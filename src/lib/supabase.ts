import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'letsstudy_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7일 유지

export interface SessionPayload {
  classroomId: string;
  ownerId: string;
  role: 'teacher' | 'supervisor';
  supervisorName?: string;
  accessToken: string;
  exp: number;
}

export function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing SUPABASE_URL');
  return url;
}

export function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error('Missing SUPABASE_ANON_KEY');
  return key;
}

/**
 * 서버 전용 관리자 클라이언트 (Auth 계정 생성 및 로그인 검증 시에만 서버 내부에서 사용)
 */
export function createAdminSupabase(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY on server');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * 로그인한 사용자(교사 또는 감독관)의 Supabase JWT 토큰으로 동작하는 RLS 적용 클라이언트
 */
export function createScopedSupabase(accessToken: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * 비로그인(anon) 상태의 클라이언트
 */
export function createAnonSupabase(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function deriveInternalAuthPassword(email: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'internal-auth-secret';
  const hmac = crypto.createHmac('sha256', secret).update(email).digest('hex').slice(0, 24);
  return ` Auth!${hmac}9zZ `;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function getSigningSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'fallback-dev-only-secret'
  );
}

export function encodeSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(data)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getServerSession(): SessionPayload | null {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return decodeSession(raw);
}

/**
 * Supabase JWT(accessToken)의 만료 시각(exp)을 확인하여 만료되었거나 10분 이내에 만료되는지 검사
 */
export function isAccessTokenExpiredOrSoon(accessToken: string, bufferSeconds = 600): boolean {
  if (!accessToken) return true;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return true;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (!payload.exp) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= payload.exp - bufferSeconds;
  } catch {
    return true;
  }
}

/**
 * 시간이 지나 Supabase JWT(기본 1시간)가 만료되었더라도,
 * 세션 쿠키가 유효하면 자동으로 내부 인증 토큰을 재발급하여 끊김 없이 학생 명단과 출석표를 유지합니다.
 */
export async function getValidServerSession(forceRefresh = false): Promise<{
  session: SessionPayload | null;
  refreshedToken: string | null;
}> {
  const session = getServerSession();
  if (!session) {
    return { session: null, refreshedToken: null };
  }

  if (!forceRefresh && !isAccessTokenExpiredOrSoon(session.accessToken)) {
    return { session, refreshedToken: null };
  }

  try {
    const admin = createAdminSupabase();
    const { data: classroom } = await admin
      .from('classrooms')
      .select('id, owner_id, supervisor_user_id')
      .eq('id', session.classroomId)
      .maybeSingle();

    if (!classroom) {
      return { session: null, refreshedToken: null };
    }

    const targetUserId =
      session.role === 'teacher' ? classroom.owner_id : classroom.supervisor_user_id;
    if (!targetUserId) {
      return { session: null, refreshedToken: null };
    }

    const { data: userLookup, error: uErr } = await admin.auth.admin.getUserById(targetUserId);
    if (uErr || !userLookup.user?.email) {
      return { session, refreshedToken: null };
    }

    const internalPw = deriveInternalAuthPassword(userLookup.user.email);
    const anon = createAnonSupabase();
    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
      email: userLookup.user.email,
      password: internalPw,
    });

    if (signInErr || !signInData.session?.access_token) {
      return { session, refreshedToken: null };
    }

    const refreshedSession: SessionPayload = {
      ...session,
      ownerId: classroom.owner_id,
      accessToken: signInData.session.access_token,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    };

    const refreshedToken = encodeSession(refreshedSession);
    return { session: refreshedSession, refreshedToken };
  } catch {
    return { session, refreshedToken: null };
  }
}

export function applySessionCookie(res: NextResponse, token: string | null): NextResponse {
  if (!token) return res;
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}

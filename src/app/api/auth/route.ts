import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  createAdminSupabase,
  createAnonSupabase,
  createScopedSupabase,
  encodeSession,
  getServerSession,
  hashPassword,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function deriveInternalAuthPassword(email: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'internal-auth-secret';
  const hmac = crypto.createHmac('sha256', secret).update(email).digest('hex').slice(0, 24);
  return ` Auth!${hmac}9zZ `;
}

function getInternalEmails(classroomTag: string) {
  return {
    teacherEmail: `teacher.${classroomTag}@letsstudy.internal`,
    supervisorEmail: `supervisor.${classroomTag}@letsstudy.internal`,
  };
}

export async function GET() {
  try {
    const admin = createAdminSupabase();
    const { data: classrooms, error } = await admin
      .from('classrooms')
      .select('id, class_name, owner_id, supervisor_user_id, created_at')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const primaryClassroom = classrooms?.[0] || null;
    const session = getServerSession();

    if (!session || !primaryClassroom || session.classroomId !== primaryClassroom.id) {
      return NextResponse.json({
        initialized: Boolean(primaryClassroom),
        authenticated: false,
        className: primaryClassroom?.class_name || '고2 우리반 오후 자습',
      });
    }

    return NextResponse.json({
      initialized: true,
      authenticated: true,
      role: session.role,
      supervisorName: session.supervisorName || '',
      classroom: {
        id: primaryClassroom.id,
        class_name: primaryClassroom.class_name,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'logout') {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    const admin = createAdminSupabase();

    if (action === 'setup') {
      const {
        className = '고2 우리반 오후 자습',
        teacherPassword,
        supervisorPassword,
        seedSampleStudents = true,
      } = body;

      if (!teacherPassword || String(teacherPassword).trim().length < 4) {
        return NextResponse.json(
          { error: '담임교사(관리자) 비밀번호를 4자 이상 입력해 주세요.' },
          { status: 400 }
        );
      }
      if (!supervisorPassword || String(supervisorPassword).trim().length < 4) {
        return NextResponse.json(
          { error: '오후 자습 감독관 비밀번호를 4자 이상 입력해 주세요.' },
          { status: 400 }
        );
      }

      const { data: existing } = await admin
        .from('classrooms')
        .select('id')
        .limit(1);

      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: '이미 초기 설정된 학급이 있습니다. 비밀번호로 로그인해 주세요.' },
          { status: 400 }
        );
      }

      const tag = crypto.randomBytes(6).toString('hex');
      const { teacherEmail, supervisorEmail } = getInternalEmails(tag);
      const teacherInternalPw = deriveInternalAuthPassword(teacherEmail);
      const supervisorInternalPw = deriveInternalAuthPassword(supervisorEmail);

      const { data: teacherUser, error: tErr } = await admin.auth.admin.createUser({
        email: teacherEmail,
        password: teacherInternalPw,
        email_confirm: true,
        user_metadata: { role: 'teacher', tag },
      });
      if (tErr || !teacherUser.user) {
        return NextResponse.json(
          { error: tErr?.message || '교사 인증 계정 생성 실패' },
          { status: 500 }
        );
      }

      const { data: supervisorUser, error: sErr } = await admin.auth.admin.createUser({
        email: supervisorEmail,
        password: supervisorInternalPw,
        email_confirm: true,
        user_metadata: { role: 'supervisor', tag },
      });
      if (sErr || !supervisorUser.user) {
        return NextResponse.json(
          { error: sErr?.message || '감독관 인증 계정 생성 실패' },
          { status: 500 }
        );
      }

      // 교사 계정으로 실제 Supabase Auth 로그인하여 RLS 토큰 획득
      const anon = createAnonSupabase();
      const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
        email: teacherEmail,
        password: teacherInternalPw,
      });
      if (signInErr || !signInData.session) {
        return NextResponse.json(
          { error: signInErr?.message || '교사 세션 발급 실패' },
          { status: 500 }
        );
      }

      const scoped = createScopedSupabase(signInData.session.access_token);
      const ownerId = teacherUser.user.id;
      const supervisorId = supervisorUser.user.id;

      const { data: createdClass, error: cErr } = await scoped
        .from('classrooms')
        .insert({
          owner_id: ownerId,
          supervisor_user_id: supervisorId,
          class_name: String(className).trim() || '고2 우리반 오후 자습',
          teacher_password_hash: hashPassword(String(teacherPassword)),
          supervisor_password_hash: hashPassword(String(supervisorPassword)),
        })
        .select('*')
        .single();

      if (cErr || !createdClass) {
        return NextResponse.json(
          { error: cErr?.message || '학급 생성 실패' },
          { status: 500 }
        );
      }

      // 기본 불참 사유 5가지 등록 (학원, 병원, 동아리, 하브루타, 기타)
      const defaultReasons = ['학원', '병원', '동아리', '하브루타', '기타'];
      await scoped.from('absence_reasons').insert(
        defaultReasons.map((label, idx) => ({
          classroom_id: createdClass.id,
          owner_id: ownerId,
          label,
          sort_order: idx + 1,
          is_default: true,
        }))
      );

      // 개인정보가 포함되지 않은 기본 번호형 학생 예시 명단 (교사가 화면에서 즉시 수정/엑셀 붙여넣기 가능)
      if (seedSampleStudents) {
        const sampleRows = Array.from({ length: 20 }, (_, i) => ({
          classroom_id: createdClass.id,
          owner_id: ownerId,
          student_number: i + 1,
          name: `${i + 1}번 학생`,
          is_active: true,
        }));
        await scoped.from('students').insert(sampleRows);
      }

      const token = encodeSession({
        classroomId: createdClass.id,
        ownerId,
        role: 'teacher',
        supervisorName: '담임선생님',
        accessToken: signInData.session.access_token,
        exp: Date.now() + 1000 * 60 * 60 * 12,
      });

      const res = NextResponse.json({
        ok: true,
        role: 'teacher',
        classroom: { id: createdClass.id, class_name: createdClass.class_name },
      });
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 12,
      });
      return res;
    }

    if (action === 'login') {
      const { role, password, supervisorName } = body;
      if (role !== 'teacher' && role !== 'supervisor') {
        return NextResponse.json({ error: '올바른 로그인 유형을 선택해 주세요.' }, { status: 400 });
      }
      if (!password) {
        return NextResponse.json({ error: '비밀번호를 입력해 주세요.' }, { status: 400 });
      }

      const { data: classrooms } = await admin
        .from('classrooms')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1);

      const classroom = classrooms?.[0];
      if (!classroom) {
        return NextResponse.json(
          { error: '아직 학급 초기 설정이 완료되지 않았습니다.' },
          { status: 404 }
        );
      }

      // 감독관 비밀번호 또는 교사 비밀번호 검증 (교사 비밀번호로 감독관 모드 진입도 허용)
      const isValid =
        role === 'teacher'
          ? verifyPassword(String(password), classroom.teacher_password_hash)
          : verifyPassword(String(password), classroom.supervisor_password_hash) ||
            verifyPassword(String(password), classroom.teacher_password_hash);

      if (!isValid) {
        return NextResponse.json(
          {
            error:
              role === 'teacher'
                ? '담임교사(관리자) 비밀번호가 일치하지 않습니다.'
                : '오후 자습 감독관 비밀번호가 일치하지 않습니다.',
          },
          { status: 401 }
        );
      }

      const targetUserId =
        role === 'teacher' ? classroom.owner_id : classroom.supervisor_user_id;
      const { data: userLookup, error: uErr } =
        await admin.auth.admin.getUserById(targetUserId);

      if (uErr || !userLookup.user?.email) {
        return NextResponse.json({ error: '내부 인증 계정 조회 실패' }, { status: 500 });
      }

      const internalPw = deriveInternalAuthPassword(userLookup.user.email);
      const anon = createAnonSupabase();
      const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
        email: userLookup.user.email,
        password: internalPw,
      });

      if (signInErr || !signInData.session) {
        return NextResponse.json({ error: '세션 토큰 생성 실패' }, { status: 500 });
      }

      const token = encodeSession({
        classroomId: classroom.id,
        ownerId: classroom.owner_id,
        role,
        supervisorName:
          role === 'teacher'
            ? '담임선생님'
            : String(supervisorName || '').trim() || '자습감독관',
        accessToken: signInData.session.access_token,
        exp: Date.now() + 1000 * 60 * 60 * 12,
      });

      const res = NextResponse.json({
        ok: true,
        role,
        supervisorName:
          role === 'teacher'
            ? '담임선생님'
            : String(supervisorName || '').trim() || '자습감독관',
        classroom: { id: classroom.id, class_name: classroom.class_name },
      });
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 12,
      });
      return res;
    }

    if (action === 'change_password') {
      const session = getServerSession();
      if (!session || session.role !== 'teacher') {
        return NextResponse.json(
          { error: '담임교사(관리자)만 비밀번호와 학급 설정을 변경할 수 있습니다.' },
          { status: 403 }
        );
      }

      const { newSupervisorPassword, newTeacherPassword, className } = body;
      const updates: Record<string, string> = {};

      if (newSupervisorPassword && String(newSupervisorPassword).trim().length >= 4) {
        updates.supervisor_password_hash = hashPassword(String(newSupervisorPassword).trim());
      }
      if (newTeacherPassword && String(newTeacherPassword).trim().length >= 4) {
        updates.teacher_password_hash = hashPassword(String(newTeacherPassword).trim());
      }
      if (className && String(className).trim().length > 0) {
        updates.class_name = String(className).trim();
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: '변경할 비밀번호(4자 이상) 또는 학급 이름을 입력해 주세요.' },
          { status: 400 }
        );
      }

      const scoped = createScopedSupabase(session.accessToken);
      const { error: uErr } = await scoped
        .from('classrooms')
        .update(updates)
        .eq('id', session.classroomId);

      if (uErr) {
        return NextResponse.json({ error: uErr.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '지원하지 않는 요청입니다.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createScopedSupabase, getServerSession } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function getMonthDateRange(monthStr: string): { startDate: string; endDate: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const startDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    lastDay
  ).padStart(2, '0')}`;
  return { startDate, endDate };
}

export async function GET(req: NextRequest) {
  try {
    const session = getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: '로그인이 필요합니다. 감독관 또는 담임교사 비밀번호로 로그인해 주세요.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const todayStr = new Date().toISOString().slice(0, 10);
    const dateParam = searchParams.get('date') || todayStr;
    const monthParam = searchParams.get('month') || dateParam.slice(0, 7);
    const { startDate, endDate } = getMonthDateRange(monthParam);

    const scoped = createScopedSupabase(session.accessToken);

    const [classRes, studentsRes, reasonsRes, attRes, confRes] = await Promise.all([
      scoped
        .from('classrooms')
        .select('id, class_name, owner_id, created_at')
        .eq('id', session.classroomId)
        .single(),
      scoped
        .from('students')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .eq('is_active', true)
        .order('student_number', { ascending: true })
        .order('name', { ascending: true }),
      scoped
        .from('absence_reasons')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      scoped
        .from('attendance_records')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .gte('study_date', startDate)
        .lte('study_date', endDate),
      scoped
        .from('supervisor_confirmations')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .gte('study_date', startDate)
        .lte('study_date', endDate),
    ]);

    if (classRes.error) {
      return NextResponse.json({ error: classRes.error.message }, { status: 403 });
    }

    return NextResponse.json({
      role: session.role,
      supervisorName: session.supervisorName || '',
      classroom: classRes.data,
      month: monthParam,
      date: dateParam,
      students: studentsRes.data || [],
      reasons: reasonsRes.data || [],
      monthAttendance: attRes.data || [],
      monthConfirmations: confRes.data || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: '로그인이 필요합니다.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action } = body;
    const scoped = createScopedSupabase(session.accessToken);

    // 1. 출석 체크 저장 (감독관 & 교사 모두 가능 — 일부 학생만 클릭해도 해당 날짜 전체 학생의 기본 '출석'이 함께 기록되어 일별 누적이 누락되지 않도록 처리)
    if (action === 'upsert_attendance') {
      const { studyDate, records } = body;
      if (!studyDate || !Array.isArray(records) || records.length === 0) {
        return NextResponse.json(
          { error: '저장할 날짜와 출석 데이터가 필요합니다.' },
          { status: 400 }
        );
      }

      const [activeStudentsRes, existingDateAttRes] = await Promise.all([
        scoped
          .from('students')
          .select('id')
          .eq('classroom_id', session.classroomId)
          .eq('is_active', true),
        scoped
          .from('attendance_records')
          .select('student_id, period8_status, period8_note, period9_status, period9_note')
          .eq('classroom_id', session.classroomId)
          .eq('study_date', studyDate),
      ]);

      const existingMap = new Map(
        (existingDateAttRes.data || []).map((r) => [r.student_id, r])
      );
      const incomingMap = new Map(
        records.map(
          (r: {
            studentId: string;
            period8Status?: string;
            period8Note?: string;
            period9Status?: string;
            period9Note?: string;
          }) => [r.studentId, r]
        )
      );

      const nowIso = new Date().toISOString();
      const allStudentIds = Array.from(
        new Set([
          ...(activeStudentsRes.data || []).map((s) => s.id),
          ...Array.from(incomingMap.keys()),
        ])
      );

      const payload = allStudentIds.map((studentId) => {
        const inc = incomingMap.get(studentId);
        const ex = existingMap.get(studentId);
        return {
          classroom_id: session.classroomId,
          owner_id: session.ownerId,
          student_id: studentId,
          study_date: studyDate,
          period8_status: inc?.period8Status || ex?.period8_status || '출석',
          period8_note: inc?.period8Note ?? ex?.period8_note ?? '',
          period9_status: inc?.period9Status || ex?.period9_status || '출석',
          period9_note: inc?.period9Note ?? ex?.period9_note ?? '',
          updated_by_role: session.role,
          updated_at: nowIso,
        };
      });

      const { data, error } = await scoped
        .from('attendance_records')
        .upsert(payload, { onConflict: 'student_id,study_date' })
        .select('*');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, records: data });
    }

    // 1-1. 특정 날짜의 출석 기록 초기화 (휴일 등 잘못 체크한 날짜의 누적 기록 제거)
    if (action === 'reset_daily_attendance') {
      const { studyDate } = body;
      if (!studyDate) {
        return NextResponse.json({ error: '초기화할 날짜가 필요합니다.' }, { status: 400 });
      }

      const admin = createAdminSupabase();
      const { error } = await admin
        .from('attendance_records')
        .delete()
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // 2. 감독 확인표 서명 및 특이사항 보고 (감독관 & 교사 모두 가능 — 서명 시 해당 날짜 출석표가 아직 미저장 상태라면 전원 출석 기준으로 자동 누적 저장)
    if (action === 'sign_confirmation') {
      const {
        studyDate,
        period8SupervisorName,
        period8Headcount,
        period9SupervisorName,
        period9Headcount,
        specialNote,
      } = body;

      if (!studyDate) {
        return NextResponse.json({ error: '날짜가 필요합니다.' }, { status: 400 });
      }

      // 해당 날짜에 아직 저장된 출석 기록이 없으면 활성 학생 전원을 기본 '출석'으로 자동 생성하여 일별 누적 보장
      const { data: existingAtt } = await scoped
        .from('attendance_records')
        .select('id')
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate)
        .limit(1);

      if (!existingAtt || existingAtt.length === 0) {
        const { data: activeStudents } = await scoped
          .from('students')
          .select('id')
          .eq('classroom_id', session.classroomId)
          .eq('is_active', true);

        if (activeStudents && activeStudents.length > 0) {
          const autoAttPayload = activeStudents.map((st) => ({
            classroom_id: session.classroomId,
            owner_id: session.ownerId,
            student_id: st.id,
            study_date: studyDate,
            period8_status: '출석',
            period8_note: '',
            period9_status: '출석',
            period9_note: '',
            updated_by_role: session.role,
            updated_at: new Date().toISOString(),
          }));
          await scoped
            .from('attendance_records')
            .upsert(autoAttPayload, { onConflict: 'student_id,study_date' });
        }
      }

      const { data: existing } = await scoped
        .from('supervisor_confirmations')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const nextP8Name =
        period8SupervisorName !== undefined
          ? String(period8SupervisorName).trim()
          : existing?.period8_supervisor_name || '';
      const nextP9Name =
        period9SupervisorName !== undefined
          ? String(period9SupervisorName).trim()
          : existing?.period9_supervisor_name || '';

      const upsertRow = {
        classroom_id: session.classroomId,
        owner_id: session.ownerId,
        study_date: studyDate,
        period8_supervisor_name: nextP8Name,
        period8_signed_at: nextP8Name
          ? existing?.period8_signed_at || nowIso
          : null,
        period8_headcount:
          period8Headcount !== undefined && period8Headcount !== null && period8Headcount !== ''
            ? Number(period8Headcount)
            : existing?.period8_headcount ?? null,
        period9_supervisor_name: nextP9Name,
        period9_signed_at: nextP9Name
          ? existing?.period9_signed_at || nowIso
          : null,
        period9_headcount:
          period9Headcount !== undefined && period9Headcount !== null && period9Headcount !== ''
            ? Number(period9Headcount)
            : existing?.period9_headcount ?? null,
        special_note:
          specialNote !== undefined
            ? String(specialNote).trim()
            : existing?.special_note || '',
        teacher_confirmed: existing?.teacher_confirmed || false,
        teacher_confirmed_at: existing?.teacher_confirmed_at || null,
        updated_at: nowIso,
      };

      const { data, error } = await scoped
        .from('supervisor_confirmations')
        .upsert(upsertRow, { onConflict: 'classroom_id,study_date' })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, confirmation: data });
    }

    // 2-1. 일별 감독관 서명 및 담임 확인 초기화 (감독관 & 담임교사 모두 가능)
    if (action === 'reset_confirmation') {
      const { studyDate, target = 'all' } = body;
      if (!studyDate) {
        return NextResponse.json({ error: '초기화할 날짜가 필요합니다.' }, { status: 400 });
      }

      const { data: existing } = await scoped
        .from('supervisor_confirmations')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ ok: true, confirmation: null });
      }

      const nowIso = new Date().toISOString();
      const resetFields =
        target === 'period8'
          ? {
              period8_supervisor_name: '',
              period8_signed_at: null,
              period8_headcount: null,
              updated_at: nowIso,
            }
          : target === 'period9'
          ? {
              period9_supervisor_name: '',
              period9_signed_at: null,
              period9_headcount: null,
              updated_at: nowIso,
            }
          : target === 'teacher'
          ? {
              teacher_confirmed: false,
              teacher_confirmed_at: null,
              updated_at: nowIso,
            }
          : {
              period8_supervisor_name: '',
              period8_signed_at: null,
              period8_headcount: null,
              period9_supervisor_name: '',
              period9_signed_at: null,
              period9_headcount: null,
              special_note: '',
              teacher_confirmed: false,
              teacher_confirmed_at: null,
              updated_at: nowIso,
            };

      const { data, error } = await scoped
        .from('supervisor_confirmations')
        .update(resetFields)
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, confirmation: data });
    }

    // 아래 기능부터는 담임교사(관리자) 전용 권한 검사
    if (session.role !== 'teacher') {
      return NextResponse.json(
        { error: '담임교사(관리자)만 실행할 수 있는 기능입니다.' },
        { status: 403 }
      );
    }

    // 3. 담임선생님 아침 확인 체크 (교사 전용 — 확인 도장 날인 시 해당 날짜 출석 기록이 아직 없으면 전원 출석 기준으로 자동 누적 저장)
    if (action === 'teacher_confirm_day') {
      const { studyDate, confirmed } = body;
      if (!studyDate) {
        return NextResponse.json({ error: '날짜가 필요합니다.' }, { status: 400 });
      }

      if (confirmed) {
        const { data: existingAtt } = await scoped
          .from('attendance_records')
          .select('id')
          .eq('classroom_id', session.classroomId)
          .eq('study_date', studyDate)
          .limit(1);

        if (!existingAtt || existingAtt.length === 0) {
          const { data: activeStudents } = await scoped
            .from('students')
            .select('id')
            .eq('classroom_id', session.classroomId)
            .eq('is_active', true);

          if (activeStudents && activeStudents.length > 0) {
            const autoAttPayload = activeStudents.map((st) => ({
              classroom_id: session.classroomId,
              owner_id: session.ownerId,
              student_id: st.id,
              study_date: studyDate,
              period8_status: '출석',
              period8_note: '',
              period9_status: '출석',
              period9_note: '',
              updated_by_role: session.role,
              updated_at: new Date().toISOString(),
            }));
            await scoped
              .from('attendance_records')
              .upsert(autoAttPayload, { onConflict: 'student_id,study_date' });
          }
        }
      }

      const { data: existing } = await scoped
        .from('supervisor_confirmations')
        .select('*')
        .eq('classroom_id', session.classroomId)
        .eq('study_date', studyDate)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const upsertRow = {
        classroom_id: session.classroomId,
        owner_id: session.ownerId,
        study_date: studyDate,
        period8_supervisor_name: existing?.period8_supervisor_name || '',
        period8_signed_at: existing?.period8_signed_at || null,
        period8_headcount: existing?.period8_headcount ?? null,
        period9_supervisor_name: existing?.period9_supervisor_name || '',
        period9_signed_at: existing?.period9_signed_at || null,
        period9_headcount: existing?.period9_headcount ?? null,
        special_note: existing?.special_note || '',
        teacher_confirmed: Boolean(confirmed),
        teacher_confirmed_at: confirmed ? nowIso : null,
        updated_at: nowIso,
      };

      const { data, error } = await scoped
        .from('supervisor_confirmations')
        .upsert(upsertRow, { onConflict: 'classroom_id,study_date' })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, confirmation: data });
    }

    // 4. 학생 개별 추가 (교사 전용)
    if (action === 'add_student') {
      const { name, studentNumber } = body;
      if (!name || !String(name).trim()) {
        return NextResponse.json({ error: '학생 이름을 입력해 주세요.' }, { status: 400 });
      }

      let nextNum = Number(studentNumber);
      if (!nextNum || Number.isNaN(nextNum)) {
        const { data: currentStudents } = await scoped
          .from('students')
          .select('student_number')
          .eq('classroom_id', session.classroomId)
          .order('student_number', { ascending: false })
          .limit(1);
        nextNum = (currentStudents?.[0]?.student_number || 0) + 1;
      }

      const { data, error } = await scoped
        .from('students')
        .insert({
          classroom_id: session.classroomId,
          owner_id: session.ownerId,
          student_number: nextNum,
          name: String(name).trim(),
          is_active: true,
        })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, student: data });
    }

    // 5. 학생 명단 일괄 등록/교체 (엑셀 복붙 지원, 교사 전용)
    if (action === 'bulk_add_students') {
      const { rawText, replaceExisting } = body;
      if (!rawText || !String(rawText).trim()) {
        return NextResponse.json(
          { error: '줄바꿈 또는 쉼표로 구분된 학생 명단을 입력해 주세요.' },
          { status: 400 }
        );
      }

      const lines = String(rawText)
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return NextResponse.json({ error: '유효한 학생 이름이 없습니다.' }, { status: 400 });
      }

      if (replaceExisting) {
        await scoped.from('students').delete().eq('classroom_id', session.classroomId);
      }

      const { data: currentMax } = await scoped
        .from('students')
        .select('student_number')
        .eq('classroom_id', session.classroomId)
        .order('student_number', { ascending: false })
        .limit(1);

      let startNum = replaceExisting ? 1 : (currentMax?.[0]?.student_number || 0) + 1;

      const rowsToInsert = lines.map((line) => {
        const match = /^(\d+)[\s.\-\t]+(.+)$/.exec(line);
        if (match) {
          return {
            classroom_id: session.classroomId,
            owner_id: session.ownerId,
            student_number: Number(match[1]),
            name: match[2].trim(),
            is_active: true,
          };
        }
        const row = {
          classroom_id: session.classroomId,
          owner_id: session.ownerId,
          student_number: startNum,
          name: line,
          is_active: true,
        };
        startNum += 1;
        return row;
      });

      const { data, error } = await scoped
        .from('students')
        .insert(rowsToInsert)
        .select('*');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, students: data });
    }

    // 6. 학생 정보 수정 (교사 전용)
    if (action === 'update_student') {
      const { studentId, name, studentNumber } = body;
      if (!studentId || !name || !String(name).trim()) {
        return NextResponse.json({ error: '학생 ID와 이름이 필요합니다.' }, { status: 400 });
      }

      const { data, error } = await scoped
        .from('students')
        .update({
          name: String(name).trim(),
          student_number: Number(studentNumber) || 1,
        })
        .eq('id', studentId)
        .eq('classroom_id', session.classroomId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, student: data });
    }

    // 7. 학생 삭제 (교사 전용)
    if (action === 'delete_student') {
      const { studentId } = body;
      if (!studentId) {
        return NextResponse.json({ error: '삭제할 학생 ID가 필요합니다.' }, { status: 400 });
      }

      const { error } = await scoped
        .from('students')
        .delete()
        .eq('id', studentId)
        .eq('classroom_id', session.classroomId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // 8. 결석(불참) 사유 추가 (교사 전용)
    if (action === 'add_reason') {
      const { label } = body;
      const cleanLabel = String(label || '').trim();
      if (!cleanLabel) {
        return NextResponse.json({ error: '추가할 결석 사유 이름을 입력해 주세요.' }, { status: 400 });
      }
      if (cleanLabel === '출석') {
        return NextResponse.json({ error: '"출석"은 결석 사유로 추가할 수 없습니다.' }, { status: 400 });
      }

      const { data: currentReasons } = await scoped
        .from('absence_reasons')
        .select('sort_order')
        .eq('classroom_id', session.classroomId)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextOrder = (currentReasons?.[0]?.sort_order || 0) + 1;

      const { data, error } = await scoped
        .from('absence_reasons')
        .insert({
          classroom_id: session.classroomId,
          owner_id: session.ownerId,
          label: cleanLabel,
          sort_order: nextOrder,
          is_default: false,
        })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json(
          { error: '이미 존재하는 사유이거나 추가할 수 없습니다.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, reason: data });
    }

    // 9. 결석(불참) 사유 삭제 (교사 전용)
    if (action === 'delete_reason') {
      const { reasonId } = body;
      if (!reasonId) {
        return NextResponse.json({ error: '삭제할 사유 ID가 필요합니다.' }, { status: 400 });
      }

      const { error } = await scoped
        .from('absence_reasons')
        .delete()
        .eq('id', reasonId)
        .eq('classroom_id', session.classroomId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '지원하지 않는 요청입니다.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

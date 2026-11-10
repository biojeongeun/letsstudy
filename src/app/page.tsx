'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  AlertCircle,
  Award,
  Check,
  X,
} from 'lucide-react';

interface Student {
  id: string;
  student_number: number;
  name: string;
  is_active: boolean;
}

interface AbsenceReason {
  id: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

interface AttendanceRecord {
  id?: string;
  student_id: string;
  study_date: string;
  period8_status: string;
  period8_note: string;
  period9_status: string;
  period9_note: string;
  updated_by_role?: string;
  updated_at?: string;
}

interface SupervisorConfirmation {
  id?: string;
  study_date: string;
  period8_supervisor_name: string;
  period8_signed_at: string | null;
  period8_headcount: number | null;
  period9_supervisor_name: string;
  period9_signed_at: string | null;
  period9_headcount: number | null;
  special_note: string;
  teacher_confirmed: boolean;
  teacher_confirmed_at: string | null;
}

type Role = 'teacher' | 'supervisor';
type ActiveTab = 'attendance' | 'supervisor_sheet' | 'monthly_stats' | 'admin';

const MINUTES_PER_PERIOD = 50; // 8교시(16:20~17:10) 50분, 9교시(17:20~18:10) 50분

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMinutesToKorean(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0분';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}분`;
  if (mins === 0) return `${hours}시간 (${totalMinutes}분)`;
  return `${hours}시간 ${mins}분 (${totalMinutes}분)`;
}

/**
 * 선택한 월(YYYY-MM)의 평일(월~금)을 주차별 5칸 배열로 반환 (첨부 사진 1번 '오후 자습 감독 확인표' 레이아웃)
 */
function getMonthWeekdayWeeks(monthStr: string): Array<Array<{ dateStr: string; label: string } | null>> {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();

  const weeks: Array<Array<{ dateStr: string; label: string } | null>> = [];
  let currentWeek: Array<{ dateStr: string; label: string } | null> = [null, null, null, null, null];
  let hasWeekdayInCurrentWeek = false;

  for (let d = 1; d <= lastDay; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay(); // 0=일, 1=월 ... 5=금, 6=토
    if (dow >= 1 && dow <= 5) {
      const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      currentWeek[dow - 1] = {
        dateStr,
        label: `${month}월 ${d}일`,
      };
      hasWeekdayInCurrentWeek = true;
    }
    if (dow === 6 || d === lastDay) {
      if (hasWeekdayInCurrentWeek) {
        weeks.push(currentWeek);
        currentWeek = [null, null, null, null, null];
        hasWeekdayInCurrentWeek = false;
      }
    }
  }
  return weeks;
}

export default function HomePage() {
  // 인증 및 초기 설정 상태
  const [authLoading, setAuthLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>('supervisor');
  const [supervisorName, setSupervisorName] = useState('');
  const [className, setClassName] = useState('고2 우리반 오후 자습');

  // 로그인 / 초기 설정 폼 상태
  const [loginMode, setLoginMode] = useState<Role>('supervisor');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSupervisorName, setLoginSupervisorName] = useState('');
  const [setupClassName, setSetupClassName] = useState('고2 우리반 오후 자습');
  const [setupTeacherPassword, setSetupTeacherPassword] = useState('');
  const [setupSupervisorPassword, setSetupSupervisorPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // 메인 탭 및 날짜/월 상태
  const [activeTab, setActiveTab] = useState<ActiveTab>('attendance');
  const [selectedDate, setSelectedDate] = useState<string>(() => formatLocalDate(new Date()));
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    formatLocalDate(new Date()).slice(0, 7)
  );

  // 학급 데이터 상태
  const [students, setStudents] = useState<Student[]>([]);
  const [reasons, setReasons] = useState<AbsenceReason[]>([]);
  const [monthAttendance, setMonthAttendance] = useState<AttendanceRecord[]>([]);
  const [monthConfirmations, setMonthConfirmations] = useState<SupervisorConfirmation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 일일 출석표 로컬 편집 버퍼 (selectedDate 기준)
  const [dailyDraft, setDailyDraft] = useState<
    Record<
      string,
      {
        period8Status: string;
        period8Note: string;
        period9Status: string;
        period9Note: string;
      }
    >
  >({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [excelCompactMode, setExcelCompactMode] = useState(false);

  // 일일/선택일 감독관 확인 서명 모달/폼 상태
  const [signingDate, setSigningDate] = useState<string>(() => formatLocalDate(new Date()));
  const [signP8Name, setSignP8Name] = useState('');
  const [signP8Headcount, setSignP8Headcount] = useState<string>('');
  const [signP9Name, setSignP9Name] = useState('');
  const [signP9Headcount, setSignP9Headcount] = useState<string>('');
  const [signSpecialNote, setSignSpecialNote] = useState('');
  const [savingSignature, setSavingSignature] = useState(false);

  // 학생 개인별 상세 모달 (언제 결석했는지, 얼마나 참여했는지)
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);

  // 관리자(교사) 전용 폼 상태
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentNumber, setNewStudentNumber] = useState('');
  const [bulkStudentsText, setBulkStudentsText] = useState('');
  const [bulkReplaceMode, setBulkReplaceMode] = useState(true);
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [adminNewSupervisorPw, setAdminNewSupervisorPw] = useState('');
  const [adminNewTeacherPw, setAdminNewTeacherPw] = useState('');
  const [adminClassName, setAdminClassName] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // 인증 상태 확인
  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth', { cache: 'no-store' });
      const data = await res.json();
      setInitialized(Boolean(data.initialized));
      setAuthenticated(Boolean(data.authenticated));
      if (data.className) {
        setClassName(data.className);
        setAdminClassName(data.className);
      }
      if (data.authenticated) {
        setRole(data.role || 'supervisor');
        setSupervisorName(data.supervisorName || '');
        if (data.classroom?.class_name) {
          setClassName(data.classroom.class_name);
          setAdminClassName(data.classroom.class_name);
        }
      }
    } catch {
      // ignore
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 학급 데이터 불러오기
  const fetchStudyData = useCallback(
    async (targetMonth = selectedMonth, targetDate = selectedDate) => {
      if (!authenticated) return;
      setDataLoading(true);
      try {
        const res = await fetch(
          `/api/study?month=${encodeURIComponent(targetMonth)}&date=${encodeURIComponent(
            targetDate
          )}`,
          { cache: 'no-store' }
        );
        if (res.status === 401) {
          setAuthenticated(false);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          setStudents(data.students || []);
          setReasons(data.reasons || []);
          setMonthAttendance(data.monthAttendance || []);
          setMonthConfirmations(data.monthConfirmations || []);
          if (data.classroom?.class_name) {
            setClassName(data.classroom.class_name);
            setAdminClassName(data.classroom.class_name);
          }
        }
      } finally {
        setDataLoading(false);
      }
    },
    [authenticated, selectedMonth, selectedDate]
  );

  useEffect(() => {
    if (authenticated) {
      fetchStudyData(selectedMonth, selectedDate);
    }
  }, [authenticated, selectedMonth, selectedDate, fetchStudyData]);

  // 날짜 변경 시 월이 바뀌면 selectedMonth도 동기화
  const handleDateChange = (nextDate: string) => {
    setSelectedDate(nextDate);
    setSigningDate(nextDate);
    const nextMonth = nextDate.slice(0, 7);
    if (nextMonth !== selectedMonth) {
      setSelectedMonth(nextMonth);
    }
  };

  const shiftDateByDays = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    handleDateChange(formatLocalDate(dt));
  };

  const shiftMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    const nextM = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(nextM);
  };

  // selectedDate 또는 monthAttendance/students 변경 시 일일 출석표 로컬 버퍼 동기화
  useEffect(() => {
    const map: Record<
      string,
      {
        period8Status: string;
        period8Note: string;
        period9Status: string;
        period9Note: string;
      }
    > = {};

    const dateRecords = monthAttendance.filter((r) => r.study_date === selectedDate);
    const byStudent = new Map(dateRecords.map((r) => [r.student_id, r]));

    for (const st of students) {
      const rec = byStudent.get(st.id);
      map[st.id] = {
        period8Status: rec?.period8_status || '출석',
        period8Note: rec?.period8_note || '',
        period9Status: rec?.period9_status || '출석',
        period9Note: rec?.period9_note || '',
      };
    }
    setDailyDraft(map);
  }, [students, monthAttendance, selectedDate]);

  // signingDate 변경 시 해당 날짜의 감독관 서명 정보 동기화
  useEffect(() => {
    const conf = monthConfirmations.find((c) => c.study_date === signingDate);
    if (conf) {
      setSignP8Name(conf.period8_supervisor_name || '');
      setSignP8Headcount(
        conf.period8_headcount !== null && conf.period8_headcount !== undefined
          ? String(conf.period8_headcount)
          : ''
      );
      setSignP9Name(conf.period9_supervisor_name || '');
      setSignP9Headcount(
        conf.period9_headcount !== null && conf.period9_headcount !== undefined
          ? String(conf.period9_headcount)
          : ''
      );
      setSignSpecialNote(conf.special_note || '');
    } else {
      setSignP8Name(supervisorName || '');
      setSignP8Headcount('');
      setSignP9Name(supervisorName || '');
      setSignP9Headcount('');
      setSignSpecialNote('');
    }
  }, [signingDate, monthConfirmations, supervisorName]);

  // 당일 8교시/9교시 출석 인원 실시간 계산
  const dailySummary = useMemo(() => {
    let p8Present = 0;
    let p9Present = 0;
    const p8ReasonCounts: Record<string, number> = {};
    const p9ReasonCounts: Record<string, number> = {};

    for (const st of students) {
      const row = dailyDraft[st.id];
      const s8 = row?.period8Status || '출석';
      const s9 = row?.period9Status || '출석';

      if (s8 === '출석') p8Present += 1;
      else p8ReasonCounts[s8] = (p8ReasonCounts[s8] || 0) + 1;

      if (s9 === '출석') p9Present += 1;
      else p9ReasonCounts[s9] = (p9ReasonCounts[s9] || 0) + 1;
    }

    return {
      total: students.length,
      p8Present,
      p8Absent: students.length - p8Present,
      p9Present,
      p9Absent: students.length - p9Present,
      p8ReasonCounts,
      p9ReasonCounts,
    };
  }, [students, dailyDraft]);

  // 월별 학생 개인별 누적 자습시간 및 결석 이력 계산
  const studentMonthlyStats = useMemo(() => {
    const recordedDates = Array.from(new Set(monthAttendance.map((r) => r.study_date))).sort();
    const totalPossiblePeriods = recordedDates.length * 2;

    return students.map((st) => {
      const records = monthAttendance
        .filter((r) => r.student_id === st.id)
        .sort((a, b) => a.study_date.localeCompare(b.study_date));

      let p8Attended = 0;
      let p9Attended = 0;
      const reasonBreakdown: Record<string, number> = {};
      const absenceHistory: Array<{
        date: string;
        period: '8교시' | '9교시';
        reason: string;
        note: string;
      }> = [];

      for (const r of records) {
        if (r.period8_status === '출석') {
          p8Attended += 1;
        } else {
          reasonBreakdown[r.period8_status] = (reasonBreakdown[r.period8_status] || 0) + 1;
          absenceHistory.push({
            date: r.study_date,
            period: '8교시',
            reason: r.period8_status,
            note: r.period8_note || '',
          });
        }

        if (r.period9_status === '출석') {
          p9Attended += 1;
        } else {
          reasonBreakdown[r.period9_status] = (reasonBreakdown[r.period9_status] || 0) + 1;
          absenceHistory.push({
            date: r.study_date,
            period: '9교시',
            reason: r.period9_status,
            note: r.period9_note || '',
          });
        }
      }

      const totalAttendedPeriods = p8Attended + p9Attended;
      const totalMinutes = totalAttendedPeriods * MINUTES_PER_PERIOD;
      const attendanceRate =
        totalPossiblePeriods > 0
          ? Math.round((totalAttendedPeriods / totalPossiblePeriods) * 100)
          : 100;

      return {
        student: st,
        p8Attended,
        p9Attended,
        totalAttendedPeriods,
        totalMinutes,
        attendanceRate,
        reasonBreakdown,
        absenceHistory,
        recordsCount: records.length,
      };
    });
  }, [students, monthAttendance]);

  // 초기 설정 제출 핸들러
  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setup',
          className: setupClassName,
          teacherPassword: setupTeacherPassword,
          supervisorPassword: setupSupervisorPassword,
          seedSampleStudents: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || '초기 설정 중 오류가 발생했습니다.');
        return;
      }
      setSetupTeacherPassword('');
      setSetupSupervisorPassword('');
      await checkAuth();
      showToast('학급 초기 설정이 완료되었습니다! 담임교사 관리자 모드로 시작합니다.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // 로그인 핸들러 (감독관 / 담임교사)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          role: loginMode,
          password: loginPassword,
          supervisorName: loginSupervisorName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || '로그인에 실패했습니다.');
        return;
      }
      setLoginPassword('');
      await checkAuth();
      showToast(
        loginMode === 'teacher'
          ? '담임교사(관리자) 모드로 로그인되었습니다.'
          : `${data.supervisorName || '오후 자습 감독관'} 모드로 로그인되었습니다.`
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  // 로그아웃 핸들러
  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setAuthenticated(false);
    setActiveTab('attendance');
  };

  // 개별 학생의 8교시 또는 9교시 출석 상태 변경 및 즉시 저장
  const handleSelectPeriodStatus = async (
    studentId: string,
    period: 8 | 9,
    nextStatus: string
  ) => {
    const current = dailyDraft[studentId] || {
      period8Status: '출석',
      period8Note: '',
      period9Status: '출석',
      period9Note: '',
    };

    const updated = {
      ...current,
      ...(period === 8 ? { period8Status: nextStatus } : { period9Status: nextStatus }),
    };

    setDailyDraft((prev) => ({
      ...prev,
      [studentId]: updated,
    }));

    // 서버에 즉시 반영
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_attendance',
          studyDate: selectedDate,
          records: [
            {
              studentId,
              period8Status: updated.period8Status,
              period8Note: updated.period8Note,
              period9Status: updated.period9Status,
              period9Note: updated.period9Note,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const savedRecord = data.records?.[0];
        if (savedRecord) {
          setMonthAttendance((prev) => {
            const filtered = prev.filter(
              (r) => !(r.student_id === studentId && r.study_date === selectedDate)
            );
            return [...filtered, savedRecord];
          });
        }
      }
    } catch {
      // ignore transient error; user can also click bulk save
    }
  };

  // 전체 출석체크 일괄 저장
  const handleSaveAllDailyAttendance = async () => {
    if (students.length === 0) return;
    setSavingAttendance(true);
    try {
      const records = students.map((st) => {
        const d = dailyDraft[st.id] || {
          period8Status: '출석',
          period8Note: '',
          period9Status: '출석',
          period9Note: '',
        };
        return {
          studentId: st.id,
          period8Status: d.period8Status,
          period8Note: d.period8Note,
          period9Status: d.period9Status,
          period9Note: d.period9Note,
        };
      });

      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_attendance',
          studyDate: selectedDate,
          records,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchStudyData(selectedMonth, selectedDate);
        showToast(`${selectedDate} 오후 자습(8·9교시) 출석표가 저장되었습니다!`);
      } else {
        showToast(data.error || '출석 저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSavingAttendance(false);
    }
  };

  // 8교시 상태 -> 9교시로 동일 복사
  const handleCopyPeriod8ToPeriod9 = () => {
    setDailyDraft((prev) => {
      const next = { ...prev };
      for (const st of students) {
        const cur = next[st.id] || {
          period8Status: '출석',
          period8Note: '',
          period9Status: '출석',
          period9Note: '',
        };
        next[st.id] = {
          ...cur,
          period9Status: cur.period8Status,
          period9Note: cur.period8Note,
        };
      }
      return next;
    });
    showToast('8교시 출결 상태를 9교시로 복사했습니다. [전체 출석표 저장]을 눌러 확정하세요.');
  };

  // 감독 확인표 서명 저장 핸들러
  const handleSaveSupervisorConfirmation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingSignature(true);
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sign_confirmation',
          studyDate: signingDate,
          period8SupervisorName: signP8Name,
          period8Headcount:
            signP8Headcount !== '' ? Number(signP8Headcount) : dailySummary.p8Present,
          period9SupervisorName: signP9Name,
          period9Headcount:
            signP9Headcount !== '' ? Number(signP9Headcount) : dailySummary.p9Present,
          specialNote: signSpecialNote,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchStudyData(selectedMonth, selectedDate);
        showToast(`${signingDate} 오후 자습 감독 확인표(8·9교시 서명)가 기록되었습니다!`);
      } else {
        showToast(data.error || '서명 저장 실패');
      }
    } finally {
      setSavingSignature(false);
    }
  };

  // 담임선생님 아침 확인 토글 핸들러 (교사 전용)
  const handleToggleTeacherConfirm = async (targetDate: string, nextConfirmed: boolean) => {
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'teacher_confirm_day',
        studyDate: targetDate,
        confirmed: nextConfirmed,
      }),
    });
    if (res.ok) {
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(
        nextConfirmed
          ? `${targetDate} 자습 감독표를 담임선생님 확인 완료 처리했습니다.`
          : `${targetDate} 담임선생님 확인을 취소했습니다.`
      );
    }
  };

  // 학생 개별 추가 (교사 전용)
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim()) return;
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_student',
        name: newStudentName.trim(),
        studentNumber: newStudentNumber ? Number(newStudentNumber) : undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewStudentName('');
      setNewStudentNumber('');
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(`학생 "${data.student?.name}"이(가) 명단에 추가되었습니다.`);
    } else {
      showToast(data.error || '학생 추가 실패');
    }
  };

  // 학생 명단 일괄 붙여넣기 (교사 전용)
  const handleBulkAddStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkStudentsText.trim()) return;
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bulk_add_students',
        rawText: bulkStudentsText,
        replaceExisting: bulkReplaceMode,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setBulkStudentsText('');
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(`총 ${data.students?.length || 0}명의 학생 명단이 등록되었습니다.`);
    } else {
      showToast(data.error || '일괄 등록 실패');
    }
  };

  // 학생 삭제 (교사 전용)
  const handleDeleteStudent = async (studentId: string, name: string) => {
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_student',
        studentId,
      }),
    });
    if (res.ok) {
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(`"${name}" 학생이 명단에서 제외되었습니다.`);
    }
  };

  // 결석 사유 추가 (교사 전용)
  const handleAddReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReasonLabel.trim()) return;
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_reason',
        label: newReasonLabel.trim(),
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewReasonLabel('');
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(`불참 사유 "${data.reason?.label}"이(가) 추가되었습니다.`);
    } else {
      showToast(data.error || '사유 추가 실패');
    }
  };

  // 결석 사유 삭제 (교사 전용)
  const handleDeleteReason = async (reasonId: string, label: string) => {
    const res = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_reason',
        reasonId,
      }),
    });
    if (res.ok) {
      await fetchStudyData(selectedMonth, selectedDate);
      showToast(`불참 사유 "${label}"이(가) 삭제되었습니다.`);
    }
  };

  // 비밀번호 및 학급명 변경 (교사 전용)
  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'change_password',
        className: adminClassName,
        newSupervisorPassword: adminNewSupervisorPw || undefined,
        newTeacherPassword: adminNewTeacherPw || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setAdminNewSupervisorPw('');
      setAdminNewTeacherPw('');
      setClassName(adminClassName);
      showToast('학급 이름 및 비밀번호 설정이 저장되었습니다.');
    } else {
      showToast(data.error || '설정 변경 실패');
    }
  };

  const monthWeeks = useMemo(() => getMonthWeekdayWeeks(selectedMonth), [selectedMonth]);
  const confirmationsByDate = useMemo(
    () => new Map(monthConfirmations.map((c) => [c.study_date, c])),
    [monthConfirmations]
  );

  const selectedDetailStat = useMemo(
    () => studentMonthlyStats.find((s) => s.student.id === detailStudentId) || null,
    [studentMonthlyStats, detailStudentId]
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
          <p className="text-sm font-medium text-slate-300">
            오후 자습 출석 & 감독 시스템을 불러오는 중입니다...
          </p>
        </div>
      </div>
    );
  }

  // 비로그인 상태 화면 (초기 설정 또는 감독관/담임교사 비밀번호 로그인)
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-amber-400 px-6 py-5 border-b-2 border-slate-900">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-900 text-amber-300">
                <BookOpen className="w-3.5 h-3.5" /> 독학자습 관리 시스템
              </span>
              <span className="text-xs font-bold text-slate-800">
                8교시(16:20~17:10) · 9교시(17:20~18:10)
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 tracking-tight">
              {className} 출석 & 감독 확인표
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-800">
              오후 자습 감독관 또는 담임교사(관리자) 비밀번호로 로그인하세요.
            </p>
          </div>

          <div className="p-6">
            {!initialized ? (
              <form onSubmit={handleInitialSetup} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-950 space-y-1">
                  <p className="font-bold flex items-center gap-1.5 text-indigo-900">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    첫 접속 환영합니다! 우리 반 초기 비밀번호를 설정해 주세요.
                  </p>
                  <p className="text-indigo-700 leading-relaxed">
                    담임선생님용 관리자 비밀번호와 오후 자습 감독관 학생들이 함께 사용할 비밀번호를 지정하면,
                    기본 결석 사유(학원·병원·동아리·하브루타·기타)와 학급 출석부가 즉시 생성됩니다.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    학급 명칭
                  </label>
                  <input
                    type="text"
                    required
                    value={setupClassName}
                    onChange={(e) => setSetupClassName(e.target.value)}
                    placeholder="예: 2학년 3반 오후 자습"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    담임교사(관리자) 비밀번호 지정 (4자 이상)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={setupTeacherPassword}
                    onChange={(e) => setSetupTeacherPassword(e.target.value)}
                    placeholder="선생님만 사용할 관리자 비밀번호 입력"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    오후 자습 감독관 공유 비밀번호 지정 (4자 이상)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={setupSupervisorPassword}
                    onChange={(e) => setSetupSupervisorPassword(e.target.value)}
                    placeholder="자습 감독관 학생들이 로그인할 비밀번호 입력"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                  />
                </div>

                {authError && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {authSubmitting ? '학급 자습실 생성 중...' : '우리 반 자습 시스템 시작하기'}
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                {/* 역할 선택 탭 */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginMode('supervisor');
                      setAuthError('');
                    }}
                    className={`py-2.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      loginMode === 'supervisor'
                        ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserCheck className="w-4 h-4 text-amber-600" />
                    오후 자습 감독관 로그인
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginMode('teacher');
                      setAuthError('');
                    }}
                    className={`py-2.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      loginMode === 'teacher'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    담임교사(관리자) 로그인
                  </button>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  {loginMode === 'supervisor' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        오늘의 감독관 이름 (서명란 자동 입력용 · 선택)
                      </label>
                      <input
                        type="text"
                        value={loginSupervisorName}
                        onChange={(e) => setLoginSupervisorName(e.target.value)}
                        placeholder="예: 홍길동 (감독관 서명에 사용됩니다)"
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {loginMode === 'supervisor'
                        ? '오후 자습 감독관 비밀번호'
                        : '담임교사(관리자) 비밀번호'}
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder={
                          loginMode === 'supervisor'
                            ? '감독관 공유 비밀번호를 입력하세요'
                            : '담임교사 관리자 비밀번호를 입력하세요'
                        }
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className={`w-full py-3 rounded-xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 ${
                      loginMode === 'supervisor'
                        ? 'bg-slate-900 hover:bg-slate-800 text-amber-300'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {loginMode === 'supervisor' ? (
                      <>
                        <UserCheck className="w-4 h-4" />
                        {authSubmitting ? '확인 중...' : '감독관 출석체크 화면 입장'}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        {authSubmitting ? '확인 중...' : '담임교사 관리자 화면 입장'}
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-3 border-t border-slate-200 text-[11px] text-slate-600 space-y-1">
                  <p>* 오후 자습 감독관은 매일 오후 자습 시작 전 칠판에 교내 인원을 적고 출석체크 표에 체크합니다.</p>
                  <p>* 9교시 종료 직후 감독 확인표에 서명하고 다음 날 아침 담임선생님께 확인받습니다.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      {/* 토스트 알림 */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-amber-400/50 flex items-center gap-2.5 text-xs font-bold animate-bounce no-print">
          <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 상단 네비게이션 헤더 */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 no-print">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-lg shadow">
              自
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                  {className}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    role === 'teacher'
                      ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40'
                      : 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                  }`}
                >
                  {role === 'teacher'
                    ? '👨‍🏫 담임교사(관리자)'
                    : `📋 오후 자습 감독관 (${supervisorName || '근무중'})`}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                8교시 <strong className="text-amber-300">16:20~17:10 (50분)</strong> · 9교시{' '}
                <strong className="text-amber-300">17:20~18:10 (50분)</strong> 독학자습 출석 관리
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
            >
              <Printer className="w-3.5 h-3.5" />
              화면 인쇄
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 text-xs font-semibold flex items-center gap-1.5 border border-rose-500/30"
            >
              <LogOut className="w-3.5 h-3.5" />
              로그아웃
            </button>
          </div>
        </div>

        {/* 메인 기능 탭 바 */}
        <div className="bg-slate-950/60 border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto gap-1 py-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('attendance')}
              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'attendance'
                  ? 'bg-amber-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              1. 오후 자습 출석표 (8·9교시 체크)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('supervisor_sheet')}
              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'supervisor_sheet'
                  ? 'bg-amber-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              2. 오후 자습 감독 확인표 (월간 서명표)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('monthly_stats')}
              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'monthly_stats'
                  ? 'bg-amber-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              3. 월별 학생 누적 자습시간 & 통계
            </button>

            {role === 'teacher' && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-indigo-500 text-white shadow'
                    : 'text-indigo-300 hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                4. 담임교사 관리 (명단·사유·결석조회·비밀번호)
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 본문 영역 */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-6">
        {/* ==================== TAB 1: 오후 자습 출석표 (불참 시 사유작성) ==================== */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            {/* 상단 독학재수학원 스타일 칠판 전광판 & 날짜 컨트롤 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    출석체크 일자 선택
                  </span>
                  {dataLoading && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  )}
                </div>
                <div className="my-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftDateByDays(-1)}
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                    title="이전 날짜"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 font-extrabold text-sm text-center focus:ring-2 focus:ring-indigo-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => shiftDateByDays(1)}
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                    title="다음 날짜"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleDateChange(formatLocalDate(new Date()))}
                    className="text-xs font-bold text-indigo-600 hover:underline"
                  >
                    오늘 날짜로 이동
                  </button>
                  <button
                    type="button"
                    onClick={() => setExcelCompactMode((v) => !v)}
                    className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    {excelCompactMode ? '버튼형 체크 보기' : '엑셀 인쇄형 표 보기'}
                  </button>
                </div>
              </div>

              {/* 칠판 게시용 8교시 / 9교시 재실 인원 현황 */}
              <div className="lg:col-span-2 bg-emerald-950 text-white rounded-2xl p-5 shadow-md border-4 border-amber-700/80 flex flex-col justify-between">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-xs font-black">
                      칠판 인원 현황판
                    </span>
                    <span className="text-sm font-bold text-emerald-100">
                      {selectedDate} 오후 자습 재실 인원 (총원 {dailySummary.total}명)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPeriod8ToPeriod9}
                      className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-bold transition"
                    >
                      8교시 → 9교시 상태 복사
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAllDailyAttendance}
                      disabled={savingAttendance}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingAttendance ? '저장 중...' : '전체 출석표 확정 저장'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
                  <div className="bg-emerald-900/60 rounded-xl p-3 border border-emerald-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">
                        8교시 (16:20 ~ 17:10 · 50분)
                      </span>
                      <span className="text-lg font-black text-amber-300">
                        출석 {dailySummary.p8Present}명{' '}
                        <span className="text-xs font-normal text-emerald-300">
                          / 불참 {dailySummary.p8Absent}명
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-emerald-200">
                      {Object.entries(dailySummary.p8ReasonCounts).length === 0 ? (
                        <span>전원 8교시 출석</span>
                      ) : (
                        Object.entries(dailySummary.p8ReasonCounts).map(([reason, cnt]) => (
                          <span
                            key={reason}
                            className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700"
                          >
                            {reason} {cnt}명
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-emerald-900/60 rounded-xl p-3 border border-emerald-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">
                        9교시 (17:20 ~ 18:10 · 50분)
                      </span>
                      <span className="text-lg font-black text-amber-300">
                        출석 {dailySummary.p9Present}명{' '}
                        <span className="text-xs font-normal text-emerald-300">
                          / 불참 {dailySummary.p9Absent}명
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-emerald-200">
                      {Object.entries(dailySummary.p9ReasonCounts).length === 0 ? (
                        <span>전원 9교시 출석</span>
                      ) : (
                        Object.entries(dailySummary.p9ReasonCounts).map(([reason, cnt]) => (
                          <span
                            key={reason}
                            className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700"
                          >
                            {reason} {cnt}명
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 첨부 사진 2번 스타일: 오후 자습 출석표 (불참 시 사유작성) */}
            <div className="bg-white rounded-2xl shadow-sm border-2 border-slate-900 overflow-hidden">
              <div className="bg-slate-100 border-b-2 border-slate-900 px-6 py-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-950">
                    오후 자습 출석표 (불참 시 사유작성)
                  </h2>
                  <p className="text-xs font-semibold text-slate-600 mt-0.5">
                    일자: {selectedDate} | 버튼을 누르면 즉시 출석 또는 불참 사유(
                    {reasons.map((r) => r.label).join(', ')})가 체크됩니다.
                  </p>
                </div>
                {role === 'teacher' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('admin')}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-200 no-print"
                  >
                    + 학생 명단 / 불참 사유 편집
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b-2 border-slate-900 text-slate-900 font-extrabold">
                      <th className="py-3 px-4 border-r border-slate-300 w-36 text-center">
                        학생 성명
                      </th>
                      <th className="py-3 px-4 border-r border-slate-300 text-center">
                        8교시{' '}
                        <span className="text-xs font-semibold text-slate-600">
                          (16:20~17:10)
                        </span>
                      </th>
                      <th className="py-3 px-4 border-r border-slate-300 text-center">
                        9교시{' '}
                        <span className="text-xs font-semibold text-slate-600">
                          (17:20~18:10)
                        </span>
                      </th>
                      <th className="py-3 px-4 w-56 text-center no-print">
                        상세 메모 (기타 사유 등)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {students.map((st) => {
                      const row = dailyDraft[st.id] || {
                        period8Status: '출석',
                        period8Note: '',
                        period9Status: '출석',
                        period9Note: '',
                      };
                      const options = ['출석', ...reasons.map((r) => r.label)];

                      return (
                        <tr key={st.id} className="hover:bg-slate-50/80 transition">
                          <td className="py-2.5 px-4 border-r border-slate-300 font-bold text-slate-900 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(st.id)}
                              className="hover:text-indigo-600 hover:underline inline-flex items-center gap-1.5"
                              title="클릭하여 월별 누적 자습시간 및 결석 이력 보기"
                            >
                              <span className="text-xs text-slate-400 font-normal">
                                {st.student_number}.
                              </span>
                              <span>{st.name}</span>
                            </button>
                          </td>

                          {/* 8교시 칸 */}
                          <td className="py-2.5 px-3 border-r border-slate-300 text-center">
                            {excelCompactMode ? (
                              <span
                                className={`font-bold ${
                                  row.period8Status === '출석'
                                    ? 'text-emerald-700'
                                    : 'text-rose-600'
                                }`}
                              >
                                {row.period8Status === '출석' ? 'O (출석)' : row.period8Status}
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {options.map((opt) => {
                                  const selected = row.period8Status === opt;
                                  const isPresent = opt === '출석';
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handleSelectPeriodStatus(st.id, 8, opt)}
                                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition border ${
                                        selected
                                          ? isPresent
                                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                                            : 'bg-rose-600 text-white border-rose-700 shadow-sm'
                                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>

                          {/* 9교시 칸 */}
                          <td className="py-2.5 px-3 border-r border-slate-300 text-center">
                            {excelCompactMode ? (
                              <span
                                className={`font-bold ${
                                  row.period9Status === '출석'
                                    ? 'text-emerald-700'
                                    : 'text-rose-600'
                                }`}
                              >
                                {row.period9Status === '출석' ? 'O (출석)' : row.period9Status}
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {options.map((opt) => {
                                  const selected = row.period9Status === opt;
                                  const isPresent = opt === '출석';
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handleSelectPeriodStatus(st.id, 9, opt)}
                                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition border ${
                                        selected
                                          ? isPresent
                                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                                            : 'bg-rose-600 text-white border-rose-700 shadow-sm'
                                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>

                          {/* 상세 메모 칸 */}
                          <td className="py-2 px-3 no-print">
                            <input
                              type="text"
                              value={row.period8Note}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDailyDraft((prev) => ({
                                  ...prev,
                                  [st.id]: {
                                    ...row,
                                    period8Note: val,
                                    period9Note: val,
                                  },
                                }));
                              }}
                              onBlur={handleSaveAllDailyAttendance}
                              placeholder="상세 사유 메모 (선택)"
                              className="w-full px-2.5 py-1 text-xs rounded border border-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 당일 오후 자습 감독관 서명 & 특이사항 보고 박스 */}
            <form
              onSubmit={handleSaveSupervisorConfirmation}
              className="bg-white rounded-2xl p-6 shadow-sm border-2 border-amber-400 space-y-4 no-print"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-amber-600" />
                    {signingDate} 오후 자습 감독관 확인 서명 & 담임선생님 보고
                  </h3>
                  <p className="text-xs text-slate-600">
                    여기서 서명하면 [2. 오후 자습 감독 확인표(월간 서명표)]의 해당 날짜 8교시·9교시 확인란에 즉시 기록됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('supervisor_sheet')}
                  className="text-xs font-bold text-indigo-600 hover:underline"
                >
                  월간 감독 확인표 전체 보기 →
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                  <label className="block text-xs font-extrabold text-slate-800">
                    8교시 (16:20~17:10) 감독관 확인 서명
                  </label>
                  <input
                    type="text"
                    value={signP8Name}
                    onChange={(e) => setSignP8Name(e.target.value)}
                    placeholder="8교시 감독관 이름 입력 (예: 김OO)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold bg-white"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>8교시 교내 재실 인원:</span>
                    <span className="font-bold text-emerald-700">
                      현재 {dailySummary.p8Present}명
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                  <label className="block text-xs font-extrabold text-slate-800">
                    9교시 (17:20~18:10) 감독관 확인 서명
                  </label>
                  <input
                    type="text"
                    value={signP9Name}
                    onChange={(e) => setSignP9Name(e.target.value)}
                    placeholder="9교시 감독관 이름 입력 (예: 김OO)"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold bg-white"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>9교시 교내 재실 인원:</span>
                    <span className="font-bold text-emerald-700">
                      현재 {dailySummary.p9Present}명
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <label className="block text-xs font-extrabold text-slate-800">
                    자습 특이사항 담임선생님 보고 메모
                  </label>
                  <textarea
                    rows={2}
                    value={signSpecialNote}
                    onChange={(e) => setSignSpecialNote(e.target.value)}
                    placeholder="특별한 상황이나 전달사항이 있으면 기록하세요."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingSignature}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold text-xs shadow flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {savingSignature
                    ? '서명 저장 중...'
                    : `${signingDate} 8·9교시 감독관 확인(서명) 저장`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== TAB 2: 오후 자습 감독 확인표 (월간 서명표 - 사진 1번) ==================== */}
        {activeTab === 'supervisor_sheet' && (
          <div className="space-y-6">
            {/* 월 선택 컨트롤 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-slate-200 no-print">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 font-extrabold text-sm"
                />
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs font-semibold text-slate-600">
                날짜 칸을 클릭하면 아래 서명란에서 8교시·9교시 감독관 확인(서명)과 담임선생님 확인을 기록할 수 있습니다.
              </p>
            </div>

            {/* 첨부 사진 1번 레이아웃 그대로 구현한 오후 자습 감독 확인표 */}
            <div className="bg-white border-2 border-slate-950 shadow-md overflow-hidden">
              {/* 상단 노란색 제목 줄 */}
              <div className="bg-[#FFFF00] border-b-2 border-slate-950 py-3.5 px-4 text-center">
                <h2 className="text-xl sm:text-2xl font-black text-slate-950 tracking-wide">
                  오후 자습 감독 확인표({Number(selectedMonth.split('-')[1])}월)
                </h2>
              </div>

              {/* 주차별 월~금 날짜 및 확인(8교시/9교시 2줄) 표 */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs sm:text-sm table-fixed">
                  <tbody>
                    {monthWeeks.map((week, wIdx) => (
                      <React.Fragment key={wIdx}>
                        {/* 날짜 행 */}
                        <tr className="border-b border-slate-950 bg-slate-50/70">
                          <td className="w-20 sm:w-24 py-2.5 px-2 border-r border-slate-950 text-center font-bold text-slate-900">
                            날짜
                          </td>
                          {week.map((dayCell, dIdx) => (
                            <td
                              key={dIdx}
                              onClick={() => {
                                if (dayCell) setSigningDate(dayCell.dateStr);
                              }}
                              className={`py-2.5 px-2 border-r last:border-r-0 border-slate-950 text-center font-bold cursor-pointer transition ${
                                dayCell?.dateStr === signingDate
                                  ? 'bg-amber-200 text-slate-950'
                                  : 'hover:bg-amber-50 text-slate-900'
                              }`}
                            >
                              {dayCell ? dayCell.label : ''}
                            </td>
                          ))}
                        </tr>

                        {/* 확인 행 - 1번째 줄: 8교시 (16:20~17:10) */}
                        <tr className="border-b border-slate-400">
                          <td
                            rowSpan={2}
                            className="w-20 sm:w-24 py-4 px-2 border-r border-b border-slate-950 text-center font-bold text-slate-900 align-middle bg-white"
                          >
                            확인
                            <div className="mt-1 text-[10px] font-medium text-slate-500">
                              위: 8교시
                              <br />
                              아래: 9교시
                            </div>
                          </td>
                          {week.map((dayCell, dIdx) => {
                            const conf = dayCell
                              ? confirmationsByDate.get(dayCell.dateStr)
                              : undefined;
                            return (
                              <td
                                key={dIdx}
                                onClick={() => {
                                  if (dayCell) setSigningDate(dayCell.dateStr);
                                }}
                                className={`h-12 px-2 py-1.5 border-r last:border-r-0 border-slate-950 text-center align-middle cursor-pointer transition ${
                                  dayCell?.dateStr === signingDate ? 'bg-amber-50/70' : 'bg-white'
                                }`}
                              >
                                {dayCell && (
                                  <div className="flex flex-col items-center justify-center">
                                    <span className="text-[10px] font-semibold text-slate-400">
                                      8교시 (16:20~17:10)
                                    </span>
                                    {conf?.period8_supervisor_name ? (
                                      <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
                                        ✍️ {conf.period8_supervisor_name}
                                        {conf.period8_headcount !== null &&
                                          conf.period8_headcount !== undefined && (
                                            <span className="ml-1 text-[11px] font-semibold text-emerald-700">
                                              ({conf.period8_headcount}명)
                                            </span>
                                          )}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-300 no-print">
                                        클릭하여 서명
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>

                        {/* 확인 행 - 2번째 줄: 9교시 (17:20~18:10) + 담임선생님 확인 */}
                        <tr className="border-b border-slate-950">
                          {week.map((dayCell, dIdx) => {
                            const conf = dayCell
                              ? confirmationsByDate.get(dayCell.dateStr)
                              : undefined;
                            return (
                              <td
                                key={dIdx}
                                onClick={() => {
                                  if (dayCell) setSigningDate(dayCell.dateStr);
                                }}
                                className={`h-14 px-2 py-1.5 border-r last:border-r-0 border-slate-950 text-center align-middle cursor-pointer transition ${
                                  dayCell?.dateStr === signingDate ? 'bg-amber-50/70' : 'bg-white'
                                }`}
                              >
                                {dayCell && (
                                  <div className="flex flex-col items-center justify-center gap-0.5">
                                    <span className="text-[10px] font-semibold text-slate-400">
                                      9교시 (17:20~18:10)
                                    </span>
                                    {conf?.period9_supervisor_name ? (
                                      <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
                                        ✍️ {conf.period9_supervisor_name}
                                        {conf.period9_headcount !== null &&
                                          conf.period9_headcount !== undefined && (
                                            <span className="ml-1 text-[11px] font-semibold text-emerald-700">
                                              ({conf.period9_headcount}명)
                                            </span>
                                          )}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-300 no-print">
                                        클릭하여 서명
                                      </span>
                                    )}

                                    {conf?.teacher_confirmed && (
                                      <span className="mt-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 text-[10px] font-extrabold border border-indigo-300">
                                        <Check className="w-3 h-3" /> 담임확인 완료
                                      </span>
                                    )}
                                    {conf?.special_note && (
                                      <span className="text-[10px] text-amber-800 bg-amber-100 px-1.5 rounded truncate max-w-full">
                                        보고: {conf.special_note}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 하단 5줄 감독관 안내 수칙 (첨부 사진 1번 문구 그대로 반영) */}
              <div className="p-4 sm:p-5 bg-white text-xs sm:text-sm text-slate-900 space-y-1.5 font-medium leading-relaxed">
                <p>* 오후 자습 감독관은 매일 오후 자습에 참여하여 학급 내 올바른 자습 분위기를 만듭니다.</p>
                <p>
                  * 오후 자습 감독관은 매일 오후 자습이 시작하기 전 칠판에 교내에 있는 인원을 적고 출석체크 표에 체크 합니다.
                </p>
                <p>
                  * 오후 자습 감독관은 9교시 끝난 직후 해당 날짜에 확인하고 다음 날 아침에 담임선생님께 확인 받습니다.
                </p>
                <p>* 오후 자습때 있었던 특별한 상황 등을 담임선생님께 보고합니다.</p>
                <p>
                  * 오후 자습 감독관은 무방비로 권력을 낭비하는 자리가 아닌 교실의 학습 분위기를 위해 봉사하는 자리입니다.
                </p>
              </div>
            </div>

            {/* 선택한 날짜의 감독관 확인 서명 및 담임선생님 확인 패널 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4 no-print">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-xs font-black">
                    선택한 날짜: {signingDate}
                  </span>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                    8교시·9교시 감독관 서명 및 특이사항 입력
                  </h3>
                </div>

                {role === 'teacher' && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentConf = confirmationsByDate.get(signingDate);
                      handleToggleTeacherConfirm(
                        signingDate,
                        !currentConf?.teacher_confirmed
                      );
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition ${
                      confirmationsByDate.get(signingDate)?.teacher_confirmed
                        ? 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {confirmationsByDate.get(signingDate)?.teacher_confirmed
                      ? '담임선생님 확인 취소'
                      : '다음 날 아침 담임선생님 확인 도장 찍기'}
                  </button>
                )}
              </div>

              <form
                onSubmit={handleSaveSupervisorConfirmation}
                className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    8교시 감독관 확인(서명)
                  </label>
                  <input
                    type="text"
                    value={signP8Name}
                    onChange={(e) => setSignP8Name(e.target.value)}
                    placeholder="8교시 감독관 이름"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    9교시 감독관 확인(서명)
                  </label>
                  <input
                    type="text"
                    value={signP9Name}
                    onChange={(e) => setSignP9Name(e.target.value)}
                    placeholder="9교시 감독관 이름"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    특별한 상황 담임선생님 보고
                  </label>
                  <input
                    type="text"
                    value={signSpecialNote}
                    onChange={(e) => setSignSpecialNote(e.target.value)}
                    placeholder="특이사항 또는 교내 인원 메모"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingSignature}
                  className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 shadow"
                >
                  <Save className="w-4 h-4" />
                  {savingSignature ? '저장 중...' : '확인표에 서명 저장'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: 월별 개인 누적 자습시간 & 참여 통계 ==================== */}
        {activeTab === 'monthly_stats' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-500" />
                  {selectedMonth} 학생별 오후 자습 누적 참여 시간표
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  8교시(16:20~17:10 = 50분), 9교시(17:20~18:10 = 50분) 기준으로 학생 개개인의 월간 누적 자습시간과 사유별 결석 현황을 집계합니다.
                </p>
              </div>

              <div className="flex items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 font-extrabold text-sm"
                />
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-white text-xs font-bold">
                      <th className="py-3 px-4 text-center w-16">번호</th>
                      <th className="py-3 px-4 text-left w-32">학생 이름</th>
                      <th className="py-3 px-4 text-center">8교시 출석</th>
                      <th className="py-3 px-4 text-center">9교시 출석</th>
                      <th className="py-3 px-4 text-center">총 참여 교시</th>
                      <th className="py-3 px-4 text-left">월 누적 자습시간 (1교시=50분)</th>
                      <th className="py-3 px-4 text-left">불참 사유별 횟수</th>
                      <th className="py-3 px-4 text-center no-print">결석 일자 상세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {studentMonthlyStats.map((stat) => (
                      <tr key={stat.student.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 text-center text-xs font-bold text-slate-500">
                          {stat.student.student_number}
                        </td>
                        <td className="py-3 px-4 font-extrabold text-slate-900">
                          {stat.student.name}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-700">
                          {stat.p8Attended}회{' '}
                          <span className="text-xs text-slate-400">
                            ({stat.p8Attended * MINUTES_PER_PERIOD}분)
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-700">
                          {stat.p9Attended}회{' '}
                          <span className="text-xs text-slate-400">
                            ({stat.p9Attended * MINUTES_PER_PERIOD}분)
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-extrabold text-indigo-700">
                          총 {stat.totalAttendedPeriods}교시
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1">
                            <span className="font-black text-emerald-700 text-sm">
                              ⏱️ {formatMinutesToKorean(stat.totalMinutes)}
                            </span>
                            <div className="w-40 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, stat.attendanceRate)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(stat.reasonBreakdown).length === 0 ? (
                              <span className="text-xs text-emerald-600 font-semibold">
                                결석 없음
                              </span>
                            ) : (
                              Object.entries(stat.reasonBreakdown).map(([reason, cnt]) => (
                                <span
                                  key={reason}
                                  className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold"
                                >
                                  {reason} {cnt}회
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center no-print">
                          <button
                            type="button"
                            onClick={() => setDetailStudentId(stat.student.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-bold border border-slate-200"
                          >
                            상세 이력 ({stat.absenceHistory.length}건)
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: 담임교사 관리자 화면 (학생 명단 / 사유 추가 / 결석 일자 조회 / 비밀번호) ==================== */}
        {activeTab === 'admin' && role === 'teacher' && (
          <div className="space-y-6">
            {/* 섹션 A: 학생별 누적 시간 & 언제 결석했는지 한눈에 확인하는 교사용 리포트 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    담임교사용 학생별 자습 참여 시간 & 결석 일자·사유 상세 리포트 ({selectedMonth})
                  </h2>
                  <p className="text-xs text-slate-600">
                    각 학생이 이번 달 얼마나 자습에 참여했는지(누적 시간), 언제(몇 월 며칠 몇 교시) 어떤 사유로 결석했는지 한눈에 확인합니다.
                  </p>
                </div>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-xs"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-indigo-950 text-white font-bold">
                      <th className="py-2.5 px-3 text-left w-32">학생</th>
                      <th className="py-2.5 px-3 text-left w-48">월 누적 자습시간</th>
                      <th className="py-2.5 px-3 text-left">
                        언제 · 왜 결석했는지 (날짜 / 교시 / 사유 상세)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {studentMonthlyStats.map((stat) => (
                      <tr key={stat.student.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-extrabold text-slate-900 whitespace-nowrap">
                          {stat.student.student_number}. {stat.student.name}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-black text-indigo-700">
                            {formatMinutesToKorean(stat.totalMinutes)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            8교시 {stat.p8Attended}회 · 9교시 {stat.p9Attended}회 출석
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          {stat.absenceHistory.length === 0 ? (
                            <span className="text-xs font-semibold text-emerald-600">
                              기록된 결석 없음 (전출석)
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {stat.absenceHistory.map((item, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold"
                                >
                                  <strong>{item.date.slice(5)}</strong> ({item.period}):{' '}
                                  <span className="text-rose-600 font-extrabold">
                                    {item.reason}
                                  </span>
                                  {item.note && (
                                    <span className="text-slate-500">· {item.note}</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 섹션 B: 학생 명단 추가 / 엑셀 붙여넣기 관리 & 기타 결석 사유 추가 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 학생 명단 관리 */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-5">
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    우리 반 학생 명단 관리 (현재 {students.length}명)
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    학생을 한 명씩 추가하거나, 엑셀의 이름 열을 복사해 한 번에 붙여넣어 등록할 수 있습니다.
                  </p>
                </div>

                {/* 개별 추가 폼 */}
                <form onSubmit={handleAddStudent} className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={newStudentNumber}
                    onChange={(e) => setNewStudentNumber(e.target.value)}
                    placeholder="번호(자동)"
                    className="w-24 px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                  <input
                    type="text"
                    required
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    placeholder="추가할 학생 이름 입력"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    학생 추가
                  </button>
                </form>

                {/* 엑셀 줄바꿈 일괄 붙여넣기 폼 */}
                <form
                  onSubmit={handleBulkAddStudents}
                  className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-slate-800">
                      엑셀 학생 명단 줄바꿈 붙여넣기 (일괄 등록)
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkReplaceMode}
                        onChange={(e) => setBulkReplaceMode(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      기존 예시 명단을 지우고 새 명단으로 교체
                    </label>
                  </div>
                  <textarea
                    rows={4}
                    value={bulkStudentsText}
                    onChange={(e) => setBulkStudentsText(e.target.value)}
                    placeholder={'엑셀에서 학생 이름들을 복사해 그대로 붙여넣으세요.\n예:\n홍길동\n김철수\n이영희'}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  />
                  <button
                    type="submit"
                    className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
                  >
                    붙여넣은 학생 명단 일괄 적용하기
                  </button>
                </form>

                {/* 현재 학생 목록 */}
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {students.map((st) => (
                    <div
                      key={st.id}
                      className="px-3.5 py-2 flex items-center justify-between text-xs hover:bg-slate-50"
                    >
                      <span className="font-bold text-slate-800">
                        {st.student_number}번 · {st.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteStudent(st.id, st.name)}
                        className="text-rose-500 hover:text-rose-700 p-1"
                        title="학생 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 결석(불참) 사유 관리 & 감독관 비밀번호 설정 */}
              <div className="space-y-6">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
                  <div>
                    <h3 className="text-base font-black text-slate-900">
                      기타 결석(불참) 사유 관리
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      기본 사유(학원, 병원, 동아리, 하브루타, 기타) 외에 학급 상황에 맞는 사유를 자유롭게 추가할 수 있습니다.
                    </p>
                  </div>

                  <form onSubmit={handleAddReason} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={newReasonLabel}
                      onChange={(e) => setNewReasonLabel(e.target.value)}
                      placeholder="새 불참 사유 입력 (예: 방과후, 상담, 대회준비)"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      사유 추가
                    </button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    {reasons.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-300 text-xs font-bold text-slate-800"
                      >
                        <span>{r.label}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteReason(r.id, r.label)}
                          className="text-slate-400 hover:text-rose-600"
                          title="사유 삭제"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* 오후 자습 감독관 & 담임교사 비밀번호 변경 */}
                <form
                  onSubmit={handleUpdateSettings}
                  className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4"
                >
                  <div>
                    <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-amber-600" />
                      오후 자습 감독관 비밀번호 & 학급 설정
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      오후 자습 감독관 학생들이 로그인할 때 사용하는 공유 비밀번호와 담임교사 비밀번호를 변경합니다.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      학급 표시 이름
                    </label>
                    <input
                      type="text"
                      value={adminClassName}
                      onChange={(e) => setAdminClassName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        새 오후 자습 감독관 비밀번호 (변경 시 입력)
                      </label>
                      <input
                        type="password"
                        minLength={4}
                        value={adminNewSupervisorPw}
                        onChange={(e) => setAdminNewSupervisorPw(e.target.value)}
                        placeholder="감독관 새 비밀번호 (4자 이상)"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        새 담임교사 비밀번호 (변경 시 입력)
                      </label>
                      <input
                        type="password"
                        minLength={4}
                        value={adminNewTeacherPw}
                        onChange={(e) => setAdminNewTeacherPw(e.target.value)}
                        placeholder="교사 새 비밀번호 (4자 이상)"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow"
                  >
                    학급 설정 및 비밀번호 변경 저장
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 학생 개인별 누적시간 & 결석 일자 모달 */}
      {selectedDetailStat && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {selectedDetailStat.student.student_number}번 {selectedDetailStat.student.name} ·{' '}
                  {selectedMonth} 자습 리포트
                </h3>
                <p className="text-xs text-slate-500">
                  누적 자습시간:{' '}
                  <strong className="text-emerald-700">
                    {formatMinutesToKorean(selectedDetailStat.totalMinutes)}
                  </strong>{' '}
                  (8교시 {selectedDetailStat.p8Attended}회, 9교시 {selectedDetailStat.p9Attended}회 출석)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudentId(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              <h4 className="text-xs font-extrabold text-slate-700">
                결석(불참) 일자 및 사유 내역 ({selectedDetailStat.absenceHistory.length}건)
              </h4>
              {selectedDetailStat.absenceHistory.length === 0 ? (
                <div className="p-4 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold text-center">
                  이번 달 결석 내역이 없습니다!
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {selectedDetailStat.absenceHistory.map((h, i) => (
                    <div
                      key={i}
                      className="px-3.5 py-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="font-bold text-slate-800">
                        {h.date} ({h.period})
                      </span>
                      <div className="flex items-center gap-2">
                        {h.note && <span className="text-slate-500">{h.note}</span>}
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-extrabold">
                          {h.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDetailStudentId(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

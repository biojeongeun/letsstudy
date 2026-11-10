'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Heart,
  KeyRound,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
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

function getReasonEmoji(label: string): string {
  if (label === '출석') return '🌱';
  if (label.includes('학원')) return '🏫';
  if (label.includes('병원')) return '🏥';
  if (label.includes('동아리')) return '🎨';
  if (label.includes('하브루타')) return '💬';
  if (label.includes('기타')) return '📝';
  return '📌';
}

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
function getMonthWeekdayWeeks(
  monthStr: string
): Array<Array<{ dateStr: string; label: string } | null>> {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();

  const weeks: Array<Array<{ dateStr: string; label: string } | null>> = [];
  let currentWeek: Array<{ dateStr: string; label: string } | null> = [
    null,
    null,
    null,
    null,
    null,
  ];
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

  const saveSeqRef = useRef(0);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, selectedMonth]);

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

  // selectedDate 또는 monthAttendance/students 변경 시 일일 출석표 로컬 버퍼 동기화 (미기록/취소 상태는 빈 문자열 ''로 유지하여 출석 취소·초기화가 즉시 반영되도록 처리)
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
        period8Status: rec?.period8_status ?? '',
        period8Note: rec?.period8_note ?? '',
        period9Status: rec?.period9_status ?? '',
        period9Note: rec?.period9_note ?? '',
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

  // 당일 8교시/9교시 출석·불참·미체크 인원 실시간 계산
  const dailySummary = useMemo(() => {
    let p8Present = 0;
    let p8Absent = 0;
    let p8Unchecked = 0;
    let p9Present = 0;
    let p9Absent = 0;
    let p9Unchecked = 0;
    const p8ReasonCounts: Record<string, number> = {};
    const p9ReasonCounts: Record<string, number> = {};

    for (const st of students) {
      const row = dailyDraft[st.id];
      const s8 = (row?.period8Status || '').trim();
      const s9 = (row?.period9Status || '').trim();

      if (s8 === '출석') {
        p8Present += 1;
      } else if (s8 && s8 !== '미체크') {
        p8Absent += 1;
        p8ReasonCounts[s8] = (p8ReasonCounts[s8] || 0) + 1;
      } else {
        p8Unchecked += 1;
      }

      if (s9 === '출석') {
        p9Present += 1;
      } else if (s9 && s9 !== '미체크') {
        p9Absent += 1;
        p9ReasonCounts[s9] = (p9ReasonCounts[s9] || 0) + 1;
      } else {
        p9Unchecked += 1;
      }
    }

    return {
      total: students.length,
      p8Present,
      p8Absent,
      p8Unchecked,
      p9Present,
      p9Absent,
      p9Unchecked,
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
        const s8 = (r.period8_status || '').trim();
        const s9 = (r.period9_status || '').trim();

        if (s8 === '출석') {
          p8Attended += 1;
        } else if (s8 && s8 !== '미체크') {
          reasonBreakdown[s8] = (reasonBreakdown[s8] || 0) + 1;
          absenceHistory.push({
            date: r.study_date,
            period: '8교시',
            reason: s8,
            note: r.period8_note || '',
          });
        }

        if (s9 === '출석') {
          p9Attended += 1;
        } else if (s9 && s9 !== '미체크') {
          reasonBreakdown[s9] = (reasonBreakdown[s9] || 0) + 1;
          absenceHistory.push({
            date: r.study_date,
            period: '9교시',
            reason: s9,
            note: r.period9_note || '',
          });
        }
      }

      const totalAttendedPeriods = p8Attended + p9Attended;
      const totalMinutes = totalAttendedPeriods * MINUTES_PER_PERIOD;
      const attendanceRate =
        totalPossiblePeriods > 0
          ? Math.round((totalAttendedPeriods / totalPossiblePeriods) * 100)
          : 0;

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
      showToast('🎉 학급 초기 설정이 완료되었어요! 담임선생님 모드로 시작합니다.');
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
          ? '🌷 담임선생님(관리자) 모드로 로그인되었습니다!'
          : `🐣 ${data.supervisorName || '오후 자습 감독관'}님, 오늘도 반가워요!`
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

  // 개별 학생의 8교시 또는 9교시 출석 상태 변경 및 재클릭 시 출석 취소(토글 해제)
  const handleSelectPeriodStatus = async (
    studentId: string,
    period: 8 | 9,
    nextStatus: string
  ) => {
    const current = dailyDraft[studentId] || {
      period8Status: '',
      period8Note: '',
      period9Status: '',
      period9Note: '',
    };

    const currentPeriodStatus = period === 8 ? current.period8Status : current.period9Status;
    // 이미 선택된 버튼(예: '출석')을 다시 누르거나 빈 값('')을 전달하면 해당 교시 출석 취소('')
    const finalStatus = currentPeriodStatus === nextStatus ? '' : nextStatus;

    const updated = {
      ...current,
      ...(period === 8 ? { period8Status: finalStatus } : { period9Status: finalStatus }),
    };

    setDailyDraft((prev) => ({
      ...prev,
      [studentId]: updated,
    }));

    const targetDate = selectedDate;

    setMonthAttendance((prev) => {
      const withoutTargetStudent = prev.filter(
        (r) => !(r.study_date === targetDate && r.student_id === studentId)
      );
      if (
        !updated.period8Status &&
        !updated.period9Status &&
        !updated.period8Note &&
        !updated.period9Note
      ) {
        return withoutTargetStudent;
      }
      return [
        ...withoutTargetStudent,
        {
          student_id: studentId,
          study_date: targetDate,
          period8_status: updated.period8Status,
          period8_note: updated.period8Note,
          period9_status: updated.period9Status,
          period9_note: updated.period9Note,
        },
      ];
    });

    const seq = ++saveSeqRef.current;

    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_attendance',
          studyDate: targetDate,
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
      if (res.ok && seq === saveSeqRef.current) {
        const data = await res.json();
        const savedRecords = data.records || [];
        setMonthAttendance((prev) => {
          const filtered = prev.filter((r) => r.study_date !== targetDate);
          return [...filtered, ...savedRecords];
        });
      }
    } catch {
      // ignore transient error
    }
  };

  // 개별 학생 당일 출석 전체 취소 (8·9교시 모두 취소)
  const handleCancelStudentDailyAttendance = async (
    studentId: string,
    studentName: string
  ) => {
    const targetDate = selectedDate;
    setDailyDraft((prev) => ({
      ...prev,
      [studentId]: {
        period8Status: '',
        period8Note: '',
        period9Status: '',
        period9Note: '',
      },
    }));
    setMonthAttendance((prev) =>
      prev.filter((r) => !(r.study_date === targetDate && r.student_id === studentId))
    );

    const seq = ++saveSeqRef.current;
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_daily_attendance',
          studyDate: targetDate,
          studentId,
          period: 'all',
        }),
      });
      if (res.ok && seq === saveSeqRef.current) {
        const data = await res.json();
        const savedRecords = data.records || [];
        setMonthAttendance((prev) => {
          const filtered = prev.filter((r) => r.study_date !== targetDate);
          return [...filtered, ...savedRecords];
        });
      }
      showToast(`↩️ ${studentName} 학생의 ${targetDate} 출석이 취소(초기화)되었어요.`);
    } catch {
      // ignore
    }
  };

  // 전 학생 전원 출석 일괄 체크 (8·9교시 전체 또는 8교시만 / 9교시만)
  const handleMarkAllPresent = async (targetPeriod: 'all' | 8 | 9 = 'all') => {
    if (students.length === 0) return;
    setSavingAttendance(true);
    const targetDate = selectedDate;

    const nextDraft: typeof dailyDraft = {};
    for (const st of students) {
      const cur = dailyDraft[st.id] || {
        period8Status: '',
        period8Note: '',
        period9Status: '',
        period9Note: '',
      };
      nextDraft[st.id] = {
        ...cur,
        period8Status: targetPeriod === 'all' || targetPeriod === 8 ? '출석' : cur.period8Status,
        period9Status: targetPeriod === 'all' || targetPeriod === 9 ? '출석' : cur.period9Status,
      };
    }
    setDailyDraft(nextDraft);

    const records = students.map((st) => ({
      studentId: st.id,
      period8Status: nextDraft[st.id].period8Status,
      period8Note: nextDraft[st.id].period8Note,
      period9Status: nextDraft[st.id].period9Status,
      period9Note: nextDraft[st.id].period9Note,
    }));

    const seq = ++saveSeqRef.current;
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_attendance',
          studyDate: targetDate,
          records,
        }),
      });
      if (res.ok && seq === saveSeqRef.current) {
        const data = await res.json();
        const savedRecords = data.records || [];
        setMonthAttendance((prev) => {
          const filtered = prev.filter((r) => r.study_date !== targetDate);
          return [...filtered, ...savedRecords];
        });
        const label =
          targetPeriod === 'all'
            ? '8·9교시 전원 출석'
            : targetPeriod === 8
            ? '8교시 전원 출석'
            : '9교시 전원 출석';
        showToast(`🌱 ${targetDate} ${label}으로 일괄 체크 및 저장되었어요!`);
      }
    } finally {
      setSavingAttendance(false);
    }
  };

  // 특정 날짜의 출석 기록 초기화 핸들러 (전체 또는 8교시만 / 9교시만)
  const handleResetDailyAttendance = async (
    targetDate: string,
    period: 'all' | 'period8' | 'period9' = 'all'
  ) => {
    setSavingAttendance(true);
    const seq = ++saveSeqRef.current;

    if (targetDate === selectedDate) {
      setDailyDraft((prev) => {
        const next: typeof prev = {};
        for (const st of students) {
          const cur = prev[st.id] || {
            period8Status: '',
            period8Note: '',
            period9Status: '',
            period9Note: '',
          };
          next[st.id] = {
            period8Status: period === 'all' || period === 'period8' ? '' : cur.period8Status,
            period8Note: period === 'all' || period === 'period8' ? '' : cur.period8Note,
            period9Status: period === 'all' || period === 'period9' ? '' : cur.period9Status,
            period9Note: period === 'all' || period === 'period9' ? '' : cur.period9Note,
          };
        }
        return next;
      });
    }

    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_daily_attendance',
          studyDate: targetDate,
          period,
        }),
      });
      if (res.ok && seq === saveSeqRef.current) {
        const data = await res.json();
        const savedRecords = data.records || [];
        setMonthAttendance((prev) => {
          const filtered = prev.filter((r) => r.study_date !== targetDate);
          return [...filtered, ...savedRecords];
        });
        const periodLabel =
          period === 'all'
            ? '전체 출석'
            : period === 'period8'
            ? '8교시 출석'
            : '9교시 출석';
        showToast(`🔄 ${targetDate} ${periodLabel} 기록이 깨끗하게 초기화(취소)되었어요!`);
      }
    } finally {
      setSavingAttendance(false);
    }
  };

  // 월간 출석 기록 초기화 핸들러 (특정 학생 또는 학급 전체)
  const handleResetMonthlyAttendance = async (studentId?: string, studentName?: string) => {
    setSavingAttendance(true);
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_monthly_attendance',
          month: selectedMonth,
          studentId,
        }),
      });
      if (res.ok) {
        await fetchStudyData(selectedMonth, selectedDate);
        showToast(
          studentName
            ? `🔄 ${studentName} 학생의 ${selectedMonth} 월간 출석 기록이 초기화되었어요.`
            : `🔄 ${selectedMonth} 우리 반 전체 출석 기록이 초기화되었어요.`
        );
      }
    } finally {
      setSavingAttendance(false);
    }
  };

  // 전체 출석체크 일괄 저장 (미체크 학생은 '출석'으로 채워서 저장)
  const handleSaveAllDailyAttendance = async () => {
    if (students.length === 0) return;
    setSavingAttendance(true);
    try {
      const records = students.map((st) => {
        const d = dailyDraft[st.id] || {
          period8Status: '',
          period8Note: '',
          period9Status: '',
          period9Note: '',
        };
        return {
          studentId: st.id,
          period8Status: d.period8Status || '출석',
          period8Note: d.period8Note,
          period9Status: d.period9Status || '출석',
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
        showToast(`✨ ${selectedDate} 오후 자습(8·9교시) 출석표가 깔끔하게 저장되었어요!`);
      } else {
        showToast(data.error || '출석 저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSavingAttendance(false);
    }
  };

  // 8교시 상태 -> 9교시로 동일 복사 및 즉시 DB 저장
  const handleCopyPeriod8ToPeriod9 = async () => {
    if (students.length === 0) return;
    const nextDraft: typeof dailyDraft = {};
    for (const st of students) {
      const cur = dailyDraft[st.id] || {
        period8Status: '',
        period8Note: '',
        period9Status: '',
        period9Note: '',
      };
      nextDraft[st.id] = {
        ...cur,
        period9Status: cur.period8Status,
        period9Note: cur.period8Note,
      };
    }
    setDailyDraft(nextDraft);

    const targetDate = selectedDate;
    const records = students.map((st) => {
      const d = nextDraft[st.id];
      return {
        studentId: st.id,
        period8Status: d.period8Status,
        period8Note: d.period8Note || '',
        period9Status: d.period9Status,
        period9Note: d.period9Note || '',
      };
    });

    const seq = ++saveSeqRef.current;
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_attendance',
          studyDate: targetDate,
          records,
        }),
      });
      if (res.ok && seq === saveSeqRef.current) {
        const data = await res.json();
        const savedRecords = data.records || [];
        setMonthAttendance((prev) => {
          const filtered = prev.filter((r) => r.study_date !== targetDate);
          return [...filtered, ...savedRecords];
        });
        showToast(`🐰 ${targetDate} 8교시 출결 상태를 9교시로 똑같이 복사하고 저장했어요!`);
      }
    } catch {
      showToast('🐰 8교시 출결 상태를 9교시로 복사했어요.');
    }
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
        showToast(`💮 ${signingDate} 오후 자습 감독 확인표 서명이 완료되었어요!`);
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
          ? `💮 ${targetDate} 자습 감독표에 담임선생님 확인 도장을 찍었어요!`
          : `${targetDate} 담임선생님 확인 도장을 취소했어요.`
      );
    }
  };

  // 일별 감독관 서명 및 담임 확인 초기화 핸들러 (담임교사 & 오후자습감독관 모두 가능)
  const handleResetConfirmation = async (
    targetDate: string,
    target: 'all' | 'period8' | 'period9' | 'teacher' = 'all'
  ) => {
    setSavingSignature(true);
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_confirmation',
          studyDate: targetDate,
          target,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (targetDate === signingDate) {
          if (target === 'all' || target === 'period8') {
            setSignP8Name('');
            setSignP8Headcount('');
          }
          if (target === 'all' || target === 'period9') {
            setSignP9Name('');
            setSignP9Headcount('');
          }
          if (target === 'all') {
            setSignSpecialNote('');
          }
        }
        await fetchStudyData(selectedMonth, selectedDate);
        const labelMap = {
          all: '8·9교시 서명 및 담임 확인 전체',
          period8: '8교시 감독관 서명',
          period9: '9교시 감독관 서명',
          teacher: '담임선생님 확인 도장',
        };
        showToast(`🔄 ${targetDate} ${labelMap[target]}이(가) 깨끗하게 초기화되었어요!`);
      } else {
        showToast(data.error || '서명 초기화에 실패했습니다.');
      }
    } finally {
      setSavingSignature(false);
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
      showToast(`🌱 학생 "${data.student?.name}" 친구가 명단에 추가되었어요!`);
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
      showToast(`✨ 총 ${data.students?.length || 0}명의 학생 명단이 등록되었어요!`);
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
      showToast(`📌 불참 사유 "${data.reason?.label}"이(가) 추가되었어요!`);
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
      showToast('🌷 학급 이름 및 비밀번호 설정이 저장되었어요!');
    } else {
      showToast(data.error || '설정 변경 실패');
    }
  };

  const monthWeeks = useMemo(() => getMonthWeekdayWeeks(selectedMonth), [selectedMonth]);
  const confirmationsByDate = useMemo(
    () => new Map(monthConfirmations.map((c) => [c.study_date, c])),
    [monthConfirmations]
  );

  const recordedDates = useMemo(
    () => Array.from(new Set(monthAttendance.map((r) => r.study_date))).sort(),
    [monthAttendance]
  );
  const isSelectedDateSaved = useMemo(
    () => recordedDates.includes(selectedDate),
    [recordedDates, selectedDate]
  );
  const statsByStudentId = useMemo(
    () => new Map(studentMonthlyStats.map((s) => [s.student.id, s])),
    [studentMonthlyStats]
  );
  const attendanceByStudentAndDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of monthAttendance) {
      map.set(`${r.student_id}_${r.study_date}`, r);
    }
    return map;
  }, [monthAttendance]);

  const selectedDetailStat = useMemo(
    () => studentMonthlyStats.find((s) => s.student.id === detailStudentId) || null,
    [studentMonthlyStats, detailStudentId]
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pastel-grid-bg">
        <div className="bg-white/90 backdrop-blur px-8 py-7 rounded-3xl shadow-[0_12px_40px_rgba(251,191,36,0.18)] border-2 border-amber-200 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center text-2xl animate-bounce">
            🐣
          </div>
          <RefreshCw className="w-5 h-5 animate-spin text-amber-500" />
          <p className="text-sm font-bold text-slate-700">
            우리 반 오후 자습 플래너를 불러오는 중이에요...
          </p>
        </div>
      </div>
    );
  }

  // 비로그인 상태 화면 (밝고 깨끗하고 귀여운 파스텔 스터디 플래너 감성)
  if (!authenticated) {
    return (
      <div className="min-h-screen pastel-grid-bg flex flex-col justify-center items-center p-4 relative overflow-hidden">
        {/* 귀여운 배경 파스텔 버블 장식 */}
        <div className="w-72 h-72 rounded-full bg-amber-200/40 blur-3xl absolute -top-16 -left-16 pointer-events-none" />
        <div className="w-80 h-80 rounded-full bg-rose-200/40 blur-3xl absolute -bottom-20 -right-16 pointer-events-none" />
        <div className="w-64 h-64 rounded-full bg-sky-200/35 blur-3xl absolute top-1/4 right-10 pointer-events-none" />

        <div className="w-full max-w-lg bg-white/95 backdrop-blur-md rounded-[2rem] shadow-[0_20px_60px_rgba(245,158,11,0.14)] border-2 border-amber-200/90 overflow-hidden relative z-10">
          {/* 상단 파스텔 버터-피치 헤더 */}
          <div className="bg-gradient-to-r from-[#FFF3B0] via-[#FFE5B4] to-[#FFD6E0] px-7 py-6 border-b-2 border-amber-200/80">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-white/90 text-amber-800 shadow-sm border border-amber-200">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> 우리반 독학자습 플래너
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white/75 text-[11px] font-bold text-rose-800">
                ⏰ 8교시 16:20 · 9교시 17:20
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-amber-200 flex items-center justify-center text-2xl shrink-0">
                ✏️
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
                  {className}
                </h1>
                <p className="text-xs font-bold text-slate-600 mt-0.5">
                  오후 자습 출석체크 & 감독 확인 시스템 🌱
                </p>
              </div>
            </div>
          </div>

          <div className="p-7">
            {!initialized ? (
              <form onSubmit={handleInitialSetup} className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-50/90 border-2 border-amber-200/80 text-xs text-slate-700 space-y-1.5">
                  <p className="font-extrabold flex items-center gap-1.5 text-amber-900 text-sm">
                    <span>🐣</span> 선생님, 첫 방문을 환영해요!
                  </p>
                  <p className="text-slate-600 leading-relaxed font-medium">
                    선생님용 <strong>관리자 비밀번호</strong>와 자습 감독관 학생들이 함께 쓸{' '}
                    <strong>감독관 비밀번호</strong>를 설정해 주시면 기본 불참 사유(학원·병원·동아리·하브루타·기타)와 출석부가 바로 만들어집니다.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    🏫 우리 반 학급 이름
                  </label>
                  <input
                    type="text"
                    required
                    value={setupClassName}
                    onChange={(e) => setSetupClassName(e.target.value)}
                    placeholder="예: 2학년 3반 오후 자습"
                    className="w-full px-4 py-3 rounded-2xl border-2 border-amber-200/90 bg-amber-50/30 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 focus:bg-white focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    👩‍🏫 담임교사(관리자) 비밀번호 지정 (4자 이상)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={setupTeacherPassword}
                    onChange={(e) => setSetupTeacherPassword(e.target.value)}
                    placeholder="선생님만 사용할 관리자 비밀번호 입력"
                    className="w-full px-4 py-3 rounded-2xl border-2 border-rose-200/90 bg-rose-50/20 text-sm font-medium focus:ring-2 focus:ring-rose-400 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    📋 오후 자습 감독관 공유 비밀번호 지정 (4자 이상)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={setupSupervisorPassword}
                    onChange={(e) => setSetupSupervisorPassword(e.target.value)}
                    placeholder="자습 감독관 학생들이 로그인할 비밀번호 입력"
                    className="w-full px-4 py-3 rounded-2xl border-2 border-emerald-200/90 bg-emerald-50/20 text-sm font-medium focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 focus:bg-white focus:outline-none transition"
                  />
                </div>

                {authError && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-200 text-xs font-bold text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span>{authError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 hover:from-amber-500 hover:to-rose-500 text-white font-black text-sm shadow-[0_8px_20px_rgba(251,146,60,0.35)] transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {authSubmitting ? '우리 반 자습실 준비 중...' : '우리 반 자습 시스템 시작하기 ✨'}
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                {/* 귀여운 파스텔 역할 선택 탭 */}
                <div className="grid grid-cols-2 gap-2 p-1.5 bg-amber-50/90 border-2 border-amber-100 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginMode('supervisor');
                      setAuthError('');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
                      loginMode === 'supervisor'
                        ? 'bg-white text-amber-900 shadow-sm border border-amber-200'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span>🐣</span>
                    오후 자습 감독관
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginMode('teacher');
                      setAuthError('');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
                      loginMode === 'teacher'
                        ? 'bg-rose-400 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span>👩‍🏫</span>
                    담임선생님 (관리자)
                  </button>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  {loginMode === 'supervisor' && (
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                        ✍️ 오늘의 감독관 이름 (서명란 자동 입력 · 선택)
                      </label>
                      <input
                        type="text"
                        value={loginSupervisorName}
                        onChange={(e) => setLoginSupervisorName(e.target.value)}
                        placeholder="예: 김민지 (확인표 서명에 자동으로 들어가요)"
                        className="w-full px-4 py-3 rounded-2xl border-2 border-amber-200 bg-amber-50/20 text-sm font-semibold focus:ring-2 focus:ring-amber-400 focus:bg-white focus:outline-none transition"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                      {loginMode === 'supervisor'
                        ? '🔑 오후 자습 감독관 비밀번호'
                        : '🔑 담임교사(관리자) 비밀번호'}
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-amber-500 absolute left-4 top-3.5" />
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder={
                          loginMode === 'supervisor'
                            ? '감독관 공유 비밀번호를 입력해 주세요'
                            : '담임선생님 관리자 비밀번호를 입력해 주세요'
                        }
                        className="w-full pl-11 pr-4 py-3 rounded-2xl border-2 border-amber-200 bg-amber-50/20 text-sm font-semibold focus:ring-2 focus:ring-amber-400 focus:bg-white focus:outline-none transition"
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-200 text-xs font-bold text-rose-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className={`w-full py-3.5 rounded-2xl font-black text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 ${
                      loginMode === 'supervisor'
                        ? 'bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-200'
                        : 'bg-gradient-to-r from-rose-400 to-pink-500 hover:from-rose-500 hover:to-pink-600 text-white shadow-rose-200'
                    }`}
                  >
                    {loginMode === 'supervisor' ? (
                      <>
                        <UserCheck className="w-4 h-4" />
                        {authSubmitting ? '입장 중...' : '감독관 출석체크 시작하기 🐣'}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        {authSubmitting ? '입장 중...' : '담임교사 관리 화면 입장하기 🌷'}
                      </>
                    )}
                  </button>
                </form>

                <div className="p-3.5 rounded-2xl bg-sky-50/80 border border-sky-100 text-[11px] text-slate-600 space-y-1 font-medium">
                  <p>🌿 오후 자습 감독관은 자습 시작 전 교내 인원을 칠판에 적고 출석체크 표에 체크해요.</p>
                  <p>🌿 9교시가 끝난 직후 확인표에 서명하고 다음 날 아침 담임선생님께 확인받아요.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pastel-grid-bg text-slate-800">
      {/* 귀여운 파스텔 토스트 알림 */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-white text-slate-800 px-5 py-3.5 rounded-2xl shadow-[0_12px_35px_rgba(244,114,182,0.25)] border-2 border-rose-300 flex items-center gap-2.5 text-xs font-extrabold animate-bounce no-print">
          <span className="text-lg">✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 밝고 깨끗한 상단 파스텔 헤더 */}
      <header className="bg-white/95 backdrop-blur-md border-b-2 border-amber-100 sticky top-0 z-30 shadow-[0_4px_20px_rgba(251,191,36,0.08)] no-print">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-200 via-yellow-200 to-rose-200 border-2 border-amber-300 flex items-center justify-center text-xl shadow-sm">
              ✏️
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-800">
                  {className}
                </h1>
                <span
                  className={`px-3 py-0.5 rounded-full text-xs font-extrabold border ${
                    role === 'teacher'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {role === 'teacher'
                    ? '👩‍🏫 담임선생님 (관리자)'
                    : `🐣 오후 자습 감독관 (${supervisorName || '열공중'})`}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-semibold mt-0.5">
                8교시 <strong className="text-amber-700">16:20~17:10 (50분)</strong> · 9교시{' '}
                <strong className="text-rose-600">17:20~18:10 (50분)</strong> 우리 반 자습 플래너
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-extrabold flex items-center gap-1.5 border border-amber-200 transition"
            >
              <Printer className="w-3.5 h-3.5 text-amber-600" />
              깔끔 인쇄
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-extrabold flex items-center gap-1.5 border border-rose-200 transition"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-500" />
              로그아웃
            </button>
          </div>
        </div>

        {/* 밝고 동글동글한 파스텔 탭 메뉴 */}
        <div className="bg-gradient-to-r from-amber-50/70 via-rose-50/50 to-sky-50/70 border-t border-amber-100">
          <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto gap-2 py-2">
            <button
              type="button"
              onClick={() => setActiveTab('attendance')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'attendance'
                  ? 'bg-amber-300 text-amber-950 shadow-sm border border-amber-400/60'
                  : 'bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900 border border-amber-100'
              }`}
            >
              <span>📋</span>
              1. 오후 자습 출석표 (8·9교시 체크)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('supervisor_sheet')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'supervisor_sheet'
                  ? 'bg-amber-300 text-amber-950 shadow-sm border border-amber-400/60'
                  : 'bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900 border border-amber-100'
              }`}
            >
              <span>🗓️</span>
              2. 오후 자습 감독 확인표 (월간 서명표)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('monthly_stats')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === 'monthly_stats'
                  ? 'bg-emerald-300 text-emerald-950 shadow-sm border border-emerald-400/60'
                  : 'bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900 border border-amber-100'
              }`}
            >
              <span>⏱️</span>
              3. 월별 학생 누적 자습시간 & 통계
            </button>

            {role === 'teacher' && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-rose-400 text-white shadow-sm border border-rose-500/40'
                    : 'bg-white/80 text-rose-600 hover:bg-rose-50 border border-rose-200'
                }`}
              >
                <span>👩‍🏫</span>
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
            {/* 상단 날짜 선택 카드 & 파스텔 민트 칠판 현황판 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
              <div className="bg-white rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-2 border-amber-200/80 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-amber-800 flex items-center gap-1.5">
                    <span>📅</span> 출석체크 날짜 선택
                  </span>
                  {dataLoading && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  )}
                </div>
                <div className="my-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftDateByDays(-1)}
                    className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 transition"
                    title="이전 날짜"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-2xl border-2 border-amber-200 bg-amber-50/30 font-black text-sm text-slate-800 text-center focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => shiftDateByDays(1)}
                    className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 transition"
                    title="다음 날짜"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleDateChange(formatLocalDate(new Date()))}
                    className="text-xs font-extrabold text-rose-500 hover:underline"
                  >
                    🎈 오늘 날짜로 이동
                  </button>
                  <button
                    type="button"
                    onClick={() => setExcelCompactMode((v) => !v)}
                    className="text-xs font-extrabold px-3 py-1.5 rounded-xl bg-amber-100/80 hover:bg-amber-200 text-amber-900 transition"
                  >
                    {excelCompactMode ? '🐣 귀여운 버튼형 보기' : '🖨️ 엑셀 인쇄형 표 보기'}
                  </button>
                </div>
              </div>

              {/* 밝고 산뜻한 파스텔 민트-크림 칠판 인원 현황판 */}
              <div className="lg:col-span-2 bg-gradient-to-br from-emerald-50 via-teal-50/80 to-amber-50 rounded-3xl p-5 shadow-[0_8px_30px_rgb(16,185,129,0.08)] border-2 border-emerald-200 flex flex-col justify-between">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/80 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-emerald-500 text-white text-xs font-black shadow-sm">
                      🌿 오늘의 칠판 인원 현황판
                    </span>
                    <span className="text-sm font-extrabold text-emerald-950">
                      {selectedDate} 자습 현황 (우리 반 총원 {dailySummary.total}명)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleMarkAllPresent('all')}
                      disabled={savingAttendance}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition shadow-sm"
                    >
                      🌱 8·9교시 전원 출석
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyPeriod8ToPeriod9}
                      className="px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold transition shadow-sm"
                    >
                      🐰 8교시 → 9교시 복사
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetDailyAttendance(selectedDate, 'all')}
                      disabled={savingAttendance}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-extrabold flex items-center gap-1 transition shadow-sm"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      오늘 출석 전체 초기화
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAllDailyAttendance}
                      disabled={savingAttendance}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingAttendance ? '저장 중...' : '전체 출석표 저장 ✨'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3">
                  <div className="bg-white/90 rounded-2xl p-3.5 border border-emerald-200 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-emerald-800">
                        🌱 8교시 (16:20 ~ 17:10 · 50분)
                      </span>
                      <span className="text-sm sm:text-base font-black text-emerald-600">
                        출석 {dailySummary.p8Present}명{' '}
                        <span className="text-xs font-bold text-rose-500">
                          / 불참 {dailySummary.p8Absent}명
                        </span>{' '}
                        <span className="text-xs font-semibold text-slate-400">
                          (미체크 {dailySummary.p8Unchecked}명)
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                      {dailySummary.p8Present === 0 && dailySummary.p8Absent === 0 ? (
                        <span className="text-slate-400">
                          아직 8교시 출석 체크 전이에요 (또는 초기화됨)
                        </span>
                      ) : Object.entries(dailySummary.p8ReasonCounts).length === 0 ? (
                        <span className="text-emerald-600">
                          🎉 체크된 인원 전원 8교시 출석!
                        </span>
                      ) : (
                        Object.entries(dailySummary.p8ReasonCounts).map(([reason, cnt]) => (
                          <span
                            key={reason}
                            className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                          >
                            {getReasonEmoji(reason)} {reason} {cnt}명
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-white/90 rounded-2xl p-3.5 border border-emerald-200 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-emerald-800">
                        🍀 9교시 (17:20 ~ 18:10 · 50분)
                      </span>
                      <span className="text-sm sm:text-base font-black text-emerald-600">
                        출석 {dailySummary.p9Present}명{' '}
                        <span className="text-xs font-bold text-rose-500">
                          / 불참 {dailySummary.p9Absent}명
                        </span>{' '}
                        <span className="text-xs font-semibold text-slate-400">
                          (미체크 {dailySummary.p9Unchecked}명)
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                      {dailySummary.p9Present === 0 && dailySummary.p9Absent === 0 ? (
                        <span className="text-slate-400">
                          아직 9교시 출석 체크 전이에요 (또는 초기화됨)
                        </span>
                      ) : Object.entries(dailySummary.p9ReasonCounts).length === 0 ? (
                        <span className="text-emerald-600">
                          🎉 체크된 인원 전원 9교시 출석!
                        </span>
                      ) : (
                        Object.entries(dailySummary.p9ReasonCounts).map(([reason, cnt]) => (
                          <span
                            key={reason}
                            className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                          >
                            {getReasonEmoji(reason)} {reason} {cnt}명
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 일별 출석 누적 기록 상태 바 & 출석 초기화/취소 컨트롤 바 */}
            <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border-2 border-amber-200 flex flex-col gap-3 no-print">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isSelectedDateSaved ? (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-black">
                      ✅ {selectedDate} 출석 기록됨 (선택된 버튼을 한 번 더 누르거나 [✕ 취소]를 누르면 출석이 취소돼요!)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black">
                      💡 {selectedDate} 미기록 상태 (학생별 버튼을 누르거나 [🌱 8·9교시 전원 출석]을 눌러 출석을 기록하세요!)
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleResetDailyAttendance(selectedDate, 'period8')}
                    className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-extrabold transition"
                  >
                    🔄 8교시 전체 취소
                  </button>
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleResetDailyAttendance(selectedDate, 'period9')}
                    className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-extrabold transition"
                  >
                    🔄 9교시 전체 취소
                  </button>
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleResetDailyAttendance(selectedDate, 'all')}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-extrabold flex items-center gap-1 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {selectedDate} 출석 전체 초기화
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-amber-100 text-xs">
                <span className="font-extrabold text-slate-600 mr-1">
                  📅 {selectedMonth} 출석 누적 기록된 날 ({recordedDates.length}일):
                </span>
                {recordedDates.length === 0 ? (
                  <span className="text-slate-400 font-semibold">
                    아직 기록된 날짜가 없어요. 오늘 출석을 체크하면 여기에 날짜별로 차곡차곡 쌓입니다!
                  </span>
                ) : (
                  recordedDates.map((dStr) => (
                    <span
                      key={dStr}
                      className={`inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full font-extrabold transition border ${
                        dStr === selectedDate
                          ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDateChange(dStr)}
                        className="hover:underline"
                      >
                        ✓ {dStr.slice(5)}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResetDailyAttendance(dStr, 'all')}
                        className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] transition ${
                          dStr === selectedDate
                            ? 'bg-emerald-600 hover:bg-rose-500 text-white'
                            : 'bg-emerald-200/80 hover:bg-rose-500 text-emerald-900 hover:text-white'
                        }`}
                        title={`${dStr} 출석 기록 전체 취소(초기화)`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* 첨부 사진 2번 스타일: 밝고 귀여운 오후 자습 출석표 (불참 시 사유작성) */}
            <div className="bg-white rounded-3xl shadow-[0_10px_35px_rgb(0,0,0,0.04)] border-2 border-amber-200 overflow-hidden">
              <div className="bg-gradient-to-r from-[#FFF6CC] via-[#FFF0D4] to-[#FFE8EC] border-b-2 border-amber-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">📋</span>
                  <div>
                    <h2 className="text-lg sm:text-xl font-black text-slate-800">
                      오후 자습 출석표 (불참 시 사유작성)
                    </h2>
                    <p className="text-xs font-bold text-slate-600 mt-0.5">
                      📅 {selectedDate} · 이미 선택된 버튼을 한 번 더 누르거나 [✕ 취소] / [↩️ 출석취소]를 누르면 즉시 출석이 취소돼요!
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 no-print">
                  <button
                    type="button"
                    onClick={() => handleMarkAllPresent('all')}
                    className="px-3.5 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold shadow-sm transition"
                  >
                    🌱 전원 출석 일괄 체크
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResetDailyAttendance(selectedDate, 'all')}
                    className="px-3.5 py-2 rounded-2xl bg-white hover:bg-rose-50 text-rose-600 text-xs font-extrabold border-2 border-rose-200 shadow-sm transition"
                  >
                    🔄 오늘 출석 전체 초기화
                  </button>
                  {role === 'teacher' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('admin')}
                      className="px-3.5 py-2 rounded-2xl bg-white hover:bg-amber-50 text-amber-900 text-xs font-extrabold border-2 border-amber-200 shadow-sm transition"
                    >
                      + 학생 명단 / 사유 관리 👩‍🏫
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-amber-50/70 border-b-2 border-amber-200 text-slate-800 font-extrabold">
                      <th className="py-3.5 px-4 border-r border-amber-100 w-36 text-center">
                        🐣 학생 이름
                      </th>
                      <th className="py-3.5 px-3 border-r border-amber-100 w-36 text-center">
                        ⏱️ {Number(selectedMonth.split('-')[1])}월 누적 시간
                      </th>
                      <th className="py-3 px-4 border-r border-amber-100 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div>
                            8교시{' '}
                            <span className="text-xs font-bold text-amber-700">
                              (16:20~17:10)
                            </span>
                          </div>
                          <div className="flex items-center gap-1 no-print">
                            <button
                              type="button"
                              onClick={() => handleMarkAllPresent(8)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-black transition"
                            >
                              🌱 8교시 전원출석
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetDailyAttendance(selectedDate, 'period8')}
                              className="px-2 py-0.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px] font-black transition"
                            >
                              🔄 8교시 초기화
                            </button>
                          </div>
                        </div>
                      </th>
                      <th className="py-3 px-4 border-r border-amber-100 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div>
                            9교시{' '}
                            <span className="text-xs font-bold text-rose-600">
                              (17:20~18:10)
                            </span>
                          </div>
                          <div className="flex items-center gap-1 no-print">
                            <button
                              type="button"
                              onClick={() => handleMarkAllPresent(9)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-black transition"
                            >
                              🍀 9교시 전원출석
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetDailyAttendance(selectedDate, 'period9')}
                              className="px-2 py-0.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px] font-black transition"
                            >
                              🔄 9교시 초기화
                            </button>
                          </div>
                        </div>
                      </th>
                      <th className="py-3.5 px-4 w-64 text-center no-print">
                        ✏️ 한줄 메모 & 개별 출석취소
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100/80">
                    {students.map((st) => {
                      const row = dailyDraft[st.id] || {
                        period8Status: '',
                        period8Note: '',
                        period9Status: '',
                        period9Note: '',
                      };
                      const stStat = statsByStudentId.get(st.id);
                      const options = ['출석', ...reasons.map((r) => r.label)];
                      const hasAnyStatus = Boolean(
                        row.period8Status || row.period9Status || row.period8Note
                      );

                      return (
                        <tr
                          key={st.id}
                          className="hover:bg-amber-50/40 transition"
                        >
                          <td className="py-3 px-4 border-r border-amber-100 font-extrabold text-slate-800 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(st.id)}
                              className="hover:text-rose-500 inline-flex items-center gap-1.5 group"
                              title="클릭하여 월별 누적 자습시간 및 결석 이력 보기"
                            >
                              <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-black inline-flex items-center justify-center group-hover:bg-rose-100 group-hover:text-rose-700 transition">
                                {st.student_number}
                              </span>
                              <span>{st.name}</span>
                            </button>
                          </td>

                          {/* 실시간 월 누적 자습시간 칸 */}
                          <td className="py-2.5 px-3 border-r border-amber-100 text-center whitespace-nowrap bg-amber-50/20">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(st.id)}
                              className="inline-flex flex-col items-center"
                            >
                              <span className="text-xs font-black text-emerald-700">
                                {formatMinutesToKorean(stStat?.totalMinutes || 0)}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                누적 {stStat?.totalAttendedPeriods || 0}교시
                              </span>
                            </button>
                          </td>

                          {/* 8교시 칸 */}
                          <td className="py-2.5 px-3 border-r border-amber-100 text-center">
                            {excelCompactMode ? (
                              !row.period8Status ? (
                                <span className="text-xs font-bold text-slate-300">-</span>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-extrabold ${
                                    row.period8Status === '출석'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {getReasonEmoji(row.period8Status)}{' '}
                                  {row.period8Status === '출석' ? '출석' : row.period8Status}
                                </span>
                              )
                            ) : (
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                {options.map((opt) => {
                                  const selected = row.period8Status === opt;
                                  const isPresent = opt === '출석';
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handleSelectPeriodStatus(st.id, 8, opt)}
                                      title={
                                        selected
                                          ? '다시 클릭하면 8교시 출석/사유가 취소됩니다'
                                          : `${opt} 선택`
                                      }
                                      className={`px-3 py-1.5 rounded-full text-xs font-extrabold transition border ${
                                        selected
                                          ? isPresent
                                            ? 'bg-emerald-400 text-white border-emerald-500 shadow-sm scale-105'
                                            : 'bg-rose-400 text-white border-rose-500 shadow-sm scale-105'
                                          : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 hover:text-slate-800'
                                      }`}
                                    >
                                      {getReasonEmoji(opt)} {opt}
                                    </button>
                                  );
                                })}
                                {row.period8Status && (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectPeriodStatus(st.id, 8, '')}
                                    className="px-2.5 py-1.5 rounded-full text-[11px] font-black bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 transition"
                                    title="8교시 출석/사유 취소"
                                  >
                                    ✕ 취소
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 9교시 칸 */}
                          <td className="py-2.5 px-3 border-r border-amber-100 text-center">
                            {excelCompactMode ? (
                              !row.period9Status ? (
                                <span className="text-xs font-bold text-slate-300">-</span>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-extrabold ${
                                    row.period9Status === '출석'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {getReasonEmoji(row.period9Status)}{' '}
                                  {row.period9Status === '출석' ? '출석' : row.period9Status}
                                </span>
                              )
                            ) : (
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                {options.map((opt) => {
                                  const selected = row.period9Status === opt;
                                  const isPresent = opt === '출석';
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => handleSelectPeriodStatus(st.id, 9, opt)}
                                      title={
                                        selected
                                          ? '다시 클릭하면 9교시 출석/사유가 취소됩니다'
                                          : `${opt} 선택`
                                      }
                                      className={`px-3 py-1.5 rounded-full text-xs font-extrabold transition border ${
                                        selected
                                          ? isPresent
                                            ? 'bg-emerald-400 text-white border-emerald-500 shadow-sm scale-105'
                                            : 'bg-rose-400 text-white border-rose-500 shadow-sm scale-105'
                                          : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 hover:text-slate-800'
                                      }`}
                                    >
                                      {getReasonEmoji(opt)} {opt}
                                    </button>
                                  );
                                })}
                                {row.period9Status && (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectPeriodStatus(st.id, 9, '')}
                                    className="px-2.5 py-1.5 rounded-full text-[11px] font-black bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 transition"
                                    title="9교시 출석/사유 취소"
                                  >
                                    ✕ 취소
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 상세 메모 & 개별 학생 당일 출석취소 칸 */}
                          <td className="py-2 px-3 no-print">
                            <div className="flex items-center gap-1.5">
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
                                placeholder="상세 사유 메모 ✏️"
                                className="flex-1 min-w-0 px-3 py-1.5 text-xs font-medium rounded-xl border border-amber-200/80 bg-amber-50/20 focus:bg-white focus:ring-2 focus:ring-amber-300 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleCancelStudentDailyAttendance(st.id, st.name)}
                                disabled={!hasAnyStatus}
                                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black whitespace-nowrap border transition ${
                                  hasAnyStatus
                                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200'
                                    : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                                }`}
                                title={`${st.name} 학생의 오늘(8·9교시) 출석 기록 취소`}
                              >
                                ↩️ 출석취소
                              </button>
                            </div>
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
              className="bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-2 border-rose-200 space-y-4 no-print"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center text-xl">
                    ✍️
                  </span>
                  <div>
                    <h3 className="text-base font-black text-slate-800">
                      {signingDate} 오후 자습 감독관 확인(서명) & 담임선생님 보고
                    </h3>
                    <p className="text-xs font-semibold text-slate-500">
                      여기서 서명하면 [2. 오후 자습 감독 확인표]의 해당 날짜 8교시·9교시 확인란에 예쁘게 기록돼요!
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('supervisor_sheet')}
                  className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-xs font-extrabold text-amber-900 border border-amber-200"
                >
                  🗓️ 월간 감독 확인표 전체 보기 →
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-amber-50/60 border-2 border-amber-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-extrabold text-amber-900">
                      🌱 8교시 (16:20~17:10) 감독관 서명
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetConfirmation(signingDate, 'period8')}
                      className="text-[11px] font-extrabold text-amber-700 hover:text-rose-600 bg-white px-2 py-0.5 rounded-full border border-amber-200 transition"
                    >
                      🔄 8교시 초기화
                    </button>
                  </div>
                  <input
                    type="text"
                    value={signP8Name}
                    onChange={(e) => setSignP8Name(e.target.value)}
                    placeholder="8교시 감독관 이름 입력"
                    className="w-full px-3.5 py-2 rounded-xl border border-amber-200 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                    <span>8교시 교실 내 인원:</span>
                    <span className="font-extrabold text-emerald-600">
                      현재 {dailySummary.p8Present}명
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-rose-50/60 border-2 border-rose-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-extrabold text-rose-900">
                      🍀 9교시 (17:20~18:10) 감독관 서명
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetConfirmation(signingDate, 'period9')}
                      className="text-[11px] font-extrabold text-rose-700 hover:text-rose-900 bg-white px-2 py-0.5 rounded-full border border-rose-200 transition"
                    >
                      🔄 9교시 초기화
                    </button>
                  </div>
                  <input
                    type="text"
                    value={signP9Name}
                    onChange={(e) => setSignP9Name(e.target.value)}
                    placeholder="9교시 감독관 이름 입력"
                    className="w-full px-3.5 py-2 rounded-xl border border-rose-200 text-sm font-bold bg-white focus:ring-2 focus:ring-rose-400 focus:outline-none"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                    <span>9교시 교실 내 인원:</span>
                    <span className="font-extrabold text-emerald-600">
                      현재 {dailySummary.p9Present}명
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-sky-50/60 border-2 border-sky-200/80 space-y-2">
                  <label className="block text-xs font-extrabold text-sky-900">
                    💌 특별한 상황 담임선생님께 보고
                  </label>
                  <textarea
                    rows={2}
                    value={signSpecialNote}
                    onChange={(e) => setSignSpecialNote(e.target.value)}
                    placeholder="자습 시간 특이사항이나 전달할 내용을 적어주세요."
                    className="w-full px-3.5 py-2 rounded-xl border border-sky-200 text-xs font-medium bg-white focus:ring-2 focus:ring-sky-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={savingSignature}
                  onClick={() => handleResetConfirmation(signingDate, 'all')}
                  className="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200 hover:border-rose-200 font-extrabold text-xs flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {signingDate} 서명 전체 초기화
                </button>
                <button
                  type="submit"
                  disabled={savingSignature}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-400 to-amber-400 hover:from-rose-500 hover:to-amber-500 text-white font-black text-xs shadow-md flex items-center gap-2 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {savingSignature
                    ? '서명 기록 중...'
                    : `${signingDate} 8·9교시 감독관 서명 저장하기 💮`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== TAB 2: 오후 자습 감독 확인표 (월간 서명표 - 사진 1번) ==================== */}
        {activeTab === 'supervisor_sheet' && (
          <div className="space-y-6">
            {/* 월 선택 컨트롤 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-3xl shadow-sm border-2 border-amber-200 no-print">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="p-2 rounded-2xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-4 py-2 rounded-2xl border-2 border-amber-200 bg-amber-50/30 font-black text-sm text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="p-2 rounded-2xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs font-extrabold text-amber-900 bg-amber-50 px-3.5 py-1.5 rounded-full border border-amber-200">
                💡 표에서 날짜 칸을 톡 클릭해 서명하거나, 잘못 서명한 날은 칸 안의 [🔄 초기화] 버튼으로 바로 지울 수 있어요!
              </p>
            </div>

            {/* 첨부 사진 1번 레이아웃 그대로 + 밝고 깨끗하고 귀여운 파스텔 옐로우 스타일 */}
            <div className="bg-white rounded-3xl border-2 border-amber-300 shadow-[0_12px_40px_rgba(251,191,36,0.12)] overflow-hidden">
              {/* 상단 밝은 노란색 배너 제목 */}
              <div className="bg-gradient-to-r from-[#FFF066] via-[#FFF380] to-[#FFE875] border-b-2 border-amber-300 py-4 px-4 text-center">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-wide flex items-center justify-center gap-2">
                  <span>🌻</span>
                  <span>오후 자습 감독 확인표({Number(selectedMonth.split('-')[1])}월)</span>
                  <span>🌻</span>
                </h2>
              </div>

              {/* 주차별 월~금 날짜 및 확인(8교시/9교시 2줄) 표 */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs sm:text-sm table-fixed">
                  <tbody>
                    {monthWeeks.map((week, wIdx) => (
                      <React.Fragment key={wIdx}>
                        {/* 날짜 행 */}
                        <tr className="border-b border-amber-200 bg-amber-50/70">
                          <td className="w-20 sm:w-24 py-2.5 px-2 border-r border-amber-200 text-center font-extrabold text-amber-900">
                            날짜
                          </td>
                          {week.map((dayCell, dIdx) => {
                            const conf = dayCell
                              ? confirmationsByDate.get(dayCell.dateStr)
                              : undefined;
                            const hasAnyRecord = Boolean(
                              conf?.period8_supervisor_name ||
                                conf?.period9_supervisor_name ||
                                conf?.teacher_confirmed ||
                                conf?.special_note
                            );
                            return (
                              <td
                                key={dIdx}
                                onClick={() => {
                                  if (dayCell) setSigningDate(dayCell.dateStr);
                                }}
                                className={`py-2 px-2 border-r last:border-r-0 border-amber-200 text-center font-extrabold cursor-pointer transition ${
                                  dayCell?.dateStr === signingDate
                                    ? 'bg-amber-300 text-slate-900'
                                    : 'hover:bg-amber-100/70 text-slate-800'
                                }`}
                              >
                                {dayCell && (
                                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                                    <span>{dayCell.label}</span>
                                    {hasAnyRecord && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSigningDate(dayCell.dateStr);
                                          handleResetConfirmation(dayCell.dateStr, 'all');
                                        }}
                                        className="px-1.5 py-0.5 rounded-full bg-white/90 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-200 text-[10px] font-black transition no-print"
                                        title={`${dayCell.label} 서명 및 확인 전체 초기화`}
                                      >
                                        🔄 초기화
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>

                        {/* 확인 행 - 1번째 줄: 8교시 (16:20~17:10) */}
                        <tr className="border-b border-amber-100">
                          <td
                            rowSpan={2}
                            className="w-20 sm:w-24 py-4 px-2 border-r border-b-2 border-amber-300 text-center font-extrabold text-slate-800 align-middle bg-amber-50/20"
                          >
                            확인
                            <div className="mt-1 text-[10px] font-bold text-amber-700 bg-amber-100/80 rounded-lg py-0.5 px-1">
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
                                className={`h-14 px-2 py-1.5 border-r last:border-r-0 border-amber-200 text-center align-middle cursor-pointer transition ${
                                  dayCell?.dateStr === signingDate
                                    ? 'bg-amber-50/90'
                                    : 'bg-white hover:bg-amber-50/30'
                                }`}
                              >
                                {dayCell && (
                                  <div className="flex flex-col items-center justify-center gap-0.5">
                                    <span className="text-[10px] font-bold text-amber-600">
                                      8교시 (16:20~17:10)
                                    </span>
                                    {conf?.period8_supervisor_name ? (
                                      <span className="font-extrabold text-slate-800 text-xs sm:text-sm inline-flex items-center gap-1">
                                        <span>✍️ {conf.period8_supervisor_name}</span>
                                        {conf.period8_headcount !== null &&
                                          conf.period8_headcount !== undefined && (
                                            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded-full">
                                              {conf.period8_headcount}명
                                            </span>
                                          )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSigningDate(dayCell.dateStr);
                                            handleResetConfirmation(dayCell.dateStr, 'period8');
                                          }}
                                          className="ml-0.5 w-4 h-4 rounded-full bg-rose-100 hover:bg-rose-500 text-rose-600 hover:text-white inline-flex items-center justify-center text-[10px] transition no-print"
                                          title="8교시 서명만 초기화"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-300 font-medium no-print">
                                        + 8교시 서명
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>

                        {/* 확인 행 - 2번째 줄: 9교시 (17:20~18:10) + 담임선생님 확인 도장 */}
                        <tr className="border-b-2 border-amber-300">
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
                                className={`h-16 px-2 py-1.5 border-r last:border-r-0 border-amber-200 text-center align-middle cursor-pointer transition ${
                                  dayCell?.dateStr === signingDate
                                    ? 'bg-amber-50/90'
                                    : 'bg-white hover:bg-amber-50/30'
                                }`}
                              >
                                {dayCell && (
                                  <div className="flex flex-col items-center justify-center gap-0.5">
                                    <span className="text-[10px] font-bold text-rose-500">
                                      9교시 (17:20~18:10)
                                    </span>
                                    {conf?.period9_supervisor_name ? (
                                      <span className="font-extrabold text-slate-800 text-xs sm:text-sm inline-flex items-center gap-1">
                                        <span>✍️ {conf.period9_supervisor_name}</span>
                                        {conf.period9_headcount !== null &&
                                          conf.period9_headcount !== undefined && (
                                            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded-full">
                                              {conf.period9_headcount}명
                                            </span>
                                          )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSigningDate(dayCell.dateStr);
                                            handleResetConfirmation(dayCell.dateStr, 'period9');
                                          }}
                                          className="ml-0.5 w-4 h-4 rounded-full bg-rose-100 hover:bg-rose-500 text-rose-600 hover:text-white inline-flex items-center justify-center text-[10px] transition no-print"
                                          title="9교시 서명만 초기화"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-300 font-medium no-print">
                                        + 9교시 서명
                                      </span>
                                    )}

                                    {conf?.teacher_confirmed && (
                                      <span className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black border border-rose-300">
                                        <span>💮 담임선생님 확인완료</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSigningDate(dayCell.dateStr);
                                            handleResetConfirmation(dayCell.dateStr, 'teacher');
                                          }}
                                          className="ml-0.5 text-rose-500 hover:text-rose-900 no-print"
                                          title="담임선생님 확인 도장 초기화"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    )}
                                    {conf?.special_note && (
                                      <span className="text-[10px] font-semibold text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded-full truncate max-w-full">
                                        💌 {conf.special_note}
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

              {/* 하단 5줄 감독관 안내 수칙 (첨부 사진 1번 문구 그대로 반영 + 귀여운 메모장 스타일) */}
              <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-50/60 via-white to-rose-50/50 text-xs sm:text-sm text-slate-700 space-y-1.5 font-bold leading-relaxed">
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
            <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-amber-200 space-y-4 no-print">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-amber-200 text-amber-950 text-xs font-black">
                    📅 선택 날짜: {signingDate}
                  </span>
                  <h3 className="text-sm sm:text-base font-black text-slate-800">
                    8교시·9교시 감독관 서명 및 일별 초기화
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingSignature}
                    onClick={() => handleResetConfirmation(signingDate, 'all')}
                    className="px-3.5 py-2 rounded-2xl bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200 hover:border-rose-200 text-xs font-black flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    🔄 {signingDate} 서명·확인 전체 초기화
                  </button>

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
                      className={`px-4 py-2 rounded-2xl text-xs font-black flex items-center gap-1.5 transition ${
                        confirmationsByDate.get(signingDate)?.teacher_confirmed
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                          : 'bg-gradient-to-r from-rose-400 to-pink-500 text-white hover:from-rose-500 hover:to-pink-600 shadow-sm'
                      }`}
                    >
                      <span>💮</span>
                      {confirmationsByDate.get(signingDate)?.teacher_confirmed
                        ? '담임선생님 확인 도장 초기화'
                        : '다음 날 아침 담임선생님 확인 도장 꾹!'}
                    </button>
                  )}
                </div>
              </div>

              <form
                onSubmit={handleSaveSupervisorConfirmation}
                className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-extrabold text-amber-900">
                      🌱 8교시 감독관 확인(서명)
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetConfirmation(signingDate, 'period8')}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      8교시 초기화
                    </button>
                  </div>
                  <input
                    type="text"
                    value={signP8Name}
                    onChange={(e) => setSignP8Name(e.target.value)}
                    placeholder="8교시 감독관 이름"
                    className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-amber-200 text-sm font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-extrabold text-rose-900">
                      🍀 9교시 감독관 확인(서명)
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetConfirmation(signingDate, 'period9')}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-500"
                    >
                      9교시 초기화
                    </button>
                  </div>
                  <input
                    type="text"
                    value={signP9Name}
                    onChange={(e) => setSignP9Name(e.target.value)}
                    placeholder="9교시 감독관 이름"
                    className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-rose-200 text-sm font-bold focus:ring-2 focus:ring-rose-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-sky-900 mb-1">
                    💌 특별한 상황 담임선생님 보고
                  </label>
                  <input
                    type="text"
                    value={signSpecialNote}
                    onChange={(e) => setSignSpecialNote(e.target.value)}
                    placeholder="특이사항 또는 교내 인원 메모"
                    className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-sky-200 text-sm font-medium focus:ring-2 focus:ring-sky-400 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingSignature}
                  className="py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                >
                  <Save className="w-4 h-4" />
                  {savingSignature ? '저장 중...' : '확인표에 서명 저장 ✨'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: 월별 개인 누적 자습시간 & 참여 통계 ==================== */}
        {activeTab === 'monthly_stats' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-emerald-200 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl">
                  🏆
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800">
                    {selectedMonth} 우리 반 학생별 누적 자습시간 & 열공 통계
                  </h2>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">
                    8교시(50분) + 9교시(50분) 기준으로 이번 달 친구들이 얼마나 자습에 참여했는지 누적 시간으로 보여줘요!
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 no-print">
                {recordedDates.length > 0 && (
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleResetMonthlyAttendance()}
                    className="px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-extrabold flex items-center gap-1 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {selectedMonth} 전체 출석 초기화
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="p-2 rounded-2xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-4 py-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50/30 font-black text-sm text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="p-2 rounded-2xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border-2 border-emerald-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gradient-to-r from-emerald-100 via-teal-100/80 to-amber-100/80 text-slate-800 text-xs font-extrabold border-b-2 border-emerald-200">
                      <th className="py-3.5 px-4 text-center w-16">번호</th>
                      <th className="py-3.5 px-4 text-left w-36">학생 이름</th>
                      <th className="py-3.5 px-4 text-center">🌱 8교시 출석</th>
                      <th className="py-3.5 px-4 text-center">🍀 9교시 출석</th>
                      <th className="py-3.5 px-4 text-center">총 참여 교시</th>
                      <th className="py-3.5 px-4 text-left">⏱️ 월 누적 자습시간 (1교시=50분)</th>
                      <th className="py-3.5 px-4 text-left">불참 사유별 횟수</th>
                      <th className="py-3.5 px-4 text-center no-print">상세 기록 / 초기화</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {studentMonthlyStats.map((stat) => (
                      <tr key={stat.student.id} className="hover:bg-emerald-50/30 transition">
                        <td className="py-3.5 px-4 text-center">
                          <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black inline-flex items-center justify-center">
                            {stat.student.student_number}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-extrabold text-slate-800">
                          {stat.student.name}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                          {stat.p8Attended}회{' '}
                          <span className="text-xs text-slate-400">
                            ({stat.p8Attended * MINUTES_PER_PERIOD}분)
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                          {stat.p9Attended}회{' '}
                          <span className="text-xs text-slate-400">
                            ({stat.p9Attended * MINUTES_PER_PERIOD}분)
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-black">
                            총 {stat.totalAttendedPeriods}교시
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-1.5">
                            <span className="font-black text-emerald-700 text-sm">
                              ✨ {formatMinutesToKorean(stat.totalMinutes)}
                            </span>
                            <div className="w-44 h-2.5 rounded-full bg-emerald-100/80 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full"
                                style={{ width: `${Math.min(100, stat.attendanceRate)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(stat.reasonBreakdown).length === 0 ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-extrabold">
                                🌷 결석 없음
                              </span>
                            ) : (
                              Object.entries(stat.reasonBreakdown).map(([reason, cnt]) => (
                                <span
                                  key={reason}
                                  className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-extrabold"
                                >
                                  {getReasonEmoji(reason)} {reason} {cnt}회
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center no-print">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(stat.student.id)}
                              className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-extrabold border border-amber-200 transition"
                            >
                              🔍 결석보기 ({stat.absenceHistory.length}건)
                            </button>
                            {stat.recordsCount > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleResetMonthlyAttendance(
                                    stat.student.id,
                                    stat.student.name
                                  )
                                }
                                className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-extrabold border border-rose-200 transition"
                                title={`${stat.student.name} 학생의 ${selectedMonth} 출석 기록 초기화`}
                              >
                                🔄 초기화
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 일자별·주간별 출석 누적 기록 매트릭스 (담임교사가 다음 날이나 주중에 날짜별 누적 상태를 한눈에 확인) */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-amber-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                    <span>📅</span>
                    <span>
                      {selectedMonth} 날짜별 출석 누적 기록표 (총 {recordedDates.length}일 기록됨)
                    </span>
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">
                    매일 기록한 8교시·9교시 출석 상태가 날짜별로 차곡차곡 누적된 표입니다. 날짜 머리글의 [× 취소]를 누르면 해당 날짜 출석을 초기화할 수 있어요!
                  </p>
                </div>
              </div>

              {recordedDates.length === 0 ? (
                <div className="p-8 rounded-2xl bg-amber-50/50 border border-amber-200 text-center text-xs font-bold text-slate-500">
                  아직 {selectedMonth}에 저장된 일별 출석 기록이 없습니다. [1. 오후 자습 출석표]에서 출석을 체크하거나 저장하면 날짜별로 누적 표시됩니다!
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-amber-50/80 border-b-2 border-amber-200 text-slate-800 font-extrabold">
                        <th className="py-2.5 px-3 text-left sticky left-0 bg-amber-50 z-10 border-r border-amber-200 w-32">
                          학생 (누적시간)
                        </th>
                        {recordedDates.map((dStr) => (
                          <th
                            key={dStr}
                            className="py-2 px-2.5 text-center border-r border-amber-100 whitespace-nowrap"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  handleDateChange(dStr);
                                  setActiveTab('attendance');
                                }}
                                className="font-black text-amber-950 hover:underline"
                                title={`${dStr} 출석표로 이동`}
                              >
                                {dStr.slice(5)}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResetDailyAttendance(dStr, 'all')}
                                className="px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-500 text-rose-600 hover:text-white text-[10px] font-black transition no-print"
                                title={`${dStr} 출석 전체 취소`}
                              >
                                ×취소
                              </button>
                            </div>
                            <div className="text-[10px] font-semibold text-amber-700">8교시 / 9교시</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {studentMonthlyStats.map((stat) => (
                        <tr key={stat.student.id} className="hover:bg-amber-50/30">
                          <td className="py-2.5 px-3 font-extrabold text-slate-800 sticky left-0 bg-white z-10 border-r border-amber-200 whitespace-nowrap">
                            <div>
                              {stat.student.student_number}. {stat.student.name}
                            </div>
                            <div className="text-[10px] font-black text-emerald-600">
                              {formatMinutesToKorean(stat.totalMinutes)}
                            </div>
                          </td>
                          {recordedDates.map((dStr) => {
                            const rec = attendanceByStudentAndDate.get(
                              `${stat.student.id}_${dStr}`
                            );
                            const p8 = rec?.period8_status || '-';
                            const p9 = rec?.period9_status || '-';
                            return (
                              <td
                                key={dStr}
                                className="py-2 px-2 text-center border-r border-amber-50 whitespace-nowrap"
                              >
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-extrabold ${
                                    p8 === '출석'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {p8 === '출석' ? '🌱출석' : p8}
                                </span>
                                <span className="mx-0.5 text-slate-300">/</span>
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-extrabold ${
                                    p9 === '출석'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {p9 === '출석' ? '🍀출석' : p9}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: 담임교사 관리자 화면 (학생 명단 / 사유 추가 / 결석 일자 조회 / 비밀번호) ==================== */}
        {activeTab === 'admin' && role === 'teacher' && (
          <div className="space-y-6">
            {/* 섹션 A: 학생별 누적 시간 & 언제 출석·결석했는지 한눈에 확인하는 교사용 리포트 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-rose-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-rose-100 flex items-center justify-center text-2xl">
                    👩‍🏫
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-800">
                      담임선생님용 학생별 누적 자습시간 & 일자별 출석·결석 리포트 ({selectedMonth})
                    </h2>
                    <p className="text-xs font-semibold text-slate-500">
                      다음 날 아침이나 주중에 확인하실 때 매일 기록된 출석 일자와 누적 시간, 결석 사유를 한눈에 확인하실 수 있어요.
                    </p>
                  </div>
                </div>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-4 py-2 rounded-2xl border-2 border-rose-200 bg-rose-50/30 font-black text-xs text-slate-800"
                />
              </div>

              {/* 이번 달 누적 기록된 날짜 요약 배너 */}
              <div className="flex flex-wrap items-center gap-2 p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs">
                <span className="font-black text-amber-950">
                  📅 {selectedMonth} 출석 누적 기록된 날 ({recordedDates.length}일):
                </span>
                {recordedDates.length === 0 ? (
                  <span className="text-slate-500 font-semibold">
                    아직 기록된 날짜가 없습니다. [1. 오후 자습 출석표]에서 출석을 체크하거나 저장하면 날짜별로 누적됩니다.
                  </span>
                ) : (
                  recordedDates.map((dStr) => (
                    <button
                      key={dStr}
                      type="button"
                      onClick={() => {
                        handleDateChange(dStr);
                        setActiveTab('attendance');
                      }}
                      className="px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold transition shadow-sm"
                      title={`${dStr} 출석표 확인하기`}
                    >
                      ✓ {dStr.slice(5)}
                    </button>
                  ))
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs sm:text-sm rounded-2xl overflow-hidden">
                  <thead>
                    <tr className="bg-gradient-to-r from-rose-100 via-pink-100/80 to-amber-100 text-slate-800 font-extrabold border-b-2 border-rose-200">
                      <th className="py-3 px-4 text-left w-36">🐣 학생</th>
                      <th className="py-3 px-4 text-left w-48">⏱️ 월 누적 자습시간</th>
                      <th className="py-3 px-4 text-left">
                        🌱 일자별 누적 기록 (날짜별 8·9교시)
                      </th>
                      <th className="py-3 px-4 text-left">
                        📅 언제 · 왜 결석했는지 (날짜 / 교시 / 사유 상세)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100">
                    {studentMonthlyStats.map((stat) => (
                      <tr key={stat.student.id} className="hover:bg-rose-50/30">
                        <td className="py-3.5 px-4 font-extrabold text-slate-800 whitespace-nowrap">
                          {stat.student.student_number}번 · {stat.student.name}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-black text-emerald-700">
                            {formatMinutesToKorean(stat.totalMinutes)}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500">
                            총 {stat.recordsCount}일 기록 (8교시 {stat.p8Attended}회 · 9교시 {stat.p9Attended}회 출석)
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {recordedDates.length === 0 ? (
                            <span className="text-xs text-slate-400 font-semibold">기록 대기 중</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {recordedDates.map((dStr) => {
                                const rec = attendanceByStudentAndDate.get(
                                  `${stat.student.id}_${dStr}`
                                );
                                const p8 = rec?.period8_status || '-';
                                const p9 = rec?.period9_status || '-';
                                const bothPresent = p8 === '출석' && p9 === '출석';
                                return (
                                  <span
                                    key={dStr}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${
                                      bothPresent
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-amber-50 text-amber-900 border-amber-200'
                                    }`}
                                  >
                                    <strong>{dStr.slice(5)}:</strong>
                                    <span>
                                      {p8 === '출석' ? '8출' : `8${p8}`}·{p9 === '출석' ? '9출' : `9${p9}`}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {stat.absenceHistory.length === 0 ? (
                            <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-extrabold">
                              🌷 기록된 결석 없음 (개근!)
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {stat.absenceHistory.map((item, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold"
                                >
                                  <strong>{item.date.slice(5)}</strong> ({item.period}):{' '}
                                  <span className="text-rose-600 font-black">
                                    {getReasonEmoji(item.reason)} {item.reason}
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
              <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-amber-200 space-y-5">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🐥</span>
                  <div>
                    <h3 className="text-base font-black text-slate-800">
                      우리 반 학생 명단 관리 (현재 {students.length}명)
                    </h3>
                    <p className="text-xs font-semibold text-slate-500 mt-0.5">
                      한 명씩 추가하거나, 엑셀의 학생 이름 열을 복사해 한 번에 붙여넣을 수 있어요!
                    </p>
                  </div>
                </div>

                {/* 개별 추가 폼 */}
                <form onSubmit={handleAddStudent} className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={newStudentNumber}
                    onChange={(e) => setNewStudentNumber(e.target.value)}
                    placeholder="번호(자동)"
                    className="w-24 px-3 py-2.5 rounded-2xl border-2 border-amber-200 text-xs font-bold"
                  />
                  <input
                    type="text"
                    required
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    placeholder="추가할 학생 이름 입력"
                    className="flex-1 px-3.5 py-2.5 rounded-2xl border-2 border-amber-200 text-xs font-bold"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-500 text-white text-xs font-black flex items-center gap-1 shadow-sm transition"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    학생 추가
                  </button>
                </form>

                {/* 엑셀 줄바꿈 일괄 붙여넣기 폼 */}
                <form
                  onSubmit={handleBulkAddStudents}
                  className="p-4 rounded-2xl bg-amber-50/60 border-2 border-amber-200/80 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-extrabold text-amber-900">
                      📋 엑셀 학생 명단 줄바꿈 붙여넣기 (일괄 등록)
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkReplaceMode}
                        onChange={(e) => setBulkReplaceMode(e.target.checked)}
                        className="rounded border-amber-300 text-amber-500"
                      />
                      기존 예시 명단을 지우고 새 명단으로 교체
                    </label>
                  </div>
                  <textarea
                    rows={4}
                    value={bulkStudentsText}
                    onChange={(e) => setBulkStudentsText(e.target.value)}
                    placeholder={'엑셀에서 학생 이름들을 복사해 그대로 붙여넣으세요.\n예:\n홍길동\n김철수\n이영희'}
                    className="w-full px-3.5 py-2.5 rounded-2xl border border-amber-200 text-xs font-medium bg-white"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-black shadow-sm transition"
                  >
                    붙여넣은 학생 명단 한 번에 적용하기 ✨
                  </button>
                </form>

                {/* 현재 학생 목록 */}
                <div className="max-h-64 overflow-y-auto divide-y divide-amber-100 border-2 border-amber-100 rounded-2xl">
                  {students.map((st) => (
                    <div
                      key={st.id}
                      className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-amber-50/40"
                    >
                      <span className="font-extrabold text-slate-800">
                        <span className="text-amber-600 mr-1.5">{st.student_number}번</span>
                        {st.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteStudent(st.id, st.name)}
                        className="text-rose-400 hover:text-rose-600 p-1"
                        title="학생 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 결석(불참) 사유 관리 & 감독관 비밀번호 설정 */}
              <div className="space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border-2 border-rose-200 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🏷️</span>
                    <div>
                      <h3 className="text-base font-black text-slate-800">
                        기타 결석(불참) 사유 추가 · 관리
                      </h3>
                      <p className="text-xs font-semibold text-slate-500 mt-0.5">
                        기본 사유(학원, 병원, 동아리, 하브루타, 기타) 외에 우리 반에 필요한 사유를 추가해 보세요!
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleAddReason} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={newReasonLabel}
                      onChange={(e) => setNewReasonLabel(e.target.value)}
                      placeholder="새 불참 사유 입력 (예: 방과후, 상담, 대회준비)"
                      className="flex-1 px-3.5 py-2.5 rounded-2xl border-2 border-rose-200 text-xs font-bold"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2.5 rounded-2xl bg-rose-400 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-1 shadow-sm transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      사유 추가
                    </button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    {reasons.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-xs font-extrabold text-rose-800"
                      >
                        <span>
                          {getReasonEmoji(r.label)} {r.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteReason(r.id, r.label)}
                          className="text-rose-400 hover:text-rose-700"
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
                  className="bg-white rounded-3xl p-6 shadow-sm border-2 border-sky-200 space-y-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🔐</span>
                    <div>
                      <h3 className="text-base font-black text-slate-800">
                        오후 자습 감독관 비밀번호 & 학급 이름 설정
                      </h3>
                      <p className="text-xs font-semibold text-slate-500 mt-0.5">
                        감독관 학생들이 로그인할 때 쓰는 공유 비밀번호와 선생님 비밀번호를 변경할 수 있어요.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">
                      🏫 학급 표시 이름
                    </label>
                    <input
                      type="text"
                      value={adminClassName}
                      onChange={(e) => setAdminClassName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-sky-200 text-xs font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 mb-1">
                        🐣 새 감독관 공유 비밀번호 (변경 시 입력)
                      </label>
                      <input
                        type="password"
                        minLength={4}
                        value={adminNewSupervisorPw}
                        onChange={(e) => setAdminNewSupervisorPw(e.target.value)}
                        placeholder="감독관 새 비밀번호 (4자 이상)"
                        className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-sky-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 mb-1">
                        👩‍🏫 새 담임교사 비밀번호 (변경 시 입력)
                      </label>
                      <input
                        type="password"
                        minLength={4}
                        value={adminNewTeacherPw}
                        onChange={(e) => setAdminNewTeacherPw(e.target.value)}
                        placeholder="교사 새 비밀번호 (4자 이상)"
                        className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-sky-200 text-xs"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-400 hover:from-sky-500 hover:to-indigo-500 text-white font-black text-xs shadow-sm transition"
                  >
                    학급 설정 및 비밀번호 변경 저장하기 ✨
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 학생 개인별 누적시간 & 결석 일자 귀여운 파스텔 모달 */}
      {selectedDetailStat && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-sm flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border-2 border-amber-200 space-y-4">
            <div className="flex items-center justify-between border-b border-amber-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center text-xl">
                  🐣
                </span>
                <div>
                  <h3 className="text-lg font-black text-slate-800">
                    {selectedDetailStat.student.student_number}번 {selectedDetailStat.student.name} ·{' '}
                    {selectedMonth} 자습 리포트
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    월 누적 자습시간:{' '}
                    <strong className="text-emerald-600">
                      {formatMinutesToKorean(selectedDetailStat.totalMinutes)}
                    </strong>{' '}
                    (8교시 {selectedDetailStat.p8Attended}회, 9교시 {selectedDetailStat.p9Attended}회 출석)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailStudentId(null)}
                className="p-1.5 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              <h4 className="text-xs font-extrabold text-slate-700">
                📅 결석(불참) 일자 및 사유 내역 ({selectedDetailStat.absenceHistory.length}건)
              </h4>
              {selectedDetailStat.absenceHistory.length === 0 ? (
                <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-extrabold text-center">
                  🌷 이번 달 결석 내역이 한 건도 없어요! 참 잘했어요!
                </div>
              ) : (
                <div className="divide-y divide-rose-100 border-2 border-rose-100 rounded-2xl">
                  {selectedDetailStat.absenceHistory.map((h, i) => (
                    <div
                      key={i}
                      className="px-4 py-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="font-extrabold text-slate-700">
                        {h.date} ({h.period})
                      </span>
                      <div className="flex items-center gap-2">
                        {h.note && <span className="text-slate-500">{h.note}</span>}
                        <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-black">
                          {getReasonEmoji(h.reason)} {h.reason}
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
                className="px-5 py-2.5 rounded-2xl bg-amber-300 hover:bg-amber-400 text-amber-950 text-xs font-black transition"
              >
                닫기 ✨
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

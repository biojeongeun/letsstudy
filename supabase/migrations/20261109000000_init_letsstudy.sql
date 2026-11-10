-- 오후 자습 출석 & 감독 확인 시스템 (letsstudy) 스키마 및 RLS 정책
-- RLS 가이드 준수: https://supabase.com/docs/guides/database/postgres/row-level-security

create extension if not exists "pgcrypto";

-- 1. 학급 설정 테이블 (교사 소유자 및 감독관 계정 매핑)
create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid references auth.users(id) on delete set null,
  class_name text not null default '고2 우리반 오후 자습',
  teacher_password_hash text not null,
  supervisor_password_hash text not null,
  created_at timestamptz not null default now()
);

-- 2. 학생 명단 테이블 (개인정보 보호를 위해 RLS 엄격 적용)
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_number int not null default 1,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. 결석(불참) 사유 테이블 (기본: 학원, 병원, 동아리, 하브루타, 기타 + 교사 추가 가능)
create table if not exists public.absence_reasons (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (classroom_id, label)
);

-- 4. 일일 8교시/9교시 출석 기록 테이블
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  study_date date not null,
  period8_status text not null default '출석',
  period8_note text not null default '',
  period9_status text not null default '출석',
  period9_note text not null default '',
  updated_by_role text not null default 'supervisor',
  updated_at timestamptz not null default now(),
  unique (student_id, study_date)
);

-- 5. 오후 자습 감독 확인표 (월별/일별 8교시·9교시 감독관 서명 및 담임 확인)
create table if not exists public.supervisor_confirmations (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  period8_supervisor_name text not null default '',
  period8_signed_at timestamptz,
  period8_headcount int,
  period9_supervisor_name text not null default '',
  period9_signed_at timestamptz,
  period9_headcount int,
  special_note text not null default '',
  teacher_confirmed boolean not null default false,
  teacher_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (classroom_id, study_date)
);

-- 인덱스 생성 (성능 최적화)
create index if not exists idx_classrooms_owner on public.classrooms(owner_id);
create index if not exists idx_classrooms_supervisor on public.classrooms(supervisor_user_id);
create index if not exists idx_students_classroom on public.students(classroom_id, student_number);
create index if not exists idx_reasons_classroom on public.absence_reasons(classroom_id, sort_order);
create index if not exists idx_attendance_classroom_date on public.attendance_records(classroom_id, study_date);
create index if not exists idx_confirmations_classroom_date on public.supervisor_confirmations(classroom_id, study_date);

-- 모든 테이블에 RLS 활성화
alter table public.classrooms enable row level security;
alter table public.students enable row level security;
alter table public.absence_reasons enable row level security;
alter table public.attendance_records enable row level security;
alter table public.supervisor_confirmations enable row level security;

-- [RLS 정책 1] classrooms: 본인 교사(owner_id)는 전체 권한, 감독관(supervisor_user_id)은 조회만 가능, 비로그인/타인 차단
create policy "classrooms_select_member"
  on public.classrooms for select
  to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = supervisor_user_id);

create policy "classrooms_insert_owner"
  on public.classrooms for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "classrooms_update_owner"
  on public.classrooms for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "classrooms_delete_owner"
  on public.classrooms for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- [RLS 정책 2] students: 교사(owner_id)와 해당 학급 감독관은 조회 가능, 추가/수정/삭제는 교사만 가능
create policy "students_select_member"
  on public.students for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = students.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "students_insert_teacher"
  on public.students for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "students_update_teacher"
  on public.students for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "students_delete_teacher"
  on public.students for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- [RLS 정책 3] absence_reasons: 교사와 감독관 조회 가능, 추가/수정/삭제는 교사만 가능
create policy "reasons_select_member"
  on public.absence_reasons for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = absence_reasons.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "reasons_insert_teacher"
  on public.absence_reasons for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "reasons_update_teacher"
  on public.absence_reasons for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "reasons_delete_teacher"
  on public.absence_reasons for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- [RLS 정책 4] attendance_records: 교사와 해당 학급 감독관 모두 조회/입력/수정 가능, 삭제는 교사만 가능
create policy "attendance_select_member"
  on public.attendance_records for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = attendance_records.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "attendance_insert_member"
  on public.attendance_records for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = attendance_records.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "attendance_update_member"
  on public.attendance_records for update
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = attendance_records.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = attendance_records.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "attendance_delete_teacher"
  on public.attendance_records for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- [RLS 정책 5] supervisor_confirmations: 교사와 해당 학급 감독관 모두 조회/입력/수정 가능, 삭제는 교사만 가능
create policy "confirmations_select_member"
  on public.supervisor_confirmations for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = supervisor_confirmations.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "confirmations_insert_member"
  on public.supervisor_confirmations for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = supervisor_confirmations.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "confirmations_update_member"
  on public.supervisor_confirmations for update
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = supervisor_confirmations.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.classrooms c
      where c.id = supervisor_confirmations.classroom_id
        and c.supervisor_user_id = (select auth.uid())
    )
  );

create policy "confirmations_delete_teacher"
  on public.supervisor_confirmations for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

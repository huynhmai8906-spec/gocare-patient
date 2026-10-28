-- GoCare App Bệnh Nhân — bảng lưu dữ liệu riêng của từng bệnh nhân (thuốc, chỉ số, lịch hẹn, cài đặt).
-- Chạy MỘT LẦN trong Supabase Dashboard → SQL Editor của project dùng chung với 2 web GoCare.
-- Chưa chạy thì app vẫn hoạt động: dữ liệu tạm lưu trong hồ sơ tài khoản (user_metadata, giới hạn dung lượng).

create table if not exists public.patient_app_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.patient_app_data enable row level security;

-- Mỗi bệnh nhân chỉ đọc/ghi được dữ liệu của chính mình
drop policy if exists "patient reads own app data" on public.patient_app_data;
create policy "patient reads own app data" on public.patient_app_data
  for select using (auth.uid() = user_id);

drop policy if exists "patient writes own app data" on public.patient_app_data;
create policy "patient writes own app data" on public.patient_app_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "patient updates own app data" on public.patient_app_data;
create policy "patient updates own app data" on public.patient_app_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nhân viên GoCare (role staff, giống Web Quản Lý) được xem để hỗ trợ bệnh nhân
drop policy if exists "staff reads patient app data" on public.patient_app_data;
create policy "staff reads patient app data" on public.patient_app_data
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'staff');

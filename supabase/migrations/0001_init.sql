-- ============================================================
-- MeetAssist initial schema
-- ============================================================

-- Use the built-in auth.users from Supabase. No custom users table.

create type meeting_status as enum (
  'pending',
  'transcribing',
  'analysing',
  'done',
  'failed'
);

create table public.meetings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Untitled meeting',
  audio_path      text not null,
  audio_mime      text not null,
  duration_sec    integer,
  status          meeting_status not null default 'pending',
  error_message   text,
  transcript      text,
  result_json     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index meetings_user_id_created_at_idx
  on public.meetings (user_id, created_at desc);

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.meetings enable row level security;

create policy "meetings_select_own"
  on public.meetings for select
  using (auth.uid() = user_id);

create policy "meetings_insert_own"
  on public.meetings for insert
  with check (auth.uid() = user_id);

create policy "meetings_update_own"
  on public.meetings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "meetings_delete_own"
  on public.meetings for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Storage bucket: meeting-audio
-- ============================================================
insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

create policy "audio_select_own"
  on storage.objects for select
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_update_own"
  on storage.objects for update
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Realtime: enable the meetings table
alter publication supabase_realtime add table public.meetings;

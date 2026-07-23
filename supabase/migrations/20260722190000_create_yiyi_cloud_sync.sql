create table public.yiyi_wardrobe_items (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table public.yiyi_preference_profiles (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table public.yiyi_daily_sessions (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table public.yiyi_outfit_versions (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create index yiyi_wardrobe_items_user_updated_idx on public.yiyi_wardrobe_items (user_id, updated_at desc);
create index yiyi_daily_sessions_user_updated_idx on public.yiyi_daily_sessions (user_id, updated_at desc);
create index yiyi_outfit_versions_user_updated_idx on public.yiyi_outfit_versions (user_id, updated_at desc);

alter table public.yiyi_wardrobe_items enable row level security;
alter table public.yiyi_preference_profiles enable row level security;
alter table public.yiyi_daily_sessions enable row level security;
alter table public.yiyi_outfit_versions enable row level security;

create policy "users manage own yiyi wardrobe" on public.yiyi_wardrobe_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own yiyi profiles" on public.yiyi_preference_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own yiyi sessions" on public.yiyi_daily_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own yiyi versions" on public.yiyi_outfit_versions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

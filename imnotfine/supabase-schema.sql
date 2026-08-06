-- I'm Not Fine v2: Supabase SQL Editor에서 한 번 실행
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique check (char_length(invite_code)=6),
  created_at timestamptz not null default now()
);
create table if not exists public.circle_members (
  circle_id uuid references public.circles(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(circle_id,user_id)
);
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete cascade,
  category text not null,
  caption text not null check (char_length(caption) between 1 and 80),
  image_url text not null,
  storage_path text,
  visibility text not null default 'circle' check (visibility in ('circle','private','public')),
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now(),
  constraint circle_visibility check ((visibility='circle' and circle_id is not null) or visibility<>'circle')
);
create table if not exists public.reactions (
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('봤어','나도 그래','버텼네')),
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check(status in ('open','reviewed','dismissed','removed')),
  created_at timestamptz not null default now()
);
create table if not exists public.blocks (
  blocker_id uuid references public.profiles(id) on delete cascade,
  blocked_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check(blocker_id<>blocked_id)
);

create or replace function public.is_circle_member(cid uuid, uid uuid default auth.uid()) returns boolean language sql security definer set search_path=public stable as $$ select exists(select 1 from circle_members where circle_id=cid and user_id=uid) $$;
create or replace function public.can_view_post(pid uuid, uid uuid default auth.uid()) returns boolean language sql security definer set search_path=public stable as $$ select exists(select 1 from posts p where p.id=pid and (p.visibility='public' or p.user_id=uid or (p.visibility='circle' and is_circle_member(p.circle_id,uid)))) $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1))); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table profiles enable row level security; alter table circles enable row level security; alter table circle_members enable row level security; alter table posts enable row level security; alter table reactions enable row level security; alter table reports enable row level security; alter table blocks enable row level security;
create policy "profiles readable to signed users" on profiles for select to authenticated using(true);
create policy "users update own profile" on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "members read circles" on circles for select to authenticated using(owner_id=auth.uid() or is_circle_member(id));
create policy "users create circles" on circles for insert to authenticated with check(owner_id=auth.uid());
create policy "owners update circles" on circles for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "members read memberships" on circle_members for select to authenticated using(user_id=auth.uid() or is_circle_member(circle_id));
create policy "users join circle" on circle_members for insert to authenticated with check(user_id=auth.uid());
create policy "users leave circle" on circle_members for delete to authenticated using(user_id=auth.uid() or exists(select 1 from circles c where c.id=circle_id and c.owner_id=auth.uid()));
create policy "view allowed posts" on posts for select using(visibility='public' or user_id=auth.uid() or (visibility='circle' and is_circle_member(circle_id)));
create policy "create own posts" on posts for insert to authenticated with check(user_id=auth.uid() and (visibility<>'circle' or is_circle_member(circle_id)));
create policy "manage own posts" on posts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "delete own posts" on posts for delete to authenticated using(user_id=auth.uid());
create policy "view reactions on visible posts" on reactions for select to authenticated using(can_view_post(post_id));
create policy "react to visible posts" on reactions for insert to authenticated with check(user_id=auth.uid() and can_view_post(post_id));
create policy "change own reaction" on reactions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "delete own reaction" on reactions for delete to authenticated using(user_id=auth.uid());
create policy "create reports" on reports for insert to authenticated with check(reporter_id=auth.uid());
create policy "read own reports" on reports for select to authenticated using(reporter_id=auth.uid());
create policy "manage own blocks" on blocks for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('post-images','post-images',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy "upload own post images" on storage.objects for insert to authenticated with check(bucket_id='post-images' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "update own post images" on storage.objects for update to authenticated using(bucket_id='post-images' and owner_id=auth.uid());
create policy "delete own post images" on storage.objects for delete to authenticated using(bucket_id='post-images' and owner_id=auth.uid());

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.reactions;

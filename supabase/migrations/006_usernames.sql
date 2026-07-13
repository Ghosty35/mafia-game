-- ============================================================
-- USERNAMES (gangster names)
-- Players choose a public name: 3-16 chars, letters/numbers/_.
-- Unique regardless of upper/lowercase. Emails stay private.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Unique regardless of case (TonySoprano = tonysoprano)
create unique index players_username_lower_idx
  on public.players (lower(username));

-- 2) Quick availability check for the register form
create or replace function public.is_username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.players where lower(username) = lower(name)
  );
$$;

-- 3) Claim a name (one-time; renaming can become a shop item later)
create or replace function public.set_username(new_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if new_username !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'INVALID_USERNAME';
  end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then
    raise exception 'NO_PLAYER';
  end if;
  if p.username is not null then
    raise exception 'ALREADY_SET';
  end if;

  if exists (
    select 1 from public.players where lower(username) = lower(new_username)
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  update public.players
  set username = new_username
  where id = auth.uid()
  returning * into p;

  return to_jsonb(p);
end;
$$;

-- 4) Registration: pick up the name chosen on the register form.
-- If it is invalid or taken by then, fall back to null — the player
-- gets a "choose your name" prompt on first login instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text;
begin
  wanted := new.raw_user_meta_data ->> 'username';

  if wanted is null
     or wanted !~ '^[A-Za-z0-9_]{3,16}$'
     or exists (select 1 from public.players where lower(username) = lower(wanted))
  then
    wanted := null;
  end if;

  insert into public.players (id, username) values (new.id, wanted);
  return new;
end;
$$;

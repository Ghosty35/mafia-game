-- ============================================================
-- 037: Per-player language preference (EN/NL)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) Language column on players. Defaults to English.
alter table public.players
  add column if not exists language text not null default 'en';

do $$
begin
  alter table public.players
    add constraint players_language_check check (language in ('en', 'nl'));
exception
  when duplicate_object then null;
end $$;

-- 2) RPC so the client can save its language without a direct table write
-- (players has RLS with no update policy — all writes go through RPCs).
create or replace function public.set_my_language(p_language text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_language not in ('en', 'nl') then
    raise exception 'INVALID_LANGUAGE';
  end if;

  update public.players
  set language = p_language
  where id = auth.uid();
end;
$$;

grant execute on function public.set_my_language(text) to authenticated;
revoke execute on function public.set_my_language(text) from anon;

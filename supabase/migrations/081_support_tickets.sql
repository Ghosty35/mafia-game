-- 081: Support / Report / Tickets
--
-- Bug-inspectie (Administration menu):
--   Support  — players report issues, bugs etc
--   Report   — player-to-player reports
--   Tickets  — reply within 24 hours
--
-- All three are the same thing underneath: a ticket with a kind. 'support' and
-- 'bug' are about the game, 'report' names another player. Tickets is just the
-- player's own list of them plus the admin's replies, so one table serves all
-- three menu entries.
--
-- Admin is is_admin() (username 'YGhosty'), matching every other admin_* RPC.

create table if not exists public.tickets (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  kind         text not null check (kind in ('support','bug','report')),
  subject      text not null check (length(subject) between 3 and 120),
  body         text not null check (length(body) between 3 and 2000),
  -- only set for kind='report'
  target_id    uuid references public.players(id) on delete set null,
  status       text not null default 'open' check (status in ('open','answered','closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.ticket_replies (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  author_id  uuid references public.players(id) on delete set null,
  is_staff   boolean not null default false,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.tickets enable row level security;
alter table public.ticket_replies enable row level security;
-- No policies: everything goes through the RPCs below, which scope by
-- auth.uid() or is_admin(). A player must never read another player's report.

create index if not exists tickets_mine on public.tickets (player_id, created_at desc);
create index if not exists tickets_queue on public.tickets (status, created_at);
create index if not exists ticket_replies_lookup on public.ticket_replies (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- open a ticket
-- ---------------------------------------------------------------------------

create or replace function public.open_ticket(
  p_kind text,
  p_subject text,
  p_body text,
  p_target_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p        public.players;
  v_target uuid;
  v_id     uuid;
  v_open   int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_kind not in ('support','bug','report') then raise exception 'INVALID_KIND'; end if;
  if p_subject is null or length(trim(p_subject)) < 3 then raise exception 'SUBJECT_TOO_SHORT'; end if;
  if p_body is null or length(trim(p_body)) < 3 then raise exception 'BODY_TOO_SHORT'; end if;
  if length(p_subject) > 120 or length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;

  select * into p from public.players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  -- Reports must name a real player, and not yourself.
  if p_kind = 'report' then
    if p_target_username is null then raise exception 'TARGET_REQUIRED'; end if;
    select id into v_target from public.players where username ilike p_target_username;
    if v_target is null then raise exception 'TARGET_NOT_FOUND'; end if;
    if v_target = p.id then raise exception 'CANNOT_REPORT_SELF'; end if;
  end if;

  -- Cheap spam brake: five open tickets at a time is plenty.
  select count(*) into v_open from public.tickets
   where player_id = p.id and status <> 'closed';
  if v_open >= 5 then raise exception 'TOO_MANY_OPEN'; end if;

  insert into public.tickets (player_id, kind, subject, body, target_id)
  values (p.id, p_kind, trim(p_subject), trim(p_body), v_target)
  returning id into v_id;

  return jsonb_build_object('success', true, 'ticket_id', v_id, 'kind', p_kind);
end;
$$;

-- ---------------------------------------------------------------------------
-- read: mine
-- ---------------------------------------------------------------------------

create or replace function public.get_my_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'kind', t.kind,
      'subject', t.subject,
      'body', t.body,
      'status', t.status,
      'target', tg.username,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'replies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id,
          'body', r.body,
          'is_staff', r.is_staff,
          'author', ra.username,
          'created_at', r.created_at
        ) order by r.created_at), '[]'::jsonb)
        from public.ticket_replies r
        left join public.players ra on ra.id = r.author_id
        where r.ticket_id = t.id
      )
    ) order by t.created_at desc)
    from public.tickets t
    left join public.players tg on tg.id = t.target_id
    where t.player_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- player replies to their own ticket
-- ---------------------------------------------------------------------------

create or replace function public.reply_ticket(p_ticket_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  t public.tickets;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_body is null or length(trim(p_body)) < 1 then raise exception 'BODY_TOO_SHORT'; end if;
  if length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;

  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  -- Your own ticket, or staff on any ticket.
  if t.player_id <> auth.uid() and not public.is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if t.status = 'closed' then raise exception 'TICKET_CLOSED'; end if;

  insert into public.ticket_replies (ticket_id, author_id, is_staff, body)
  values (p_ticket_id, auth.uid(), public.is_admin(), trim(p_body));

  update public.tickets
     set updated_at = now(),
         status = case when public.is_admin() then 'answered' else 'open' end
   where id = p_ticket_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- staff queue
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_tickets(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'kind', t.kind,
      'subject', t.subject,
      'body', t.body,
      'status', t.status,
      'from', pl.username,
      'target', tg.username,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'reply_count', (select count(*) from public.ticket_replies r where r.ticket_id = t.id),
      'replies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'body', r.body, 'is_staff', r.is_staff,
          'author', ra.username, 'created_at', r.created_at
        ) order by r.created_at), '[]'::jsonb)
        from public.ticket_replies r
        left join public.players ra on ra.id = r.author_id
        where r.ticket_id = t.id
      )
    ) order by
      case t.status when 'open' then 1 when 'answered' then 2 else 3 end,
      t.created_at)
    from public.tickets t
    join public.players pl on pl.id = t.player_id
    left join public.players tg on tg.id = t.target_id
    where p_status is null or t.status = p_status
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_ticket_status(p_ticket_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_status not in ('open','answered','closed') then raise exception 'INVALID_STATUS'; end if;

  update public.tickets set status = p_status, updated_at = now() where id = p_ticket_id;
  if not found then raise exception 'TICKET_NOT_FOUND'; end if;

  return jsonb_build_object('success', true, 'status', p_status);
end;
$$;

revoke all on function public.open_ticket(text, text, text, text) from public, anon;
revoke all on function public.get_my_tickets() from public, anon;
revoke all on function public.reply_ticket(uuid, text) from public, anon;
revoke all on function public.admin_get_tickets(text) from public, anon;
revoke all on function public.admin_set_ticket_status(uuid, text) from public, anon;

grant execute on function public.open_ticket(text, text, text, text) to authenticated;
grant execute on function public.get_my_tickets() to authenticated;
grant execute on function public.reply_ticket(uuid, text) to authenticated;
grant execute on function public.admin_get_tickets(text) to authenticated;
grant execute on function public.admin_set_ticket_status(uuid, text) to authenticated;

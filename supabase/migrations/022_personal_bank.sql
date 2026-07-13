-- ============================================================
-- 022: Personal Bank System (fixed)
-- ============================================================

-- Add personal bank column to players (separate from family bank)
alter table public.players
  add column if not exists personal_bank bigint not null default 0;

-- RPC: Deposit to personal bank (now also applies 0.5% tax to gov_tax_bank atomically)
create or replace function public.deposit_personal_bank(amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  tax bigint := floor(amount * 0.005);
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.cash < amount then
    raise exception 'NOT_ENOUGH_CASH';
  end if;

  p.cash := p.cash - amount;
  p.personal_bank := p.personal_bank + amount;
  p.gov_tax_bank := coalesce(p.gov_tax_bank, 0) + tax;

  update public.players 
  set cash = p.cash, 
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  where id = p.id;

  return jsonb_build_object('player', to_jsonb(p));
end;
$$;

-- RPC: Withdraw from personal bank (now also applies 0.5% tax to gov_tax_bank atomically)
create or replace function public.withdraw_personal_bank(amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.players;
  tax bigint := floor(amount * 0.005);
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  if p.personal_bank < amount then
    raise exception 'NOT_ENOUGH_IN_BANK';
  end if;

  p.personal_bank := p.personal_bank - amount;
  p.cash := p.cash + amount;
  p.gov_tax_bank := coalesce(p.gov_tax_bank, 0) + tax;

  update public.players 
  set cash = p.cash, 
      personal_bank = p.personal_bank,
      gov_tax_bank = p.gov_tax_bank
  where id = p.id;

  return jsonb_build_object('player', to_jsonb(p));
end;
$$;
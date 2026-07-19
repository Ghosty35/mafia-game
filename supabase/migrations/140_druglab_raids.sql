-- 140_druglab_raids.sql
-- Adds the missing risk layer to the existing idle drug lab (buy/upgrade/collect
-- already live): POLICE RAIDS on collection + hireable SECURITY (guards), per the
-- Layouts drug-lab design ("politie-invallen ... als je beveiliging of omkoopgelden
-- niet op orde zijn" + "huur bewakers"). Each collection rolls a raid; a raid seizes
-- the whole pending batch, adds heat and shuts the lab for a cooldown. Guards lower
-- the odds; you can also bribe on the spot (can fail, like a smuggling bribe).
-- The bigger the uncollected batch, the more heat it draws — so don't sit on it.
--
-- NOTE: precursors (buy grondstoffen to start production) are intentionally NOT added
-- here — the live lab is an idle-accrual model and reworking it into a precursor-gated
-- batch model would rewrite the whole accrual path. Left as a future extension; the
-- raid/guard risk is the design's emphasised risk/reward layer.

alter table public.player_druglabs
  add column if not exists guards int not null default 0,
  add column if not exists raided_until timestamptz;

insert into public.game_config (key, num, label) values
  ('druglab_raid_base',        20, 'Drug lab raid % base'),
  ('druglab_guard_mit',        4,  'Raid % reduced per guard'),
  ('druglab_bribe_success',    60, 'Drug lab raid bribe success %'),
  ('druglab_raid_heat',        20, 'Heat added on a lab raid'),
  ('druglab_raid_cooldown_min', 60, 'Minutes a lab is offline after a raid')
on conflict (key) do nothing;

-- Raid chance for a lab given its pending batch + guards (for both the roll and the UI).
create or replace function public._druglab_raid_pct(p_pending bigint, p_guards int)
returns int
language sql
stable
set search_path to ''
as $$
  select greatest(3, least(85,
    public._cfg('druglab_raid_base', 20)::int
    + least(15, floor(p_pending / 100.0)::int)
    - p_guards * public._cfg('druglab_guard_mit', 4)::int
  ))::int;
$$;

-- ============================================================
-- hire_lab_guards: security tiers 0..5 (mirrors bodyguard pricing)
-- ============================================================
create or replace function public.hire_lab_guards(p_lab_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  p    public.players;
  lab  public.player_druglabs;
  cost bigint;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into p from public.players where id = auth.uid() for update;
  if p.id is null then raise exception 'NO_PLAYER'; end if;

  select * into lab from public.player_druglabs where id = p_lab_id and player_id = p.id for update;
  if lab.id is null then raise exception 'LAB_NOT_FOUND'; end if;
  if lab.guards >= 5 then raise exception 'GUARDS_MAX'; end if;

  cost := (array[50000, 100000, 200000, 350000, 500000])[lab.guards + 1];
  if p.cash < cost then raise exception 'NOT_ENOUGH_CASH'; end if;

  update public.players set cash = cash - cost where id = p.id;
  update public.player_druglabs set guards = guards + 1 where id = lab.id;

  return jsonb_build_object('success', true, 'guards', lab.guards + 1, 'cost', cost);
end;
$$;

revoke all on function public.hire_lab_guards(uuid) from public, anon;
grant execute on function public.hire_lab_guards(uuid) to authenticated;

-- ============================================================
-- collect_druglab: now rolls a raid (guards + optional bribe mitigate)
-- ============================================================
drop function if exists public.collect_druglab(uuid);

create or replace function public.collect_druglab(p_lab_id uuid, p_bribe boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  p public.players;
  lab public.player_druglabs;
  pending bigint;
  new_storage jsonb;
  new_total int;
  cap int := 500000;
  v_pct int;
  v_fee bigint;
  v_heat int := public._cfg('druglab_raid_heat', 20)::int;
  v_cd int := public._cfg('druglab_raid_cooldown_min', 60)::int;
  v_raided boolean := false;
  v_bribed boolean := false;
  v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
  IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;
  IF lab.raided_until IS NOT NULL AND lab.raided_until > now() THEN RAISE EXCEPTION 'LAB_RAIDED'; END IF;

  pending := public._druglab_pending(lab.drug_type, lab.level, lab.last_collected);
  IF pending <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_COLLECT'; END IF;

  new_total := COALESCE((p.drug_storage->>lab.drug_type)::int, 0) + pending;
  IF new_total > cap THEN RAISE EXCEPTION 'LAB_CAP_REACHED'; END IF;

  v_pct := public._druglab_raid_pct(pending, lab.guards);

  -- Optional bribe: pay up front, can still fail.
  IF p_bribe THEN
    v_fee := least(150000, 20000 + (pending * 50));
    IF p.cash < v_fee THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH_BRIBE'; END IF;
    UPDATE public.players SET cash = cash - v_fee WHERE id = p.id;
    v_bribed := true;
    v_ok := random() < (public._cfg('druglab_bribe_success', 60) / 100.0);
    IF NOT v_ok THEN v_raided := true; END IF;
  ELSE
    v_raided := random() < (v_pct / 100.0);
  END IF;

  IF v_raided THEN
    -- Batch seized, heat spike, lab shut for the cooldown. last_collected reset so
    -- accrual restarts fresh once it reopens.
    UPDATE public.players
      SET heat = least(100, coalesce(heat, 0) + v_heat), heat_updated_at = now()
      WHERE id = p.id;
    UPDATE public.player_druglabs
      SET last_collected = now(), raided_until = now() + make_interval(mins => v_cd)
      WHERE id = lab.id;
    PERFORM public.log_event('bust', 'had a ' || lab.drug_type || ' lab raided in ' || lab.city || '!');
    RETURN jsonb_build_object('success', true, 'raided', true, 'bribed', v_bribed,
      'bribe_fee', COALESCE(v_fee, 0), 'seized', pending, 'drug_type', lab.drug_type,
      'raid_pct', v_pct, 'offline_min', v_cd);
  END IF;

  -- Clean collection.
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[lab.drug_type], to_jsonb(new_total));
  UPDATE public.players SET drug_storage = new_storage WHERE id = p.id;
  UPDATE public.player_druglabs SET last_collected = now() WHERE id = lab.id;

  RETURN jsonb_build_object('success', true, 'raided', false, 'bribed', v_bribed,
    'bribe_fee', COALESCE(v_fee, 0), 'lab_id', lab.id, 'drug_type', lab.drug_type,
    'collected', pending, 'new_total', new_total, 'raid_pct', v_pct);
END;
$$;

revoke all on function public.collect_druglab(uuid, boolean) from public, anon;
grant execute on function public.collect_druglab(uuid, boolean) to authenticated;

-- ============================================================
-- get_my_druglabs: expose guards / raid risk / offline status
-- ============================================================
create or replace function public.get_my_druglabs()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
DECLARE
  labs jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', dl.id, 'city', dl.city, 'drug_type', dl.drug_type, 'level', dl.level,
      'pending', public._druglab_pending(dl.drug_type, dl.level, dl.last_collected),
      'rate', CASE dl.drug_type
                WHEN 'Coke'  THEN (public._druglab_rates()->>'coke_rate')::int
                WHEN 'Meth'  THEN (public._druglab_rates()->>'meth_rate')::int
                WHEN 'Pills' THEN (public._druglab_rates()->>'pills_rate')::int
                ELSE 0
              END * dl.level,
      'guards', dl.guards,
      'raided_until', dl.raided_until,
      'raid_pct', public._druglab_raid_pct(public._druglab_pending(dl.drug_type, dl.level, dl.last_collected), dl.guards),
      'last_collected', dl.last_collected, 'created_at', dl.created_at
    ) ORDER BY dl.created_at
  ), '[]'::jsonb) INTO labs
  FROM public.player_druglabs dl WHERE dl.player_id = auth.uid();

  RETURN jsonb_build_object('labs', labs, 'count', COALESCE(jsonb_array_length(labs), 0), 'limit', 1);
END;
$$;

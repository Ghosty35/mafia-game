-- 067_family_wars_and_territory.sql
-- =====================================================================
-- Spoor C2 — Family wars + territory control.
-- ---------------------------------------------------------------------
-- Migration 036 shipped a bare territories table + claim_territory /
-- get_territories that no page ever called, and takeovers were a pure
-- power auction. This makes territory a real asset and contested via war:
--   * Each city pays hourly income into the owning family's bank
--     (lazily accrued on read, 24h backlog cap, remainder-preserving).
--   * claim_territory now only claims UNCLAIMED cities (500 power,
--     boss/underboss). Owned cities can only change hands through war.
--   * declare_war(city): boss/underboss, 250 power stake, 24h war.
--     One active war per family; a city gets a 24h peace shield after
--     a war over it ends.
--   * war_attack(war_id, bullets): any member of either side, 60s
--     per-player cooldown, 0-100 bullets consumed for bonus points,
--     +3 heat. Points scale with level.
--   * Resolution is lazy (on read/attack past ends_at). Higher score
--     wins, tie goes to the DEFENDER. Winner takes the city, wars_won+1,
--     +250 respect, and loots 10% of the loser's family bank (zero-sum).
--     Loser drops 100 respect (floor 0).
--   * families.territory is kept in sync as "number of cities owned".
-- =====================================================================

-- ---------- A) territory columns + income seed ----------

ALTER TABLE public.territories ADD COLUMN IF NOT EXISTS income_per_hour bigint NOT NULL DEFAULT 0;
ALTER TABLE public.territories ADD COLUMN IF NOT EXISTS last_income_at timestamptz;
ALTER TABLE public.territories ADD COLUMN IF NOT EXISTS last_war_ended_at timestamptz;

UPDATE public.territories SET income_per_hour = v.iph
FROM (VALUES
  ('New York',    25000),
  ('Los Angeles', 20000),
  ('Chicago',     17500),
  ('Las Vegas',   15000),
  ('Miami',       12500)
) AS v(city, iph)
WHERE territories.city = v.city;

-- ---------- B) war tables ----------

CREATE TABLE IF NOT EXISTS public.family_wars (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city               text NOT NULL REFERENCES public.territories(city),
  attacker_family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  defender_family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  attacker_name      text NOT NULL,
  defender_name      text NOT NULL,
  attacker_score     bigint NOT NULL DEFAULT 0,
  defender_score     bigint NOT NULL DEFAULT 0,
  state              text NOT NULL DEFAULT 'active'
                     CHECK (state IN ('active', 'attacker_won', 'defender_won')),
  loot               bigint NOT NULL DEFAULT 0,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz NOT NULL,
  resolved_at        timestamptz
);

-- one active war per city
CREATE UNIQUE INDEX IF NOT EXISTS family_wars_one_active_per_city
  ON public.family_wars (city) WHERE state = 'active';

ALTER TABLE public.family_wars ENABLE ROW LEVEL SECURITY;

-- Wars are public news: readable by any logged-in player. Writes only
-- happen inside SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "Wars are readable by logged in players" ON public.family_wars;
CREATE POLICY "Wars are readable by logged in players"
  ON public.family_wars FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.war_contributions (
  war_id         uuid NOT NULL REFERENCES public.family_wars(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  family_id      uuid NOT NULL,
  points         bigint NOT NULL DEFAULT 0,
  attacks        int NOT NULL DEFAULT 0,
  last_attack_at timestamptz,
  PRIMARY KEY (war_id, player_id)
);
-- RLS on, no policies: only reachable via the SECURITY DEFINER RPCs below.
ALTER TABLE public.war_contributions ENABLE ROW LEVEL SECURITY;

-- ---------- C) helpers ----------

-- Keep families.territory = number of cities the family owns.
CREATE OR REPLACE FUNCTION public._sync_family_territory(p_family_id uuid)
RETURNS void LANGUAGE sql SET search_path = ''
AS $$
  UPDATE public.families f
  SET territory = (SELECT count(*) FROM public.territories t WHERE t.owner_family_id = f.id)
  WHERE f.id = p_family_id;
$$;

-- Accrue pending city income into the owning family's bank.
-- Lazy, capped at a 24h backlog, remainder-preserving (the anchor only
-- advances by the exact seconds that were paid out).
CREATE OR REPLACE FUNCTION public._accrue_territory_income()
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  t RECORD;
  anchor timestamptz;
  elapsed numeric;
  amount bigint;
BEGIN
  FOR t IN
    SELECT city, owner_family_id, income_per_hour, last_income_at
    FROM public.territories
    WHERE owner_family_id IS NOT NULL AND income_per_hour > 0
    FOR UPDATE
  LOOP
    anchor := GREATEST(COALESCE(t.last_income_at, now()), now() - interval '24 hours');
    elapsed := EXTRACT(epoch FROM now() - anchor);
    amount := FLOOR(t.income_per_hour * elapsed / 3600.0);
    IF amount > 0 THEN
      UPDATE public.families SET bank = bank + amount WHERE id = t.owner_family_id;
      UPDATE public.territories
      SET last_income_at = anchor + (amount * 3600.0 / t.income_per_hour) * interval '1 second'
      WHERE city = t.city;
    ELSIF t.last_income_at IS NULL OR t.last_income_at < anchor THEN
      UPDATE public.territories SET last_income_at = anchor WHERE city = t.city;
    END IF;
  END LOOP;
END;
$$;

-- Resolve one war (caller must know it is expired). Locks everything it
-- touches; families are locked in id order to avoid deadlocks.
CREATE OR REPLACE FUNCTION public._resolve_war(p_war_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  w public.family_wars;
  winner_id uuid;
  loser_id uuid;
  winner_name text;
  loser_name text;
  attacker_won boolean;
  v_loot bigint := 0;  -- v_ prefix: plain "loot" collides with the family_wars column in embedded SQL
BEGIN
  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id FOR UPDATE;
  IF w.id IS NULL OR w.state <> 'active' OR now() < w.ends_at THEN
    RETURN NULL;  -- already resolved by a concurrent caller, or not due
  END IF;

  -- tie goes to the defender
  attacker_won := w.attacker_score > w.defender_score;
  IF attacker_won THEN
    winner_id := w.attacker_family_id; loser_id := w.defender_family_id;
    winner_name := w.attacker_name;    loser_name := w.defender_name;
  ELSE
    winner_id := w.defender_family_id; loser_id := w.attacker_family_id;
    winner_name := w.defender_name;    loser_name := w.attacker_name;
  END IF;

  -- lock both families in id order
  PERFORM 1 FROM public.families WHERE id IN (winner_id, loser_id) ORDER BY id FOR UPDATE;

  -- loot: 10% of the loser's family bank, zero-sum transfer
  SELECT FLOOR(GREATEST(0, COALESCE(bank, 0)) * 0.10) INTO v_loot
  FROM public.families WHERE id = loser_id;
  IF v_loot > 0 THEN
    UPDATE public.families SET bank = bank - v_loot WHERE id = loser_id;
    UPDATE public.families SET bank = bank + v_loot WHERE id = winner_id;
  END IF;

  UPDATE public.families
  SET wars_won = COALESCE(wars_won, 0) + 1,
      respect = COALESCE(respect, 0) + 250
  WHERE id = winner_id;

  UPDATE public.families
  SET respect = GREATEST(0, COALESCE(respect, 0) - 100)
  WHERE id = loser_id;

  -- settle any pending income for the old owner before a transfer
  PERFORM public._accrue_territory_income();

  IF attacker_won THEN
    UPDATE public.territories
    SET owner_family_id = winner_id,
        owner_family_name = winner_name,
        power_invested = 250,
        claimed_at = now(),
        last_income_at = now(),
        last_war_ended_at = now()
    WHERE city = w.city;
  ELSE
    UPDATE public.territories SET last_war_ended_at = now() WHERE city = w.city;
  END IF;

  UPDATE public.family_wars
  SET state = CASE WHEN attacker_won THEN 'attacker_won' ELSE 'defender_won' END,
      loot = v_loot,
      resolved_at = now()
  WHERE id = w.id;

  PERFORM public._sync_family_territory(w.attacker_family_id);
  PERFORM public._sync_family_territory(w.defender_family_id);

  PERFORM public._log_event_named(
    winner_name, 'war',
    'won the war against ' || loser_name || ' over ' || w.city ||
    CASE WHEN v_loot > 0 THEN ' and looted $' || v_loot || '!' ELSE '!' END
  );

  RETURN jsonb_build_object(
    'winner', winner_name, 'loser', loser_name,
    'city', w.city, 'loot', v_loot, 'attacker_won', attacker_won
  );
END;
$$;

-- Resolve every expired active war (cheap: wars are rare and short).
CREATE OR REPLACE FUNCTION public._resolve_expired_wars()
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  wid uuid;
BEGIN
  FOR wid IN
    SELECT id FROM public.family_wars WHERE state = 'active' AND ends_at <= now()
  LOOP
    PERFORM public._resolve_war(wid);
  END LOOP;
END;
$$;

-- ---------- D) claim_territory: unclaimed cities only ----------

CREATE OR REPLACE FUNCTION public.claim_territory(p_city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t public.territories;
  fam_id uuid;
  my_role text;
  fam public.families;
  cost bigint := 500;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT family_id, role INTO fam_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();

  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF my_role NOT IN ('boss', 'underboss') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO t FROM public.territories WHERE city = p_city FOR UPDATE;
  IF t.city IS NULL THEN RAISE EXCEPTION 'CITY_NOT_FOUND'; END IF;
  IF t.owner_family_id = fam_id THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;
  -- owned cities can only be taken through war
  IF t.owner_family_id IS NOT NULL THEN RAISE EXCEPTION 'CITY_OWNED_DECLARE_WAR'; END IF;

  SELECT * INTO fam FROM public.families WHERE id = fam_id FOR UPDATE;

  IF COALESCE(fam.power, 0) < cost THEN
    RAISE EXCEPTION 'NOT_ENOUGH_FAMILY_POWER: need %', cost;
  END IF;

  UPDATE public.families SET power = power - cost WHERE id = fam_id;

  UPDATE public.territories
  SET owner_family_id = fam_id,
      owner_family_name = fam.name,
      power_invested = cost,
      claimed_at = now(),
      last_income_at = now()
  WHERE city = p_city;

  PERFORM public._sync_family_territory(fam_id);
  PERFORM public._log_event_named(fam.name, 'territory', 'claimed ' || p_city || '!');

  RETURN jsonb_build_object('success', true, 'city', p_city, 'cost', cost);
END;
$$;

-- ---------- E) declare_war ----------

CREATE OR REPLACE FUNCTION public.declare_war(p_city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t public.territories;
  fam_id uuid;
  my_role text;
  fam public.families;
  def public.families;
  stake bigint := 250;
  w_id uuid;
  war_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT family_id, role INTO fam_id, my_role
  FROM public.family_members WHERE player_id = auth.uid();

  IF fam_id IS NULL THEN RAISE EXCEPTION 'NOT_IN_FAMILY'; END IF;
  IF my_role NOT IN ('boss', 'underboss') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO t FROM public.territories WHERE city = p_city FOR UPDATE;
  IF t.city IS NULL THEN RAISE EXCEPTION 'CITY_NOT_FOUND'; END IF;
  IF t.owner_family_id IS NULL THEN RAISE EXCEPTION 'CITY_UNCLAIMED_USE_CLAIM'; END IF;
  IF t.owner_family_id = fam_id THEN RAISE EXCEPTION 'ALREADY_OWNED'; END IF;

  -- 24h peace shield after a war over this city
  IF t.last_war_ended_at IS NOT NULL AND now() < t.last_war_ended_at + interval '24 hours' THEN
    RAISE EXCEPTION 'CITY_PROTECTED';
  END IF;

  -- one active war per family (either side, either family)
  IF EXISTS (
    SELECT 1 FROM public.family_wars
    WHERE state = 'active'
      AND (attacker_family_id IN (fam_id, t.owner_family_id)
        OR defender_family_id IN (fam_id, t.owner_family_id))
  ) THEN
    RAISE EXCEPTION 'FAMILY_AT_WAR';
  END IF;

  -- lock both families in id order
  PERFORM 1 FROM public.families WHERE id IN (fam_id, t.owner_family_id) ORDER BY id FOR UPDATE;
  SELECT * INTO fam FROM public.families WHERE id = fam_id;
  SELECT * INTO def FROM public.families WHERE id = t.owner_family_id;

  IF COALESCE(fam.power, 0) < stake THEN
    RAISE EXCEPTION 'NOT_ENOUGH_FAMILY_POWER: need %', stake;
  END IF;

  UPDATE public.families SET power = power - stake WHERE id = fam_id;

  war_ends := now() + interval '24 hours';
  INSERT INTO public.family_wars
    (city, attacker_family_id, defender_family_id, attacker_name, defender_name, ends_at)
  VALUES
    (p_city, fam_id, def.id, fam.name, def.name, war_ends)
  RETURNING id INTO w_id;

  PERFORM public._log_event_named(
    fam.name, 'war', 'declared war on ' || def.name || ' over ' || p_city || '!'
  );

  RETURN jsonb_build_object('success', true, 'war_id', w_id, 'ends_at', war_ends, 'stake', stake);
END;
$$;

-- ---------- F) war_attack ----------

CREATE OR REPLACE FUNCTION public.war_attack(p_war_id uuid, p_bullets int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  w public.family_wars;
  me public.players;
  side text;
  cd timestamptz;
  pts bigint;
  resolved jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_bullets IS NULL OR p_bullets < 0 OR p_bullets > 100 THEN
    RAISE EXCEPTION 'INVALID_BULLETS';
  END IF;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'WAR_NOT_FOUND'; END IF;
  IF w.state <> 'active' THEN RAISE EXCEPTION 'WAR_OVER'; END IF;

  IF now() >= w.ends_at THEN
    resolved := public._resolve_war(w.id);
    RETURN jsonb_build_object('war_over', true, 'result', resolved);
  END IF;

  SELECT * INTO me FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF me.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF me.death_until IS NOT NULL AND me.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;
  IF me.jailed_until IS NOT NULL AND me.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;

  IF me.family_id = w.attacker_family_id THEN side := 'attacker';
  ELSIF me.family_id = w.defender_family_id THEN side := 'defender';
  ELSE RAISE EXCEPTION 'NOT_YOUR_WAR';
  END IF;

  -- 60s per-player cooldown for this war
  SELECT last_attack_at INTO cd FROM public.war_contributions
  WHERE war_id = w.id AND player_id = me.id;
  IF cd IS NOT NULL AND now() < cd + interval '60 seconds' THEN
    RAISE EXCEPTION 'ON_COOLDOWN';
  END IF;

  IF p_bullets > 0 THEN
    IF COALESCE(me.bullets, 0) < p_bullets THEN RAISE EXCEPTION 'NOT_ENOUGH_BULLETS'; END IF;
    UPDATE public.players SET bullets = bullets - p_bullets WHERE id = me.id;
  END IF;

  pts := 5 + FLOOR(COALESCE(me.level, 1) / 2.0) + FLOOR(p_bullets / 4.0) + FLOOR(random() * 6);

  IF side = 'attacker' THEN
    UPDATE public.family_wars SET attacker_score = attacker_score + pts WHERE id = w.id;
  ELSE
    UPDATE public.family_wars SET defender_score = defender_score + pts WHERE id = w.id;
  END IF;

  INSERT INTO public.war_contributions (war_id, player_id, family_id, points, attacks, last_attack_at)
  VALUES (w.id, me.id, me.family_id, pts, 1, now())
  ON CONFLICT (war_id, player_id) DO UPDATE
  SET points = war_contributions.points + excluded.points,
      attacks = war_contributions.attacks + 1,
      last_attack_at = now();

  UPDATE public.players
  SET heat = LEAST(100, COALESCE(heat, 0) + 3), heat_updated_at = now()
  WHERE id = me.id;

  SELECT * INTO w FROM public.family_wars WHERE id = p_war_id;

  RETURN jsonb_build_object(
    'success', true,
    'points', pts,
    'side', side,
    'attacker_score', w.attacker_score,
    'defender_score', w.defender_score,
    'next_attack_at', now() + interval '60 seconds'
  );
END;
$$;

-- ---------- G) reads ----------

CREATE OR REPLACE FUNCTION public.get_territories()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();
  PERFORM public._accrue_territory_income();

  RETURN QUERY
  SELECT to_jsonb(t.*) || jsonb_build_object(
    'active_war', (
      SELECT jsonb_build_object(
        'id', fw.id,
        'attacker_name', fw.attacker_name,
        'defender_name', fw.defender_name,
        'attacker_score', fw.attacker_score,
        'defender_score', fw.defender_score,
        'ends_at', fw.ends_at
      )
      FROM public.family_wars fw
      WHERE fw.city = t.city AND fw.state = 'active'
    ),
    'protected_until', CASE
      WHEN t.last_war_ended_at IS NOT NULL
       AND now() < t.last_war_ended_at + interval '24 hours'
      THEN t.last_war_ended_at + interval '24 hours'
    END
  )
  FROM public.territories t
  ORDER BY t.income_per_hour DESC, t.city;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_wars()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_fam uuid;
  active jsonb;
  recent jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM public._resolve_expired_wars();

  SELECT family_id INTO my_fam FROM public.players WHERE id = auth.uid();

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'ends_at')), '[]'::jsonb) INTO active
  FROM (
    SELECT to_jsonb(fw.*) || jsonb_build_object(
      'my_side', CASE
        WHEN my_fam = fw.attacker_family_id THEN 'attacker'
        WHEN my_fam = fw.defender_family_id THEN 'defender'
      END,
      'my_points', (
        SELECT wc.points FROM public.war_contributions wc
        WHERE wc.war_id = fw.id AND wc.player_id = auth.uid()
      ),
      'my_next_attack_at', (
        SELECT wc.last_attack_at + interval '60 seconds'
        FROM public.war_contributions wc
        WHERE wc.war_id = fw.id AND wc.player_id = auth.uid()
      ),
      'top_contributors', (
        SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (
          SELECT p.username, wc.points, wc.family_id
          FROM public.war_contributions wc
          JOIN public.players p ON p.id = wc.player_id
          WHERE wc.war_id = fw.id
          ORDER BY wc.points DESC
          LIMIT 5
        ) c
      )
    ) AS x
    FROM public.family_wars fw
    WHERE fw.state = 'active'
  ) sub;

  SELECT COALESCE(jsonb_agg(to_jsonb(fw.*) ORDER BY fw.resolved_at DESC), '[]'::jsonb) INTO recent
  FROM (
    SELECT * FROM public.family_wars
    WHERE state <> 'active'
    ORDER BY resolved_at DESC
    LIMIT 10
  ) fw;

  RETURN jsonb_build_object('active', active, 'recent', recent, 'my_family_id', my_fam);
END;
$$;

-- ---------- H) grants ----------

REVOKE ALL ON FUNCTION public._sync_family_territory(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._accrue_territory_income() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._resolve_war(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._resolve_expired_wars() FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_territory(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_territory(text) TO authenticated;
REVOKE ALL ON FUNCTION public.declare_war(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.declare_war(text) TO authenticated;
REVOKE ALL ON FUNCTION public.war_attack(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.war_attack(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.get_territories() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_territories() TO authenticated;
REVOKE ALL ON FUNCTION public.get_family_wars() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_family_wars() TO authenticated;

-- Backfill territory counters for all families (all cities are currently
-- unclaimed on prod, so this is a no-op there; safe either way).
UPDATE public.families f
SET territory = (SELECT count(*) FROM public.territories t WHERE t.owner_family_id = f.id);

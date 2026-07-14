-- ============================================================
-- Performance cleanup (no schema/behavior changes):
-- 1) Add covering indexes for foreign keys flagged by the linter
-- 2) Wrap auth.uid() in (select ...) in RLS policies so it's
--    evaluated once per query instead of once per row
-- 3) Drop a redundant duplicate SELECT policy on properties
-- ============================================================

-- 1) Missing FK covering indexes
CREATE INDEX IF NOT EXISTS crime_cooldowns_crime_key_idx ON public.crime_cooldowns (crime_key);
CREATE INDEX IF NOT EXISTS family_members_player_id_idx ON public.family_members (player_id);
CREATE INDEX IF NOT EXISTS family_pending_donations_family_id_idx ON public.family_pending_donations (family_id);
CREATE INDEX IF NOT EXISTS family_pending_donations_player_id_idx ON public.family_pending_donations (player_id);
CREATE INDEX IF NOT EXISTS messages_from_player_id_idx ON public.messages (from_player_id);
CREATE INDEX IF NOT EXISTS messages_to_player_id_idx ON public.messages (to_player_id);
CREATE INDEX IF NOT EXISTS players_family_id_idx ON public.players (family_id);
CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON public.properties (owner_id);

-- 2) RLS initplan fixes
DROP POLICY IF EXISTS "Family members can view their pending donations" ON public.family_pending_donations;
CREATE POLICY "Family members can view their pending donations"
  ON public.family_pending_donations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = (select auth.uid()) AND p.family_id = family_pending_donations.family_id
    )
  );

DROP POLICY IF EXISTS "Players can view their messages" ON public.messages;
CREATE POLICY "Players can view their messages" ON public.messages
  FOR SELECT USING ((select auth.uid()) = to_player_id);

DROP POLICY IF EXISTS "Players can send messages" ON public.messages;
CREATE POLICY "Players can send messages" ON public.messages
  FOR INSERT WITH CHECK ((select auth.uid()) = from_player_id);

DROP POLICY IF EXISTS "Players can update own properties" ON public.properties;
CREATE POLICY "Players can update own properties" ON public.properties
  FOR UPDATE USING ((select auth.uid()) = owner_id);

-- 3) Drop redundant duplicate SELECT policy on properties.
-- "Players can view properties" (023_death_travel_properties.sql) already
-- allows USING (true) for all readers, fully subsuming this one.
DROP POLICY IF EXISTS "Players can view own properties" ON public.properties;

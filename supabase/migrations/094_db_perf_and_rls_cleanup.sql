-- 094_db_perf_and_rls_cleanup.sql
-- ============================================================
-- Performance cleanup (no schema/behavior changes):
-- 1) Add covering indexes for foreign keys flagged by the linter
-- 2) Wrap auth.uid() in (select ...) in RLS policies so it's
--    evaluated once per query instead of once per row
-- 3) Drop a redundant duplicate SELECT policy on properties
-- ============================================================
-- Recovered from a discarded agent worktree (originally 038_...).
-- Idempotent: safe to (re)apply.
-- NOTE: public.family_pending_donations was dropped in 074_family_suite.sql,
-- so no index/policy is created for it here.

-- 1) Missing FK covering indexes
CREATE INDEX IF NOT EXISTS crime_cooldowns_crime_key_idx ON public.crime_cooldowns (crime_key);
CREATE INDEX IF NOT EXISTS family_members_player_id_idx ON public.family_members (player_id);
CREATE INDEX IF NOT EXISTS messages_from_player_id_idx ON public.messages (from_player_id);
CREATE INDEX IF NOT EXISTS messages_to_player_id_idx ON public.messages (to_player_id);
CREATE INDEX IF NOT EXISTS players_family_id_idx ON public.players (family_id);
CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON public.properties (owner_id);

-- 2) RLS initplan fixes
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

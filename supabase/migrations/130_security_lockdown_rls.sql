-- 130_security_lockdown_rls.sql
-- =====================================================================
-- SECURITY HARDENING — remove all client-side WRITE access to tables whose
-- columns are trusted as economy inputs by SECURITY DEFINER RPCs.
--
-- Rationale: every legitimate mutation to these tables already happens inside
-- SECURITY DEFINER functions (which bypass RLS). A static scan of the frontend
-- found ZERO direct writes to any of these tables except messages.read (which
-- is rerouted to an RPC below). Demoting these policies to read-only is therefore
-- non-breaking and closes the direct-write exploit surface.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- #1 CRITICAL — hustler_progress
-- claim_hustler_task() reads reward_money AND the "claimed" set directly from
-- this row. A client PATCH could forge a task with arbitrary reward_money or
-- reset daily_claimed and mint unlimited cash. (Proven live: HTTP 200 write.)
-- Only an ALL policy existed here (no separate SELECT) — replace with SELECT.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "hustler progress own row" ON public.hustler_progress;
CREATE POLICY hustler_progress_select_own ON public.hustler_progress
  FOR SELECT TO authenticated
  USING (username = (SELECT username FROM public.players WHERE id = auth.uid()));

-- ---------------------------------------------------------------------
-- #2 HIGH — player_druglabs
-- collect_druglab()/upgrade_druglab() trust level + last_collected. Direct
-- writes = free max-level labs + infinite harvest + unlimited fake labs.
-- A player_druglabs_select_own policy already exists; just drop the ALL policy.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS player_druglabs_modify_own ON public.player_druglabs;

-- ---------------------------------------------------------------------
-- #3 HIGH — player_bitches
-- claim_bitch_earnings() pays from last_claimed/loyalty. Direct writes/inserts
-- = infinite dirty-cash income. A _select_own policy already exists.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS player_bitches_modify_own ON public.player_bitches;

-- ---------------------------------------------------------------------
-- #4 HIGH — player_stats
-- daily_* counters gate daily limits; totals feed leaderboards. Direct writes
-- = limit bypass + fake stats. Public "stats readable by everyone" SELECT stays.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "players manage own stats" ON public.player_stats;

-- ---------------------------------------------------------------------
-- #5 MEDIUM — properties
-- Legacy writable money columns (income_per_hour, bank_balance, level). Live
-- economy uses players.owned_properties JSONB + property_banks (both RPC-only).
-- "Players can view properties" SELECT stays.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Players can update own properties" ON public.properties;

-- ---------------------------------------------------------------------
-- #6 MEDIUM — drug_market_listings
-- Listing creation/editing must go through list_drugs_for_sale(), which
-- validates the seller actually owns the stock. The client INSERT/UPDATE
-- policies let a seller list drugs they never had. Public SELECT stays.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS drug_market_listings_insert_own ON public.drug_market_listings;
DROP POLICY IF EXISTS drug_market_listings_update_own ON public.drug_market_listings;

-- ---------------------------------------------------------------------
-- #7 LOW — messages
-- The old UPDATE policy let a recipient rewrite ANY column of received messages
-- (RLS cannot scope columns). Replace with a narrow SECURITY DEFINER RPC that
-- only ever flips read=true on the caller's own inbound messages.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Players can mark their messages read" ON public.messages;

CREATE OR REPLACE FUNCTION public.mark_messages_read(
  p_from uuid DEFAULT NULL,
  p_system boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.messages
     SET read = true
   WHERE to_player_id = auth.uid()
     AND read = false
     AND (
          (p_system AND from_player_id IS NULL)
       OR (NOT p_system AND p_from IS NOT NULL AND from_player_id = p_from)
         );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', n);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_read(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid, boolean) TO authenticated;

COMMIT;

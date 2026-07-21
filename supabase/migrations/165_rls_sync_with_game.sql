-- 165_rls_sync_with_game.sql
-- Sync Row Level Security policies with actual game access patterns.
-- Tables are accessed either through SECURITY DEFINER RPC functions
-- or direct client queries; policies block unauthorized direct access.

BEGIN;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if the logged-in player is an admin/leader/staff of the given family
CREATE OR REPLACE FUNCTION public.is_family_admin(p_family_id uuid, p_player_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT role IN ('boss', 'underboss', 'captain', 'lieutenant', 'soldier')
     FROM public.family_members
     WHERE family_id = p_family_id AND player_id = p_player_id),
    false
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_family_admin(uuid, uuid) TO authenticated;

-- ============================================
-- CATALOG / LOOKUP TABLES (public read)
-- ============================================

-- armory_catalog: weapons/vests catalog, readable by everyone
CREATE POLICY "armory_catalog_select_public"
  ON public.armory_catalog FOR SELECT
  TO public
  USING (true);

-- car_catalog: available cars, readable by everyone
CREATE POLICY "car_catalog_select_public"
  ON public.car_catalog FOR SELECT
  TO public
  USING (true);

-- city_distances: travel distances, readable by everyone
CREATE POLICY "city_distances_select_public"
  ON public.city_distances FOR SELECT
  TO public
  USING (true);

-- city_fuel_prices: fuel prices per city, readable by everyone
CREATE POLICY "city_fuel_prices_select_public"
  ON public.city_fuel_prices FOR SELECT
  TO public
  USING (true);

-- forum_categories: public forum categories
CREATE POLICY "forum_categories_select_public"
  ON public.forum_categories FOR SELECT
  TO public
  USING (true);

-- property_catalog: properties for sale, readable by everyone
CREATE POLICY "property_catalog_select_public"
  ON public.property_catalog FOR SELECT
  TO public
  USING (true);

-- ============================================
-- GAME STATE TABLES (authenticated read)
-- ============================================

-- casino_pools: live jackpot pools, readable by logged-in players
CREATE POLICY "casino_pools_select_authenticated"
  ON public.casino_pools FOR SELECT
  TO authenticated
  USING (true);

-- stocks: stock market data, readable by logged-in players
CREATE POLICY "stocks_select_authenticated"
  ON public.stocks FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- PLAYER-SPECIFIC TABLES (own rows only)
-- ============================================

-- daily_tasks: each player's daily task progress
CREATE POLICY "daily_tasks_select_own"
  ON public.daily_tasks FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- casino_hands: active casino hands for the logged-in player
CREATE POLICY "casino_hands_select_own"
  ON public.casino_hands FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

CREATE POLICY "casino_hands_insert_own"
  ON public.casino_hands FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

CREATE POLICY "casino_hands_update_own"
  ON public.casino_hands FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- launder_history: player's own laundering records
CREATE POLICY "launder_history_select_own"
  ON public.launder_history FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- rip_cooldowns: player's own rip/attack cooldowns
CREATE POLICY "rip_cooldowns_select_own"
  ON public.rip_cooldowns FOR SELECT
  TO authenticated
  USING (attacker_id = auth.uid() OR target_id = auth.uid());

-- tickets: player's own support tickets + staff can see all
CREATE POLICY "tickets_select_own_or_staff"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "tickets_insert_own"
  ON public.tickets FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

CREATE POLICY "tickets_update_own_or_staff"
  ON public.tickets FOR UPDATE
  TO authenticated
  USING (
    player_id = auth.uid()
    OR is_admin()
  )
  WITH CHECK (
    player_id = auth.uid()
    OR is_admin()
  );

-- ticket_replies: replies on tickets player owns + staff
CREATE POLICY "ticket_replies_select_own_or_staff"
  ON public.ticket_replies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_replies.ticket_id
        AND (t.player_id = auth.uid() OR is_admin())
    )
    OR author_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "ticket_replies_insert_own_or_staff"
  ON public.ticket_replies FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_replies.ticket_id
        AND (t.player_id = auth.uid() OR is_admin())
    )
  );

-- ============================================
-- AUCTION SYSTEM
-- ============================================

-- auctions: everyone can see live auctions, seller can manage own
CREATE POLICY "auctions_select_public"
  ON public.auctions FOR SELECT
  TO public
  USING (true);

CREATE POLICY "auctions_insert_own"
  ON public.auctions FOR INSERT
  TO authenticated
  WITH CHECK (seller_id = auth.uid());

CREATE POLICY "auctions_update_own"
  ON public.auctions FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid() OR is_admin())
  WITH CHECK (seller_id = auth.uid() OR is_admin());

-- auction_bids: everyone can see bids on an auction, bidder can place own
CREATE POLICY "auction_bids_select_public"
  ON public.auction_bids FOR SELECT
  TO public
  USING (true);

CREATE POLICY "auction_bids_insert_own"
  ON public.auction_bids FOR INSERT
  TO authenticated
  WITH CHECK (bidder_id = auth.uid());

-- ============================================
-- FAMILY SYSTEM
-- ============================================

-- family_bounties: readable by authenticated players
CREATE POLICY "family_bounties_select_authenticated"
  ON public.family_bounties FOR SELECT
  TO authenticated
  USING (true);

-- family_join_requests: player can see own, family admin can see family requests
CREATE POLICY "family_join_requests_select_own_or_family_admin"
  ON public.family_join_requests FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid()
    OR is_family_admin(family_id, auth.uid())
    OR is_admin()
  );

CREATE POLICY "family_join_requests_insert_own"
  ON public.family_join_requests FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

CREATE POLICY "family_join_requests_update_family_admin"
  ON public.family_join_requests FOR UPDATE
  TO authenticated
  USING (
    is_family_admin(family_id, auth.uid())
    OR is_admin()
  )
  WITH CHECK (
    is_family_admin(family_id, auth.uid())
    OR is_admin()
  );

-- family_messages: readable by family members
CREATE POLICY "family_messages_select_family_member"
  ON public.family_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = family_messages.family_id
        AND fm.player_id = auth.uid()
    )
    OR is_admin()
  );

-- ============================================
-- WAR CONTRIBUTIONS
-- ============================================

-- war_contributions: readable by authenticated players
CREATE POLICY "war_contributions_select_authenticated"
  ON public.war_contributions FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- GLOBAL STATE (admin-managed)
-- ============================================

-- bullet_factory: global bullet production, readable by all, admin write
CREATE POLICY "bullet_factory_select_public"
  ON public.bullet_factory FOR SELECT
  TO public
  USING (true);

CREATE POLICY "bullet_factory_admin_write"
  ON public.bullet_factory FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- gov_tax_bank: treasury, readable by authenticated, admin write
CREATE POLICY "gov_tax_bank_select_authenticated"
  ON public.gov_tax_bank FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "gov_tax_bank_admin_write"
  ON public.gov_tax_bank FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================
-- ADMIN LOGS
-- ============================================

-- admin_logs: readable/writable by admins only
CREATE POLICY "admin_logs_admin_only"
  ON public.admin_logs FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

COMMIT;

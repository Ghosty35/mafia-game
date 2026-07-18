-- 116_drug_marketplace.sql
-- P2P drug marketplace: lab owners and players can list drugs for sale.
-- Buyers purchase listings; money goes to seller's personal_bank, drugs
-- transfer to buyer's drug_storage.

CREATE TABLE IF NOT EXISTS public.drug_market_listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  lab_id         uuid REFERENCES public.player_druglabs(id) ON DELETE SET NULL,
  drug_type      text NOT NULL CHECK (drug_type IN ('Coke','Meth','Pills','Weed')),
  qty            int NOT NULL CHECK (qty > 0),
  price_per_kg   bigint NOT NULL CHECK (price_per_kg > 0),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  sold_at        timestamptz
);

CREATE INDEX IF NOT EXISTS drug_market_listings_seller_idx ON public.drug_market_listings(seller_id);
CREATE INDEX IF NOT EXISTS drug_market_listings_status_idx ON public.drug_market_listings(status, created_at);
ALTER TABLE public.drug_market_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drug_market_listings_select ON public.drug_market_listings;
CREATE POLICY drug_market_listings_select ON public.drug_market_listings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drug_market_listings_insert_own ON public.drug_market_listings;
CREATE POLICY drug_market_listings_insert_own ON public.drug_market_listings
  FOR INSERT WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS drug_market_listings_update_own ON public.drug_market_listings;
CREATE POLICY drug_market_listings_update_own ON public.drug_market_listings
  FOR UPDATE USING (seller_id = auth.uid());

-- ---------- list drugs for sale ----------
CREATE OR REPLACE FUNCTION public.list_drugs_for_sale(
  p_lab_id uuid,
  p_drug_type text,
  p_qty int,
  p_price_per_kg bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  lab public.player_druglabs;
  have int;
  lid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_qty < 1 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF p_price_per_kg < 1 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  IF p_lab_id IS NOT NULL THEN
    SELECT * INTO lab FROM public.player_druglabs WHERE id = p_lab_id AND player_id = p.id FOR UPDATE;
    IF lab.id IS NULL THEN RAISE EXCEPTION 'LAB_NOT_FOUND'; END IF;
  END IF;

  have := COALESCE((p.drug_storage->>p_drug_type)::int, 0);
  IF have < p_qty THEN RAISE EXCEPTION 'NOT_ENOUGH_STOCK'; END IF;

  INSERT INTO public.drug_market_listings (seller_id, lab_id, drug_type, qty, price_per_kg)
  VALUES (p.id, p_lab_id, p_drug_type, p_qty, p_price_per_kg) RETURNING id INTO lid;

  RETURN jsonb_build_object('success', true, 'listing_id', lid, 'drug_type', p_drug_type, 'qty', p_qty, 'price_per_kg', p_price_per_kg);
END;
$$;

-- ---------- buy from a listing ----------
CREATE OR REPLACE FUNCTION public.buy_drugs_from_listing(p_listing_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  buyer public.players;
  listing public.drug_market_listings;
  seller public.players;
  cost bigint;
  buyer_have int;
  buyer_cap int;
  buyer_storage jsonb;
  seller_bank bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO buyer FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF buyer.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF buyer.jailed_until IS NOT NULL AND buyer.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF buyer.death_until IS NOT NULL AND buyer.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO listing FROM public.drug_market_listings WHERE id = p_listing_id AND status = 'active' FOR UPDATE;
  IF listing.id IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;

  IF listing.seller_id = buyer.id THEN RAISE EXCEPTION 'CANNOT_BUY_OWN'; END IF;

  SELECT * INTO seller FROM public.players WHERE id = listing.seller_id FOR UPDATE;
  IF seller.id IS NULL THEN RAISE EXCEPTION 'SELLER_NOT_FOUND'; END IF;

  cost := listing.price_per_kg * listing.qty;
  IF buyer.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  buyer_have := COALESCE((buyer.drug_storage->>listing.drug_type)::int, 0);
  buyer_cap := public._drug_cap(listing.drug_type);
  IF buyer_have + listing.qty > buyer_cap THEN RAISE EXCEPTION 'CAP_REACHED'; END IF;

  buyer_storage := jsonb_set(
    COALESCE(buyer.drug_storage, '{}'::jsonb),
    ARRAY[listing.drug_type],
    to_jsonb(buyer_have + listing.qty)
  );

  seller_bank := COALESCE(seller.personal_bank, 0) + cost;

  UPDATE public.players
  SET cash = cash - cost,
      drug_storage = buyer_storage
  WHERE id = buyer.id;

  UPDATE public.players
  SET personal_bank = seller_bank
  WHERE id = seller.id;

  UPDATE public.drug_market_listings
  SET status = 'sold', sold_at = now()
  WHERE id = listing.id;

  RETURN jsonb_build_object('success', true, 'listing_id', listing.id, 'drug', listing.drug_type, 'qty', listing.qty, 'total', cost);
END;
$$;

-- ---------- cancel own listing ----------
CREATE OR REPLACE FUNCTION public.cancel_drug_listing(p_listing_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.players;
  listing public.drug_market_listings;
  have int;
  new_storage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;
  IF p.jailed_until IS NOT NULL AND p.jailed_until > now() THEN RAISE EXCEPTION 'IN_JAIL'; END IF;
  IF p.death_until IS NOT NULL AND p.death_until > now() THEN RAISE EXCEPTION 'DEAD'; END IF;

  SELECT * INTO listing FROM public.drug_market_listings WHERE id = p_listing_id AND seller_id = p.id AND status = 'active' FOR UPDATE;
  IF listing.id IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;

  have := COALESCE((p.drug_storage->>listing.drug_type)::int, 0);
  new_storage := jsonb_set(COALESCE(p.drug_storage, '{}'::jsonb), ARRAY[listing.drug_type], to_jsonb(have + listing.qty));

  UPDATE public.players SET drug_storage = new_storage WHERE id = p.id;
  UPDATE public.drug_market_listings SET status = 'cancelled' WHERE id = listing.id;

  RETURN jsonb_build_object('success', true, 'listing_id', listing.id, 'drug', listing.drug_type, 'qty', listing.qty);
END;
$$;

-- ---------- read: active listings ----------
CREATE OR REPLACE FUNCTION public.get_drug_market_listings(p_drug_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  listings jsonb;
  me uuid := auth.uid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', dl.id, 'seller_id', dl.seller_id, 'lab_id', dl.lab_id,
      'drug_type', dl.drug_type, 'qty', dl.qty, 'price_per_kg', dl.price_per_kg,
      'total', dl.price_per_kg * dl.qty,
      'status', dl.status, 'created_at', dl.created_at,
      'is_mine', dl.seller_id = me
    ) ORDER BY dl.created_at DESC
  ), '[]'::jsonb) INTO listings
  FROM public.drug_market_listings dl
  WHERE dl.status = 'active'
    AND (p_drug_type IS NULL OR dl.drug_type = p_drug_type);

  RETURN listings;
END;
$$;

-- ---------- grants ----------
REVOKE ALL ON FUNCTION public.list_drugs_for_sale(uuid, text, int, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_drugs_for_sale(uuid, text, int, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.buy_drugs_from_listing(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_drugs_from_listing(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_drug_listing(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_drug_listing(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_drug_market_listings(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_drug_market_listings(text) TO authenticated;

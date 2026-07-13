-- 028: Garage, Racing, Properties rescaling, Billing, Live trackers, Money rank, Transaction log, Rent system, Images prep

-- Player fields
ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS owned_properties jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS cars jsonb DEFAULT '[]'::jsonb,  -- array of {id, name, condition, value, tuned, type}
ADD COLUMN IF NOT EXISTS garage_level int DEFAULT 0,  -- 0 none, 1 house (2 spots? wait cars), for warehouse
ADD COLUMN IF NOT EXISTS drug_storage jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS weed_plants jsonb DEFAULT '[]'::jsonb,  -- array of {id, progress, watered_count, last_water}
ADD COLUMN IF NOT EXISTS murder_cooldown timestamptz,
ADD COLUMN IF NOT EXISTS total_wealth bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS money_rank text DEFAULT 'Hobo',
ADD COLUMN IF NOT EXISTS transaction_log jsonb DEFAULT '[]'::jsonb,  -- last 10
ADD COLUMN IF NOT EXISTS autopay_bills boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bill_history jsonb DEFAULT '[]'::jsonb;

-- Properties table for ownership and details
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.players(id),
  type text NOT NULL,  -- house, villa, mansion, train_station, etc.
  city text NOT NULL,
  name text NOT NULL,
  purchase_date timestamptz DEFAULT now(),
  bank_balance bigint DEFAULT 0,
  maintenance_due bigint DEFAULT 0,
  income_per_hour bigint DEFAULT 0,
  spots int DEFAULT 0,  -- for weed or cars
  level int DEFAULT 1,  -- for upgrades like warehouse
  last_bill_paid timestamptz,
  details jsonb DEFAULT '{}'::jsonb  -- for images, funny text, etc.
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Policies for properties
DROP POLICY IF EXISTS "Players can view own properties" ON public.properties;
CREATE POLICY "Players can view own properties" ON public.properties
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Players can update own properties" ON public.properties;
CREATE POLICY "Players can update own properties" ON public.properties
  FOR UPDATE USING (auth.uid() = owner_id);

-- Add missing columns if table exists from previous migrations (e.g. 023)
ALTER TABLE public.properties 
  ADD COLUMN IF NOT EXISTS purchase_date timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS bank_balance bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maintenance_due bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spots int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_bill_paid timestamptz,
  ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}'::jsonb;

-- Add unique constraint safely for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'properties_type_city_key' 
      AND conrelid = 'public.properties'::regclass
  ) THEN
    ALTER TABLE public.properties 
    ADD CONSTRAINT properties_type_city_key UNIQUE (type, city);
  END IF;
END $$;

-- Example initial properties (agencies dev owned, residential buyable)
-- Use ON CONFLICT to avoid dups. Names may differ slightly from migration 023.
INSERT INTO public.properties (type, city, name, income_per_hour, spots, level) VALUES
('train_station', 'New York', 'Grand Central', 50, 0, 1),
('metal_factory', 'Chicago', 'Midwest Munitions', 120, 0, 1),
('detective_agency', 'Los Angeles', 'Shadow Investigations', 80, 0, 1),
('hospital', 'Miami', 'South Beach Medical', 90, 0, 1),
('general_bank', 'Las Vegas', 'Desert Vault', 200, 0, 1),
('house', 'New York', 'Cozy Hideout', 20, 2, 1),
('villa', 'Chicago', 'Luxury Villa', 60, 4, 1),
('mansion', 'Las Vegas', 'Kingpin Estate', 150, 8, 1)
ON CONFLICT (type, city) DO UPDATE SET 
  name = EXCLUDED.name,
  income_per_hour = EXCLUDED.income_per_hour,
  spots = EXCLUDED.spots,
  level = EXCLUDED.level;

-- Function to calculate money rank
CREATE OR REPLACE FUNCTION public.get_money_rank(wealth bigint)
RETURNS text AS $$
BEGIN
  IF wealth < 1000 THEN RETURN 'Hobo';
  ELSIF wealth < 10000 THEN RETURN 'Street Rat';
  ELSIF wealth < 50000 THEN RETURN 'Small Time Hustler';
  ELSIF wealth < 200000 THEN RETURN 'Gangster';
  ELSIF wealth < 1000000 THEN RETURN 'Made Man';
  ELSE RETURN 'Kingpin';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- RPC for buying property (residential only)
CREATE OR REPLACE FUNCTION public.buy_property(property_type text, city text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  prop record;
  cost bigint;
  new_owned jsonb;
BEGIN
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'NO_PLAYER'; END IF;

  -- Find property
  SELECT * INTO prop FROM public.properties 
  WHERE type = property_type AND city = city AND owner_id IS NULL 
  LIMIT 1;

  IF prop.id IS NULL THEN RAISE EXCEPTION 'PROPERTY_NOT_AVAILABLE'; END IF;

  cost := prop.income_per_hour * 1000;  -- example, adjust

  IF p.cash < cost THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;

  p.cash := p.cash - cost;

  -- Add to owned
  new_owned := COALESCE(p.owned_properties, '[]'::jsonb) || jsonb_build_object(
    'id', prop.id,
    'name', prop.name,
    'type', prop.type,
    'city', prop.city,
    'purchase_date', now(),
    'bank_balance', 0,
    'maintenance_due', prop.income_per_hour * 0.12,
    'autopay', false,
    'spots', prop.spots,
    'level', 1
  );

  UPDATE public.players SET 
    cash = p.cash,
    owned_properties = new_owned
  WHERE id = p.id;

  UPDATE public.properties SET owner_id = p.id WHERE id = prop.id;

  RETURN jsonb_build_object('success', true, 'player', to_jsonb(p));
END;
$$;

-- RPC for paying bill (advanced)
CREATE OR REPLACE FUNCTION public.pay_bill(property_id uuid, amount bigint, method text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.players;
  prop record;
  paid bigint;
BEGIN
  SELECT * INTO p FROM public.players WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO prop FROM public.properties WHERE id = property_id AND owner_id = p.id;

  IF prop.id IS NULL THEN RAISE EXCEPTION 'NO_PROPERTY'; END IF;

  IF method = 'cash' THEN
    IF p.cash < amount THEN RAISE EXCEPTION 'NOT_ENOUGH_CASH'; END IF;
    p.cash := p.cash - amount;
  ELSE
    IF p.personal_bank < amount * 1.05 THEN RAISE EXCEPTION 'NOT_ENOUGH_BANK'; END IF;
    p.personal_bank := p.personal_bank - (amount * 1.05);
  END IF;

  prop.bank_balance := prop.bank_balance + amount;
  prop.maintenance_due := GREATEST(0, prop.maintenance_due - amount);

  UPDATE public.players SET cash = p.cash, personal_bank = p.personal_bank, owned_properties = (
    SELECT jsonb_agg(
      CASE WHEN (value->>'id')::uuid = property_id THEN 
        jsonb_set(value, '{bank_balance}', to_jsonb(prop.bank_balance)) || jsonb_set(value, '{maintenance_due}', to_jsonb(prop.maintenance_due))
      ELSE value END
    ) FROM jsonb_array_elements(p.owned_properties)
  ) WHERE id = p.id;

  UPDATE public.properties SET bank_balance = prop.bank_balance, maintenance_due = prop.maintenance_due WHERE id = property_id;

  RETURN jsonb_build_object('success', true, 'player', to_jsonb(p));
END;
$$;

-- Function for weekly rent/invoice (to be called by cron or manually)
CREATE OR REPLACE FUNCTION public.generate_weekly_bills()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  p record;
  prop jsonb;
  total_bill bigint;
  tax bigint;
BEGIN
  FOR p IN SELECT * FROM public.players LOOP
    total_bill := 0;
    FOR prop IN SELECT * FROM jsonb_array_elements(p.owned_properties) LOOP
      total_bill := total_bill + (prop->>'maintenance_due')::bigint;
    END LOOP;
    tax := total_bill * 0.05;  -- example tax
    -- Add to bill_history
    UPDATE public.players SET 
      bill_history = COALESCE(bill_history, '[]'::jsonb) || jsonb_build_object(
        'date', now(),
        'total', total_bill + tax,
        'tax', tax,
        'details', p.owned_properties
      ),
      autopay_bills = COALESCE(autopay_bills, false)
    WHERE id = p.id;

    -- If autopay, deduct
    IF p.autopay_bills THEN
      -- deduct logic
    END IF;
  END LOOP;
END;
$$;
-- Add fields for weed, properties, billing, money rank

ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS owned_properties jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS money_rank text DEFAULT 'Hobo',
ADD COLUMN IF NOT EXISTS total_wealth bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS autopay_bills boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bill_due_date timestamptz;

-- Update get_my_player or add function if needed, but assume select * works

-- Function to calculate money rank based on wealth
CREATE OR REPLACE FUNCTION public.calculate_money_rank(wealth bigint)
RETURNS text
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN wealth < 1000 THEN 'Hobo'
    WHEN wealth < 10000 THEN 'Street Rat'
    WHEN wealth < 50000 THEN 'Small Time Hustler'
    WHEN wealth < 200000 THEN 'Gangster'
    WHEN wealth < 1000000 THEN 'Made Man'
    ELSE 'Kingpin'
  END;
$$;
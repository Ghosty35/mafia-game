-- ============================================================
-- 038: Fix get_casino_pools crashing at runtime
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
--
-- Bug: 034 / FIX_034_typo declared get_casino_pools() as STABLE,
-- but the function INSERTs the seed row. Postgres refuses writes
-- inside non-volatile functions ("INSERT is not allowed in a
-- non-volatile function", SQLSTATE 0A000), so every call fails and
-- the casino page silently falls back to fake demo pool numbers.
--
-- Fix: recreate the function as VOLATILE (the default).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_casino_pools()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.casino_pools (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  RETURN (SELECT to_jsonb(p.*) FROM public.casino_pools p WHERE id = 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_casino_pools() TO authenticated;

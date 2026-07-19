-- ============================================================
-- 087_fix_drop_vulnerable_buffs.sql
-- ============================================================
-- Drops the old vulnerable overloads of buy_family_buff_* that
-- accepted a caller-supplied power_gain. The safe versions (cash
-- derives power from cost_cash, diamonds derives from cost_diamonds
-- + bundle flag) are kept.
-- ============================================================

DROP FUNCTION IF EXISTS public.buy_family_buff_cash(bigint, integer);
DROP FUNCTION IF EXISTS public.buy_family_buff_diamonds(bigint, integer);

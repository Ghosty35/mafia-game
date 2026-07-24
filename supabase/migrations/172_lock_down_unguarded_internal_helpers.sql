-- CRITICAL FIX: _prop_bank_credit(prop_id, amount) had zero auth/ownership check and was
-- directly EXECUTE-granted to `authenticated`, callable via /rest/v1/rpc/_prop_bank_credit.
-- Exploit: call _prop_bank_credit('<own_property_id>', 999999999999) directly, then
-- withdraw_property_bank() (which only checks real ownership -> attacker legitimately owns it)
-- pays out unlimited real cash. Only legitimate caller is claim_bitch_earnings() (internal PERFORM).
-- Revoking from authenticated/public does NOT break internal PERFORM calls from other
-- SECURITY DEFINER functions (those execute under the function-owner role).
REVOKE EXECUTE ON FUNCTION public._prop_bank_credit(text, bigint) FROM PUBLIC, authenticated;

-- _prop_bank_sync(prop_id) is self-computing (derives owner_id from real ownership data) so it
-- isn't directly exploitable, but it's an internal helper with no reason to be client-callable.
REVOKE EXECUTE ON FUNCTION public._prop_bank_sync(text) FROM PUBLIC, authenticated;

-- _append_family_txn / _append_txn had zero auth check and let ANY authenticated user forge
-- arbitrary fake transaction-log entries (icon/desc/amount/player name) into ANY family's or
-- ANY player's transaction history. Doesn't move real money but is a real forgery/deception
-- vector (fake "donations", fake evidence). Internal-only, called via PERFORM from donate_to_family,
-- buy_family_power, deposit/withdraw_property_bank, bank ops, etc.
REVOKE EXECUTE ON FUNCTION public._append_family_txn(uuid, text, text, bigint, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public._append_txn(uuid, text, text, bigint, bigint) FROM PUBLIC, authenticated;

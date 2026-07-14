# Supabase Database — A Hustler's Way

All schema changes are plain SQL scripts, applied by hand in:
**Supabase Dashboard → SQL Editor → New query**.

There is no automatic migration runner: the numbered order below IS the
contract. Never edit an already-applied script — add a new numbered one.

## Apply order

Run the numbered files in `migrations/` in ascending order. The FIX_ scripts
are hotfixes that belong at a specific point in the chain:

| Order | Script | Note |
|---|---|---|
| 001–033 | `001_players.sql` … `033_no_xp_on_fail.sql` | in numeric order |
| 034 | `034_stock_market_casino_economy_admin.sql` | |
| 034a | `FIX_034_typo.sql` | hotfix for 034 |
| 034b | `FIX_034_stocks_table.sql` | hotfix for 034 |
| 034c | `FIX_create_family.sql` | hotfix (family creation) |
| 034d | `FIX_bank_persistence.sql` | hotfix (bank persistence) |
| 035 | `035_admin_tools_and_persistence.sql` | SECURITY DEFINER RPC layer |
| 036 | `036_idle_income_events_races_territory.sql` | |
| 037 | `037_language_preference.sql` | **NEW — not yet applied. Run this one!** |

## Ground rules (enforced by 001 + 035)

- `players` has RLS with **no insert/update/delete policies**: the browser can
  never write stats directly. Every mutation goes through a
  `security definer` RPC (`apply_action`, `update_my_state`, `commit_crime`,
  `piggy_*`, `purchase_property`, `set_my_language`, …).
- Reads of OTHER players' rows also go through RPCs
  (`get_public_profile`, `get_leaderboard`, `admin_list_players`).
- `get_my_player()` returns the full `players` row type, so a new column
  added with `alter table` is automatically available client-side.

## Current status

The live project already has 001 through 036 (+ all FIX scripts) applied.
Only `037_language_preference.sql` is new: it adds `players.language`
('en'/'nl') and the `set_my_language(p_language)` RPC used by the in-game
language switcher.

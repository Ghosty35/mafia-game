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

## Current status (live-DB audit, 2026-07-15)

An API probe of the live project found that **8 scripts were never
(fully) applied** — the SQL Editor runs each script as one transaction,
so a single error rolls the whole script back. As a result 31 RPCs,
8 tables and 7 player columns the frontend depends on are missing live.

### 🔧 Repair: run ONLY these, in this order

```
015 → 016 → 018 → 020 → 021 → 025 → 035 → 036 → 037
```

| Script | Restores |
|---|---|
| `015_pending_donations_and_bank.sql` | family donations / pending bank |
| `016_heat_jail_heists.sql` | heists table + jail breakout |
| `018_health_protection_hospital.sql` | buy_protection |
| `020_commit_heist.sql` | commit_heist |
| `021_heist_pvp_balance.sql` | attempt_hit, buy_power |
| `025_health_deduction_pvp_heist.sql` | PvP/heist health loss |
| `035_admin_tools_and_persistence.sql` | apply_action, update_my_state, travel, property, bullets, all admin_* (25 fns) |
| `036_idle_income_events_races_territory.sql` | races, territories, game_events |
| `037_language_preference.sql` | players.language + set_my_language |

All eight are rerun-safe: every `CREATE TABLE` / `ADD COLUMN` uses
`IF NOT EXISTS` and every seed insert is `ON CONFLICT`-guarded. If a
script errors, stop and report the message instead of continuing.

(The full 001→037 order above remains the contract for a fresh database.)

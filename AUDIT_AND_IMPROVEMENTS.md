# Mafia Game — Work Summary, Security/Accuracy Audit & Improvement Plan

> Generated: 2026-07-17 · Branch `hustler-overhaul` (synced to `origin/master` @ `67a51c0`)
> Scope: exploit-free, glitch-free, UI-shows-accurate-server-values, universal buy/sell caps.

---

## 1. What was done so far (this session)

### 1.1 Push/merge recovery (the original blocker)
- The earlier `git push` was failing with `fatal: The upstream branch of your current branch does not match` — local branch `hustler-overhaul` had upstream `origin/master`, which `git`'s `simple` policy refuses.
- A second attempt was rejected non-fast-forward because `origin/master` had 3 PR-merge commits (`7045fc4`, `1cb912e`, `4616812`) absent locally (same work, merged via PRs).
- **Fix:** merged `origin/master` into local, then pushed `HEAD:master`. Verified local `HEAD` == `origin/master`.
- A later unpushed commit `447b45e` was resolved the same way (origin had gained PR #5); fast-forward brought local to `67a51c0`, fully in sync. `npx tsc --noEmit` passes clean.

### 1.2 Family-buff exploit fix (migration 086) — DONE & MIGRATED
- **Problem:** `buy_family_buff_cash(cost_cash, power_gain)` / `buy_family_buff_diamonds(cost_diamonds, power_gain)` accepted a **caller-supplied `power_gain`** and only bound-checked it. A malicious client could request the maximum allowed power and receive ~2× intended family power for the same price.
- **Fix (migration 086, applied to Supabase):** dropped the `power_gain` param entirely; power is now **derived server-side**:
  - cash: `power = GREATEST(5, FLOOR(cost_cash / 8000))`
  - diamonds: `power = FLOOR(cost_diamonds * 1.8)`
  - diamonds bundle (donator): `power = FLOOR(cost_diamonds * 4.0)`
- **Client aligned:** `app/shop/vip/page.tsx` no longer computes `powerGain`; it reads `data.power_gain` from the RPC response. `447b45e` fixed a leftover `powerGain` reference in the cash branch.

### 1.3 Real-estate caps + murder weapon bonuses — DONE
- `purchase_property` (055) enforces server-side total cap (4) and per-type caps (mansion 1, villa 2, house 4), duplicate-catalog guard, city match.
- Real-estate buy buttons disabled at caps; murder weapon bonuses synced to server.

### 1.4 Server-authoritative refresh sweep — DONE
- Added `refreshPlayer()` + `router.refresh()` after actions across `murder`, `heists`, `race`, `gym`/`GymBoard`, `shop`, `travel`, `stocks`, `casino`, `crimes/[key]`. Replaced `alert()` with toasts. Removed simulated/fake surfaces (made it all live).

---

## 2. Current security posture (from RPC audit)

### SAFE (server-authoritative, capped, locked)
| RPC | Why safe |
|-----|----------|
| `purchase_property` (055) | Total cap 4, per-type caps, dup guard, city match, price from catalog |
| `garage_buy_car` (059) | `max_cars` derived from property tier + garage lvl, `GARAGE_FULL` guard |
| `buy_drug` / `sell_drug` (045) | Per-drug storage cap via `_drug_cap`, server prices, sell validates owned |
| `buy_weapon` (060) | Only 3 weapon IDs exist → implicitly capped at 3, `ALREADY_OWNED` |
| `buy_heist_gear` (058) | Single active tier (JSON overwrite), no stacking |
| `upgrade_shed` (035) | Capped at lvl 3, cost derived `50000 * lvl` |
| `harvest_weed` / `water_weed_plant` (046) | Weed cap 1000, progress cap 5, 1h cooldown |
| `buy_stock` / `sell_stock` (034/042) | `FOR UPDATE`, affords/owns check, no caller price |
| `buy_power` (044) | Cost derived from `CASE power_amount` (fixed 021 exploit) |
| `buy_family_buff_*` (086) | Power derived server-side (fixed 041 exploit) |
| `play_casino` (034/043) | Bet 100–500000, `FOR UPDATE`, `NOT_ENOUGH_CASH` |
| `commit_heist` (020/066) | Reward/cost server-computed, `FOR UPDATE`, validated inputs |
| `launder_cash` (066) | `FOR UPDATE`, min 100, dirty-cash check, 24h cap |
| `deposit/withdraw_personal_bank` (022) | `FOR UPDATE`, balance validated, `amount <= 0` rejected |
| `piggy_deposit/withdraw` (035) | `FOR UPDATE`, balance validated, server fee |
| `enter_weekly_lottery` (044) | 7-day cooldown, server ticket cost 5000 |
| `commit_crime` / `attempt_murder` / `travel_to_city` / `gym_train` / `rebirth` | Server-authoritative, validated |

### NEEDS FIX (race conditions / missing caps)
| # | RPC | File | Issue | Fix |
|---|-----|------|-------|-----|
| ⚠️1 | `buy_family_power` | 029 | Family bank read **without `FOR UPDATE`** → concurrent donations can drive family bank negative | Add `FOR UPDATE` to family SELECT, or `UPDATE ... SET bank = bank - spend WHERE id = ? AND bank >= spend` |
| ⚠️2 | `donate_to_family` | 014/015 | Player cash read **without `FOR UPDATE`** → concurrent donations can drive player cash negative | `FOR UPDATE` on player, or atomic `UPDATE players SET cash = cash - amt WHERE id = ? AND cash >= amt` |
| ⚠️3 | `buy_bullets` | 070 | **No cap on total bullets owned**; repeated <5000 buys accumulate unbounded | Add `IF COALESCE(p.bullets,0) + bought > <MAX_BULLETS> THEN RAISE 'BULLET_CAP'` (pick a sane max, e.g. 10000) |

---

## 3. UI accuracy audit (from client audit)

### 3.1 Stale / won't refresh (real bugs)
| Area | File | Issue | Fix |
|------|------|-------|-----|
| Dashboard stats | `app/dashboard/DashboardClient.tsx:33` | Local `player` state never syncs to `usePlayer()` context → shows SSR snapshot after actions elsewhere | `useEffect(() => setPlayer(contextPlayer), [contextPlayer])` or render `contextPlayer ?? player` |
| Missing `router.refresh()` after mutations | vip, street-dealer, weed-grow, casino/*, stocks, families/crusher | `refreshPlayer()` called but not `router.refresh()` → server components serve stale data | Add `await router.refresh()` after `refreshPlayer()` in each |

### 3.2 Hardcoded values that should be server/live
| Area | File | Hardcoded | Better |
|------|------|-----------|--------|
| Protection costs | `app/shop/page.tsx:44-47` | `cost: 450/780/1350` | From RPC response / catalog |
| Bodyguard costs | `app/shop/page.tsx:118` | `COSTS=[50000,100000,200000,350000,500000]` | From RPC response |
| VIP donator cost | `app/shop/vip/page.tsx:75` | `500 💎` | Server-returned cost |
| VIP buff costs + power | `app/shop/vip/page.tsx:134-139,213` | Buff cash/diamond costs; `* 4.0` power formula | Server cost catalog; use `data.power_gain` (213 already fixed post-purchase, but preview still hardcoded) |
| Drug caps | `app/street-dealer/page.tsx:15-20` | `DRUG_CAPS={Coke:200,Meth:100,Pills:300,Weed:1000}` | Match server `_drug_cap` (or fetch) |
| Weed cap | `app/weed-grow/page.tsx:86` | `WEED_CAP=1000` | Use server error message / catalog |
| Tuning parts | `app/garage/tune-shop/page.tsx:21-26` | Part costs/bonuses | Server catalog |
| Junkyard resale | `app/garage/junkyard/page.tsx:28` | `car.value*(cond/100)` | Use RPC-returned sale value |
| Heist fallback + weapon catalog + gear costs | `app/heists/HeistsClient.tsx:23-51,73-77,297-299` | `DEFAULT_HEISTS`, `WEAPONS`, gear `450/720/1100` | DB-loaded heists; server catalog |
| Heat items + lawyer | `app/components/HeatManager.tsx:10-14,15` | `5000/25000/60000`, `LAWYER_COST=250000` | Server catalog |
| Shed cap/upgrade cost/piggy fee | `app/safehouse/page.tsx:34-42,54,250,301` | `*1.5/*2.5`, `50000*lvl`, `0.008` fee | Server-derived values |
| Power fallback | `app/components/PlayerInfoCard.tsx:101` | `level*50 + rebirths*500` when null | Require server `power`, else show `—` |
| Crime cooldown + "live" % | `app/crimes/CrimesClient.tsx:109-112,145` | Client cooldown math; `success*0.8` labeled "(live)" | Derive remaining time from server `available_at`; drop misleading "(live)" or use server value |

### 3.3 Estimates that are OK *if labeled*
- `HeistsClient` "Est. Success" (server is source of truth) — label clearly as estimate.
- `GymBoard` training cost preview — fine as preview if server formula matches.

---

## 4. Recommended improvement plan (priority order)

### P0 — Close the 3 real exploits (must do)
1. **`buy_family_power` (029):** add `FOR UPDATE` / atomic update on family bank.
2. **`donate_to_family` (014/015):** add `FOR UPDATE` / atomic update on player cash.
3. **`buy_bullets` (070):** add a server-side total-bullets cap.

### P1 — Fix stale UI
4. **Dashboard:** sync local `player` → `usePlayer()` context.
5. **Add `router.refresh()`** after mutations in: vip, street-dealer, weed-grow, casino (5 files), stocks, families/crusher.

### P2 — Replace hardcoded economic constants with live/server values
6. Move all costs/caps/catalogs (shop protection+bodyguard, VIP, street-dealer drug caps, weed cap, garage tuning/junkyard, heist catalog/gear, heat items/lawyer, safehouse shed, PlayerInfoCard power) to a server catalog or read the actual RPC response. Goal: UI never shows a number the server can contradict.

### P3 — Accuracy polish
7. Crime cooldown: compute remaining time from server `available_at` timestamp, not client recompute.
8. Remove misleading "live" success % or wire it to a real server value.
9. Junkyard/safehouse: display the exact server-computed value from RPC responses.

---

## 5. How to apply SQL fixes
For items in P0, write a new migration `087_*.sql` (do NOT edit 029/014/015/070 in place — Supabase tracks migrations). Run it in Supabase SQL Editor or `supabase db remote commit`. Then align any client that displays the affected values.

## 6. Status
- ✅ Repo synced & type-clean.
- ✅ Family-buff exploit closed (migration 086 live).
- ✅ Real-estate + murder bonuses fixed.
- ✅ Refresh sweep complete.
- ⚠️ 3 remaining server-side issues (2 race conditions, 1 missing bullet cap).
- ⚠️ Dashboard stale-state + inconsistent `router.refresh()`.
- ⚠️ Several hardcoded economic constants should become live.

# 🎲 A Hustler's Way — Complete Game Diagnose

> **Live browser-based Mafia PBBG** · Next.js (App Router) + TypeScript + Supabase (Postgres 17)
> Server-authoritative economy · fully live/online · single source of truth for the whole game.
> _Last updated: 2026-07-18. All values sourced from the live database._

---

## 1. What this game is

A persistent, multiplayer online crime MMO. You start as a street nobody ("Hobo"), commit crimes for cash and XP, build a criminal empire (properties, drug labs, cars), join or run a Family, wage territory wars, and climb the money/power/most-wanted leaderboards. Every meaningful action runs through **server-side RPCs** — the browser never decides outcomes, so nothing can be forged from DevTools.

**Two currencies:**
- **Clean cash 💵** — from legit sources (property income, family payouts, casino/lottery wins, stocks, car sales). Freely spendable, shown on leaderboards.
- **Dirty cash 🩸** — from all crime (crimes, heists, rip, murder, races, drug sales). Must be **laundered** into clean cash before it counts toward wealth. Shown on the Most Wanted board.

---

## 2. Progression

| Track | How it works |
|---|---|
| **Level / XP** | Every successful crime grants XP. Level 1 → 50 (cap). Higher level unlocks crimes, cars, properties, and improves PvP odds. |
| **Rank** | Title based on progression (starts "Hobo" → up to "Godfather"). Cosmetic + prestige. |
| **Rebirth** | At **level 46+** you can rebirth: keep cash/assets/family/gym stats, murder_skill ×0.2, gain `max(5, (rebirths+1)×2)` diamonds. Prestige reset for long-term players. |
| **Hustler's Way** | Daily/weekly/family task ladder granting cash + XP + streak bonuses (3-day +10%, 7-day +25%). `hustler_rank` tiers at 5k / 25k / 100k total XP. |

**Stats:** `strength` / `defense` (trained at the Gym), `power` (bought/earned, drives PvP + family power), `murder_skill`, `breakout_skill`, `stamina` (0–100, regen 60/hr, 90/hr for donators).

---

## 3. Earn methods & values (all live)

### 3a. Street crimes (dirty cash + XP)
| Crime | Min Lvl | Payout | Success | Jail (fail) | Cooldown | XP |
|---|---|---|---|---|---|---|
| Pickpocket | 1 | $20–60 | 90% | 30s | 3 min | 5 |
| Rob Store | 3 | $80–250 | 70% | 60s | 5 min | 15 |
| Steal Car | 6 | $300–800 | 50% | 120s | 7 min | 40 |
| Train Murder | 8 | $50–150 | 45% | 300s | 10 min | 10 |
| Warehouse Heist | 10 | $1,500–5,000 | 25% | 300s | 30 min | 120 |

Crimes cost **stamina** (≈1 for pickpocket → 8 for warehouse), roll an **8% random street event** on success, and raise **heat**. Failure = jail + no XP.

### 3b. Heists (crew + gear, dirty cash)
`commit_heist(heist_key, crew, bullets_used, weapon, car_id)` — consumes bullets (0–500) and requires an owned **weapon** + **getaway car** (car wears −8/heist). Gear (pistol/kevlar/full kit, +8/+12/+18 success) is a persistent purchase. Bullets add up to +15pp success.

### 3c. Properties (clean passive income) — 18–19 per city × 5 cities
| Property | Price | Income/hr |
|---|---|---|
| House | $15,000 | $40 |
| Train Station | $25,000 | $100 |
| Villa | $75,000 | $120 |
| Fruit Machine (casino) | $600,000 | $200 |
| Tuneshop | $700,000 | $280 |
| Mansion | $1,500,000 | $300 |
| Red Light District | $1,500,000 | $700 |
| Penthouse | $2,350,000 | $420 |
| Airport | $3,000,000 | $800 |
| Yacht | $9,200,000 | $185 + perks |

Buy tax = **10% (live-tunable)**, paid into the Gov Tax Bank. Limits: max **4 properties**, 1 mansion, 2 villas, 4 houses; must be in the property's city. Income accrues lazily (24h cap) and is collected at the Safehouse. The **Yacht** grants a tax discount + income multiplier perk rather than raw income.

### 3d. Drugs (dirty cash)
- **Drug Labs** (`player_druglabs`): buy, upgrade level (higher = more output), collect production over time, then **sell** on the player Drug Marketplace via `list_drugs_for_sale` (stock-validated) — buyers pay, seller earns.
- **Weed Grow**: plant → water (drift/timing) → harvest kg, real-time waits.
- Drug types: **Coke, Weed, Meth, Pills**. Prices fluctuate; high-demand cities pay more.

### 3e. Other income
- **Races** (`run_race`): bet + compete, winner takes the pot (dirty).
- **Casino** (real, server-dealt): Blackjack (3:2 naturals), Roulette (single-zero, ~2.7% house edge), Video Poker (6/5 Jacks-or-Better ~95% RTP), RPS (1.9× win), slots pools.
- **Lottery**: $5,000 ticket, real 37%/42% odds (donator), prize = flat $25k–105k or 8% of pool once >$200k, 7-day per-player cooldown.
- **Stocks** (6 live tickers, volatility 0.025–0.06): CASROY, FAMPOW, GOTHAM, HEISTX, PHARMA, RACERZ. Real random-walk market, rate-limited server ticks.
- **Rip** (`rip_player`): PvP mug — steal 10–20% of a target's cash-on-hand (bank is safe), 4s per-target cooldown, scored on the Rip leaderboard.
- **Family hourly** payout, **territory** income, **bounties**, **detective** work.

### 3f. Cars (asset + racing + travel)
43 models across tiers: **default → low → mid → luxury → super → hyper**, $2,000 (Old Sedan) → $7,000,000 (Rimac Nevera), speed 70 → 230, fuel tank 45L → 90L, min level 1 → 50. Cars are used for racing, heist getaways, and **inter-city travel** (fuel matters — NY→LA needs ~79L, so a 50L compact can't cross the country).

---

## 4. Money systems

- **Personal Bank** — safe from rip/robbery; deposit/withdraw (guarded, no negatives).
- **Family Bank** — shared treasury; donations in, power purchases out, transaction-logged.
- **Property "Piggy" banks** & per-property banks — store cash inside a property.
- **Gov Tax Bank** — collects the 10% property tax + trade fees; admin-managed, feeds the Tax leaderboard.
- **Laundering** (`launder_cash`): laundromat (30% fee, $5M/24h), casino (18%, $10M), offshore (10%, $25M). Bust risk = heat/300 (halved by a Corrupt Lawyer); bust = batch confiscated + heat. Rolling 24h caps.

---

## 5. Combat, heat & risk

- **Murder** (`attempt_murder`): requires warm **detective intel** on the target and being in their city; consumes bullets; murder_skill + strength edge. Kill scoring rewards hunting strong/armed targets.
- **Bullets**: bought from the **Bullet Factory** (live stock, scarcity price ~$3–10, refills 2,500/hr, **hard cap 10,000/player [live-tunable]**, >5,000/purchase = police bust).
- **Bodyguards** (max 5) absorb rip/murder attempts.
- **Heat 🔥** (0–100): rises with crime, decays passively (30/hr base, +50% donator/lawyer). ≥75 = **Most Wanted**. Reduce via burner/bribe/lay-low or a one-time Corrupt Lawyer ($250k).
- **Jail** — failed crimes jail you; breakout training/attempts to escape.
- **Death/respawn** — lethal PvP can kill; respawn with protection window.

---

## 6. Families

Roles: **Boss → Underboss → Accountant → Soldier** (+ join-request approval flow, family inbox).
- **Bank & power**: donate (respect + logged), buy family power ($25k+ → power, boss/underboss/accountant only).
- **Hourly payout**: derived from family power + bank, capped **500/hr base [live-tunable]**, 60% to bank / 40% to cash.
- **Wars & Territory**: 5 cities with hourly income to the owning family; declare war (250 power stake, 24h), bullet attacks, lazy resolution — winner takes the city + 250 respect + loots 10% of the loser's bank, loser respect floored; 24h peace shield after. **Territory is admin-transferred to the rightful winner after a war** (no self-claim button).
- **Auto Crusher**: family machine that turns cars into bullets (tiers Klein/Middel/Groot: 8/12/16 bullets/car).
- **Leave fee = bounty**: leaving costs 5% of your cash+bank (floor $25k, cap $5M) → becomes a 7-day bounty only your old family can claim.

---

## 7. Support systems

- **Detective Agency**: hire ($25k, 15 real min) to locate a target → 5-minute intel window enabling murder.
- **Tickets/Support/Report**: player support + reporting (RLS-private, staff-answered).
- **Forum**: general forum + family messaging (rate-limited, ban/timeout gated).
- **Messages**: player DMs + system ("City Hall") messages, read-marking via a scoped RPC.
- **Travel**: train ($380 + 3min cooldown), car (fuel + wear), plane (`greatest($500, km×0.8)`).

---

## 8. Staff & Admin (role-based, no username hardcode)

`players.staff_role`: **ceo → admin → jr_admin → game_mod → support**.
- `is_admin()` = any staff role (opens the admin panel; each action is server-gated).
- `is_ceo()` = full/dev perks (CEO-only: staff management).
- **CEO** can promote/demote staff via the Admin → Staff Management panel.
- Admin panel: give cash/stimulus, manage all banks (gov tax, lottery), inspect/give/sell any player's property, moderation (warn/kick/ban/timeout/IP-ban), war events, and the **Live Economy Config** editor.

### Live Economy Config ⚙️
`game_config` table + `_cfg(key, default)` reader: admins tune balance **instantly for all players, no redeploy**. Unset keys fall back to the code default (zero-risk). Currently wired: `bullet_cap`, `bullet_bust_threshold`, `family_hourly_cap`, `property_tax_pct`. Extend by swapping any literal for `_cfg('key', <value>)`.

---

## 9. Security posture (launch-grade)

- **RLS enabled on all 45 tables.** No client can write economy tables — `hustler_progress`, `player_stats`, `player_druglabs`, `player_bitches`, `properties`, `drug_market_listings` are read-only to clients; all mutation goes through `SECURITY DEFINER` RPCs (263 of them, all with pinned `search_path`).
- **No `service_role` key in client code.** Frontend is RPC-first.
- **Closed exploits:** hustler-task money printer, drug-lab/bitches/stats self-writes, the forgeable `purchase_property(jsonb,bigint)` (99M/hr for $1), the messages-rewrite hole, the family-hourly double-claim race, and the ungated `admin_set_tax` stub.
- Admin RPCs all `is_admin()`-gated; moderation role-based (no `YGhosty` hardcode).

---

## 10. Tips & strategy

1. **Early game**: spam pickpocket/rob-store on cooldown, buy a House ($15k) ASAP for passive income, train at the Gym.
2. **Mid game**: stack properties (respect the 4-cap; Airport/Red Light are the best raw income), start a drug lab, join a Family for the hourly + wars.
3. **Money hygiene**: launder dirty cash regularly (offshore is cheapest at 10% but needs level 25); keep cash in the **personal bank** so rippers can't touch it.
4. **PvP**: keep bullets + bodyguards up; watch your heat (≥75 paints a target on your back); use the Detective before a murder.
5. **Long game**: rebirth at 46+ for diamonds, chase family territory income, climb the Money/Power/Most-Wanted boards.

---

## 11. Technical notes for future devs (Claude)

- **Server-authoritative**: exactly one `Math.random()` in the whole client (crime flavor text). All outcomes come from RPCs.
- **Migrations**: numbered SQL in `supabase/migrations/`. The tracked ledger drifted (085–114 applied out-of-band by multiple agents) — **trust the live catalog (`pg_policies`/`pg_proc`), not `list_migrations`**. Ledger repaired + current through 134.
- **Money helpers**: `_append_txn` / `_append_family_txn` log every bank move; guard every new money RPC with `amount > 0` + `FOR UPDATE` on the player row.
- **i18n**: everything uses `t()` + `fm()`/`formatCash(x, language)` (EN=$ / NL=€). Never hardcode currency.
- **Impersonation for testing RLS**: `set_config('request.jwt.claims', …)` then call the RPC.
- **Config pattern**: make any constant live-tunable via `_cfg('key', <current literal>)` + seed a `game_config` row.

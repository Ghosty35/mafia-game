# Mafia Game 2026 - All Rates, Ratios & Formulas (Master Reference)

This file contains **every** important number, formula, ratio, and balance decision in one place. Use this as the single source of truth for balancing, in-game help, and future documentation.

---

## 1. Economy & Tax

### Tax Rates (Current Defaults)
| Category                  | Rate          | Notes                                              | Adjustable by Admin |
|---------------------------|---------------|----------------------------------------------------|---------------------|
| Property Purchase         | 10%           | On top of purchase price                           | Yes                 |
| Property Earnings         | 20%           | On daily/weekly income from properties             | Yes                 |
| Bank Transactions         | 0.5%          | Default on deposits/withdrawals                    | Yes                 |
| Bank Bill Payments        | +5% penalty   | Extra when paying property bills from bank         | Yes                 |
| Street Dealer Buy         | 1.5%          | Goes to Community Fund                             | Yes                 |

**All taxes go to the Government Fund.**

### Other Economy Notes
- Street Dealer prices shift every 4 hours per city with multipliers.
- Property income is hourly but simulated in UI for demo.
- Carry caps prevent hoarding (see Safehouse/Weed docs).
- Admin can globally change tax % per category live.

### Property Limits (Hard Limits)
- **Mansion**: Maximum 1 per player
- **Villa**: Maximum 2 per player (must be in **different cities**)
- **House**: Maximum 4 per player (must be in **different cities**)
- **Total Properties**: Maximum 4

### Shed Capacity (Weed Storage)
Base (House):
- Level 1: **1000 kg**
- Level 2: **2500 kg**
- Level 3: **3500 kg**

Multipliers:
- Villa: **+50%**
- Mansion: **+150%**

### Piggybank (Mansion only)
- Separate from normal wealth
- **Hidden** from global leaderboard
- Visible to family members in family leaderboard
- No tax on transfers inside Piggybank (for now)

### Drug Carry Caps
- Coke: **200 kg**
- Meth: **100 kg**
- Pills: **300 kg**
- Weed: **1000 kg** (higher because of growing system)

---

## 2. Crime System

### XP Rules
- **Success**: Full XP
- **Failure**: **0 XP** (changed in recent update)
- Donator bonus: **+25% XP**

### Cash Rewards
- Donator bonus: **+20% cash**
- Stacks with rebirth multiplier

### Heat
- Gained on both success and failure
- Higher heat = higher chance of extra jail
- Police chance roughly: `heat / 180`
- Donators have slightly reduced heat impact

### Current Crime Values (from DB)
- **Pickpocket**: Min Level 1, Min Reward 20, Max 60, Success 90%, XP 5, Jail 30s, Cooldown ~3min base
- **Rob Store**: Min Level 3, Min 80, Max 250, Success 70%, XP 15, Jail 60s, Cooldown 5min
- **Steal Car**: Min Level 6, Min 300, Max 800, Success 50%, XP 40, Jail 120s, Cooldown 7min
- **Bank Heist**: Min Level 10, Min 1500, Max 5000, Success 25%, XP 120, Jail 300s, Cooldown longer

### Heists (examples)
- Convenience Store Raid: Min Lvl 5, Min 800 Max 2200, Success ~65%, XP 60
- Armored Truck: Min 12, 3500-8500, ~42%
- Casino Vault: Min 22, 12000-28000, ~28%

### Specific Crime Notes (from code)
- Pickpocket: Low risk, high success rate
- Rob Store, Steal Car, Bank Heist: Increasing risk/reward
- No XP on any failure (jail, death, etc.)
- Health loss on fail: higher (e.g. 2x risk multiplier + extra)

---

## 3. Family System

### Creation Cost
- 2,000,000 cash **or** 25 diamonds
- Donators can create at any rank

### Power Purchase Ratio
- ~**1 Power per $2,000** spent from family bank
- Minimum spend per purchase: $25,000
- Example: $50k spend = roughly +25 Power

### Hourly Pay Formula (per member)
```
base_hourly = floor( (family_power / 200) + (family_bank / 500000) )
```
- Capped at reasonable max (around 500)
- **60%** → Personal Bank
- **40%** → Cash
- Automatically deducted from family bank when claimed
- Example with 10k power + good bank ≈ $50/hr per member

### Family Roles (The Table)
- Boss / Underboss / Accountant / Manager / Caporegime / Soldier / Associate
- Max 2 Managers

### Pending vs Main Bank
- Donations first go to Pending Bank
- Leadership accepts → moves to main Bank + Respect
- Main Bank used for buying Power

---

## 4. Safehouse & Property System

### Property Type Benefits
- **House**: Basic weed spots + storage
- **Villa**: More spots + garage access
- **Mansion**: Best storage, Piggybank, no raids

### Raid Chances (approximate)
- House: High (~60-65%)
- Villa: Medium (~25-30%)
- Mansion: **0%**

### Bodyguards (Villa only)
- Base raid chance: ~30%
- Reduction: **-4% per bodyguard**
- Minimum effective: **2 bodyguards**
- Maximum: 10
- Cost: Starts at $2000 per
- Discount: After 5 → 0.2% cheaper per additional

---

## 5. Weed Growing

### Quality System
- Starts at **100%**
- Successful water: **+15%**
- Failed water: **-10%**
- Can go negative → harvest destroyed

### Harvest
- Minimum progress to harvest: **4/5**
- Yield = base_kg × (quality / 100)
- Base depends on property type + shed level

### Carry & Storage
- Limited by shed level + property type (see above)

---

## 6. Racing

### Requirements
- Car must have **≥75% health**
- 2 players minimum (no solo racing)

### Entry Fee
- Roughly **10% of the bet** (balanced for both players)

### Timers
- 5 min / 15 min / 1 hour / 2 hours (player chooses when posting)

### Cooldown
- **10 minutes** after every race (both players)

### Rewards
- Winner takes the full pot (bets + entry fees)

---

## 7. Banking & Transfers

### Personal Bank
- Deposit / Withdraw with 0.5% tax (default)

### Family Bank
- Donations go to Pending first
- Accepted → main bank + respect

### Piggybank (Mansion)
- Fully hidden from global wealth
- No tax on internal transfers (current)

### All Money Actions
- Require explicit confirmation
- After confirmation → immediate page refresh + DB save

---

## 8. Donator / VIP Perks (Current)

- **+25% XP** from all crimes and heists
- **+20% cash** rewards
- **20% cooldown reduction** (global)
- Shop items **25% cheaper**
- Golden name + DONATOR badge everywhere
- Better weed yields
- Family creation at any rank with diamonds
- Lower raid/jail chance on high heat
- Discount on family power purchases
- Faster hourly pay accrual
- Access to Piggybank

**Note**: Perks stack on top of double XP events.

---

## 9. Casino (to attract the gambling economy)

- Blackjack: ~48.5% win (1.95x payout). Donator slight +1.5% edge.
- Roulette: ~46% base.
- All losses feed dedicated sub-pools (Blackjack / Roulette / Lottery / General).
- Pools visible live and pay big lottery jackpots.

## 10. Advanced Stock Market

- 6 tickers: GOTHAM (realty), PHARMA (drugs), FAMPOW (family), HEISTX, RACERZ, CASROY.
- Buy/sell with real cash. Holdings in player jsonb.
- Prices tick with family power total + total crimes succeeded + random walk.
- Small tax on trades to casino pool.
- Full working RPCs + UI.

## 11. Admin Controls

- Full live player roster edit + give/take cash, set VIP, clear jail/death.
- Real give money persists immediately.
- Tax rate logging + controls.
- Casino pools + stock market visible and controllable.
- Special YGhosty account overrides (4M cash, 50k power, Godfather, 75% KillSkill)

---

## 10. Other Important Numbers

- **Action Delay**: 2 seconds between actions (anti-spam)
- **Race Cooldown**: 10 minutes
- **Murder Cooldown**: 60 minutes
- **Death Duration**: 60 minutes
- **Breakout Training**: +5% per training session ($500)

---

**How to use this file:**
- This is the single source of truth for all numbers.
- When balancing, update this file first.
- Extract short tips from here for in-game help text.

Last updated: See conversation history or git.

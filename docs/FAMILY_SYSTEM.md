# Family System - Detailed Guide

## Creation
- Cost: 2,000,000 cash **or** 25 diamonds
- Donators can create at any level
- Creator becomes Boss automatically
- Max 1 Mansion per player (balance reason)

## Roles & Permissions
- **Boss**: Full control
- **Underboss**: Almost full control (members + settings)
- **Accountant**: Bank management (donations, power buys)
- **Manager**: Limited member management (max 2)
- Lower roles: basic members

## Power & Hourly Pay System
**How Power is gained:**
1. Members donate → goes to Pending Bank
2. Leadership accepts donation → moves to main Bank + Respect
3. Leadership spends family bank on Power (buy_family_power)

**Power Purchase Ratio:**
- Approximately 1 Power per $2,000 spent from family bank
- Minimum spend: $25,000 per purchase

**Hourly Pay Formula:**
```
base_hourly = floor( (family_power / 200) + (family_bank / 500000) )
```
- Capped at reasonable amounts
- 60% goes to Personal Bank
- 40% goes to Cash
- Automatically deducted from family bank when claimed

## Family Bank vs Pending Bank
- **Pending Bank**: Donations land here first. Only leadership can accept.
- **Main Bank**: Used for Power purchases and (future) wars.

## VIP Family Buffs
Available in Shop for Donators:
- Power boosts
- Hourly pay multipliers
- War readiness packs
- Bundle pricing gives slight advantage over single purchases

## Family Limits & Balance
- 1 Mansion per player
- Villas in different cities only
- Power directly influences member payouts and future family wars

---
*Used for in-game help, tooltips, and future wiki.*
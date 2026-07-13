# Crime System - Detailed Balance & Ratios

## General Rules
- No XP gained on failure (including jail)
- Heat increases on both success and failure
- Police raid chance increases with heat (>25)
- Donator bonus: +25% XP and +20% cash from all crimes

## Crime Balance (approximate current values)

| Crime          | Min Level | Success % | Reward Range     | XP     | Heat Gain (Success/Fail) | Notes |
|----------------|-----------|-----------|------------------|--------|---------------------------|-------|
| Pickpocket     | 1         | 90%       | $5 - $20         | 5      | 3 / 12                    | Low risk, starter crime |
| Rob Store      | 5         | ~70-75%   | $50 - $150       | 15     | Higher                    | Medium risk |
| Steal Car      | 10        | ~60%      | $100 - $300      | 25     | High                      | Good for vehicles |
| Bank Heist     | Higher    | Lower     | High             | High   | Very High                 | Requires crew |

### Heat Mechanics
- Heat affects random extra jail chance when >25
- Formula roughly: police_roll < (heat / 180)
- Donators have slightly reduced heat impact

### Failure Penalties
- Reduced XP (was half, now 0)
- Jail time based on crime
- Health loss
- Heat increase

## Donator Crime Advantages
- 25% more XP
- 20% more cash reward
- Stacks with rebirth multipliers

## Future Plans
- More dynamic success rates based on player stats
- Crime-specific perks
- Heat decay over time

---
*Source of truth for in-game help text and balancing.*
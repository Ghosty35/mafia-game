# Vehicle & Garage System

## Car Health
- Cars have condition (0-100%)
- Below 75% cannot be used for racing
- Repair in Garage (cost based on damage)
- Tuning only possible at 100%

## Tuning & Mods
- Basic tune: +value
- Parts: Engine, Turbo, Brakes/Suspension, Bodykit
- Each part gives small % bonus (e.g. +5% speed)
- Mods are saved on the car object

## Categories (Planned)
- Low End: 15 cars (hatchbacks, shitboxes) - base speed ~80-95
- Mid Range: sedans (Lexus, Mercedes, Nissan) - base ~100-115
- High End
- Super Sport (rare, 5 cars)

## Images
- When stealing a car (e.g. BMW M3): show image + congratulate player with username

## Integration
- Cars stored in player.cars (jsonb)
- Linked to owned properties (garage spots)
- Used in Racing

## Balance
- Health system makes repair/tune shop meaningful
- Different categories have different base performance

---
*Future: full list of 45+ cars with exact base stats.*

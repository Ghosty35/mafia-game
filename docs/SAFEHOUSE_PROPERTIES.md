# Safehouse & Properties System

## Property Types
- **House**: Basic, 2 weed spots, higher raid risk
- **Villa**: 4 spots, can have garage, medium risk
- **Mansion**: 8 spots, Piggybank, no raids, best storage

## Purchase Limits
- Max 1 Mansion per player
- Max 2 Villas (must be in different cities)
- Max 4 Houses (must be in different cities)
- Total properties limited to 4

**Warning system**: Players are warned that multiple properties = more bills and grinding.

## Shed Upgrades (Weed Storage)
- Level 1: 1000 kg (House)
- Level 2: 2500 kg
- Level 3: 3500 kg
- Villa: +50% on base
- Mansion: +150% on base

Upgrades bought in Shed submenu.

## Piggybank (Mansion only)
- Standalone hidden bank
- Does **not** count toward global leaderboard wealth
- Family members can see the full amount in family leaderboard
- Deposit from cash, withdraw to cash
- Hidden from normal total money calculation

## Naming
- Players can name their properties when buying
- Custom name shown in Safehouse welcome message

## Tax on Properties
- 10% tax on purchase price
- 20% tax on earnings
- Weekly tax bills
- Tax goes to Government Fund

## Welcome Messages (Dynamic)
- House: Low-life, gritty messages
- Villa: Mid-tier motivation
- Mansion: Highly motivated + jokes

## Post Office (Bills & Taxes)
- View and pay open bills
- See weekly tax
- Property-specific tax rate and info
- Advanced payment options

---
*All property-related data lives in player.owned_properties (jsonb array).*

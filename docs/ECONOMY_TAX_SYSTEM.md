# Economy & Tax System - Detailed Guide

## Core Principles
- Realistic but fun economy
- Taxes fund the "Government Fund"
- All money movement should feel meaningful
- Donators get slight advantages but not broken

## Tax Rates (Current)

### Property Purchase Tax
- **Rate**: 10%
- Applied when buying any House, Villa, or Mansion
- Goes directly to Government Fund
- Warning messages are shown for multiple properties

### Property Earnings Tax
- **Rate**: 20%
- Applied to daily/weekly earnings from properties
- Can be simulated in Safehouse
- Weekly bills are generated based on earnings

### Bank Transactions
- **Default Rate**: 0.5%
- Applied on deposits and withdrawals in Personal Bank
- Extra 5% tax when paying property bills from bank

### Street Dealer
- **Rate**: 1.5%
- Tax on every buy (goes to Community Fund)

### Real Estate Billing
- **Bank Payment Penalty**: +5% when paying bills from bank

## Government Fund
- Receives most taxes in the game
- Currently used for:
  - Community benefits (future)
  - Admin oversight

## Admin Tax Controls
Admins can adjust tax rates in the Admin panel for categories:
- Properties
- Bank Transactions
- Other (expandable)

Rates should stay between 0-100%.

## Property Earnings Tracking
Each property tracks:
- `earnings_week`
- `last_earned`

When "Simulate 24h Earnings" is used:
- Income is calculated
- Tax is deducted
- Net goes to property bank balance
- Tax is added to maintenance debt

## Carry Caps (Drug Economy Balance)
- Coke: 200 kg
- Meth: 100 kg
- Pills: 300 kg
- Weed: 1000 kg (higher because growable)

Weed has higher limits because of the growing system in Safehouses.

## Future Considerations
- Interest on family bank for donators
- Property tax rate visible per building
- Government Fund usage (community events, etc.)
- Dynamic tax rates based on server economy

---
*This document should be kept up to date. It can be used to generate in-game tooltips and help pages.*
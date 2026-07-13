# Weed Growing System

## How it Works
- Requires House/Villa/Mansion
- Progress: 0 to 5 (water to increase)
- Each water: ~70% +15% quality, 30% -10% quality
- Can go negative → harvest destroyed
- Harvest at 4/5 or 5/5 for best results

## Quality & Yield
- Final yield = base_kg × (quality_percent / 100)
- Base depends on property type + shed level
- Negative quality = destroyed, progress reset

## Carry & Storage Caps
- Base caps increase with shed upgrades
- House: 1000 → 2500 → 3500 kg
- Villa: +50%
- Mansion: +150%
- Overall weed carry cap is higher than other drugs because it can be grown

## Harvest Tracking
- Successful Harvest Total Kg
- Failed Harvest Total Kg
- Shown in Safehouse → Shed

## Integration
- Storage in drug_storage.Weed
- Progress in weed_progress (player level)
- Quality tracked per grow session (client + state)

---
*Quality system inspired by Bulletstar mechanics.*

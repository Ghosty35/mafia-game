# Live Trackers & Cooldowns

## Current Trackers (Global via PlayerContext)
- Murder cooldown (60 min)
- Weed progress (0-5) + quality %
- Heist cooldowns
- Race cooldown (10 min after race)
- Bills / weekly tax timers
- Bullets carried (live update)
- Family hourly pay timers
- Property earnings simulation

## Design Rules
- All trackers must show the **same values** across pages
- Use `router.refresh()` + `refreshPlayer()` after actions
- Central widget (LiveLogs + LiveTracker) on dashboard and other pages
- Countdowns update every second

## Future
- Central /timers page with all cooldowns
- More visual indicators (progress bars, colors)

---
*Consistency is critical for player trust.*

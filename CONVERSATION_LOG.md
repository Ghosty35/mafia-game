# Mafia Game 2026 - Conversation Log
**Date:** 2026-07-13 (simulated)
**User:** Ritesh Ghost
**Language:** Mix of English and Dutch

## Summary of the Session

This conversation is a continuation of iterative development of a Next.js 16 + Supabase "Mafia Game 2026" browser RPG.

### Major Features Requested and Implemented in This Session:

1. **Online Status / Server Status Page**
   - Dynamic "Online X" in top nav linking to `/server-status`
   - Shows: Online people, Logged in this week, Total Families, Total Members, Total Money Circulation, People Registered
   - Used `get_server_stats()` RPC + `last_active` tracking

2. **About Page**
   - Narrative intro story: "Start your journey, you decide how you become the God of the Streets"

3. **Real Estate City Filtering**
   - Properties only shown for player's `current_city`
   - Must travel to see other cities' properties

4. **Family System Overhaul**
   - Creation cost: 2M cash **or 25 diamonds**
   - Donators can create at any rank
   - **Hourly Pay System**:
     - Donations → Pending Bank
     - Leaders buy Power from family bank
     - Power increases family attack/defense + member hourly pay
     - Payout: 60% to personal_bank, 40% cash
     - Automatic deduction from family bank on claim
   - VIP Family Buffs in shop (diamond + cash pricing with subtle bundle advantage)
   - Pending Bank logs with clickable player names linking to `/profile`

5. **Profile Page**
   - `/profile?user=username`
   - Shows stats, Donator badge
   - Added basic profile customization (avatar, bio) in Safehouse

6. **Safehouse System**
   - New `/safehouse` menu replacing direct Garage link
   - Sub: Shed + Garage
   - Property details, costs, upgrades
   - **Mansion Piggybank**: Hidden standalone bank (not in global leaderboard, visible in family)
   - Property naming on purchase
   - Dynamic welcome messages based on property type (House/Villa/Mansion)
   - Post Office section for bills/taxes

7. **Property Limits & Tax**
   - Max: 1 Mansion, 2 Villas (different cities), 4 Houses (must be different cities)
   - Tax on purchase (10%)
   - Weekly tax simulation + logs
   - Admin can adjust tax rates

8. **Admin Tools (`/admin`)**
   - Logbook
   - Give money (persists to DB)
   - Ban/Kick/Assign Mod (simulated)
   - Tax rate controls
   - Economy summary

9. **Race System Overhaul**
   - 2-player only
   - Post race with expire timer (5min/15min/1h/2h) + live tracker
   - Entry fee + betting
   - Car selection (min 75% health)
   - Vehicle health system
   - History + current challenges
   - 10min cooldown with live tracker

10. **Other Polish**
    - All major actions now have `confirm()` dialogs
    - `router.refresh()` + `refreshPlayer()` after actions so state saves across navigation
    - LiveLogs widget
    - Bullets shown in LiveTracker
    - Golden name + perks for Donators
    - 2-second action delay via context
    - No XP on fails/losses
    - Dynamic/varied messages on crimes
    - Improved family layout + join requests
    - Clickable cash → /bank
    - Car images + categories in garage

### Current Known Issues / Next Steps (from last messages)
- Values should now persist because of DB writes + `router.refresh()` after confirms.
- "Death buttons and empty clicks" — addressed by allowing `/jail` during death + force respawn + explicit refreshes after every action.
- Need to continue making **every** button/action call `router.refresh()` + `refreshPlayer()` where appropriate.
- More realistic vehicle health, full car list with images on steal.
- Bulletstar-like profile customization deeper integration.
- Full server-side enforcement for admin powers, tax, limits, etc.
- Professional UI overhaul + consistent backgrounds (started on login).

## Key Files Changed Recently
- `app/safehouse/page.tsx` (Piggybank, Shed upgrades, Post Office, tax, greetings)
- `app/families/page.tsx` (expanded banking, confirmations, requests)
- `app/jail/page.tsx` + layout
- `app/race/page.tsx` (full 2-player posting system)
- `app/admin/page.tsx`
- `app/real-estate/page.tsx` (limits + tax on buy)
- `app/components/PlayerContext.tsx` (admin override + action delay + refreshPlayer)
- `app/components/GameLayout.tsx` (allowed /jail during death)
- `app/components/LiveLogs.tsx`
- `app/components/LiveTracker.tsx` (added bullets)
- `app/crimes/SingleCrimeView.tsx` + `CrimesClient.tsx` (refresh + dynamic messages)
- `app/bank/BankClient.tsx` (confirm + refresh)
- `app/leaderboard/page.tsx` (clickable names)
- `mafia-game/supabase/migrations/03x_*.sql` (many: hourly pay, donator, no XP on fail, ambiguous crime_key fix, etc.)

## Notes for Future
- User wants everything to feel like Bulletstar (professional family hub, jail training, profile customization, logs widget).
- All financial actions should have confirmation + immediate page refresh.
- Make sure no more "empty clicks" — every button must trigger real state change + `router.refresh()`.
- Add more images/backgrounds consistently.
- Vehicle health system for races/garage.

---
*Conversation saved as requested. This file can be used as reference for the next session.*

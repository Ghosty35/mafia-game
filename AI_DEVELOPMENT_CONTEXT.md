# AI Development Context - Mafia Game 2026

This document is created so another AI (or future session) can quickly understand the full history, current state, decisions, problems, and direction of the project without reading the entire chat history.

---

## Project Overview

**Name:** Mafia Game 2026  
**Type:** Browser-based Mafia RPG (text-heavy with some client-side state)  
**Tech Stack:**
- Next.js 16 (App Router)
- Supabase (PostgreSQL + Auth + RPCs)
- React + TypeScript
- Tailwind CSS
- Turbopack (in dev)

**Core Philosophy (from user):**
- Bulletstar-inspired systems (family structure, jail training, profile, etc.)
- Professional + immersive feel
- Everything should feel "real" and balanced
- Strong emphasis on **persistence**, **live state**, and **good UX feedback** (especially after actions)

**Main Goal:** A deep, persistent multiplayer-feeling single-player mafia game with meaningful progression, family systems, economy, and long-term play.

---

## Current State (as of latest session)

### Major Systems Implemented

| System              | Status                          | Key Notes |
|---------------------|----------------------------------|---------|
| **Personal Banking** | Mostly working | Uses RPCs (`deposit_personal_bank`, `withdraw_personal_bank`). Has confirmation dialogs. |
| **Family System**   | Advanced | Creation (2M cash or 25 diamonds), roles, pending bank, hourly pay (60/40), power system, VIP buffs |
| **Safehouse**       | Good | Piggybank (Mansion only, hidden from global LB), Shed upgrades, Garage link |
| **Weed Growing**    | Separate page | % quality system, carry caps based on property type + shed level |
| **Properties / Real Estate** | Functional | City filtering, purchase limits, naming, tax on buy |
| **Race System**     | Recently overhauled | 2-player posting system with timers, entry fees, car health, history |
| **Admin Tools**     | Present | Give money, tax rate controls, logbook, simulated bans |
| **Death System**    | Active | `death_until`, redirects to `/dead`, force respawn available |
| **Jail System**     | Basic | Train breakout, attempt escape |
| **Live Trackers**   | Global via context | Murder, weed, heist, bills, bullets, race cooldowns |
| **Donator / VIP**   | Implemented | Perks (cooldown reduction, golden name, better yields, etc.) |
| **Tax System**      | Partial | Property tax, weekly bills, admin controls |
| **Vehicle System**  | Basic | Condition/health, tuning, selling, crushing |

### State Management
- **PlayerContext** is the central source of truth for the current player.
- Many actions still do **optimistic/local updates** + `updatePlayer()`.
- **Critical problem** (repeatedly mentioned): Changes often do **not persist** across page navigation because they only update client state.
- Solution pattern that has been applied:
  - Do DB update (via RPC or direct `supabase.from('players').update`)
  - Call `updatePlayer()`
  - Call `refreshPlayer()` (to sync context)
  - Call `router.refresh()` (to re-fetch server data on current page)

---

## Major Problems Encountered (and how they were handled)

### 1. State not persisting across navigation
- **Symptom**: User changes something (bank, piggybank, family donation, etc.), goes to another page, comes back → values are gone.
- **Cause**: Only `updatePlayer()` (local state) was used. Server components re-fetch old data via `get_my_player`.
- **Current fix**: Always do real DB write + `refreshPlayer()` + `router.refresh()` after important actions.

### 2. "Empty clicks" / buttons do nothing
- Happened multiple times (banking, jail, safehouse, etc.).
- Often because:
  - Missing `await refreshPlayer()` + `router.refresh()`
  - Functions not marked `async`
  - No confirmation + actual execution flow
- **Rule now**: After every meaningful button click → confirm (if money involved) → execute → refresh page.

### 3. Death system blocking too much
- Death lock in `GameLayout` was redirecting even from useful pages (jail, etc.).
- Jail was made accessible during death.
- Force respawn button added in `/dead`.

### 4. Ambiguous SQL / RPC errors
- "column reference 'crime_key' is ambiguous" (fixed in multiple migrations by using table aliases and `ON CONSTRAINT`).
- Missing columns on record `p` (fixed by recreating `commit_crime` after schema changes).

### 5. use* hook not defined errors
- Multiple times (`usePlayer`, `useState`) because imports were forgotten during refactors.
- Always double-check imports when moving logic between components.

### 6. Inconsistent data between components
- One place shows old cash/level, LiveTracker shows correct values.
- Fixed by preferring `contextPlayer` over local `initialPlayer` where possible.

---

## Important Conventions & Rules (for future AI)

1. **After every important action** (especially money, family, jail, crimes):
   ```ts
   updatePlayer(updated);
   if (refreshPlayer) await refreshPlayer();
   router.refresh();
   ```

2. **Financial actions** must have a `confirm()` dialog with clear explanation.

3. **Live data** should come from `PlayerContext` when possible.

4. **Owned properties** (`player.owned_properties`) is a jsonb array. When modifying (Piggybank, shed_level, earnings, etc.), always update the full array and persist it.

5. **Admin (YGhosty)**:
   - Special handling in `PlayerContext` (high stats, no restrictions).
   - Has extra tools in `/admin`.

6. **Death vs Jail**:
   - `death_until` → player is dead.
   - `jailed_until` → player is in jail (can still do some things, especially jail training).

7. **Tax & Economy**:
   - Most taxes go to "Government Fund".
   - Admin can adjust rates.

---

## Recommended Next Steps / Open Tasks

- Make **all** banking flows (personal, family, piggy, property) use the same "enter amount → confirm → execute → refresh" pattern.
- Centralize cooldown / timer display (user wants one overview page + consistent widget).
- Vehicle health system + proper tuning parts with real bonuses.
- Better persistence for weed quality % and harvest stats.
- Make the Live Logs widget more prominent and actually driven by real events (not just random).
- Finish professional UI overhaul (less black, better backgrounds, consistent theming).
- Make sure **every** button in the game actually does something + refreshes the page.

---

## File Structure Highlights

- `app/` – Main Next.js pages
  - `safehouse/` – Properties + Piggybank + Shed
  - `jail/` – Breakout training
  - `admin/` – Admin tools
  - `families/` – Family hub (multiple tabs)
  - `bank/` – Personal banking
  - `crimes/` – Crime list + individual crime pages
- `components/` – Shared UI (PlayerContext, LiveTracker, LiveLogs, GameLayout, etc.)
- `supabase/migrations/` – Many incremental migrations (be careful with order)
- `lib/types.ts` – Main Player type (keep this up to date)

---

**Goal for any future AI:**
Help the user build a polished, consistent, persistent mafia game where every action feels meaningful and state is reliable across the entire experience.

Keep asking clarifying questions when the request is ambiguous (user likes to think things through together).

---

*This file was created to give another AI full context quickly.*
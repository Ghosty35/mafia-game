# A Hustler's Way

A modern mafia browser game. Rise through the ranks, rule the city.

**Mobile-ready PWA** — install it on your phone's home screen for an app-like experience.

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A Supabase project (free tier works)

### Setup

1. Clone the repo:
```bash
git clone https://github.com/Ghosty35/mafia-game.git
cd mafia-game
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env.local
```

4. Edit `.env.local` and add your Supabase credentials:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000)

## Deploy

### Vercel (Recommended)
1. Push to GitHub
2. Import repo in [Vercel](https://vercel.com/new)
3. Add environment variables in Vercel project settings
4. Deploy

### Manual
```bash
npm run build
npm run start
```

## Mobile App

This is a PWA (Progressive Web App). To install on mobile:

1. Open the deployed URL in your mobile browser (Chrome/Safari)
2. Tap "Add to Home Screen" or "Install App"
3. The app will launch fullscreen like a native app

## Tech Stack

- [Next.js 16](https://nextjs.org/) - React framework
- [Supabase](https://supabase.com/) - Backend, auth, database
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## Project Structure

```
app/                    # Next.js app router pages
  components/           # Shared React components
  lib/                  # Utilities, types, i18n
  supabase/             # Database migrations
```

## Database Migrations

Migrations are in `supabase/migrations/`. To apply them:

1. Go to your Supabase project > SQL Editor
2. Or use Supabase CLI: `supabase db remote commit`

## License

MIT

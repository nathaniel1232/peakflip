# Peak Flip

Low-poly ski trick game. Plain HTML + Three.js, no build step.

## Run locally
```
python3 -m http.server 8123
```
Open http://localhost:8123

## Deploy to Vercel (free)
1. Import the GitHub repo on vercel.com → **Add New → Project** → **Deploy** (static site, no settings needed).
2. Every push to `main` redeploys automatically.

## Global leaderboards (Supabase)
1. Open your Supabase project → **SQL Editor** → paste `supabase/schema.sql` → **Run** (once).
2. The project URL and publishable key live in `config.js`. The browser can only call the validated
   `submit_score`, `get_leaderboard` and `get_ghosts` functions — it has no direct table access.

## Side ads on your own site
Apply for Google AdSense with your Vercel domain. Once approved, put your publisher ID and two 160×600 slot IDs in `config.js`.
Banners only show on screens ≥1280px wide and never on CrazyGames.

## CrazyGames build
`npm run zip:crazygames` → upload `peak-flip-crazygames.zip`.
Before uploading, set `ADS_ENABLED = true` in `game.js` (it's off for testing). CrazyGames doesn't allow third-party ads, and online leaderboards there should use their SDK instead.

## Files
- `game.js` — rendering, physics, controls, world generation, race mode
- `meta.js` — save data, cosmetics catalog, chests & odds, missions
- `ui.js` — menus, chest opening, locker, leaderboards, results
- `icons.js` — the hand-made SVG icon set
- `supabase/schema.sql` — leaderboard table + functions

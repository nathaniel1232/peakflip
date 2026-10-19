# Peak Flip

Low-poly ski trick game. Plain HTML + Three.js, no build step.

## Run locally
```
python3 -m http.server 8123
```
Open http://localhost:8123

## Deploy to Vercel (free)
1. Push this folder to a GitHub repo.
2. On vercel.com → **Add New → Project** → import the repo → **Deploy** (no settings needed; it's a static site + 2 API functions).
3. Leaderboards: in the Vercel project → **Storage → Create / Connect → Upstash for Redis** (free tier) → connect it to the project → **Redeploy**.
   Vercel adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars automatically. Without a database the game still works; the leaderboard just says it's offline.

Or from the terminal: `npx vercel` (logs you in through the browser), then `npx vercel --prod`.

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
- `api/` — Vercel serverless functions for leaderboards (Upstash Redis REST)

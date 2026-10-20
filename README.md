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

## Analytics (Vercel Web Analytics)
`index.html` loads Vercel's `/_vercel/insights/script.js` (the static-site version of `@vercel/analytics`).
Turn it on once in Vercel → your project → **Analytics** → **Enable**. It only loads on the deployed site, not on localhost or CrazyGames.

## Global leaderboards (Supabase)
1. Open your Supabase project → **SQL Editor** → paste `supabase/schema.sql` → **Run**. Run it again whenever the file changes
   (the points-based Daily Race needs the `racepts` board added in this version).
2. The project URL and publishable key live in `config.js`. The browser can only call the validated
   `submit_score`, `get_leaderboard` and `get_ghosts` functions — it has no direct table access.

## Cloud saves & moving to a new domain
Every change to a player's progress (coins, items, missions, name) is backed up to Supabase (`saves` table, via
`save_progress` / `load_progress` / `restore_progress` in `supabase/schema.sql`). Each player gets a save code
(Menu → profile button) that restores their progress on any device or browser.

To move to a new domain (e.g. `peakflip.io`):
1. Add the domain in Vercel → Settings → Domains, but **don't** set a redirect from the old address.
2. Set `canonicalHost: 'peakflip.io'` in `config.js` and push.
Visitors on the old address get their save uploaded and are sent to the new domain with it, so nobody loses progress.

## Ads

The game has three kinds of ad slots, all going through `ads.js`:

| Slot | When | Where it comes from |
|---|---|---|
| **Rewarded** | Player clicks a ▶ button: ad-exclusive items (Jetpack, Laser Eyes, Propeller Cap…), +75 coins, free Snow Chest | CrazyGames SDK or Google H5 Games Ads |
| **Between runs** | Before "Ride again" (only when `ADS_ENABLED = true` in `game.js`) | same |
| **Side banners** | Desktop screens ≥1280px, your own site only | Google AdSense display ads |

On `localhost` rewarded ads are faked with a 3-second "test ad" so you can try the flow.

### On CrazyGames
Nothing to configure: their SDK serves rewarded and midgame ads automatically. Set `ADS_ENABLED = true` in `game.js`,
run `npm run zip:crazygames`, upload. (CrazyGames forbids other ad networks; the game already disables them there.)

### On your own site (Vercel)
1. Get a custom domain (AdSense rarely approves `*.vercel.app`) and add it in Vercel → Settings → Domains.
2. Apply at **adsense.google.com** with that domain. Approval takes days to weeks and needs real content/traffic.
3. In AdSense, also apply for **H5 Games Ads** (the games ad format: rewarded + interstitial).
4. Once approved, edit `config.js`:
   ```js
   adsenseClient: 'ca-pub-XXXXXXXXXXXXXXXX',
   h5GamesAds: true,
   adsTestMode: false,          // true shows Google test ads while you check it works
   adsenseSlotLeft: '1234567890',  // optional 160×600 side banners
   adsenseSlotRight: '0987654321',
   ```
5. Also add an `ads.txt` file in the project root with the line AdSense gives you, then push.

Alternatives if AdSense says no: **GameMonetize**, **GameDistribution**, or **AdinPlay** (made for web games, easier approval),
or simply publish on CrazyGames/Poki and let them handle ads.

## CrazyGames build
`npm run zip:crazygames` → upload `peak-flip-crazygames.zip`.
Before uploading, set `ADS_ENABLED = true` in `game.js` (it's off for testing). CrazyGames doesn't allow third-party ads, and online leaderboards there should use their SDK instead.

## Files
- `game.js` — rendering, physics, controls, world generation, sky themes, race track (winding course, gates, points)
- `meta.js` — save data, cosmetics catalog (incl. themed sets & Fits), chests & odds, missions
- `ui.js` — menus, chest opening, locker (3D closet + try-on), profile & save code, leaderboards, results
- `cloud.js` — cloud saves, save codes, domain hand-off · `net.js` — Supabase RPC helper
- `icons.js` — the hand-made SVG icon set
- `ads.js` — rewarded / between-run ads (CrazyGames, Google H5, dev fake)
- `supabase/schema.sql` — leaderboard table + functions

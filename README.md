# Peak Flip

Low-poly ski trick game. Plain HTML + Three.js, no build step.

## Run locally
```
python3 -m http.server 8123
```
Open http://localhost:8123

The alpine landscape uses broad snow-covered foothills, layered distant ridges, and deterministic
groves with irregular clearings. `landscape.js` keeps scenery placement separate from the course RNG,
so the daily race layout stays consistent. Run `npm test` for terrain continuity and scatter checks.

## Deploy to Vercel (free)
1. Import the GitHub repo on vercel.com → **Add New → Project** → **Deploy** (static site, no settings needed).
2. Every push to `main` redeploys automatically.

## Analytics (Vercel Web Analytics)
`index.html` loads Vercel's `/_vercel/insights/script.js` (the static-site version of `@vercel/analytics`).
Turn it on once in Vercel → your project → **Analytics** → **Enable**. It only loads on the deployed site, not on localhost or CrazyGames.

## Global leaderboards (Supabase)
1. Open your Supabase project → **SQL Editor** → paste `supabase/schema.sql` → **Run**. Run it again whenever the file changes.
   Then run `supabase/points-and-chat.sql` for the score-based races, period leaderboards, and global chat.
   Then run `supabase/surf.sql` for the Surf leaderboard.
   Then run `supabase/coins.sql` for the Coins leaderboard (most coins right now, read from the cloud saves; not in the CrazyGames version).
   Then run `supabase/names.sql`: any name allowed (shared names, accents, emoji), renames any time, and scores
   from players the database hasn't seen yet are accepted. Finally run `supabase/score-cap.sql` to upgrade the
   score limit and offline submission rules on an existing database. Run `supabase/vault.sql` for the Vault: Event Horizon, a 10,000,000-coin outfit that only 5 players can ever own (the shop lists the owners). These files are safe to run again. The migration is additive: existing lifetime scores and legacy timed races are kept.
2. The project URL and publishable key live in `config.js`. The browser can only call the
   validated score and chat functions — it has no direct table access.

Endless opens first and has All time and Daily rankings on the main site. CrazyGames also retains Weekly,
which resets Monday at 00:00 UTC. Daily resets at 00:00 UTC. Each period uses the best run earned during that period, even when it is below
a player's lifetime best. Period tracking starts with this update; old lifetime scores stay on All time.
Daily Race awards riding/trick points plus 500 per checkpoint. Highest points wins; faster elapsed time
breaks equal scores. Scored race records are stored separately from the old timed records.
Completed Endless and Daily Race runs are queued locally before their result screens open and submitted immediately
once a name is set. Failed uploads retry automatically with bounded requests, including after reconnecting or restoring
a cloud save. The queue retains the best pending run per board and day until the server acknowledges it; older
queued runs keep their earned date. Accepted uploads refresh the visible rankings immediately.

Global chat shares the latest 50 messages from the last seven days. Players claim a name before sending,
messages are limited to 240 characters and one per five seconds, and chat identity tokens travel with cloud saves.
Players can mute others on their device and report messages. Reports are stored in `public.chat_reports` for
owner review; hide a message by setting `chat_messages.hidden = true`, or mute a sender with
`chat_sessions.muted = true` in the Supabase dashboard. These tables are not browser-accessible.

## Cloud saves & moving to a new domain
Every change to a player's progress (coins, items, missions, name) is backed up to Supabase automatically
(`saves` table, via `save_progress` / `load_progress` in `supabase/schema.sql`). Players don't have to do anything.

To move to a new domain (e.g. `peakflip.io`):
1. Add the domain in Vercel → Settings → Domains, but **don't** set a redirect from the old address.
2. Set `canonicalHost: 'peakflip.io'` in `config.js` and push.
Visitors on the old address get their save uploaded and are sent to the new domain with it, so nobody loses progress.

## Ads

The game has three kinds of ad slots, all going through `ads.js`:

| Slot | When | Where it comes from |
|---|---|---|
| **Rewarded** | Player clicks a ▶ button: ad-exclusive items (Jetpack, Laser Eyes, Propeller Cap…), +75 coins | CrazyGames SDK or Google H5 Games Ads |
| **Between runs** | Before "Ride again" (only when `ADS_ENABLED = true` in `game.js`) | same |
| **Side banners** | Desktop screens ≥1280px, your own site only | Google AdSense display ads |

On `localhost` rewarded ads are faked with a 3-second "test ad" so you can try the flow.

### On CrazyGames
Run `npm run build:crazygames` and upload `peak-flip-crazygames.zip`. Their SDK serves the rewarded and midgame ads, and the
build removes every other ad network. See [CRAZYGAMES.md](CRAZYGAMES.md) for what the build changes, how to submit, and the launch stages.

### On your own site (Vercel)
AdSense is set up with publisher id `ca-pub-5606045487621821`:
- the AdSense snippet is in `<head>` of `index.html` (Google uses it to verify the site),
- `ads.txt` in the project root authorizes Google to sell the ad space,
- `config.js` has `adsenseClient`, `h5GamesAds: true` and `adsTestMode: false`, and `ADS_ENABLED = true` in `game.js`.

Still to do in the AdSense dashboard: add the site (www.peakflip.io) under **Sites** and request review, apply for
**H5 Games Ads**, and turn on a consent message under **Privacy & messaging → GDPR** (required for players in Europe).
Ads appear only once Google approves; until then players just see no ad and rewarded buttons say none is available.

Alternatives if AdSense says no: **GameMonetize**, **GameDistribution**, or **AdinPlay** (made for web games, easier approval),
or simply publish on CrazyGames/Poki and let them handle ads.

## CrazyGames build
`npm run zip:crazygames` → upload `peak-flip-crazygames.zip`.
Before uploading, set `ADS_ENABLED = true` in `game.js` (it's off for testing). CrazyGames doesn't allow third-party ads, and online leaderboards there should use their SDK instead.

## Peak Surf (Surf on the home screen)
Ski and Surf sit side by side on the home screen (← → to choose, Space to ride). Surf lives in `ride.js` (physics,
camera, flow) and `surf.js` (the beach, waves, creatures and rider); `game.js` hands it the renderer, the synth and the
mountain's own HUD, pause screen and results card, so both modes look and play the same.
You ride downhill on a beach break: sand on the left, open ocean on the right, waves rolling up the slope at you.
Riding into a wave launches you; ← → steers, and in the air ↑ ↓ flips, ← → spins and holding Space grabs. Rocks, sharks,
buoys and paddling surfers wipe you out; jellyfish, turtles, the sand and deep water slow you. Now and then a whale
surfaces in the lane (ride up its back for a bonus) or breaches out at sea.
**Whirlpool:** every 1,000 to 1,400 m a whirlpool opens in the lane. Ride into it and it pulls you under and out into a
glowing lagoon worth double points for 650 m, like the special worlds on the mountain.
Coins go into the normal wallet. Scores go to their own board, `surf`, with All time and Daily tabs (run
`supabase/surf.sql` once to add it; test with `supabase/tests/surf.sql`). Until then surf scores wait in the local queue.

## Roblox version
`roblox/` is a Roblox port of Endless mode (same physics, tricks and course), with DataStore saves and
global leaderboards. See `roblox/README.md` to open it in Roblox Studio and publish it.

## Files
- `game.js` — rendering, physics, controls, world generation, sky themes, 3D closet, race mode
- `landscape.js` — alpine heightfield and world-space tree groves
- `meta.js` — save data, cosmetics catalog (incl. themed sets & Fits), daily item shop rotation & prices, daily gift, missions
- `ride.js` — the Surf engine: physics, camera, combos, the whirlpool bonus zone
- `surf.js` — Peak Surf: the beach, waves, sea creatures, whirlpool and surfer
- `ui.js` — menus, item shop (daily rotation + 3D try-on), locker (owned items), profile, leaderboards, results
- `cloud.js` — automatic cloud saves, domain hand-off · `net.js` — Supabase RPC helper
- `chat.js` — shared chat, reconnect/polling, mute and report controls
- `icons.js` — the hand-made SVG icon set
- `ads.js` — rewarded / between-run ads (CrazyGames, Google H5, dev fake)
- `supabase/schema.sql` — leaderboard table + functions

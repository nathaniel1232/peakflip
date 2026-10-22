# Peak Flip for Roblox

Peak Flip as a Roblox experience. Everyone plays as the game's own rider, a clean blocky skier they
dress up with jackets, pants, hats, goggles and extras. They hang out in a warm ski lodge, then ride an
endless mountain on skis or a snowboard. They flip, spin, grab, grind and bounce,
and when they crash they ragdoll with an **OOF**. The trick physics are ported line for line from the web
game's `game.js`, with tighter landings and more hazards.

## Open it in Roblox Studio

1. Install [Roblox Studio](https://create.roblox.com/) (free; sign in with your Roblox account).
2. Build the place file (or use the `PeakFlip.rbxlx` that's already here):
   ```
   cd roblox && rojo build -o PeakFlip.rbxlx
   ```
   (`brew install rojo` if you don't have it.)
3. Double-click `PeakFlip.rbxlx` to open it in Studio, then press **Play**.

Live-editing: run `rojo serve` here, install the [Rojo plugin](https://rojo.space/docs/v7/getting-started/installation/)
in Studio and click **Connect**. Saved `.luau` files then show up in Studio straight away.

## Publish it

1. Studio: **File → Publish to Roblox**.
2. **Game Settings → Security → Enable Studio Access to API Services** (lets Studio playtests save).
3. At [create.roblox.com](https://create.roblox.com/): add an icon and thumbnails, then make it **Public**.

Saves and leaderboards use DataStores, which only work in a **published** place.

### Icons and sounds (do this once)
The menus use icons from the *Free Icon Pack v3.1* by @gvesster. The sounds and music are the web game's own
synth sounds, rendered to files by `tools/make_sounds.py`. Roblox can only use images and sounds that are
uploaded to Roblox, so upload them once:

1. Create an API key at [create.roblox.com/dashboard/credentials](https://create.roblox.com/dashboard/credentials)
   with the **Assets** API system (**Read + Write**) and **0.0.0.0/0** under Accepted IP Addresses.
2. Open the **Terminal** app and run the uploader. It asks you to copy the key (Cmd+C) and press Enter,
   then asks for your user id (the number in your profile URL):
   ```
   cd ~/peakflip
   python3 roblox/tools/upload_assets.py
   ```
3. Rebuild: `cd roblox && rojo build -o PeakFlip.rbxlx`

The ids land in `src/shared/Icons.luau` and `src/shared/Sounds.luau`. Until then the game shows an emoji
for each icon and stays silent. The icon PNGs live in `roblox/assets/icons/` and are gitignored: the
pack's license doesn't allow sharing the files, and this repo is public.

### Robux (optional)
1. Creator Dashboard → your experience → **Monetization** → create:
   - game passes **2x Coins**, **2x XP**, **VIP** (crown tag, free revive each run) and **Gold Gear**
     (gold skis, board, helmet and trail);
   - developer products **Revive** (continue a run after a crash, e.g. 25 R$) and **Bag / Chest / Vault of Coins**
     (1,000 / 6,000 / 20,000 coins).
2. Paste their ids into `src/shared/Config.luau` (`PASS_IDS`, `PRODUCT_IDS`).

Anything left at `0` is hidden from players. In Studio it shows as "Set id in Config" as a reminder.

### Music
The game's own music (the web game's tune) is uploaded with the sounds above. To use a different track,
put its id in `MUSIC_ID` in `Config.luau`. Players can switch music off in Settings.

### Codes
Edit `CODES` at the top of `src/server/Main.server.luau`. Each player can redeem each code once.
The ones there now: `PEAKFLIP`, `RELEASE`, `OOF`, `SENDIT`, `FROSTY`.

## What's in it

**Lobby: a warm, bright ski lodge (shared, everyone sees each other)**
- Cream walls with wood trim, soft ceiling lights, two stone fireplaces with real fire, candles, sofas and
  hot chocolate, chandeliers and lanterns. Big windows look out on falling snow and pine trees.
- A Christmas tree with presents next to the daily gift chest.
- The ski shop counter with ski and board racks, plus outfits on rotating mannequins.
- Framed leaderboards (top riders all time and today). Big "TO THE SLOPES" doors: step on the mat (or press PLAY) to ride.
- Name tags with level, plus a crown for VIPs. `leaderstats` show Level, Best and Coins.

**The rider and outfits (seen by everyone, in the lobby and on the slope)**
Everyone plays as the same clean blocky skier (the web game's rider: red jacket, navy pants, white helmet,
orange goggles, dark gloves and boots). The shop's Outfit tab dresses it: 9 jackets, 6 pants, 9 hats (helmets,
beanies, cap, headphones), 6 goggles and extras (scarf, backpack, jetpack). Roblox's own walking and
jumping sounds are switched off.

**Skis or snowboard**
Pick in the lobby or by equipping a pair of skis or a board in the shop. The snowboard rides sideways with
the web game's board physics: sharper carving and a stronger ollie, butters (hold W on the snow),
Frontside/Backside spins, board grabs (Melon, Method, Stalefish, Nose), boardslides and riding switch.

**Riding**
- Your own avatar (R15 or R6) with skis and poles, crouching and grabbing. Ragdoll + OOF on a crash.
- 3-2-1-GO countdown, score, distance, coin counter, combo meter (up to x8), speedometer, "NEW BEST!", and a
  small trick feed at the bottom of the screen that fades out cleanly.
- Revive after a crash with Robux (the Revive product; VIP gets one free per run), up to twice a run, with a
  6-second timer that pauses while the purchase prompt is open.
- Pause menu: resume, settings, back to the lobby. Leaving mid-run still banks your coins.
- Four cameras (C), keyboard, gamepad and touch controls.
- Harder than the web game: much stricter landings, hazards ramp up over 900 m instead of 1.6 km, 50% more
  scattered rocks and a higher top speed (`Tuning.luau`).
- One clean look everywhere: smooth plastic only (no textures), a few colours (`shared/Theme.luau`), bright even lighting.

**Menus**
- **Shop**: Outfit (jackets, pants, hats, goggles, extras), Skis, Boards, Trails, Upgrades (Coin Magnet, Trick Speed,
  Coin Value, Head Start) and Passes tabs. Every item is a turning 3D model on its card.
- **Daily rewards**: a 7-day streak (100 → 1,200 coins), with a countdown to the next gift.
- **Quests**: 3 daily quests (the same for everyone each UTC day) with progress bars and coin rewards.
- **Codes**, **Stats** (lifetime flips, distance, perfect landings…), **Leaderboard**, **Settings**
  (music, sound, controls hint, low graphics, camera).
- Results screen: score count-up, coin breakdown, XP bar, level-ups, finished quests, Play again / Lobby.
- Levels and XP, toasts, red badges when a gift or quest reward is waiting, a branded loading screen,
  and UI that scales down on phones.

## How it's built

Each run is simulated and drawn on the player's own client, as on the web, so it's smooth at 200 km/h.
Nobody else sees your slope; while you ride, your real character waits out of sight and comes back to the lobby afterwards.
The server owns everything that matters: coins, purchases, upgrades, quests, daily rewards, codes and leaderboards.
It caps every reported run based on how long it actually lasted.

```
src/
  first/Loading.client.luau   loading screen (ReplicatedFirst)
  shared/Config.luau          store names, limits, Robux ids, music, lobby position
  shared/Catalog.luau         outfit pieces, skis, boards, trails, upgrades, passes, daily rewards, quests, levels
  shared/Outfit.luau          dresses a character (or a shop mannequin) in an outfit
  shared/Theme.luau           the palette and the smooth-only material rule
  shared/Icons.luau           uploaded icon ids   } written by tools/upload_assets.py
  shared/Sounds.luau          uploaded sound ids  }
  server/Main.server.luau     profiles, shop, rewards, quests, codes, Robux receipts, leaderboards, run checks
  server/Lobby.luau           the ski lodge, leaderboard boards, mannequins, name tags
  server/Avatar.luau          dresses every player as the game's rider in their outfit
  server/Icons.luau           turns uploaded icon decals into images for the UI
  client/Main.client.luau     physics, tricks, scoring, camera, input, run flow (lobby → countdown → ride → results)
  client/Course.luau          endless course generation and terrain queries
  client/Rider.luau           your avatar on skis or a board (blocky fallback), poses, celebrations, trails, ragdoll
  client/SkinFx.luau          small outfit animations, flickering fires, turning mannequins
  client/World.luau           simulation → workspace mapping (slope, metres → studs, floating origin)
  client/Sfx.luau             sounds and music (the game's own, uploaded)
  client/ui/Kit.luau          buttons, windows, icons, toasts, bars
  client/ui/Preview.luau      3D shop previews (ViewportFrames)
  client/ui/Hud.luau          the in-run HUD, countdown, revive, pause
  client/ui/Menus.luau        lobby HUD, all windows, results
```

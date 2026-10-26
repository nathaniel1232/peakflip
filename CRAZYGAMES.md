# Peak Flip on CrazyGames

## Quality update — 25 October 2026

- A skippable lesson teaches steering, taking a ramp, grabbing, and banking a landing during actual Endless play. Replay it from **How to play**.
- Endless starts with wide kickers, visible coin trails, and clear landings before introducing the procedural course. The first three runs use daylight.
- A clear primary button, quieter secondary buttons, readable leaderboard rows, and compact layouts improve the embedded experience. The display font and its OFL license ship in `lib/`.
- Simulation runs at a fixed 60 Hz, independent of display refresh. Pause clears held input and background stalls do not fast-forward the rider.
- Gameplay events survive a slow SDK initialization. Audio can resume from an interrupted state on the next gesture.
- Ad completion/error callbacks control when the next run may begin. The CrazyGames build cannot select Google ads, and its HTML contains no AdSense loader.

This addresses observed onboarding, readability, timing, and integration issues. It does not guarantee editorial acceptance. Validate real ads, account save behavior, site mute/chat settings, and physical touch devices in the Developer Portal before resubmitting.

## Endless without stages (CrazyGames only)

The CrazyGames build has no kilometre stages, stage bonuses, stage-driven lighting changes, or stage-4 solid-rock switch. Its HUD shows distance, and menu/help/lesson copy refers to scores and combos. Speed and procedural difficulty still rise gradually with distance. The self-hosted version retains its stages.

## Build the upload
```
npm run build:crazygames
```
This makes `peak-flip-crazygames.zip` (and the same files unzipped in `dist/crazygames/`). The build is the same game with
`platform: 'crazygames'` in `config.js`, which:

- serves ads only through the CrazyGames SDK (AdSense, H5 Games Ads and the side banners are removed)
- keeps progress in the player's CrazyGames account (SDK Data module), as well as Supabase as before
- uses a logged-in player's CrazyGames username as their leaderboard name, if they haven't picked one
- hides global chat and Off-piste chat when the player has chat switched off in their CrazyGames settings, and mutes the game
  when CrazyGames says to
- makes every "watch to unlock" item one ad (CrazyGames doesn't allow one reward to need several ads), and also sells it
  for coins (2× its rarity price), since CrazyGames wants players to have an option besides the ad
- is simpler: only **Endless** and the **Daily Race** (the "other" button is just "race"; no Off-piste, no Levels), no secret
  cabin, no Agartha or North Pole worlds, and none of the themed item sets (Agartha, Christmas, Halloween, Shabbat) in the
  shop, chests, bundles or locker. No Coins leaderboard either; that's on your own site only
- skips the Norwegian "Ideer?" popup (CrazyGames needs English), the move to www.peakflip.io, Vercel analytics, and the ".io"
  in the logo (pointing players at another place to play counts as cross-promotion)

Both versions have a privacy policy (`privacy.html`, linked from Settings) and a small note for new players under the menu
buttons that links to it, until they press OK. That covers the QA check "In-game mention of Terms & Conditions and/or Privacy
Policy": answer **Yes**.

The word filter (`clean.js`) is on everywhere. It masks bad words in chat, names and name tags, and refuses them when
someone sends a message or claims a name.

Test it locally with CrazyGames' test SDK (demo ads, fake settings):
```
python3 -m http.server 8125 --directory dist/crazygames
```
Open http://localhost:8125, or http://localhost:8125/?disableChat=true&muteAudio=true to try the settings.

## Submit it
1. Make a developer account at **developer.crazygames.com** and choose **Add game → HTML5**.
2. Upload `peak-flip-crazygames.zip` (`index.html` is at the root of the zip).
3. Fill in the form:
   - **Progress save:** choose *Yes, using the Data Module from the CrazyGames SDK*. If you don't, the Data module is off and
     saves stay only on the device.
   - **Account integration / login:** guests play as guests, and no external login.
   - **Chat:** yes, with a profanity filter, and it respects the disableChat setting.
   - **Multiplayer:** say yes only if you want the Off-piste mountain listed. Full multiplayer listing has extra rules (rooms,
     invite links); leave it off for now.
   - **Devices:** desktop and mobile (the game has touch controls), landscape.
   - **Controls:** A/D steer, Space jumps; in the air W/S flip, A/D spin, both = sideflip, hold G to grab (tap G to switch
     grab); C camera, P pause, M mute. On phones: left thumb steers, right thumb jumps; in the air the stick flips and spins,
     hold jump to grab.
4. Covers and video (see *Covers* below).
5. Use the **preview / QA tool** in the portal to play the uploaded build inside the CrazyGames frame. Check a midgame ad
   after Ride again, and a rewarded ad in the shop.
6. Submit. Their QA usually replies in a few days.

## Covers (required)
- Three images in the same style: **1920×1080** (16:9), **800×1200** (2:3), **800×800** (1:1).
- Only the title "Peak Flip" as text. No "Play", "New", borders, store logos or icons.
- Preview videos: **15–20 s**, no sound, 1080p, both **16:9 and 2:3**, starting on the cover image. No black bars, no mouse
  cursor, no "Play now" text, no fast-forward.

## What happens next
1. **Basic Launch (7–21 days):** the game goes live to a small share of players, **with no ads and no revenue**, so it can be
   measured. It ends after 7 days and 500 plays, or after 21 days.
   - **Average playtime:** good games reach 10+ minutes.
   - **Day-1 retention:** 10–15% is strong.
   - **Conversion** (players still playing after 1 minute): top games reach 80%+. Helped by loading in under 10 s with a
     build under 20 MB (this one is about 1.4 MB).
2. **Full Launch:** if the numbers are good, CrazyGames invites the game to full launch. Then it serves SDK ads, you get a
   share of the revenue, and it's checked against the full rules: SDK events, ads used correctly, CrazyGames account
   integration, and players landing in gameplay within one click.

Updates during Basic Launch are approved automatically, so upload improvements as soon as you have them.

## Getting the most from ads
CrazyGames earns money from ads and pays you a share. More playtime and more returning players mean more ad views, so
engagement matters more than the number of ad slots. Already in place:

- **Midgame ad** on Ride again / Race again / Try again (after a run, never during one). The SDK limits it to one every
  3 minutes, so asking every time is fine. The results screen stays blocked until the SDK reports that the ad finished or
  could not be shown; a delayed ad must never start over a new run.
- **Rewarded ads:** "watch to unlock" items and +75 coins (5 a day). Always optional, with a "try again later" note when
  there's no ad.
- **Double coins** on the results card (rewarded): pays the run's coins again (mission rewards aren't doubled). To stay within
  CrazyGames' rules it shows only when the run earned 25+ coins, up to 5 times a day, and not within 3 minutes of another
  rewarded ad. It's a quiet button below the coins, never louder than Ride again. Ride again is locked while the ad loads, and
  the coins are only paid when the ad finishes. Ride again also skips its midgame ad for 3 minutes after any rewarded ad, so
  ads never come back to back.
- `gameplayStart` / `gameplayStop` (CrazyGames uses these to time ads), and `happytime` on big combos.

Ideas that would add more (each needs testing against their rules):
- **One banner on the results or locker screen**, desktop only and never over buttons. Banners are only allowed on screens
  players stay on for 5+ seconds, and never during gameplay.
- Keep the daily gift, daily shop and daily race prominent, since they drive day-1 retention.

## Things to watch in QA
- Anything posted in global chat from your own site is shown to CrazyGames players too. The filter masks the worst words, but
  a filter in the database (`send_chat_message` / `change_name`) would be stronger.
- Live notices you send from Supabase reach CrazyGames players too, so write them in English.
- The crash marks on the snow are red. That should be fine for PEGI 12, but tone them down if QA mentions it.
- The Off-piste chairlift lodge and other modes must not link out anywhere. Nothing does today, so keep it that way.

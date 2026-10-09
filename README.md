# +1 Backflip Keyboard Escape

A multiplayer "+1" game for the browser, built with **Three.js** and **Colyseus** for Bloxity. Every step gives +Speed, Speed fills your Level, and every level gives **+3 walk speed and +1 jump**. Spam jump in the air to **backflip** higher and climb the giant keyboard walls, stage after stage. It clones the Roblox game *[+1 Backflip Keyboard Escape](https://www.roblox.com/games/102553576537621/1-Backflip-Keyboard-Escape)* (see `Reference/Gameplay (Lobby + Stage1).mp4`).

**There are no in-app purchases.** Everything in the game is bought with **Wins**, earned on the stage pads.

It shares its engine with Motorcycle Evolution and Jump Pogo (server, Bloxity login and avatars, profiles, effects). The keyboard world, backflip physics, 15 stages, HUD and soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player, backflips, camera, network), `world.js` (lobby, 15 stages, hazards), `keys.js` (instanced keycaps with letters), `candy.js` (candy decor, wings, halos, shoes), `ui.js` (HUD and panels), `audio.js` (music and sounds), `fx.js` (bloom, grading, particles) |
| `server/` | Colyseus 0.18 server: the `keyboard` room (`KeyboardRoom.js`), profiles, leaderboards, play stats |
| `shared/` | Game data and formulas used by both sides (`config.js`): stages, shoes, treadmills, items, trails, prices |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm --prefix server install && npm --prefix client install
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2595
```

For development run `npm run dev:server` and `npm run dev:client`, then open the Vite URL (the client talks to the server on port 2595; `VITE_SERVER_URL` overrides that).

## Gameplay (from the reference)

- **Every step is +Speed** ("👟+5" pops up as you walk). Speed is also XP: Level 1 needs 3, then 4, 6, 9, 15, 22, 33, 51, 76, 115, 172, 259, 389 (as in the reference), then x1.45 a level.
- **Each level: +3 Speed and +1 Jump** ("LEVEL UP! Level 2 / Speed 11 (+3) • Jump 2 (+1)"). Level N walks at 5 + 3N.
- **Backflips:** the first jump is a normal jump; every press in the air is a backflip that jumps again. You get one backflip per level (+1 per rebirth). "Jump: 12/13" shows how many are left while you're in the air. Each flip in a chain rings one note higher.
- **Stages:** 15 stages climb up and away from the lobby. Each is a corridor of keyboard tiers and hazards, ending in a giant wall. Three Wins pads stick out of the wall's left side: **+1x (yellow), +2x (cyan), +3x (pink) Wins**, each a few more jumps up. A pad pays out and sends you back to the lobby, with a **Teleport Back** button to go straight back. The next stage starts on top of the wall: climbing it takes `5.2 studs x jumps` (3 jumps at Stage 1, 80 at Stage 15). Fall and you respawn at the last checkpoint (the stage start, or the foot of the wall).
  1. **Candy Keys**: pink keyboard tiers (the reference's Stage 1) — 3 jumps, +1/+2/+3 Wins
  2. **Spacebar Bridges**: space bars and floating keys over the void — 6 jumps
  3. **Typing Keys**: piston keys bobbing up and down in a wave — 10 jumps
  4. **Chocolate River**: cookies sliding over a flowing chocolate river — 14 jumps
  5. **Caps Lock Lasers**: sweeping lasers and blinking laser gates — 18 jumps
  6. **Arrow Key Conveyors**: belts pushing you back and sideways over the void — 23 jumps
  7. **Gumball Alley**: giant gumballs rolling down a keyboard ramp — 28 jumps
  8. **Slippery Frosting**: icy keys and gliding ice blocks — 33 jumps
  9. **Lollipop Spinners**: low bars to jump, high bars not to jump into — 39 jumps
  10. **Glitch Keys**: keys that flicker and vanish, glitch lasers — 45 jumps
  11. **Mouse Click Crushers**: giant computer mice slamming down — 52 jumps
  12. **RGB Gaming Rig**: backlit keys, pistons, lasers, conveyors — 59 jumps
  13. **Jelly Bounce**: bounce pads over big gaps, spinners on the landings — 66 jumps
  14. **Sugar Storm**: narrow walkways, wind gusts, keys falling from the sky — 73 jumps
  15. **Rainbow Finale**: everything at once, then the summit: **ESCAPE! +100K Wins**
  Hazards run on the server clock, so everyone sees the same thing. Stage Wins grow 1, 2, 4, 8 … 16K, and each rebirth adds +25% Wins.
- **Lobby** (pink keyboard plaza, chocolate half behind the spawn, candy everywhere):
  - **SHOES** (west): 16 pairs on chocolate bleachers, "+1 Steps / 1 Wins" up to "+50K Steps / 1M Wins". Step on a pad to buy or equip.
  - **TREADMILLS** (east): Starter x2, x3 (5 Wins), x9 (30), x18 (150), x36 (600), x100 (3K), x200 (15K) and the Aqua x50 (Daily Day 7). They keep paying while you're offline (a quarter rate, up to 8 h).
  - **Trails** next to them: Starter, 1 Rebirth x1.5, 3 Rebirths x2, 5 x3, 10 x5, 20 x8, Moon Trail (Daily Day 3).
  - **Items Shop**: Donut Halo x1.25 (10 Wins), Angel Wings x1.5, Candy Crown x2, Demon Wings x2.5, Cookie Jetpack x3, Rainbow Wings x4, Galaxy Halo x6, Golden Keyboard Wings x10 (600K). You wear one at a time; it shows on your character.
  - **Gift Shop**: buy an item for another player. **Codes** and **Group Reward** chests, **Top Speed / Top Wins / Top Rebirths** boards, the **Sugar Rush** countdown board, World 2 portal (coming soon).
- **HUD** (as in the reference): Wins, Rebirth (with progress %), Inventory, Sounds, FREE!, Teleport, Treadmill on the left; Shop, Custom Speed (box + slider + MAX), Trade, x2 Speed on the right; CODES, Quests, Daily, Friends, Settings and the OP STARTER PACK top right; the quest line top centre; Multiplier x (Global / x2 Speed / Items / Trail / Rebirth), Total Speed, the Level bar, **+1 Level** and three Speed packs at the bottom; "Event In 00:20:33" bottom left.
- **Prices in Wins:** x2 Speed forever (50), x2 Speed Boost 15 min (10), OP Starter Pack (10, first 15 minutes: Angel Wings + boost + 1K Speed), +1 Level and the Speed packs (priced by your level).
- **Rebirth** from Level 15 (+5 per rebirth, up to 60): back to Level 1 for +50% Speed, +25% Wins, +1 jump and +2 walk speed for good.
- **Sugar Rush** event: every 30 minutes, 5 minutes of x2 Speed and x2 Wins for everyone.
- **Trade**: Items and Wins between two players; both press Ready, then a 3 s countdown and an atomic swap on the server.
- Daily Rewards (7 days), FREE playtime rewards, quests, codes (`BACKFLIP`, `KEYBOARD`, `SUGARRUSH`, `LEGION`, `RELEASE`), Friend Boost, Auto Train.
- **Soundtrack**: "Sugar Keys", an original code-generated 132 BPM candy-pop / future-bass track: keyboard-clack hats, a space-bar snare, a bell hook, chiptune plucks and pumping supersaws. No audio files.

## Graphics

- Every floor is made of glossy keycaps with a letter printed on each (instanced, a few draw calls); dark stages get glowing letters and RGB backlights.
- Candy everywhere: donuts with sprinkles, ice creams, lollipops, peppermints, macarons, cupcakes, candy canes, cookies, cotton-candy clouds (instanced per stage).
- PBR plastic with an environment map, soft sun shadows, a candy sky that darkens into a starry galaxy as you climb, bloom on neon and a colour grade.
- Only the stages next to you are drawn and collided with.

## Controls

| Action | Keyboard / mouse | Controller |
|---|---|---|
| Move | WASD / arrows | Left stick |
| Jump / backflip | Space (press again in the air) | A |
| Camera | Drag, wheel to zoom | Right stick |
| Auto Train | Treadmill button | X |
| Shop / Rebirth / Teleport / Inventory | Buttons | Y / LB / RB / View |

Phones get a joystick and a JUMP button.

## Multiplayer and saves

- One shared `keyboard` room (up to 24 players). Movement and hazards are client-side; Speed, Wins, levels, purchases, pads (position and jump checks), rebirths and trades are decided by the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/backflip-keyboard-escape-server`, Legion rollout, client upload. Play at https://backflip-keyboard-escape.play.bloxity.io.

One-time setup: create the app `backflip-keyboard-escape` on hosting.bloxity.io, create the game with the same slug in bloxity.io Manage Games (no IAPs needed), and add the repo secret `LEGION_DEPLOY_TOKEN`. `bloxity-setup.html` has every form field with copy buttons.

# BREACHLINE — a three.js tactical FPS

Port Sable, 19:40. A five-person Vanguard crew hits a freight terminal at
dusk to breach the vault pier; the Harbor Watch holds the yard. Short
rounds, money between them, one breach charge — plant it at the crane bay
(Site A) or the fuel depot (Site B), or wipe the other crew. First to seven
rounds takes the pier.

An original round-based tactical shooter in the browser: no build step, no
network, no assets — every texture is painted in code, every sound is
synthesized, and three.js 0.187 is vendored under `game/vendor/`.

## Play

```
node serve.ts          # serves game/ on http://localhost:8080
```

Open the page, click **Deploy**. You play Vanguard (attack) with four bot
teammates against five Harbor Watch bots.

| Key | Action |
| --- | --- |
| W A S D | Move (Shift walks quietly, Ctrl crouches) |
| Mouse / Click | Look / fire (right mouse aims; the Longbow scopes) |
| R | Reload |
| 1 / 2 / 3 | Primary / sidearm / blade |
| B | Buy menu (buy phase) |
| E (hold) | Plant the charge inside a site |
| Tab | Scoreboard |

## How a round works

- **Buy phase (15 s).** $800 to start. Rifles, an SMG, a shotgun, a heavy
  pistol, armour, a helmet — kills pay $300, round wins $3,000+, losses pay
  a rising streak bonus. Dying costs you your primary and armour.
- **Live (100 s).** The charge carrier is random each round; if they drop,
  the charge drops with them and anyone on Vanguard can pick it up.
  Standing still or crouching tightens your cone; sprinting is loud —
  bots hear footsteps and gunfire and act on both.
- **Planted (35 s).** Defenders rotate in and defuse (5 s, half with a kit)
  under fire; damage interrupts a defuse just like it interrupts a plant.
- **Match.** First to 7, at most 12 rounds.

## The yard

One flat terminal, ~100 × 76 m: A-main along the north fence, B-main along
the south, mid through a roofless warehouse, two connectors between them.
Containers, crates, tanks and barriers are cover; a nav graph over the
lanes drives the bots — escorts, a mid lurker, site posts, rotations on
information, burst discipline and human reaction times. Their ballistics
are exactly yours: same damage, spread, falloff and armour rules.

## Layout

- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — HUD DOM/CSS and the one import map.
- `game/src/` — `config` (all numbers), `world` (map, colliders, nav),
  `actors` (fighter state, damage rules, figures), `player` (movement),
  `weapons` (viewmodel + the shared shot), `bots` (perception and plans),
  `hud`, `effects`, `audio` (synth), `input`, `textures` (canvas-painted),
  `main` (round director, economy, channels, noise, the `?shot=` staging
  used for the screenshots).
- `screenshots/` — real renders of the game, staged deterministically via
  `?shot=start|buy|play|end` (see `shots.json`).

MIT licensed.

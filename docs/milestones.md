# Milestones — Yokai Field v2 (roguelite)

Every milestone must be **playable or testable**. No milestone counts as done just because "the code is written".
There are no deadlines, but each milestone is a mandatory stopping point to re-evaluate scope.

Design source: `docs/gdd.md`. Technical decisions: `docs/tech-decisions.md`.

---

## M0 — Tooling

**Work.** Cocos Creator 3.8.8 project (Empty 2D) at the root. `assets/scripts/{core,game,ui}`, `assets/resources/data/`. `AGENTS.md`. `tsc --noEmit`, vitest, eslint, prettier. GitHub Actions runs `bun run check`. Script generates placeholder sprites. Remove Unity + tag `unity-final` (per ADR-003, ADR-011).

**Acceptance.** `bun run check` green; empty boot scene with no console errors; `docs/` has all 5 files; repo clean, no `Assets/` left.

---

## M1 — Core loop with rectangles

**Work.** 8-direction WASD. Auto-fire 2 shots/s at the nearest enemy. Bullets are 2×2 px circles. 1 grunt enemy charges in, contact deals 1 damage, player gets 0.8 s i-frames. 6 hearts of health. Clear the room → show the text "room clear". Death → restart.

**Acceptance.**
- Tests (core, no `cc` import): pick the nearest target; fire cadence; damage + i-frames; knockback; room clear state.
- 1 room playable in the editor, can die and restart.
- No `cc` imports inside `src/core/`.

**Status: ✅ Done (2026-11-16).** 361 tests green (including `knockback.test.ts`); played the web build: 1.5-tile knockback, "ROOM CLEAR" for ~1 s then on to 2/9, GAME OVER + R to retry. Still open: the Vietnamese IME (Telex) makes WASD keys stick — see `AGENTS.md`; the caster does not fire bullets yet (that is M3).

---

## M1.5 — Art taste test (required)

**Work.** Install the **Ninja Adventure Update #8** pack (includes `Actor/CharacterAnimated`). The room uses the pack's existing tileset. Wire player + 1 enemy + 1 room into M1.

**Acceptance.**
- A 512×288 screenshot that looks like a game, not a prototype.
- Decision: keep this art direction / change it. **Change it here**, not after M3.

**Status: ✅ Done (2026-11-16).** Kept the pack's tileset, no dungeon. Acceptance image: `docs/art/m1.5-taste-test.png` (512×288, release build). The 32×18 room letterboxes snugly at every canvas aspect ratio (`core/view/letterbox.ts`), and the HUD sticks to the room edges.

---

## M2 — Rooms and run flow

**Work.** 32×18 tile room, single screen, no camera follow. Tiled → `.tmx` → `TiledMap` + parse the object layer → `LevelData` (collision, spawn, wave). Room transitions, `3/9` counter, chapter select stub. No scrolling, no confiner.

**Acceptance.**
- The `LevelData` schema has validation tests.
- Adding a new room only touches the `.tmx`, not code.
- Walk all 9 rooms of chapter 1 (boss is a placeholder) with no errors.

**Status: ✅ Done (2026-11-16).** 427 tests green (new: `xml`, `tmx`, `chapter-discovery`, `withBest`, `run-state` data-driven + `markWon`). 9 rooms `chapter-1/room-<n>.tmx` + `field.tsx`; `TiledMap` draws the tiles, and the object layer is parsed by **one** parser (`core/level/tmx.ts`, no `cc`) into `LevelData`. Chapter select is built in code (ch1 unlocked, 2–3 locked, shows the best from `localStorage`) → 9 rooms → Tengu 60 HP placeholder boss → CHAPTER CLEAR → back to chapter select. Tried dropping in `room-10.tmx`: HUD and flow become `x/10` with no code change (test file deleted). Headless Chrome walks the whole `1/9 → 9/9` with no console errors. Not yet: 3 boss phases/bullets (M4), skill pick (M3), pixel font.

---

## M3 — Combat depth

**Work.** 3 enemy roles (grunt/caster/brute) + caster bullets + brute charge + telegraph. Elite variant (tint + scale + 1 extra attack). 70 ms hitstop, knockback, stagger. Object pool for bullets (no `new` per shot).

**Acceptance.**
- Tests: telegraph timing, charge hitbox, i-frames when hit by a bullet, pool does not leak after 1000 shots.
- The 3 enemies are distinguishable at a glance for 2 seconds: different silhouette, different attack, different dodge.
- 60 fps with 8 enemies + 40 bullets on screen.

**Status: ✅ Done (2026-11-16).** 469 tests green (31 files; new `hitstop`, `charge-hitbox`, `enemy-fire`, `elite-attacks`, `bullet-pool`, plus boss rules in `chapter-discovery`). Roles: chaser (blue bat, contact damage), caster (green octopus — swapped from Eye so it does not match the bat's silhouette/color — slow bullets with owner `enemy`, orange tint, sharing `BulletPool`), brute/tank (bear, silhouette ×1.75 via `enemies.roles.tank.scale`, 700 ms telegraph then a 7 tile/s charge); the telegraph is an `fx/telegraph-ring` circle **colored by role** (yellow/cyan/orange) + pulse + tint. Elite = tint + 1.15 scale + 1 extra attack: elite chaser does a short dash (300 ms telegraph, 6 tiles/s × 300 ms), elite caster fires a 3-bullet fan (±0.22 rad), elite tank charges **twice** (the second locks a new direction). 70 ms hitstop when a player bullet hits an enemy = freezes **simulation time** (`HitstopClock`), so telegraph/i-frames/cooldown/TTL all stand still — tested; the 150 ms stagger is a separate action and does not reset cooldowns (if it did, an enemy facing 2 shots/s auto-fire would never get an attack out — a bug caught in smoke testing). Bullets: 256-slot pool + 64 prebuilt view nodes, no `new` per shot. `chapterFromLevels` rejects a boss that is not the last room / >1 boss room (tested). Debug `?debug=1`: `spawn(role, elite, at)`, `stress()`, `fps()`, `godMode(on)` (+ `enemies()`, `bulletCount()`), used for acceptance. Headless Chrome (ANGLE Metal, 1280×960 viewport): `stress()` holds **8 enemies + 40–41 bullets**, `fps()` 12 consecutive samples **~60.0 fps / 16.67 ms** (normal-room baseline 60); the M2 9-room loop re-runs `1/9 → 9/9` → CHAPTER CLEAR → back to chapter select, **no console errors**. Shots: `/tmp/yokai-m3/shots/`. Still missing (not part of M3): death/impact FX and the elite palette remap (tint multiplies the current color, deferred to M6), 3-phase bosses (M4), headless sim does not model hitstop/stagger or the elite extra attacks (only the game adapter does).

---

## M4 — Skills and bosses

**Work.** 20 skills per GDD §6, rarity weight, stacking, 1-of-3 pick screen. Real bosses from GDD §5 — **TenguBlue / SquidGreen / GiantBlueSamurai**, 60/80/100 HP, 3 phases, readable patterns — no more dragon/blocky-placeholder boss. Chapters 2 and 3 with scaling.

**Acceptance.**
- Tests: rarity roll is deterministic with a fixed seed; stacking adds up correctly; skills affect DPS by the right formula.
- Play one full 9-room run + boss in all 3 chapters.
- The 3 boss phases are clearly different (tint + telegraph ring color + separate banner), and each phase has at least 1 pattern that forces movement (test: a player standing still at `playerStart` still gets hit in all 9 phases).

**Status: ✅ Done (2026-11-17).** 538 tests green (39 files; new `skills-loadout`, `combat-effects`, `boss-phases`, `chapter-scaling`, `chapter-assets`, `save-unlock`, `integer-damage`). All 20 skills live in the game through `DerivedStats` + `core/combat/*` (crit, pierce, ricochet, homing, AoE explosion with flash, freeze/poison with tint + DoT, lifesteal, execute, 20 s shield with tint, thorns, Second Wind, Vitality…); the sim uses those same helpers. The 1-of-3 pick screen is built in code (`skill-pick.ts`): 3 cards with name/rarity color/effect/stack, picked with the mouse **and** keys 1/2/3 (must listen on `document` capture — see the AGENTS.md traps), rolled with the run's seeded RNG, respecting max stacks. The HUD has a 2-character abbreviation row + stack count (20 distinct codes) and a boss health bar. Bosses use `core/boss/patterns.ts`: Tengu 60 / Squid 80 / Samurai 100 HP, phases at 66%/33%, Summon runs Squid's 2 casters, Samurai lineups with the player's row before charging sideways (otherwise a player in another row is never threatened); each phase has its own tint + telegraph ring color + `PHASE 2` / `ENRAGE` banner. Chapters 2–3 are authored with all 9 rooms each (5–6 enemies/room, brute from room 3; 7–8 enemies + elite), each room split into 2–3 waves; health scales via `config/tuning.json` (`chapters.enemyHealthMultipliers` 1/1.05/1.05, damage stays 1/1/1 — the real difficulty comes from count/elites, true to the spirit of GDD §4). Winning a chapter writes `chaptersUnlocked` to the save; chapter select shows exactly 1 → 2 → 3. Headless Chrome (1280×960): ch1 → ch2 → ch3, each chapter through 9 rooms + 3 boss phases + unlock, **no console errors**; `stress()` holds 8 enemies + 44 bullets; 12 separate samples at **60.0 fps** (16.67 ms/frame); a full-flow run of 3 chapters + 3 bosses averages **58.1 fps**. Balance sim (3 seeds, dodge policy): standing still dies in room 1 after 8.2–11.2 s; dodging with no skills survives 9.9–121.2 s; dodging + a typical loadout **wins all 3 chapters** (average 85 / 93 / 135 s). Round 2 added separate tests for chapters 2–3 with a 0-skill run: standing still loses room 1 (14.3 / 13.4 s), dodging with no skills survives **254–256 s** (ch2, clearing 6 rooms) and **187–205 s** (ch3, clearing 3–4 rooms). Shots: `/tmp/yokai-m4/shots/`. Still missing: Greed gives no gold during a run (M5), Freeze does not slow bosses (normal enemies only), crit/lifesteal share an RNG with boss patterns, the skill HUD uses abbreviations because the pack has no fitting 16×16 skill icons.

---

## M5 — Meta and UI

**Work.** Gold, 3-track meta shop, `localStorage` save (schema in GDD §10), title, chapter select, pause, run results, settings, credits. Entirely mouse + keyboard.

**Acceptance.**
- Tests: save/load round-trip, upgrade prices, purchase blocked when short on gold, chapter locked until unlocked.
- Every screen can be entered and left, no dead ends.
- No clipped text at 16:9, 16:10, 4:3.

**Status: ✅ Done (2026-11-17).** 562 tests green (43 files; new `run-stats`, `run-rewards`, `chapter-gate`, `settings`; `save.test` already covered round-trip/price/purchase blocking/migrating the old `hp`/`firerate` keys). Gold: a kill pays `goldForKill` (elite ×3) via `RunRewards`, Greed multiplies then **rounds** (tank 3 × 1.5 = 5), room clear +5 / boss +50, the HUD shows it live; written to the save only once at the end of the run (`game/run-end.ts`: death/win, restart/quit mid-run also keep gold). Meta: `core/meta/run-stats.ts` applies purchased levels to the baseline before skills (heart +1/level, damage +5%/level, fire rate +3%/level); checked in the browser: buying damage 1 + hearts 1 → a new run has `damage 1.05`, `maxHearts 7` and 7 full hearts. Screens: title / chapter select (+Back, keyboard focus) / pause (Resume, Restart, Quit, volume; **sim clock stands still** — enemies move 0.000 tiles after 1.5 s) / result (death + win; rooms, gold, time, kills, Shop/Chapter select/Title) / shop with 3 tracks (level, price, gold, disabled reason) / settings (volume in 10% steps, real fullscreen, read-only keybinds) / credits (Pixel-boy & AAA, CC0) / skill-pick (adds ←/→ + Enter, still 1/2/3). Every screen uses `game/screens/menu.ts`: real mouse clicks, hover/focus, ↑/↓/←/→, Enter/Space, Esc; focus has a yellow outline. Locked chapters are blocked in **core** (`chapterGate`, tested), not just by a disabled button — clicking Chapter 2 in the browser does not enter the run. The save schema keeps `version: 1`, keys `hearts/damage/fireRate` (GDD §10 was corrected to match the code; migration reads the old draft names); a corrupt `localStorage` → default save, no crash (test + browser). Debug `?debug=1`: adds `screen()`, `save()`, `setGold(n)`, `uiText()` (label rect in canvas + `insideCanvas`), keeps the old hooks. Canvas: `applyCanvasSize` sets `screen.windowSize` at boot + on resize, drops the template's border/header/footer → canvas is exactly `innerWidth×innerHeight`; the world still letterboxes to 16:9. Headless Chrome walks the full flow (title → chapter → run → pause/resume/restart/quit; death → result → shop → buy → back; win chapter 1 → unlock chapter 2 → play chapter 2; credits/settings; 54 UI audits across 6 viewports 1280×720, 1920×1080, 1280×800, 1440×900, 1024×768, 1280×960, **0 clipped labels**, 0 console errors). `stress()` 8 enemies + 44 bullets: **58.5–60.1 fps** (120-frame samples; 1280×720/960/1024×768/1920×1080). Shots: `/tmp/yokai-m5/shots/` (every screen at 16:9 and 4:3, plus result-win/stress). Still missing: volume is only stored, no audio yet (M6); system font instead of the pack's `NormalFont.ttf` (M6); Esc inside fullscreen is used by the browser to exit fullscreen, so you must press it again or use the Back button; no key rebinding (as in v1).

---

## M6 — Art integration

**Work.** Decorate all 27 rooms with tilesets that **actually exist in the pack** per the GDD §8 table — ch1 Nature/Relief/Element/Field, ch2 Water + waterfall/water + Nature banks, ch3 VillageAbandoned/House/Towers/Hole, boss arena + 4 stone pillars. Decoration must not contradict collision: anything that looks solid must be an obstacle in the object layer, and floor that looks walkable must stay walkable. Real animation via `animations.json` for the player (NinjaGreen: idle/walk scaled by velocity, hurt, death), the 3 enemy roles + elite (idle/walk; hurt = flash/tint, death = FX — GDD §12.3), and the 3 bosses TenguBlue/SquidGreen/GiantBlueSamurai (attack/Trans/AttackLoop/Shoot/charge/hit tied to pattern events). Foot pivot, no jitter when switching between animations of different sizes. Bullets/VFX/impact from the pack's `FX/` (shuriken, energy ball, spark, explosion, smoke, shield, freeze/poison, gold sparkle), all pooled. Audio: title/chapter/boss music + action SFX, master volume from the save, autoplay unlocked on first input. Pack pixel font for every label. UI uses real nine-slice. In-game credits + `README.md`.

**Acceptance.**
- No placeholders left on screen.
- Every manifest key has a real sprite or a fallback.
- 4 required animations per actor; no frame drifts off pivot.
- Credits in game + `README`.

**Status: ✅ Done (2026-11-17).** 576 tests green (45 files; new `art-files` 9 tests + `water-layout` 5 tests). **Manifest**: 119 keys; `art-files.test` reads the real PNGs with an in-repo decoder (`scripts/lib/png.ts`), checks that files exist, that the grid divides the sheet evenly, and that `footPx` = the sheet's lowest opaque pixel row (pivot test); adds idle for 9 monsters + 8 FX keys. `SpriteEntry` has `anchor`/`footPx`; `SpriteAnimator` anchors at the feet, `contentSize` from the frame, walk scale from velocity (GDD §12.2). **Rooms**: `scripts/dress-rooms.ts` covers 27 `.tmx` with a decor layer (ch1 Nature grass/flowers/pebbles + hedge/barrel on row 0; ch2 grass + `water-layout.json`; ch3 Desert props + Village roofs/fences on rows 0/17 + Houses/Towers/Hole in the boss arena). ch2 water is the `Backgrounds/Animated` sprite strip (ripple + 3-part waterfall) drawn by `room-water.ts` over a blue `Graphics` backdrop — `TilesetWater` is an irrigation-channel autotile that turns stamped blocks into a pipe shape, so it is not used as a river. No new obstacles: solid props only sit on row/column 0/31 and are clamped 1 tile, so collision/balance is unchanged (`run-simulation` still green). **Actors**: enemy idle/walk, hurt tint/flash, death = smoke+impact; bosses use attack/Trans/AttackLoop/Shoot/charge/hit on events and return to idle when the clip ends; player death FX 1.4 s then result. **FX**: 32-slot pool slices frames from the manifest + one shared clock (the first version used one `SpriteAnimator`/slot and dragged stress down to 40 fps); impact/explosion/smoke/shield/ice/poison/gold sparkle; shuriken bullet 15 frames + energy ball 4 frames. **Audio**: 5 tracks (title/ch1/ch2/ch3/boss) + 15 SFX mp3 (2.2 MB), autoplay unlock on first input, saved volume applied live; debug `audio()` shows track + SFX. **UI**: `NormalFont.ttf` for every label, nine-slice panels/buttons/skill cards (with insets), credits updated + `README.md`. Build `du -sh` **7.9 MB**. Headless 1280×720 and 1024×768: every screen (title/chapter/shop/settings/credits/skill-pick/pause/result) `uiText` clipped=0 overflow=0; ch1→ch3 all 9 rooms + 3 phases per boss; `placeholders()` empty on every screen; `stress()` 59.5–60.1 fps with 8 enemies + 44 bullets + FX; 0 console errors. Shots: `/tmp/yokai-m6/shots/`. Honest limitations: ch3 interiors are fairly empty (VillageAbandoned is all autotile fragments with transparent corners, so placing them individually looks like "torn paper"); `TilesetElement` has no stone pillar so the boss arena uses a Nature boulder; water/river is walkable (shallow river); the Samurai boss can touch the arena edge and have part of its sprite cut off; monsters still have no attack/hurt/death frames (FX + tint per GDD §12.3).

---

## M7 — Ship

**Work.** Web build, host on **Cloudflare** (Worker serving static files only, `yokai-field`, custom domain `yokai.lukeinc.tech`; drop itch.io and GitHub Pages), pixel-perfect integer scaling (512×288 × 2/3/4), performance check, showcase page = the portfolio project page `lukeinc.tech/projects/dragon-field` (covering the Unity 2023 version → this one). Fix before shipping: Samurai sprite clipped at the arena edge, WASD stuck when the Vietnamese IME is enabled.

**Acceptance.**
- Link opens in Chrome/Safari/Firefox.
- 60 fps at 1920×1080 on a mid-range laptop.
- Build < 15 MB (audio streamed separately if needed).
- No console errors on the first play.

**Status: ✅ Done (2026-11-18).** 598 tests green (new: `move-keys`, `deploy-html`, boss bounds in `boss.test`, sprite extent in `art-files`, `pixelPerfectRect`/`worldToUiScale` in `letterbox`). The world draws at integer multiples (1920×1080 → 1536×864 ×3, integer-pixel margins), the HUD shrinks by `hudScale` to hug the room edges, menus still use `SHOW_ALL`. Bosses stay inside `bossRoomBounds` based on the sprite extent measured from the PNG — a Samurai charging near the wall is no longer clipped (verified at 1920×1080). WASD reads `event.code` on `document` — a synthetic event with `key: 'đ'`, `keyCode: 229` still moves correctly <!-- i18n-allow: IME key value -->; **still waiting for a real Telex test** (`?debug=1` → `__yokai.keyLog()`). Panels/skill cards moved to `nine_path_panel_interior` (no more offset double frame from M6). `bun run deploy:prepare`: 431 files, 6.66 MB, largest file 2.42 MB. Local 1920×1080: `stress()` 8 enemies + 44 bullets **60.0 fps** (6 samples × 120 frames). **Real deploy ✅** (Cloudflare Workers Builds, `yokai.lukeinc.tech` returns 200). **Chrome on the domain ✅ (2026-11-18)**: `?debug=1`, viewport 1920×876, canvas matches exactly `innerWidth×innerHeight`, title → ch1, `stress()` 8 enemies + 44 bullets **60.0 fps** (4 samples × 120 frames), `placeholders()` empty, 0 console errors (the only warning came from calling `stress()` while the room was still loading). The project owner decided to **skip** the Safari/Firefox check and the real Telex test (2026-11-18) — the "Chrome/Safari/Firefox" acceptance is confirmed on Chrome only; the `event.code` WASD fix stays but has not been tested with a real IME.

---

## M8 — Visuals and juice

Agreed in the 2026-11-18 grill session (see GDD §13, ADR-014…017). **Do not change balance numbers**: hitbox, damage, AI, spawn stay the same; `run-simulation` must stay green without retuning. Branch `m8-visuals`, merge `master` (= deploy) when acceptance is met. Skills used: `game-feel`, `game-ui-ux`, `level-design`, `performance-optimization` (engine-neutral — map them to Cocos yourself).

**Work (in order).**
1. **Juice.** Screen shake on hit taken / boss slam, amplitude in whole texel multiples (keeps M7 integer scaling); squash/stretch for the player (direction change, hit taken) and enemies (hit by a bullet); muzzle flash; coins fly to the HUD when gold is picked up; damage numbers in the pixel font. Settings: **Screen shake** on/off (on by default), **Damage numbers** on/off (off by default).
2. **Weapon VFX.**
   - Player bullet sprite by strongest element (priority): Explosive → BigEnergyBall with orange tint, Freeze → IceSpike, Poison → PlantSpike, Homing → ShurikenMagic, Piercing → Kunai, default Shuriken. Sharpen ≥ 3 → Big variant (BigShuriken/BigKunai).
   - Trail of 2–3 ghosts (own pool), colored by element: fire orange, ice cyan, poison green, homing purple, crit yellow. Fps drops → 1 ghost.
   - Dedicated impact: crit (large Spark + white flash + longer hitstop), freeze (`Elemental/Ice`), poison (`Elemental/Plant` + bubbles), explosive (Explosion + SmokeCircular + shake), pierce (small `Attack/Cut`), ricochet (Spark at the bounce point + a tracer to the new target), execute (`Slash/Arc` + red flash), lifesteal (red particles flying back to the player).
   - The player plays `Attack` in 4 directions when **standing still** and firing; while running, keep walk + muzzle flash.
   - `Magic/Boost` on receiving a skill; `Magic/Aura` under the feet at ≥ 8 stacks or with an Epic+ skill, colored by strongest element.
   - **Shape language:** player bullets are pointed (shuriken/kunai/spike), enemy bullets round + dark outline, per chapter: ch1 EnergyBall, ch2 water bubble, ch3 CanonBall/Rock, ch4 Fireball (ADR-016).
   - Settings **Effects: Full / Reduced** — Reduced drops trails, auras, secondary particles; keeps impacts and telegraphs.
3. **Elite palette remap.** A build-time script generates elite PNG variants, remapped by index through `Palette.png` (53 colors) — replaces the M3 tint multiply (ADR-015).
4. **Skill icons.** 20 skills → 24×24 icons in `Ui/Skill Icon` (+ Disabled variant) for the HUD, skill pick cards, mid-run shop, door icons. The mapping is data, with a test for duplicates.
5. **Per-chapter atmosphere** with sprites + `Graphics` (no custom shaders — ADR-017): ch1 Raylight + flying leaves, ch2 Fog + water ripples, ch3 ash + vignette, ch4 heat/sand. **Living decor** with no collider, not covering bullets/telegraphs: `Animal/` critters, animated flags/trees/flowers.
6. **Re-dress ch3** (no more "torn paper") and the boss arena.
7. **Living menus.** Title + chapter select draw a real room from the chapter, NinjaGreen idle, critters, atmosphere layer.
8. **Small audio.** SFX variants (do not loop a single file) + room clear / skill received jingle.

**Acceptance.**
- `bun run check` green; new tests for: bullet sprite selection by loadout, shake in texel multiples, icon mapping, palette remap (output colors ⊂ palette), new settings round-trip through the save.
- `run-simulation` green **without changing `tuning.json`**.
- `stress()` **60 fps at 1920×1080** with Effects Full, a loadout with trail + aura; no deploy file > 25 MiB (drops M7's 15 MB ceiling).
- Readable: a bullet-filled screenshot — enemy bullets distinguishable from player bullets in every loadout; telegraphs not covered by decor/FX.
- 0 console errors on the title → ch1 → boss → result flow.

**Status: ✅ Done (2026-11-19).** Tickets #2–#9 merged (PRs #10, #13–#19) and deployed (`5c63f36`). `bun run check` green (922 tests incl. `run-simulation`); `tuning.json` only gained the new `feel` block, no balance number changed. `stress()` at 1920×1080 with Effects Full, trail + aura and the heaviest loadout: 59–60 fps (#16, #17). Largest deploy file 2.5 MB, whole build 8.9 MB (ceiling 25 MiB). 0 console errors on full chapter flows to the boss and back to title (#15, #18, #19). Each ticket has screenshots at 1920×1080 and/or 1280×720 (#13, #14, #17–#19). Verified on Chrome only.

---

## M9 — Content

Branch `m9-content`. Skills used: add `game-ai`, `roguelike`, `game-docs`, `camera-systems`, `level-design`, `performance-optimization`. New numbers go in `tuning.json` and are tuned by sim (ADR-013); a human approves the sim table, not each number.

**Work.**
0. **Solid props and collision (bugfix, do first).** Today the player and enemies only clamp to the room edge (`player-controller.ts`, `enemy-view.ts`), so they walk through rocks, pillars and walls; only bullets stop on `LevelData.obstacles`, and props the dress script paints (rocks, trees, houses) are not obstacles at all. Fix:
   - One prop catalogue per chapter: each prop has a sprite, a footprint in tiles and `solid: true|false`. The dress/generator script writes an obstacle for every solid prop it places, so what the player sees blocking is what blocks.
   - Player and enemies collide with solid obstacles (circle hitbox vs rect, resolved per axis so they slide along walls instead of sticking). Bullets (player and enemy) stop on solid obstacles; pits block walkers but not bullets (GDD §8).
   - Enemies **go around** obstacles: a shared flow field (Dijkstra from the player's tile on the nav grid, obstacles inflated by the enemy radius, 8-way with no corner cutting), rebuilt when the player changes tile and at most every 0.25 s; enemies follow it with steering + separation (spatial hash). Stuck guard: no progress for 2 s → re-pick a goal. Ranged enemies only fire with a clear line of sight (`firstHit` against solid obstacles), otherwise they reposition.
   - **Collider ≠ sprite.** A prop blocks only at its base: a tree at its trunk (about 1×1 tile at the bottom), a house at its walls on the ground, a rock at its full footprint. The catalogue stores the collider rect separately from the sprite rect.
   - Pure logic in `core/level/` (catalogue, nav grid), `core/movement/` (collision), `core/enemies/` (flow field, steering); `game/` only reads positions.
1. **More prop variety from the pack.** Per chapter at least 8 solid and 6 walk-over prop types (`[ASSUMPTION]`, tuned by screenshot review), from art not used yet: `TilesetNature` (trees, stumps, rocks, bushes), `TilesetElement` (boulders, statues), `TilesetVillageAbandoned` / `TilesetHouse` / `TilesetTowers` (ruins, fences, wells), `Vehicles/Boat` + `FishNet` (ch2), `TilesetDesert` + `tileset_camp` (ch4: cactus, bones, tents, logs), `Items/Object/CrateEmpty`, `Items/Resource/Rock`, `Backgrounds/Animated` (`WaterMill`, `MillPropeller`, `Flag`, `Plant` as animated props). Props are decor or obstacles only, no new mechanics (no destructibles outside the boss arena).
   - **Houses and trees** are first-class props: houses (`TilesetHouse`, `TilesetVillageAbandoned`, `tileset_camp` tents) and trees (`TilesetNature`, several sizes) in every chapter where they fit the theme.
1b. **Depth, cover and see-through (visual only).**
   - **Y-sorting:** actors and prop bases sort by their foot y, so the player walks in front of a trunk when below it and behind it when above it.
   - **Canopies and roofs** are a separate overlay part of the prop, drawn above actors. When the player or an enemy is under it, the overlay eases to ~40% opacity (`[ASSUMPTION]`, `tuning.json` → `cover`) so the actor shows through; it eases back when they leave.
   - **Tall grass and bushes** are walk-in cover with no collider: an actor inside is drawn faded (~50%) with the grass tips drawn over its lower half, so it reads as hiding in the bush.
   - **Readability wins:** bullets, telegraphs, edge arrows and the HUD always draw above every overlay and are never faded (ADR-016, M8 rule).
   - **No stealth** (owner decision, 2026-11-22): cover is visual only — enemies still target a hidden player and the player still auto-targets a hidden enemy.
2. **Big rooms + follow camera** (ADR-018, GDD §13.2). Normal rooms are **128×72 tiles** (4× each side, 16 screens); boss arenas stay 32×18 with the static camera. The view keeps the M7 zoom (32×18 tiles, integer multiple), follows the player with a deadzone + eased look-ahead, is clamped to the room, snaps to whole texels after smoothing, hard-cuts on room entry, and shake rides on top. Camera numbers go in `tuning.json` → `camera`. Pure follow math in `core/camera/`.
3. **Room pool.** 15–18 rooms per chapter, each run draws 9 by run seed. Rooms generated by a `.tmx` script from a lean **128×72** template + the dress script (extends `scripts/dress-rooms.ts`; obstacle/decor density per screen, not per room); a human approves via screenshots (full-room overview + a few view-sized crops).
4. **Door choice.** After each normal room: 2 doors, each with a reward icon (skill / gold / heal / shop / chest). Boss room always last (ADR-014).
5. **Special rooms.** Heal (NPC), mid-run shop (NPC, **shares meta gold** — spend it in a run and you return with less), chest (`Items/Treasure`). NPCs come from `Actor/Character/`; NPCs only, never a player skin.
6. **Enemy count ×8 in waves.** Total enemies per normal room is 8× v1 (ch1 24–32, ch2 40–48, ch3 56–64, ch4 set by sim). They arrive in waves with at most **24 alive** at once. Fairness rules: enemies attack (fire, charge, pounce) only while inside the view; off-screen enemies inside the aggro radius walk toward the player, others idle; a spawn never lands inside the view without its telegraph, nor closer than 6 tiles to the player. Edge arrows point at off-screen enemies and, once the room is clear, at the doors; the HUD shows enemies left.
7. **New enemy roles**, present in ch1–4, sprites per chapter from unused monsters: **Sniper** (stands far away, ~800 ms line telegraph, 1 fast shot), **Splitter** (on death splits into 2–3 smaller ones, tinted).
8. **Boss pool** (random 1 of 2 by seed), unique music per boss: ch1 Tengu / GiantFrog · ch2 Squid / GiantSlime · ch3 Samurai / GiantBamboo · ch4 GiantRacoon / color-variant Tengu (stronger pattern). New bosses follow the M4 bar: 3 phases, tint + telegraph color + banner, each phase ≥ 1 pattern that forces movement.
9. **Chapter 4 — desert** (`TilesetDesert` + `tileset_camp`), unlocked after ch3. Save bumps `version` + migration.

**Acceptance.**
- Tests (cover): a tree blocks only at its trunk collider (the player can stand under the canopy); depth order follows foot y; the overlay opacity target is faded exactly while an actor overlaps the canopy/roof rect, and actors inside grass get the faded alpha; bullets and telegraphs sort above every overlay.
- Tests (collision): the player and every enemy role, pushed into each solid obstacle kind from 8 directions, never end inside it and slide along it; every solid prop the dress/generator places has a matching obstacle (and no obstacle without a visual); bullets stop on solid obstacles, pass over pits; an enemy behind a wall reaches the player by going around it (flow-field path length within 1.2× the A* optimum), and no enemy makes < 0.5 tiles progress in 2 s in a headless run of every generated room; a caster with no line of sight does not fire.
- Tests: camera view never leaves the room rect, follow lag is the same at `dt = 1/30` and `1/144` (frame-rate independent), the view is texel-aligned, shake does not move the follow target, the boss room keeps the static camera; enemies outside the view never fire; alive count never exceeds the cap and the room total is 8× v1; room draw is deterministic per seed and has no duplicates within a run; every generated 128×72 room is traversable from spawn to every door, solid props are obstacles, spawns do not overlap obstacles; door rewards follow the seed; shop deducts gold correctly + blocks when short; splitter splits into the right count; sniper telegraphs before firing; new bosses still hit a player standing at `playerStart` in every phase; save v1 → v2 migration.
- Sim (multiple seeds, both bosses per chapter): standing still loses room 1; dodging + a typical loadout wins all 4 chapters.
- Play ch1 → ch4 fully in the browser, 0 console errors; no visible camera jitter running along walls and into corners. 60 fps `stress()` at 1920×1080 with **24 enemies alive + their bullets, Effects Full, camera moving**; nodes outside the view + margin are culled. No deploy file > 25 MiB with all 128×72 `.tmx`.

History: 2026-11-22 — normal rooms 32×18 → 128×72 with a follow camera, enemies per room ×8 in waves (owner request, ADR-018). Same day: added solid-prop collision fix, enemies path around obstacles, more pack props; owner accepts a 30–60 min run. Then: houses and trees, trunk-only tree colliders, y-sorting, canopies/roofs that fade when an actor is under them, walk-in grass that shows actors faded (visual only, no stealth — owner decision). Skill pick per cleared room stays for M9; it will later become XP levels (level up → pick a skill), GDD §13.2. 2026-11-22 — normal rooms 128×72 → 64×36, speed 4 → 5 (#66).

**Status: ✅ Done (2026-11-22).** M9 tickets merged (#33–#45). Balance proven by sim (ADR-013) on unchanged `tuning.json`: `bun run sim:table` (24 rows, ch1–4, both pooled bosses, 3 seeds per boss) — standing still lost room 1 in 24/24, dodge + typical loadout won 9/9 in 24/24; table in `docs/research/2026-11-m9-sim-table.md`.

---

## M10 — Playable characters and weapons

Design: GDD §14. The art side (unarmed bodies, separate attachments, rig data) lands with ticket #20 in the pipeline; this milestone is the **game-side** work. No balance change: existing characters keep their baked attack sheets until they are migrated one at a time.

**Work.**
1. **Attachment node.** Add a child node to the player renderer that draws one attachment sprite on top of (or behind) the body, using `core/art/attachments.ts` (`placeAttachment`) for the offset and draw order. Giant body sheets keep their existing baked weapon.
2. **Draw order per direction.** Apply the `hand`/`back` rules from GDD §14 (and the item's `behind` override) whenever the facing or frame changes; the attachment follows the bob recorded in `attachments.json`.
3. **Hide/show on skill events.** Expose a hide flag on the attachment node so a skill can hide a worn item while its own effect is on screen (the cultivator's “Ten Thousand Swords” case), and restore it when the effect ends. Projectile weapons never create an attachment node.
4. **Character select.** Data-driven roster: each playable character is a body sheet plus its default loadout; the title screen picks one and the run stores the choice in the save. One character per run, no mid-run swap.
5. **Migrate the first character** (the cultivator: unarmed body + `back` sword) behind a settings/data flag, leaving the current character as the default until the new one passes the same acceptance.

**Acceptance.**
- Tests: `placeAttachment` is already covered; add the node-level cases — a `hand` item is behind only facing `up`, a `back` item behind for every other direction, an item `behind` list wins, the offset includes the bob for frame `n`, hiding and showing on a skill event restores the same offset.
- A migrated character reads correctly at 1920×1080 in all four directions while idle and while moving: the sword stays on the back, never floats or clips the head, and is not visible during the skill's effect.
- Character select round-trips through the save (`version` bump + migration), and a run started with each roster entry reaches the chapter boss with 0 console errors.
- `bun run check` green; `run-simulation` green **without changing `tuning.json`** (a different body must not change hitbox, damage or spawn numbers).

**Status: ✅ Done (2026-11-26).** Landed on `m10-characters`. `bun run check` green (97 test files / 1274 tests incl. `attachment-node`, `characters-roster`, save v3 migration, and `run-simulation` on unchanged `tuning.json`). Optional `player-attachment` child node sits alongside `player-body` under a sprite-free `player` container (never created for projectile weapons), applying per-direction `hand`/`back` and `behind` draw order, per-frame bob from `attachments.json`, and skill hide/show (`hideAttachmentForSkill`/`showAttachmentForSkill`). Data-driven roster (`ninja` default, `cultivator` gated behind Settings `cultivatorEnabled`) wired through Title character select (locked for the whole run), living menu backdrop, and save v3 (`v1`/`v2` → `v3`). Cocos 3.8.8 `web-desktop` build + Chrome verification at 1920×1080, 1280×720, and 1024×768: 0 clipped/overflow labels, 4-direction idle/moving Cultivator `sword-back` placement and skill hide/show verified visually, and both Ninja and Cultivator reached the Chapter 1 boss with `placeholders()` empty and 0 console errors. Honest limitations: Cultivator falls back to `idle` for `walk`/`attack`/`hit`/`dead` until additional clips are authored; `game/deploy/` not rebuilt/pushed yet.

---

## Dependencies

```text
M0 → M1 → M1.5 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10
```

No milestone starts before the previous one meets acceptance. Exception: downloading the Update #8 pack and building the dungeon tile set can run in parallel with M0–M1.

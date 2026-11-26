# M11 Plan — Visual Overhaul: Map, Weather & UI

Design source: [gdd.md](../gdd.md) §15.1, [milestones.md](../milestones.md) (M11), [tech-decisions.md](../tech-decisions.md) (ADR-019, ADR-020).
Agreed in the 2026-11-26 grill session after inspecting live build screenshots (`95484a3`) alongside the Ninja Adventure demo scenes.

## Common rules for every ticket

- Gates: `cd game && bun run check` green; `bun run sim:table` green when room geometry/obstacles change (Ticket 2 / 3).
- Pure logic in `game/assets/scripts/core/` with vitest tests (`no-restricted-imports` forbids `cc`); Cocos components in `game/assets/scripts/game/` stay thin adapters.
- Art strictly from `art-source/ninja-adventure/` (CC0, gitignored) — no AI-generated sprites needed in M11.
- Browser proof on a real Cocos `web-desktop` build (`?debug=1`) at **1920×1080** and **1280×720**, 0 console errors, `placeholders()` empty; `stress()` holds **60 fps** at 1920×1080 with Effects Full.
- **Do not commit `game/deploy/`** in feature tickets; only the final deploy ticket rebuilds and ships `game/deploy/`.

---

## Ticket dependency graph

```text
T1 (Weather particles 1:1 & drop overlays) ──┐
T2 (Ch2 real rivers + bridges & nav/sim) ────┼──▶ T5 (Menu UI & backdrop) ──┐
T3 (Ch3 mossy ruins + Ch1/Ch4 cluster art) ──┤                              ├──▶ T7 (Visual proof, sim gate & deploy)
T4 (HUD high-contrast overhaul) ─────────────┴──▶ T6 (Enemy buff retune)  ──┘
```

*(T1–T4 can run largely in parallel; T5 benefits from T1–T3 landing so the living menu backdrop shows the upgraded rooms & weather; T6 runs after T2–T3 so the final `tuning.json` retune and `sim:table` prove balance on the exact new Ch2 bridged maps.)*

---

## T1 — Rebuild chapter weather at 1:1 pixel scale & remove ugly overlays

**Goal (ADR-019).** Remove `raylight`, `fog`, `vignette`, and `heat-haze` completely; replace with crisp 1:1 pixel-scale particles matching the Ninja Adventure demo GIFs.

**Scope & files.**
- Stage particles in `game/scripts/stage-atmosphere.ts` + `game/assets/resources/data/animations.json`:
  - `art-source/ninja-adventure/FX/Particle/Leaf.png` (6 frames, green)
  - `art-source/ninja-adventure/FX/Particle/LeafPink.png` (6 frames, cherry blossom)
  - `art-source/ninja-adventure/FX/Particle/Rain.png` (diagonal rain streaks)
  - `art-source/ninja-adventure/FX/Particle/RainOnFloor.png` (3-frame ground splash rings)
  - `art-source/ninja-adventure/FX/Particle/Clouds.png` (soft ground cloud shadow blobs, `under-actors`)
  - Crisp 1:1 ash/dry-leaf & desert sand sprites + animated campfire/smoke prop (`FX/Elemental/Flam` + `FX/Smoke/Smoke` or pack campfire) for Ch3.
- Update `game/assets/scripts/core/atmosphere/atmosphere.ts` and `game/assets/resources/data/atmosphere.json`:
  - Remove `raylight`, `fog`, `vignette`, `heat-haze` from `ATMOSPHERE_LAYER_KINDS` and config.
  - Configure per-chapter layers:
    - **Ch1**: `leaves` + `blossoms` (`over-actors`, 1:1 pixel scale, full opacity, diagonal wind + flutter) + `cloud-shadows` (`under-actors`, subtle dark alpha drifting across ground).
    - **Ch2**: `rain` (fast diagonal streaks) + `rain-splash` (`under-actors` popping rings across walkable ground) + `ripples` (on water).
    - **Ch3**: crisp 1:1 `ash` / dry leaves + smoking campfires as living decor props.
    - **Ch4**: crisp 1:1 `sand` gusts (diagonal bursts) + `cloud-shadows` (`under-actors`).
- Update `game/assets/scripts/game/atmosphere-view.ts`:
  - Remove `Graphics` vignette/heat-haze code paths and old `raylight`/`fog` styles.
  - Size all weather particles strictly via `ACTOR_SCALE` (1 texture px = 1/16 tile) — never crush to `0.45` tiles or wash out to `0.38` alpha.
  - Keep single-component pooled clock; respect `Effects: Reduced` (drops secondary layers/cloud shadows while keeping core readability).

**Acceptance.**
- Unit tests in `game/tests/core/` confirm removed layer kinds fail schema validation, new kinds parse cleanly, and `Effects: Reduced` filters secondary layers.
- `art-files.test.ts` passes for all newly staged particle PNGs.
- Visual check: Ch1 leaves/blossoms & cloud shadows, Ch2 rain + ground splashes, Ch3 ash + campfires, Ch4 sand gusts — crisp pixel art, never hiding bullets/telegraphs, 60 fps in `stress()`.

---

## T2 — Chapter 2 real impassable rivers, shorelines & bridges

**Goal (ADR-020).** Replace Chapter 2's flat blue T-bar strips with natural bordered rivers/waterfalls backed by `pit` obstacles (blocks walkers, bullets pass over) crossed by wooden/stone bridges.

**Scope & files.**
- `game/scripts/lib/room-pool.ts`, `game/scripts/dress-rooms.ts`, `game/scripts/generate-rooms.ts`:
  - Generate natural river courses and waterfall pools with grass/stone bank transitions (`TilesetNature` / `TilesetRelief` edge tiles) around water areas instead of bare straight cuts.
  - Emit `kind: "pit"` obstacle rects for deep water tiles **excluding** bridge tiles; render wooden/stone bridge deck tiles cleanly over the river crossings.
  - Ensure every Ch2 room has ≥ 2 wide bridge crossings (≥ 3 tiles wide so enemies and player do not deadlock) connecting `playerStart`, all enemy spawn pockets, and both exit doors.
- `game/assets/scripts/game/room-water.ts` + `game/assets/resources/data/water-layout.json`:
  - Break up uniform grid repetition of water ripples (staggered phase/offset) and align waterfall splash foam cleanly with the pool bank.
- Regenerate Ch2 `.tmx` rooms + `water-layout.json`.

**Acceptance.**
- Geometry & nav tests pass for every Ch2 room: `spawn → every door` walkable on the nav grid, no spawn inside water `pit`, enemy flow-field makes progress with 0 stuck enemies over headless runs, player bullets cross `pit` while player/enemies are blocked by water and cross bridges smoothly.
- `bun run sim:table` passes all Ch2 rows (standing still loses Room 1; dodge + typical loadout wins 9/9 for both Ch2 bosses).

---

## T3 — Chapter 3 mossy ruins palette & Ch1/Ch4 cluster composition

**Goal.** Eliminate flat brown-gray Ch3 dirt and scattered salt-and-pepper noise across Ch1, Ch3, and Ch4; compose rooms in intentional clusters matching the Ninja Adventure demo scenes.

**Scope & files.**
- `game/scripts/lib/room-pool.ts`, `game/scripts/dress-rooms.ts`, `game/config/tuning.json` (`roomArt` if density params change):
  - **Ch3 (Abandoned Village):** switch primary ground fill from flat gray-brown dirt to **mossy olive grass (`TilesetNature` / `TilesetVillageAbandoned`) with worn dirt paths**; group mossy houses, watchtowers, fences, crates, and overgrown trees into ruin clusters around clear combat courtyards; add smoking campfire POIs (paired with T1).
  - **Ch1 (Grassland/Forest):** build dense overlapping tree-cluster borders framing natural clearings; group village houses with fences, barrels/crates, and carts into cozy edge yards instead of isolated rows; cut random mid-field pebble/flower scatter so open fight lanes read cleanly.
  - **Ch4 (Desert):** soften visual noise (fewer scattered random bones/skulls), group palm trees + sand-bordered oasis pools and fortified outpost/tent clusters cohesively.
- Regenerate Ch1, Ch3, Ch4 `.tmx` rooms.

**Acceptance.**
- All room geometry, prop-to-obstacle parity, cover/canopy, and traversability tests green across Ch1, Ch3, Ch4.
- `bun run sim:table` green across all 4 chapters.
- Side-by-side contact sheet saved to `docs/research/2026-11-m11-screens/` showing Ch1–Ch4 rooms visibly improved over `docs/research/2026-11-67-room-art/`.

---

## T4 — In-game HUD high-contrast overhaul (with M12/M13 layout reserve)

**Goal (`game-ui-ux`).** Make every HUD element immediately legible over every chapter background (especially bright Ch4 sand) with zero roof/prop overlap, while reserving clean anchor slots for M12's XP bar and M13's Dash/Active icons.

**Scope & files.**
- `game/assets/scripts/game/hud.ts`, `game/assets/scripts/game/hud-sync.ts`, `game/assets/scripts/core/view/` (layout helpers if pure math is extracted):
  - Wrap top-left (Hearts + Gold with real `GoldCoin` pixel icon) and top-right (Room `x/9` + Enemies remaining with icon) in compact, pixel-sharp dark/wood backing plates (`Theme Wood` 9-slice or crisp dark semi-transparent panel with 1px pixel border) scaled cleanly via `WorldCamera.hudScale`.
  - Keep bottom-center / bottom-left safe bands clear for the upcoming M12 XP bar and M13 Dash/Active widgets.
  - Drive updates strictly on state-change events (`hud-sync.ts`), no redundant per-frame label rebuilds.

**Acceptance.**
- Unit tests for HUD layout anchoring / safe bounds across 16:9, 16:10, and 4:3.
- Browser verification (`uiText()`): 0 clipped/overflow labels at 1920×1080, 1280×720, 1280×800, 1024×768; visually verified readable on Ch1 grass, Ch2 river, Ch3 ruins, and Ch4 bright sand.

---

## T5 — Menu UI polish & living backdrop framing

**Goal (`game-ui-ux`).** Upgrade Title, Chapter Select, Meta Shop, Settings, Pause, Skill Pick, and Result screens from flat brown/orange rectangles to cohesive `Theme Wood` pixel-art UI with balanced typography and cleaner living-room framing.

**Scope & files.**
- `game/assets/scripts/game/screens/menu.ts` and screen builders (`title-screen.ts`, `chapter-select.ts`, `shop-screen.ts`, `settings-screen.ts`, `pause-screen.ts`, `result-screen.ts`, `skill-pick.ts`):
  - Use crisp `Theme Wood` 9-slice frames/buttons (`loadPixelTexture` nearest filtering + proper insets) with distinct normal / hover / focus / disabled visual states and comfortable internal padding so subtitles never touch borders.
  - Improve button label/subtitle contrast and spacing (preventing cramped text like `Choose a chapter` / `Default ninja (Settings to unlock)`).
  - Refine `game/assets/scripts/game/menu-backdrop.ts` so the living chapter scene behind Title / Chapter Select shows the upgraded M11 room + weather cleanly without jarring framing.

**Acceptance.**
- All existing menu navigation/focus tests stay green (mouse hover/click + keyboard arrows/Enter/Esc + focus trap).
- Browser audit across all screens at 1920×1080, 1280×720, 1280×800, and 1024×768: 0 clipped/overflow labels (`uiText()`), 0 console errors.

---

## T6 — Enemy difficulty retune (Tier 1) & boss room entrance bugfix

**Goal.** Eliminate the post-`#66` 0-hit cakewalk (19/24 sim rows taking 0 hits) and fix the bug where bosses spawn/act immediately on top of the player on room entry.

**Root causes verified in code.**
- `#66` raised player speed `4 → 5 tiles/s` while over-nerfing enemies (`tank.chargeSpeed 7 → 4`, slower than player walk; `chaser.speed 3.2 → 2.6`; `caster` cooldown `900 → 3000 ms`; `sniper` cooldown `1800 → 4000 ms`; flat `enemyHealthMultipliers [1, 1.05, 1.05, 1.1]`; low `aliveCapStart = 3`).
- **Boss entrance bug:** `CombatLoop.nowMs` accumulates across rooms 1–8 (`~300,000 ms`), while `initialBossState()` sets `stepStartedMs = 0`, so on frame 1 of the boss room `nowMs - stepStartedMs` is huge and the boss immediately skips its opening step / attacks with zero warning. In addition, Ch3 & Ch4 `room-17.tmx` place `playerStart (27, 6)` and `bossStart (16, 6)` on the exact same row, and Ch2 `bossStart (16, 8)` sits too close to `playerStart (16, 16)`.

**Scope & files.**
- **Boss entrance & spacing fix:**
  - `game/assets/scripts/core/boss/patterns.ts` + `game/assets/scripts/game/boss-view.ts` + `game/assets/scripts/game/combat-loop.ts`: pass `nowMs` into `initialBossState(id, position, nowMs)` and add a short **~1.0 s boss intro / entrance grace window** (banner + boss visible/idle, no attacks/teleports/contact lunge until intro finishes).
  - Normalize `playerStart` and `bossStart` in all 4 `chapter-*/room-17.tmx` boss arenas to opposite ends (e.g. player at bottom-center `(16, 15.5)`, boss at top-center `(16, 4.5)`, enforcing **≥ 10 tiles** initial separation in level validation tests).
- **Enemy difficulty retune (Tier 1):**
  - Update `game/config/tuning.json` + run `bun run gen`:
    - Restore Tank charge speed above player walk speed (`~6.5–7 tiles/s`), raise Chaser / Splitling / Elite closing speeds, shorten Caster / Tank / Sniper attack cooldowns, increase opening wave density (`aliveCapStart`), and apply a real Ch1 → Ch4 health & Elite scaling curve + Boss HP adjustment.
  - Target: **challenging roguelite** — fresh 0-Meta runs risk death in Ch1–Ch2 on sloppy dodging; Ch3–Ch4 feel genuinely intense; `dodge + typical loadout` wins 9/9 across Ch1–Ch4 under real pressure (no longer 19/24 0-hit runs).

**Acceptance.**
- Unit tests: `initialBossState` honors non-zero `nowMs` (boss does not skip step 0 when entering after 300 s of play); boss intro grace blocks attacks for the intro window; all 4 boss arenas enforce `distance(playerStart, bossStart) >= 10` tiles.
- `bun run check` green; `bun run sim:table` green across all 24 rows with before/after table recorded in `docs/research/2026-11-m11-sim-table.md`.

---

## T7 — Full M11 visual acceptance, sim gate & deploy

**Goal.** Verify all M11 tickets together on a release `web-desktop` build, capture final before/after screenshots, run the full balance sim table, update `docs/milestones.md`, and deploy.

**Scope.**
- Run `cd game && bun run check` and `bun run sim:table` (verify all 24 rows green; save updated sim table to `docs/research/2026-11-m11-sim-table.md`).
- Build release web-desktop with Cocos Creator 3.8.8 CLI (expect exit code 36).
- Verify in headless/live Chrome at 1920×1080 and 1280×720:
  - Title → Chapter Select → Ch1, Ch2, Ch3, Ch4 rooms + boss (confirm boss spawns ≥ 10 tiles away with intro grace!) → Pause → Shop → Settings → Result; 0 console errors, `placeholders()` empty, 0 clipped labels.
  - `stress()` holds 60 fps at 1920×1080 with Effects Full (including Ch2 rain + splashes and Ch1 leaves + cloud shadows).
- Save proof screenshots to `docs/research/2026-11-m11-screens/`.
- Run `bun run deploy:prepare` (verify largest file < 25 MiB), mark M11 Done in `docs/milestones.md`, commit and ship.

# Tech decisions — Yokai Field v2

Technical decision record. Each entry is a short ADR: decision, rationale, consequences.
Agreed: 2026-11-15. Status: settled, reopened only with new evidence.

---

## ADR-001 — Engine: Cocos Creator 3.8.8, web-desktop only

**Decision.** Use Cocos Creator **3.8.8** (LTS, released 2025-12-16). Do not use 4.0 (the latest is only `4.0.0-beta.2`, 2026-11-13; the official download page only offers 3.8.x). Sole target: **web-desktop**.

**Rationale.** 3.8 is the only stable release; web is Cocos's strongest platform; dropping mobile/mini-game avoids handling touch + mobile layout from the start.

**Consequences.** No native build. Input = mouse + keyboard. Save = `localStorage`. Resolution must use pixel-perfect scaling.

---

## ADR-002 — Rewrite from scratch, no parity port

**Decision.** No 1:1 port of the Unity codebase. New genre: **single-screen bullet-dodging roguelite** (Archero reference). The player auto-fires, the skill is movement; clear a room → pick 1 of 3 skills; death ends the run, gold is kept for permanent upgrades. 3 chapters × (8 rooms + 1 boss per GDD §5). Drop hub, NPCs, dialog, inventory. Details in `docs/gdd.md`.

**Rationale.** The audit showed the old content was very thin (Level1 = 14 scattered mobs, damage hardcoded to 1, no state machine). Nothing worth keeping as a baseline, so a genre change costs nothing extra.

**Consequences.** Single-screen room ⇒ **no camera follow, no large maps** (reversed for normal rooms in M9 by ADR-018). New systems to build: skill pool, rarity, meta progression, meta save. Systems dropped: dialog, inventory, in-level shop, hub. Technical numbers (16px, animation cadence, audio) are preserved in `docs/research/2026-11-unity-content-audit.md`.

---

## ADR-003 — Repo: Cocos at root, Unity deleted, tag kept

**Decision.** Tag `unity-final` on the last Unity commit, then force-push a clean repo containing only the Cocos project at the root. Drop Plastic SCM, use git only.

**Rationale.** A lean repo is easier for the agent; the tag is enough to go back without a separate branch/backup. Plastic is unnecessary when it is one person plus an agent working through git.

**Consequences.** No more `.plastic/`, `ignore.conf`, `Assets/`, `Packages/`, `ProjectSettings/`. Do not delete until the 3 documents in `docs/` exist (see ADR-011).

---

## ADR-004 — Architecture: pure TS core + Cocos adapters

**Decision.** All logic (stats, combat math, inventory, save, level data) lives in `assets/scripts/core/` and **must not import `cc`**. `cc` components in `assets/scripts/game/` are thin adapters only: read input, call core, assign sprite/transform. UI lives in `assets/scripts/ui/`.

**Rationale.** Cocos docs confirm the compiler **skips TypeScript type errors** and `tsconfig.json` is not read at compile time. The CLI also has no headless authoring. If logic lived in components it would be untestable, and the agent would get no feedback except by opening the editor.

**Consequences.** `tsc --noEmit` + vitest are mandatory. The "`core` must not import `cc`" boundary is enforced (eslint rule `no-restricted-imports`).

---

## ADR-005 — Level pipeline: TiledMap rendering + pure TS LevelData

**Decision.** Maps are `.tmx` (orthogonal, 32×18 tiles of 16 px) at
`game/assets/resources/data/levels/chapter-<n>/room-<r>.tmx`, with `.tsx` in the same directory.
Cocos `TiledMap` renders the tile layers. The object layer is parsed by **one** pure-TS parser
(`core/level/tmx.ts`) into `LevelData`; at runtime it pulls the XML from `TiledMapAsset.tmxXmlStr` and
calls the same function vitest uses, so a broken file cannot slip past `bun run check`.

**Conventions** (single source: the header comment of `core/level/tmx.ts`):

- Map properties: `chapter` int 1..3, `room` int ≥ 1, `isBossRoom` bool (default false),
  `boss` string = `spriteName` in `BOSSES` (boss rooms only).
- Object layer (identified by `name`):
  - `playerStart` — point, exactly 1.
  - `spawn` — point; properties `role` (chaser/caster/tank), `wave` (int ≥ 1), `elite` (bool).
  - `obstacle` — rect; property `kind` (pillar/wall/pit).
  - `door` — point; property `toRoom` (int ≥ 1), missing = last door of the chapter (`null`).
  - `bossStart` — point, optional, boss rooms only (default 16,5).
  - Any other object name ⇒ error, so typos are never silently skipped.
- Object coordinates are **Tiled pixels** (16 px/tile); the parser converts to tile units.
- Tile layers are for drawing only (`encoding="csv"`); collision/obstacles are **not** derived from tiles.
- Adding a room = adding a `.tmx`. Bootstrap `resources.loadDir`s the whole directory, sorted by `room`,
  and `RunState` takes the room total from data — drop in `room-10.tmx` and the HUD shows `x/10`,
  no code change.

**Rationale.** Cocos has no native TileMap, only TiledMap/TMX; there is no tilemap import path
from Unity. Separating LevelData keeps headless testability while still using the official component;
a single parser removes the chance of tests and runtime reading the file differently.

**Consequences.** No Circle/Edge colliders like Unity — collision is box/polygon or
tile-based; currently only axis-aligned rectangles are used (object `rotation` must be 0).
Tilesets must be in the asset DB (PNG import Type = sprite-frame) and `.tsx` must sit in the same
directory as `.tmx`, referenced by bare filename (`source="field.tsx"`): the importer stores that
exact string as the key and the engine looks up `tsxContentMap[source]` **with no fallback** unlike images.

---

## ADR-006 — Art contract: logical-name manifest

**Decision.** Code never references sprite filenames. Every animation is accessed through a logical name in `assets/resources/data/animations.json` (`player.idle.down`, `enemy.grunt.attack`), with a `fallback` when the pack lacks it.

**Rationale.** Lets M1→M5 be built with placeholders and art swapped in at M6 without touching logic.

**Consequences.** The manifest must be validated by a test (every key used by code exists or has a fallback).

---

## ADR-008 — Combat numbers

**Decision.**
- WASD movement in 8 directions, **no dash**, no attack/fire buttons.
- **Auto-fire at 2 shots/s, firing even while running**, auto-targets the nearest enemy in range.
- Bullets: 1 projectile, damage 1, speed 12 tiles/s.
- Player 6 hearts; takes 1 damage; **i-frame 0.8 s**; knockback 3 px.
- Enemy: 70 ms hitstop on hit, 150 ms stagger; 500 ms telegraph (caster) / 700 ms (brute).
- Bosses per GDD §5: Tengu 60 / Squid 80 / Samurai 100 health, 3 phases (100–66 / 66–33 / 33–0%).

Full tables: `docs/gdd.md` §3–§5. All numbers live in `src/core/config`, with tests.

**Rationale.** "Feels better" can only be verified with numbers; and in a roguelite these numbers are the input to skill balance, so they must be separated from logic.

**Consequences.** Archero's "stand still to shoot" rule is gone ⇒ difficulty must come from bullet density and mob count. If playtests feel flat, add it back as a skill rather than changing the core rule.

---

## ADR-009 — Code-first, art later, with a taste test

**Decision.** Build with placeholders (coloured rectangles + fake animation) from M1. Attach real tilesets + the player sprite at **M1.5** to approve the art direction. Swap everything at M6.

**Rationale.** Art depends on licensing and on the pack existing — it cannot gate code. But leaving art until M6 kills motivation, so an early visible milestone is needed.

**Consequences.** M1.5 is a required milestone, not optional.

---

## ADR-010 — Gates and CI

**Decision.** `tsc --noEmit`, `vitest`, `eslint` + `prettier` run on every push via GitHub Actions. **No** web build in CI (the build needs the editor GUI).

**Rationale.** Cocos skips type errors; without a gate, type errors only blow up at runtime. A web build in CI would require installing the editor on the runner — too heavy, deferred past M7.

**Consequences.** `bun run check` is the only command the agent needs to run before reporting done.

---

## ADR-011 — Conditions for deleting Unity

**Decision.** Delete `Assets/`, `Packages/`, `ProjectSettings/`, `.plastic/` only after the following files exist and are committed:
1. `docs/research/2026-11-unity-content-audit.md` ✅
2. `docs/gdd.md`
3. `docs/tech-decisions.md` (this file)
4. `docs/milestones.md`
5. ~~`docs/art/asset-pack-shortlist.md`~~ — deleted after choosing Ninja Adventure

**Rationale.** Avoid irreversible data loss before there is anything to replace it with.

**Consequences.** The `unity-final` tag must be created **before** deleting.

---

## ADR-012 — Save: meta only, runs are not saved

**Decision.** `localStorage`, 1 slot, versioned schema: `gold`, `upgrades{hp,damage,firerate}`, `chaptersUnlocked`, `best{chapter,room}`, `settings{volume,fullscreen}`. **No** saving of the in-progress run.

**Rationale.** The project owner chose no run resume: dying or closing the tab loses the run. The schema is small so no complex migration is needed; `version` is kept to leave room for later.

**Consequences.** No need to serialize state between rooms. The entire "run state" lives in RAM and is wiped on reload.

---

## ADR-013 — Tuning numbers live in `game/config/tuning.json`, and simulation is the balance gate

**Decision.** Every tuning number (combat, enemy, spawn) lives in `game/config/tuning.json` — **outside `assets/`**, so Cocos does not treat it as asset DB content. `scripts/gen-tuning.ts` reads the JSON, validates it with `core/enemies/tuning-schema.ts`, then generates `assets/scripts/core/enemies/tuning.generated.ts` (a plain TS module, `as const`). Game code reads through `core/enemies/tuning.ts` and `core/config.ts` and keeps no constants of its own. `core/sim/run-simulation.ts` is the measurement tool: it runs a whole chapter on pure core, no engine needed.

**Rationale.** A simulation check found the player **could stand still and still win chapter 1 without losing health** — a bug unit tests cannot see, and one that would only surface after the scene was built. Separating numbers from code allows retuning via JSON and re-measuring in seconds. JSON is not imported directly because everything under `assets/` is asset DB content, and there is no CLI way to verify that a JSON import survives the editor's script bundling step; a TS module definitely does.

**Consequences.** A balance change = edit `config/tuning.json` then run `bun run gen`; `bun run check:config` (the first step of `bun run check`) fails if the generated file drifts from the source. A balance change must come with a sim run showing before/after numbers. Integration tests hold the thresholds: standing still loses, dodging survives ≥2× longer, god-mode still wins within 60–180 s. If a threshold breaks, that is a design signal, not a broken test.

---

## ADR-014 — Branching runs: pick 1 of 2 doors, seeded room pool

**Decision.** M9: each chapter has a pool of 15–18 rooms, a run draws 9 using the run's seeded RNG; after each normal room the player picks 1 of 2 doors showing a reward icon (skill / gold / heal / shop / chest). The boss room is fixed at the end. Rooms are generated by a `.tmx` script (template + dress), not drawn by hand in Tiled.

**Rationale.** v1 had 9 fixed rooms so runs felt the same; door choice is the change that buys the most difference per unit of effort. The agent cannot use the Tiled GUI, and 60–70 hand-drawn rooms cannot be verified by tests.

**Consequences.** Room/reward draw logic lives in `core/run/` with seed-deterministic tests. There must be geometry tests for every generated room (spawn → door is walkable, solid props = obstacles, spawns do not overlap obstacles). The balance sim must model door choice too.

---

## ADR-015 — Elites are palette-remapped PNGs, generated at build time

**Decision.** Elite variants are pre-generated by a script: map each sprite colour to another colour in `Palette.png` (53 colours) via an index table. No multiplicative tint, no shader.

**Rationale.** Multiplicative tint (M3) drifts off the pack palette; custom shaders in Cocos 3.8 are effortful and risky for web builds. The remap script is testable with vitest using the `scripts/lib/png.ts` decoder.

**Consequences.** Adds PNGs to `resources/art` (slight size increase — the 15 MB cap was dropped at M8). Test: every output pixel belongs to the palette. Regenerate with `cd game && bun run gen:elites`; the tables live in `game/config/elite-palette.json` and `gen:anim` keeps the elite keys.

---

## ADR-016 — Player bullets pointed, enemy bullets round

**Decision.** Player bullets are always pointed shapes (shuriken, kunai, spike); enemy bullets are always round with a dark outline (EnergyBall, bubble, CanonBall/Rock, Fireball). The player's Explosive uses BigEnergyBall tinted orange because Fireball belongs to the ch4 enemy bullets.

**Rationale.** From M8 the player bullet colour changes with the build, so colour no longer separates friend from foe. Shape is the remaining readable channel on a bullet-filled screen.

**Consequences.** Every new projectile must follow this rule; reviewing a “screen full of bullets” screenshot is an M8 acceptance item.

---

## ADR-017 — Atmosphere via sprites/Graphics, no custom shaders; the budget is fps, not MB

**Decision.** Chapter atmosphere layers (sunlight, mist, ash, heat), trails and auras use sprites from the pack + `Graphics`, pooled up front. The M7 15 MB build cap is dropped; the remaining gates are: `stress()` at 60 fps at 1920×1080 with Effects Full, and no deploy file > 25 MiB (Cloudflare static assets limit). There is an Effects Full/Reduced setting.

**Rationale.** A room is one screen with a static camera — a sprite overlay looks good enough and carries no shader build risk. Web players do not feel a few MB, but they feel an fps drop instantly in a bullet-dodging game.

**Consequences.** `deploy:prepare` switches the gate from “total > 15 MB” to “file > 25 MiB”. Every new FX goes through the pool (`fx/effect-pool.ts`), never `SpriteAnimator` for FX.

---

## ADR-018 — Big rooms with a follow camera, 8× enemies in waves (M9)

**Decision.** Normal rooms grow from 32×18 to 128×72 tiles; the view stays 32×18 tiles at the M7 integer zoom and follows the player (hand-rolled: deadzone, look-ahead eased with `1 - exp(-rate·dt)`, view clamped to the room, snapped to whole texels after smoothing, shake added last, hard cut on room entry). Boss arenas stay single-screen with the static camera. Enemies per normal room are 8× v1, in waves capped at 24 alive; enemies only attack while inside the view.

**Rationale.** Owner request (2026-11-22) to raise difficulty and give rooms space to explore. Keeping the zoom keeps 16 px readability; the alive cap and on-screen-only attacks keep 60 fps and keep the bullet-dodging fair (no hits from bullets fired off screen). Bosses keep one screen because their patterns are designed to be seen whole.

**Consequences.** Overrides ADR-002's "no camera follow, no large maps" for normal rooms. New `core/camera/` (pure, tested) + a `game/` adapter that moves the world camera; HUD and atmosphere stay screen-space. Off-screen culling of world nodes, edge arrows, aggro radius, wave scheduler and spawn rules go in `core/`. Room generator, traversal tests, dress density and the balance sim all work on 128×72. The `stress()` gate becomes 24 enemies alive with the camera moving.

**Update 2026-11-22 (#66).** Normal rooms are **64×36** tiles (2×2 screens) instead of 128×72: the walk between fights was too long and enemies could spread too thin. Enemy counts per room, the alive cap and the follow camera rules above are unchanged; the player's base speed rises 4 → 5 tiles/s. Boss arenas stay 32×18. The decision above otherwise stands.

---

## ADR-019 — Weather particles at 1:1 pixel scale; drop full-screen overlays (M11)

**Decision.** Remove `raylight`, `fog`, `vignette`, and `heat-haze` from `atmosphere.json` and `atmosphere-view.ts`. Render all chapter weather particles (`Leaf`, `LeafPink`, `Rain`, `RainOnFloor`, ash/sand) at **1:1 pixel scale** (`ACTOR_SCALE` = 1/16 tile per texture pixel) and crisp full opacity with diagonal wind motion, optionally paired with soft drifting ground cloud shadows (`Clouds.png`, `under-actors`). Keep ADR-017's no-shader rule and `Effects: Full / Reduced` toggle.

**Rationale.** Visual inspection of live M10/#67 screenshots against the Ninja Adventure demo GIFs showed that oversized low-alpha `Raylight`/`Fog` sprites and `Graphics`-drawn `vignette`/`heat-haze` strips looked artificial and washed out the terrain, while 0.45-tile / 0.38-alpha leaves broke pixel consistency and nearly vanished.

**Consequences.** `ATMOSPHERE_LAYER_KINDS` in `core/atmosphere/atmosphere.ts` drops the four removed kinds and adds `rain`, `rain-splash`, `blossoms`, and `cloud-shadows`. All particles remain pooled under one component clock to hold 60 fps at 1920×1080.

---

## ADR-020 — Impassable rivers with bridges in Chapter 2 (M11)

**Decision.** Chapter 2 rivers are rendered with natural grass/stone shoreline banks and backed by `kind: "pit"` obstacles (blocking player and enemy movement while allowing projectiles to pass over, per GDD §8), crossed via explicit wooden/stone bridges whose tiles are clear of `pit` obstacles.

**Rationale.** The M6/M9 shallow-river rectangles looked like flat blue tape pasted over grass. Making water truly impassable with bridges gives Chapter 2 genuine visual grounding and tactical positioning without inventing a new obstacle kind.

**Consequences.** Room generation in `scripts/lib/room-pool.ts` must guarantee bridge placement connects `playerStart`, all enemy spawn zones, and every door; existing traversability, flow-field stuck tests, and `run-simulation` validate every Ch2 room.

---

## ADR-021 — Unified XP level-up skill acquisition with dedicated sub-seed (M12)

**Decision.** Skill picks trigger solely from XP level-ups (orbs dropped by enemies with magnetic pickup + room-clear auto-vacuum) rather than room clears; the `skill` door becomes an `xp` / Elite door. Skill rolls and gold Rerolls use a dedicated per-run skill-roll sub-seed, decoupled from combat RNG (crit/lifesteal/boss patterns).

**Rationale.** With 24–72 enemies per 64×36 room, a single skill pick at room end felt slow and disconnected from combat. Separating the skill-roll RNG stream eliminates the M4 debt where combat randomness shifted future card offers (per `.claude/skills/roguelike`).

**Consequences.** `tuning.json` gains an `xp` block targeting 12–16 level-ups/run; `core/run/doors.ts` replaces `'skill'` with `'xp'`; mid-combat resume applies a radial enemy knockback wave + 0.6 s i-frame (bullets stay live).

---

## ADR-022 — Active controls (Dash + Signature Skill) and pure-combat skill rebuild (M13)

**Decision.** Amend ADR-008: keep basic firing **100% auto-fire**, and add two discrete player actions routed through a **150 ms game-time action buffer** (`core/movement/` or `core/input/`): **Dash (`Space`)** with cooldown + brief i-frame, and **Signature Active Skill (`E` / Right-Click)** recharging via time cooldown accelerated by hits/kills. Rebuild `core/skills/pool.ts` into ~24–28 pure-combat skills (removing `Greed`, `Luck`, and all economy/XP/gold cards) plus 6–8 Legendary Evolutions unlocked by skill pairs.

**Rationale.** Active defensive/offensive windows deepen bullet-hell expression and give M14's four classes unmistakable identity (e.g. Cultivator's *Ten Thousand Swords*), while keeping every level-up card impactful in combat. Economy/magnet upgrades move cleanly to Meta Shop (M15).

**Consequences.** `core/skills/` expands with Evolution definitions and pairing metadata; `core/sim/run-simulation.ts` models Dash, Active Skill, and the rebuilt pool; all existing `Greed`/`Luck` references move out of the combat skill pool.

**Amendment (#108, 2026-11-28).** The Signature Active no longer accelerates its cooldown on hits or kills: each class ships a fixed **19–22 s** base cooldown (`characters.*.signature.hitCooldownReductionMs` / `killCooldownReductionMs` = 0), and the projectiles do **20% less** damage. Hitstop for a Signature cast is requested **once per cast** (`core/combat/hit-hitstop.ts`) instead of on every projectile hit.

---

## ADR-023 — Split profile and active-run saves with safe-boundary autosave (M15)

**Decision.** Revise ADR-012: persist two separate `localStorage` keys — **Profile Save** (meta progression, unlocks, settings, bests, with a `.bak` backup key for corruption fallback) and **Active Run Save** (plain JSON data: seed, chapter, room index, door choice, character, HP/XP/level, skills/evolutions, gold earned, elapsed time, ascension/endless loop). Autosave the active run **only at safe boundaries** (room entry / after door choice). Death deletes the Active Run Save immediately (strict permadeath).

**Rationale.** M9's 64×36 rooms extended runs to 30–60 minutes, making accidental tab closes punishing. Splitting profile vs run saves and avoiding mid-frame combat serialization prevents corruption while preserving permadeath (per `.claude/skills/save-systems` and `.claude/skills/roguelike`).

**Consequences.** Reloading mid-room restores the player at the start of that room; Title adds a `Continue Run` button whenever a valid `runSave` exists; `runSave` uses its own schema `version` + migration chain and stores zero engine node references.

---

## ADR-024 — Client-side i18n (Vietnamese default) & Vietnamese pixel font (M16)

**Decision.** Add a pure-TypeScript localization module (`core/i18n/`) with **Vietnamese (`'vi'`) as the default locale** and English (`'en'`) toggleable in Settings (persisted in `settings.locale` with automatic migration for v5 saves). Replace `NormalFont.ttf` (which lacks 36/43 Vietnamese diacritics) with an open-source pixel TTF supporting 100% of Vietnamese diacritics.

**Rationale.** Target player base defaults to Vietnamese, and the pack's `NormalFont.ttf` renders broken/fallback glyphs for Vietnamese text. Centralizing copy behind typed keys prevents drift between `core/` data (skills, characters, death causes) and `game/` UI screens.

**Consequences.** Every player-facing string moves to typed i18n dictionaries (`vi` & `en` key parity tested in vitest); HUD/menu containers account for taller Vietnamese diacritics and ~20–30% longer labels across all viewports.

---

## ADR-025 — RPG HP scale, unified top-left HUD & single North Portal (M17)

**Decision.** Replace the 6-heart integer health model with a **`100 HP` base RPG scale** (class deltas `100 / 85 / 85 / 120`, Meta Health `+20 HP/level`, enemy hits `15–35 HP`), rendered as a top-left **HP bar** with a delayed damage-drain trail and the **XP bar + `LV X` badge** stacked directly beneath it. Replace the M9 two-door choice (revises ADR-014) with a **single animated North Portal** on room clear (automatically inserting 1 mid-chapter special room after Room 4 and the red Boss Portal after Room 8), paired with a `+45%` out-of-combat room-clear speed boost and small glowing physical pickups (XP, Gold, rare Health Potion).

**Rationale.** Small integer hearts caused rounding distortion for Lifesteal/healing drops and visually cluttered the HUD; placing XP under HP frees the bottom edge for bullet dodging. Two doors slowed room pacing and created redundant choices once the Village Hub hosts permanent progression; a single North Portal with strong VFX and faster post-clear movement makes room-to-room flow immediate and readable.

**Consequences.** `tuning.json`, `core/combat/`, `core/meta/`, `core/run/doors.ts`, and `run-save.ts` migrate from hearts/2-doors to HP/1-north-portal; `DoorView` upgrades to a pooled multi-layer animated portal.

---

## ADR-026 — Bullet-hell lethality, no enemy knockback & combat clarity (M18)

**Decision.** Amend ADR-008: set enemy hit knockback and hit-stagger to `0` (preserving hit-flash, squash, crit hitstop, and ADR-021's Level-Up safety push wave). Raise enemy speed, bullet speed, and room-by-room density, and add two pressure roles (`dasher`, `gunner`). Amend ADR-019: move wandering `LivingDecor` animals out of combat rooms (reserved for M21 Village Hub), reduce combat weather opacity (`~30–40%`) and density, and enforce high-contrast combat silhouettes (enemy ground shadows + 1 px dark outline; bright-core + dark-rimmed enemy bullets).

**Rationale.** Continuous auto-fire with knockback/stagger trivialized chasing enemies, while vivid falling leaves and wandering animals visually competed with 16 px monsters and round projectiles.

**Consequences.** All tuning changes lock through `bun run sim:table`; enemy sprite staging bakes 1 px dark outlines at build time (zero runtime shaders, keeping ADR-017 and 60 fps).

---

## ADR-027 — Pruned core skill pool, class-exclusive skills & `image-generator` assets (M19–M20)

**Decision.** Prune 6 low-excitement passive skills from `core/skills/pool.ts` (`27 → 21`, rewiring `Aegis Retribution` to `Shield + Vitality`) and add **4 class-exclusive active-mechanic skills + 1 Class Legendary Evolution per playable character** (`16` skills + `4` Evolutions) blended into the level-up roll strictly for that character. Use Antigravity's `image-generator` (with transparent-background cleanup and nearest-neighbor pixel scaling matching `docs/art/gemini-style.md`) to author 64×64 hero/NPC portraits, 24×24 class skill icons, and new class/portal VFX sprites.

**Rationale.** Shared pools alone made all 4 classes converge onto identical mid-run builds, while stat-stick cards diluted exciting picks. Dedicated pixel portraits and icons make every class identity readable in both the HUD and Skill Codex.

**Consequences.** `core/skills/roll.ts` filters class-exclusive pools by `characterId`; `art-files.test.ts` and unique-icon tests cover all newly generated assets; `sim:table` validates all 4 classes with their exclusive pools.

---

## ADR-028 — Playable 2D Village Hub & enterable Shop interior (M21)

**Decision.** Revise v1 out-of-scope hub/NPC/dialog rules: introduce a playable `36×24` **Village Hub** between a streamlined Title Screen and combat runs, featuring wandering villagers & relocated animals, an **enterable `16×12` Shop interior** (`Interior/*` tileset) with RPG `DialogBox` + portrait shopkeeper, an East **Dojo** for live character switching & Skill Codex inspection, and a North **Expedition Gate** for Chapter/Ascension launch (plus quick-access shortcuts).

**Rationale.** Replaces static menu hopping with a tangible world space that showcases the 4 playable characters, gives wandering animals a natural home, and makes Meta progression feel rewarding.

**Consequences.** Reuses existing `TiledMap`, `core/camera/`, `core/movement/`, and `cover-view.ts` infrastructure with auto-fire disabled in hub/interior scenes; adds pure interaction/dialog state machines in `core/` so hub logic remains unit-testable without `cc`.


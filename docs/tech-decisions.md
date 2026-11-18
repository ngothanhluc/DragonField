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

**Consequences.** Single-screen room ⇒ **no camera follow, no large maps**. New systems to build: skill pool, rarity, meta progression, meta save. Systems dropped: dialog, inventory, in-level shop, hub. Technical numbers (16px, animation cadence, audio) are preserved in `docs/research/2026-11-unity-content-audit.md`.

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

## ADR-007 — Art spec

**Decision.** **Use only Ninja Adventure Update #8** (pixel-boy & AAA, CC0), no outside packs, **no drawing extra assets**. Source: `art-source/ninja-adventure/` (110 MB: 1915 PNGs, 188 audio files, 23 tilesets, 66 monsters, 20 boss folders, 361 UI files, 62 skill icons). 16×16 tiles, top-down 3/4 view, 4 directions.

Whatever the pack **lacks** is **cut from the design**, not made by hand:
- **No dungeon/crypt tileset** → the 3 chapters are grassland/forest, river/waterfall, abandoned village.
- **Dragons have no animation** (modular parts, 0 frames) → drop dragons. Bosses use Tengu / Squid / Samurai.
- **Only 1 character has a full 4-direction set** (`CharacterAnimated/NinjaGreen`) → the player is that character, no animated skins.
- **No monster has attack/hurt/death** → telegraph, getting hit and death are all FX + palette remap.
- **No boss health bar / skill card frame art** → assemble from nine-path `Theme Wood`.

Details + coverage table: `docs/art/pack-inventory.md`.

**Rationale.** A survey found no animated top-down 16px dragons on the market, and this pack already has enemy breadth (66 monsters + 10 bosses) — exactly what a roguelite needs more than one pretty boss. Drawing dungeon tiles + dragons by hand would be the 2 biggest authoring tasks, and neither is needed for the loop.

**Consequences.** Zero licence risk, zero art authoring effort. In exchange: themes are limited to the 3 available settings, and enemy expression depends entirely on FX.

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
5. ~~`docs/art/asset-pack-shortlist.md`~~ — deleted after choosing Ninja Adventure (ADR-007)

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

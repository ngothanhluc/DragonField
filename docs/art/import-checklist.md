# Art import checklist — subset used in the game

Status: **staged** into `game/assets/resources/art/` (94 PNG files, 387.567 byte ≈ 378,5 KiB) from `art-source/ninja-adventure/` (CC0, gitignored).

Rules for this staging pass:

- Copy only the files the game actually uses (per `docs/art/pack-inventory.md` §9 and `docs/gdd.md` §4–§6). The full pack is **not** committed.
- **Keep the original filenames, do not re-encode, do not resize, do not crop.** Byte-for-byte copy from the pack.
- Do not copy `.meta` — the editor generates them on first import. The target tree currently has **0 `.meta` files**.
- Do not edit any `.ts`, `.json`, or doc. Discrepancies found are recorded in §6 and are **not fixed here**.

---

## 1. Target tree

```text
game/assets/resources/art/                                    94 file   387.567 B
├── characters/
│   └── ninja-green/          7 file   11.602 B   Idle, Walk, Attack, Hit, Roll, Dead, Jump
├── monsters/                 9 file   21.375 B   1 sheet/monster, 1 directory each
│   ├── blue-bat/             SpriteSheet.png
│   ├── spider-red/           SpriteSheet.png
│   ├── snake3/               Snake3.png
│   ├── eye/                  Eye.png
│   ├── green-octopus/        SpriteSheet.png
│   ├── lantern-red/          SpriteSheet.png
│   ├── bear/                 SpriteSheet.png
│   ├── trex/                 SpriteSheet.png
│   └── cyclope/              SpriteSheet.png
├── bosses/                  18 file   73.907 B
│   ├── tengu-blue/           5 file   Idle, Walk, Attack, Hit, Trans
│   ├── squid-green/          6 file   Idle, Walk, Attack, AttackLoop, Shoot, Hit
│   └── giant-blue-samurai/   7 file   Idle, Walk, AttackLeft, AttackRight,
│                                      ChargeLeft, ChargeRight, Hit
├── tilesets/                15 file  254.638 B
│   ├── TilesetNature.png  TilesetRelief.png  TilesetElement.png
│   ├── TilesetField.png   TilesetWater.png   TilesetVillageAbandoned.png
│   ├── TilesetHouse.png   TilesetTowers.png  TilesetHole.png
│   ├── tileset_camp.png   tileset_bed.png
│   └── interior/             4 file   Elements, TilesetInterior,
│                                      TilesetInteriorFloor, TilesetWallSimple
├── ui/                      39 file   16.019 B
│   ├── Heart.png  LifeBarMiniProgress.png  LifeBarMiniUnder.png
│   ├── theme-wood/          16 file   8 nine-path + 8 button state (see §5)
│   └── skill-icons/         20 file   24×24, see the mapping table in §5
└── fx/                       6 file   10.026 B
    ├── shuriken/SpriteSheet.png          player projectile
    ├── energy-ball/EnergyBall.png        enemy projectile
    ├── spark/SpriteSheet.png             impact
    ├── explosion/SpriteSheet.png         explosion / enemy death
    ├── telegraph-ring/SpriteSheetWhite.png  telegraph ring
    └── slash-arc/SpriteSheetArc.png      samurai slash wave
```

Totals per group: characters 11.602 B · monsters 21.375 B · bosses 73.907 B · tilesets 254.638 B · ui 16.019 B · fx 10.026 B.

Corresponding sources: `Actor/CharacterAnimated/NinjaGreen/Separate/`, `Actor/Monster/<Name>/`, `Actor/Boss/<Name>/`, `Backgrounds/Tilesets/`, `Ui/Receptacle/` + `Ui/Theme/Theme Wood/` + `Ui/Skill Icon/Spell/`, `FX/`.

---

## 2. Required import settings

Applies to **all 94 files**. Select several files at once (per directory) and set them in the Inspector — Creator lets you set them in bulk.

### 2.1 Image asset (PNG files)

| Property | Value | Why |
|---|---|---|
| Type | **sprite-frame** | the 3.8 default is `texture` — leave it and there is no SpriteFrame to assign to a `Sprite` |
| Filter Mode | **Nearest (None)** | 16 px pixel art; Bilinear blurs it and shifts the palette colors |
| Wrap Mode | **Clamp** | avoid edge repetition at the sheet borders |
| useCompressTexture | **off** | compression distorts the 53-color palette |
| Fix Alpha Transparency Artifacts | **off** | it bleeds color into transparent pixels → halos under a Point filter |
| Flip Vertical | off | |
| Bake Offline Mipmaps | off | mipmaps are not used for 2D pixel art |

### 2.2 SpriteFrame (sub-asset, expand the PNG file)

| Property | Value | Why |
|---|---|---|
| Trim Type | **None** | `Auto` crops the transparent border → every frame gets a different rect and the animation jitters |
| Trim Threshold | not applicable (only has an effect with Auto) | |
| Offset X/Y | 0, 0 | |
| Packable | **false** | the dynamic atlas can change UVs; Point filter + atlas easily ends up half a pixel off |
| Border | 0, except for the nine-paths (see §2.4) | |

### 2.3 Pixels-per-unit

Cocos Creator 3.8 **has no "pixels per unit" field** on SpriteFrame (unlike 2.x). Project convention:

- **1 texture pixel = 1 design unit** (1:1 ratio). A 16 px tile ⇒ tile = **16×16 unit**.
- Base resolution **512×288 = 32×18 tile** (`docs/gdd.md` §8). Static camera, no scrolling.
- A `Sprite` node must have `size` = the exact frame size in the sheet (16×16, 32×32, 68×68, 76×79, 96×48…). **Do not** scale nodes by fractional amounts; if you need to enlarge, use integer multiples (×2, ×3) and keep `size` an integer.
- Do not use `Size Mode = Custom` for characters/enemies — it stretches the sprite.

### 2.4 Nine-path (only `ui/theme-wood/`)

Open the **Sprite Editor** (select the file → **Edit** button at the bottom of the Inspector) and set `Border`:

| File | px | Suggested Border (T/B/L/R) | Note |
|---|---|---|---|
| `nine_path_panel*.png`, `nine_path_bg*.png` | 16×16 | 4 / 4 / 4 / 4 | leaves an 8×8 core; tweak the edges if the corners look distorted |
| `nine_path_focus.png` | **8×8** | 2 / 2 / 2 / 2 | smaller than the other files — use it for a thin focus outline |
| `nine_path_panel_disabled.png`, `nine_path_panel_interior.png` | 16×16 | 4 / 4 / 4 / 4 | |
| `button_normal/hover/pressed/disabled.png` | **16×8** | 3 / 3 / 5 / 5 | |
| `button_checked/unchecked*.png` | **26×14** | 3 / 3 / 5 / 5 | **different size** from the 4 files above — the UI must cope with 2 sizes |

After dragging the cut lines, click the **green check mark** in the top-right corner of the Sprite Editor to save.

---

## 3. Frame slicing

Cocos Creator 3.8 **has no automatic grid slicing** (the Sprite Editor only does border/trim). So:

> **Do not create sub-frames by hand.** Each PNG imports as **exactly 1 SpriteFrame**, then code slices frames at runtime from `frameWidth`/`frameHeight`/`frames`/`layout` in `game/assets/resources/data/animations.json` (`SpriteFrame.clone()` + setting `rect`). Both `rect` and `originalSize` are properties you can set in 3.8.

Two layout types in the manifest:

- `layout: "grid"` — **columns = direction** in the pack's exact order **D / U / L / R**, **rows = frames**.
- `layout: "strip"` — **a single row**, frames run left → right (all bosses).

### 3.1 Player — `characters/ninja-green/` (32×32 frames)

| File | Sheet px | Columns × rows | Frames/direction | Note |
|---|---|---|---|---|
| `Idle.png` | 128×128 | 4 × 4 | 4 | |
| `Walk.png` | 128×128 | 4 × 4 | 4 | |
| `Attack.png` | 128×128 | 4 × 4 | 4 | |
| `Hit.png` | 128×64 | 4 × 2 | 2 | |
| `Roll.png` | 128×96 | 4 × 3 | 3 | |
| `Dead.png` | **32×64** | **1 × 2** | 2 | **not a horizontal strip** — 2 frames stacked vertically |
| `Jump.png` | 96×128 | 3 × 4 | 4 | 3 directions; **no key yet** in the manifest (see §6) |

### 3.2 Monster — `monsters/<monster>/` (16×16 frames)

All 9 sheets: **64×64 = 4 columns (D/U/L/R) × 4 rows (frames)**, 4 frames/direction, 10 fps, loop. None of them has attack/hurt/death.

### 3.3 Boss — `bosses/` (1-row strips)

| File | Sheet px | Frame | Frame count |
|---|---|---|---|
| `tengu-blue/Idle.png` | 408×68 | 68×68 | 6 |
| `tengu-blue/Walk.png` | 820×82 | 82×82 | 10 |
| `tengu-blue/Attack.png` | 1230×82 | 82×82 | 15 |
| `tengu-blue/Hit.png` | 544×68 | 68×68 | 8 |
| `tengu-blue/Trans.png` | 748×68 | 68×68 | 11 |
| `squid-green/Idle.png` `Walk.png` `Hit.png` `AttackLoop.png` | 304×79 | 76×79 | 4 / 4 / 4 / 4 |
| `squid-green/Attack.png` | 456×79 | 76×79 | 6 |
| `squid-green/Shoot.png` | 380×79 | 76×79 | 5 |
| `giant-blue-samurai/Idle.png` `Walk.png` | 576×48 | 96×48 | 6 / 6 |
| `giant-blue-samurai/AttackLeft.png` `AttackRight.png` | 384×96 | 96×96 | 4 / 4 |
| `giant-blue-samurai/ChargeLeft.png` `ChargeRight.png` | 288×96 | 96×96 | 3 / 3 |
| `giant-blue-samurai/Hit.png` | 384×48 | 96×48 | 4 |

Note: Tengu has 2 frame sizes (68 and 82) ⇒ pivot/anchor must be computed per sheet, not with a single shared offset. Samurai has 2 heights (48 and 96) ⇒ when switching to the attack/charge animations the node must keep the **bottom** fixed (anchor Y at the feet), not the center.

### 3.4 FX — `fx/` (1-row strips)

| File | Sheet px | Frame | Note |
|---|---|---|---|
| `energy-ball/EnergyBall.png` | 64×16 | **16×16 × 4** | divides evenly, certain |
| `telegraph-ring/SpriteSheetWhite.png` | 128×32 | **32×32 × 4** | divides evenly, certain |
| `explosion/SpriteSheet.png` | 360×40 | 24×40 × 15 | 360/15 = 24 (divides evenly) |
| `shuriken/SpriteSheet.png` | 690×54 | **not determined** | 690 is not divisible by 27 (the frame count pack-inventory records) — must be measured in the Sprite Editor; estimate 46×54 × 15 |
| `spark/SpriteSheet.png` | 270×35 | **not determined** | 270/24 = 11,25 — does not divide evenly; measure again |
| `slash-arc/SpriteSheetArc.png` | 228×34 | **not determined** | 228/11 ≈ 20,7 — does not divide evenly; measure again |

The last 3 sheets **have no key in the manifest**, so nothing depends on them yet; when adding keys you must measure the real frame count (do not trust the numbers in pack-inventory, they do not divide the sheet width evenly).

### 3.5 UI

| File | px | Slicing |
|---|---|---|
| `Heart.png` | 80×16 | **5 states × 16×16** (empty → full, frame 0 is the grey heart), horizontal slicing |
| `LifeBarMiniProgress.png` | 18×4 | 1 state, use `Sprite Type = FILLED` (horizontal) |
| `LifeBarMiniUnder.png` | 18×4 | background, `FILLED` or simple |
| `skill-icons/*.png` | 24×24 | 1 icon/file, no slicing |

### 3.6 Tileset

**No slicing on import** (leave 1 SpriteFrame intact). Tiles are sliced on a **16×16** grid when building the map in Tiled / when building the tilemap. All 15 files are divisible by 16:

`TilesetNature` 24×21 · `TilesetRelief` 20×12 · `TilesetElement` 16×15 · `TilesetField` 5×15 · `TilesetWater` 28×17 · `TilesetVillageAbandoned` 20×12 · `TilesetHouse` 33×23 · `TilesetTowers` 24×6 · `TilesetHole` 11×5 · `tileset_camp` 23×9 · `tileset_bed` 14×12 · `interior/Elements` 9×3 · `interior/TilesetInterior` 16×20 · `interior/TilesetInteriorFloor` 22×17 · `interior/TilesetWallSimple` 10×11.

`TilesetFloor.png` (417 px, 1 px off) is **deliberately not copied**.

---

## 4. Animation → manifest key mapping tables

Source: `game/assets/resources/data/animations.json` (75 keys across 33 sheets). Target paths are relative to `game/assets/resources/art/`.

### 4.1 Player — 21 keys / 6 sheets

| Key | Target file | Frame | Frames/direction | fps | loop |
|---|---|---|---|---|---|
| `player.idle.down` `player.idle.up` `player.idle.left` `player.idle.right` | `characters/ninja-green/Idle.png` | 32×32 | 4 | 10 | ✔ |
| `player.walk.down` `player.walk.up` `player.walk.left` `player.walk.right` | `characters/ninja-green/Walk.png` | 32×32 | 4 | 10 | ✔ |
| `player.attack.down` `player.attack.up` `player.attack.left` `player.attack.right` | `characters/ninja-green/Attack.png` | 32×32 | 4 | 20 | ✘ |
| `player.hit.down` `player.hit.up` `player.hit.left` `player.hit.right` | `characters/ninja-green/Hit.png` | 32×32 | 2 | 12 | ✘ |
| `player.roll.down` `player.roll.up` `player.roll.left` `player.roll.right` | `characters/ninja-green/Roll.png` | 32×32 | 3 | 15 | ✘ |
| `player.dead` | `characters/ninja-green/Dead.png` | 32×32 | 2 (1 column × 2 rows) | 8 | ✘ |

### 4.2 Monster — 36 keys / 9 sheets

Each monster has 4 keys `<actor>.walk.down|up|left|right`, 16×16 frames, 4 frames/direction, 10 fps, loop.

| Actor (key) | Target file |
|---|---|
| `bluebat` | `monsters/blue-bat/SpriteSheet.png` |
| `spiderred` | `monsters/spider-red/SpriteSheet.png` |
| `snake3` | `monsters/snake3/Snake3.png` |
| `eye` | `monsters/eye/Eye.png` |
| `greenoctopus` | `monsters/green-octopus/SpriteSheet.png` |
| `lanternred` | `monsters/lantern-red/SpriteSheet.png` |
| `bear` | `monsters/bear/SpriteSheet.png` |
| `trex` | `monsters/trex/SpriteSheet.png` |
| `cyclope` | `monsters/cyclope/SpriteSheet.png` |

### 4.3 Boss — 18 keys / 18 sheets (1 key = 1 sheet, strip)

| Key | Target file | Frame | Frame count | fps | loop |
|---|---|---|---|---|---|
| `tengu.idle` | `bosses/tengu-blue/Idle.png` | 68×68 | 6 | 10 | ✔ |
| `tengu.walk` | `bosses/tengu-blue/Walk.png` | 82×82 | 10 | 10 | ✔ |
| `tengu.attack` | `bosses/tengu-blue/Attack.png` | 82×82 | 15 | 20 | ✘ |
| `tengu.hit` | `bosses/tengu-blue/Hit.png` | 68×68 | 8 | 20 | ✘ |
| `tengu.trans` | `bosses/tengu-blue/Trans.png` | 68×68 | 11 | 20 | ✘ |
| `squid.idle` | `bosses/squid-green/Idle.png` | 76×79 | 4 | 10 | ✔ |
| `squid.walk` | `bosses/squid-green/Walk.png` | 76×79 | 4 | 10 | ✔ |
| `squid.attack` | `bosses/squid-green/Attack.png` | 76×79 | 6 | 20 | ✘ |
| `squid.attack-loop` | `bosses/squid-green/AttackLoop.png` | 76×79 | 4 | 12 | ✔ |
| `squid.shoot` | `bosses/squid-green/Shoot.png` | 76×79 | 5 | 20 | ✘ |
| `squid.hit` | `bosses/squid-green/Hit.png` | 76×79 | 4 | 20 | ✘ |
| `samurai.idle` | `bosses/giant-blue-samurai/Idle.png` | 96×48 | 6 | 10 | ✔ |
| `samurai.walk` | `bosses/giant-blue-samurai/Walk.png` | 96×48 | 6 | 10 | ✔ |
| `samurai.attack.left` | `bosses/giant-blue-samurai/AttackLeft.png` | 96×96 | 4 | 20 | ✘ |
| `samurai.attack.right` | `bosses/giant-blue-samurai/AttackRight.png` | 96×96 | 4 | 20 | ✘ |
| `samurai.charge.left` | `bosses/giant-blue-samurai/ChargeLeft.png` | 96×96 | 3 | 15 | ✔ |
| `samurai.charge.right` | `bosses/giant-blue-samurai/ChargeRight.png` | 96×96 | 3 | 15 | ✔ |
| `samurai.hit` | `bosses/giant-blue-samurai/Hit.png` | 96×48 | 4 | 20 | ✘ |

---

## 5. UI: files taken + map of the 20 skill icons

### 5.1 `ui/theme-wood/` — 16 files

Nine-path (8): `nine_path_bg.png`, `nine_path_bg_2.png`, `nine_path_focus.png`, `nine_path_panel.png`, `nine_path_panel_2.png`, `nine_path_panel_3.png`, `nine_path_panel_disabled.png`, `nine_path_panel_interior.png`.

Button state (8): `button_normal.png`, `button_hover.png`, `button_pressed.png`, `button_disabled.png`, `button_checked.png`, `button_checked_disabled.png`, `button_unchecked.png`, `button_unchecked_disabled.png`.

The rest of `Theme Wood` (tabs, slider, radio, checkbox, arrow, `inventory_cell`) is **not copied** — add it once the real HUD/shop exists.

### 5.2 `ui/skill-icons/` — 20 icons, mapped per GDD §6

Chosen from `Ui/Skill Icon/Spell` (34 enabled icons). These are the closest-meaning substitutes, **not** custom-drawn icons — to change one later you only swap the file, the keys stay the same.

| # | Skill (GDD §6) | Icon | Why chosen |
|---|---|---|---|
| 1 | Sharpen (+1 damage) | `AttackUpgrade` | sword blade + upward arrow = increased damage |
| 2 | Rapid Fire (+25% fire rate) | `Fireball` | fireball = projectile/firepower symbol |
| 3 | Twin Shot (+1 projectile, ±12° spread) | `Permutation` | split/duplicate = doubling the projectiles |
| 4 | Piercing (pierces 1 enemy) | `RockSpike` | piercing spike |
| 5 | Ricochet (1 bounce) | `BookThunder` | spreading lightning = chain bounce |
| 6 | Homing (tracks the target) | `Vision` | eye = target lock |
| 7 | Explosive (1.5 tile AoE) | `Explosion` | literal |
| 8 | Crit Eye (15% ×2) | `Counter` | critical counterattack |
| 9 | Vitality (+1 heart) | `Heal` | healing |
| 10 | Second Wind (heal 2 hearts/room) | `BookPlant` | regrowth = recovery on a rhythm |
| 11 | Shield (blocks 1 hit) | `DefenseUpgrade` | shield + upward arrow |
| 12 | Thorns (contact deals 2 dmg) | `BookDarkness` | dark aura = reflected damage |
| 13 | Swift (+10% speed) | `BookWind` | wind = speed |
| 14 | Long i-frame (0.8 → 1.1 s) | `Mist` | mist = dodge |
| 15 | Freeze (slow 40% / 1 s) | `BookIce` | ice |
| 16 | Poison (1 dmg/s for 3 s) | `BookDeath` | poison/death |
| 17 | Lifesteal (5% heal) | `MagicWeapon` | life-stealing weapon |
| 18 | Greed (+25% gold) | `Alchemy` | alchemy = gold |
| 19 | Luck (+1% rarity weight) | `LuckUpgrade` | literal |
| 20 | Executioner (+50% dmg < 30% health) | `Death` | finisher |

Not used (still in the pack if you need a swap): `BookFire`, `BookLight`, `BookRock`, `Camouflage`, `Cut`, `Downgrade`, `Necromancy`, `Orb*`, `WaterCanon`.

A 24×24 icon = 1,5 tile of 16 px ⇒ when shown in a skill card it must be scaled by an integer multiple (×2 = 48 unit) so it does not blur.

---

## 6. Discrepancies found (DO NOT fix)

### 6.1 No key is missing a sheet

All 75/75 keys in `animations.json` have a corresponding copied file. 33 sheets with keys ↔ 33 staged files.

### 6.2 Sheets copied but **without a key** — 61 files

| Group | File | Note |
|---|---|---|
| Player | `characters/ninja-green/Jump.png` | the pack has Jump with 3 directions × 4 frames; the manifest has **no** jump key. To use it you must add a key + declare `directions` (only 3 columns, so it cannot be the full 4 directions) |
| Tileset | 15 files | the manifest only contains actor sprites; tiles go through Tiled/tilemap, not through `animations.json` |
| UI | 39 files | Heart/LifeBar/theme/skill icon have no keys yet — the HUD uses the SpriteFrame directly |
| FX | 6 files | no keys yet; FX also have no schema in the manifest |

This was **expected** at M0 (the manifest only covers actors), but it means 61/94 files are not verified by any test.

### 6.3 Manifest pointed at the wrong path root — **fixed**

`animations.json` used to record `sheet` against the `art-source/ninja-adventure/` root (for example `"Actor/Monster/BlueBat/SpriteSheet.png"`), while the real files were staged under `game/assets/resources/art/`. The loader would not find the PNGs.

Fixed: all 75 entries use paths relative to `game/assets/` (`art/monsters/blue-bat/SpriteSheet.png`), verified **33/33 sheets exist on disk**. The validator switched to `isAssetRelativePath` and reports errors against the `game/assets/` root.

Trade-off: the manifest no longer cross-checks directly against the pack names; the `Actor/<Category>/<Name>/<File>.png` → `art/<category>/<kebab-name>/<File>.png` mapping convention lives in §2 of this document.

### 6.4 Slicing traps confirmed by measurement

- `Dead.png` 32×64 = **1 column × 2 rows**, the manifest records `layout: "grid"`, `frames: 2`. Do not infer `columns` in the loader: `manifest.ts` already exports `frameColumns()`, `frameRows()`, `frameRect()` to handle both 1-column sheets and boss strip sheets (tested in `tests/core/frame-geometry.test.ts`).
- FX `shuriken`, `spark`, `slash-arc`: the sheet width does not divide evenly by the frame count `pack-inventory` records (690/27, 270/24, 228/11) ⇒ the inventory frame counts are estimates and **must be re-measured** when building the VFX. FX have no schema in the manifest yet, so nothing currently catches this.
- `nine_path_focus.png` is 8×8 while the other nine-paths are 16×16; `button_checked*` is 26×14 while `button_normal*` is 16×8 ⇒ do not share a single node size.

---

## 7. Opening the project for the first time — action checklist

Correct order, work from the top down:

1. **Close the editor** if another project is open. `git status --short` must only show `game/assets/resources/art/**` and `docs/art/import-checklist.md` as new files.
2. Open **Cocos Creator 3.8.8** → choose the `game/` project. Wait for the import to finish (Assets shows the `art` folder, the status bar stops showing "Importing…").
3. If you want every future PNG to default to sprite-frame: **Edit → Preferences → Default Meta section** → open the JSON → set `"image": { "type": "sprite-frame" }` → Apply. (Optional; step 4 can be done manually.)
4. In Assets, select **each directory** (`characters`, `monsters`, `bosses`, `tilesets`, `ui`, `fx`) → select all the PNGs inside → Inspector:
   - Type = **sprite-frame**
   - Filter Mode = **Nearest (None)**
   - Wrap Mode = **Clamp**
   - useCompressTexture = **off**, Fix Alpha Transparency Artifacts = **off**
5. Expand **one** PNG file → select the **SpriteFrame** sub-asset → Trim Type = **None**, Packable = **false**. Repeat for each directory (batch setting works).
6. Check 3 sample files: `characters/ninja-green/Idle.png` must be 128×128, `monsters/blue-bat/SpriteSheet.png` 64×64, `tilesets/TilesetNature.png` 384×336. Wrong size ⇒ some step resized them, start over.
7. **Do not** create sub-frames by hand, **do not** click "auto slice". Frame slicing is the runtime's job (§3).
8. For the 16 `ui/theme-wood/` files: open the **Sprite Editor**, set `Border` per the table in §2.4, click the ✔ to save.
9. `Heart.png` (80×16): keep it as 1 SpriteFrame; if you need the 5 states, slice 5 16×16 rects in code rather than splitting the file.
10. Let the editor finish "Import/Compile", then **commit all the newly generated `.meta` files** (`git status` will show 94 `.meta`). `.meta` is **not** gitignored and **must** be committed — without it you lose UUIDs and break scene references.
11. Run the gate: `cd game && bun run check` (tsc + vitest + eslint). This task changes no code, so it must pass right away.
12. Open 1 scene/prefab, drag `characters/ninja-green/Idle.png` onto a `Sprite` → you must see 4 directions × 4 frames crisp, **not** blurry, **not** half a pixel off while previewing.

Not allowed: enabling compression, leaving `Trim Type = Auto`, resizing/scaling images in the Inspector, committing `art-source/`, adding external packs.

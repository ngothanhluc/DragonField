# Unity content audit — Yokai Field (2026-11-15)

Purpose: lock down the **technical numbers** of the Unity build before deleting the source to rewrite in Cocos Creator 3.8.
This is a read-only record, not a code backup. Gameplay content (dialogue, item names, map layout) **will not be reused**, per the "100% new content" decision; the tables below serve only as technical reference (grid, frame size, animation cadence, short audio).

Source: `Assets/Scenes/*.unity`, `Assets/Prefabs/**/*.prefab`, `Assets/Animations/**`, `Assets/Data/**`, `ProjectSettings/EditorBuildSettings.asset`.

---

## 1. Grid + pixel scale

| Scene | `m_CellSize` | `m_CellGap` | Grid |
|---|---|---|---|
| Level1 | `{0.16, 0.16, 0}` | 0 | 1 |
| Level2 | `{0.16, 0.16, 0}` | 0 | 1 |
| Village | `{0.16, 0.16, 0}` | 0 | 1 |
| Menu | — | — | 0 |

PPU = **100** in 1149/1150 `.meta` files (exception: `Thaleah_DemoBackground.png` = 16).
→ **1 tile = 16 px = 0.16 world unit**. This is the reference figure for the Cocos build: 16 px/tile, world unit = 1/100.

Build settings (`ProjectSettings/EditorBuildSettings.asset`): **all 4 scenes enabled** — Menu (0), Village (1), Level1 (2), Level2 (3).

---

## 2. Sprite frame sizes

| Character | Sheet | PNG | Frame | Pitch | Actual rect (w×h) |
|---|---|---|---|---|---|
| Player Knight Idle | `Idle-Sheet.png` | 128×32 | 4 | 32×32 | 19×29 / 19×27 |
| Player Knight Run | `Run-Sheet.png` | 384×64 | 6 | 64×64 | 17–24 × 29–31 |
| Player Knight Death | `Death-Sheet.png` | 288×32 | 6 | 48×32 | 19×29 → 33×13 |
| Orc (Enemy_1) Idle | | 128×32 | 4 | 32×32 | 20×30 / 20×28 |
| Orc Run | | 384×64 | 6 | 64×64 | 19–24 × 30–32 |
| Skeleton Base (Enemy_2) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 16×30 / 15–22 × 30–32 |
| Skeleton Warrior (Enemy_3) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 20×30 / 18–23 × 31–32 |
| Rogue (Player2) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 19×30 / 18–24 × 30–32 |

Player collider `m_Size` = **0.19 × 0.29** unit (≈ 19×29 px). Weapons: `Wood.png` 192×112, `Hands.png` 32×64, `Bone.png` 224×144.
→ Spec for new art: character frame **32×32**, body occupies ~19×29 px, feet anchored to the bottom of the frame.

---

## 3. Animation cadence

| Clip | Loop | Sample rate | Frames | Notes |
|---|---|---|---|---|
| Idle (all characters) | yes | **10 fps** | 4 | 0.4 s/loop |
| Run / walk | yes | **10 fps** | 6 | 0.6 s/loop |
| Player Death | no | 30 fps | 6 | ~0.17 s |
| Weapon idle | yes | 10 fps | 3–5 | |
| Weapon attack | no | **20 fps** | 1 | 0.1 s |
| Player2 weapon | — | 60 fps | 0 | empty clip (bug) |

→ Reference cadence to require from the new pack: idle 4 frames, walk/run 6 frames, attack ≥3 frames, death 6 frames, 4 directions.

---

## 4. Gameplay numbers

| Prefab | Max HP | Notes |
|---|---|---|
| Player | 10 (prefab) | scene override **20** |
| Player (1) | 10 / cur 2 | variant with ranged fire |
| Enemy_1/2/3 | 2 | |

| Prefab | chase | attackDist | attackDelay |
|---|---|---|---|
| Enemy_1, Enemy_2 | 1 | 0.3 | 2 |
| Enemy_3 | 2 | 0.3 | 2 |

| Prefab | delay | radius | fire interval | rotSpeed | projectile |
|---|---|---|---|---|---|
| Player | 0.3 | 0.37 | — | — | — |
| Player (1) | 0.3 | — | 0.005 s | 10 | yes |
| Enemy_1 | 0.3 | 0.36 | — | — | — |
| Enemy_2/3 | 0.3 | 0.34 | — | — | — |

Projectile: speed 5, lifetime 10 s, damage 1.
**Hardcoded damage = 1** in exactly 2 places: `WeaponParent.cs:110`, `Projectile.cs:26`. No i-frames; only `attackBlocked` + a 0.3 s delay.

---

## 5. Item (reference, not reused)

| Asset | Name | Stack | HP heal | Param |
|---|---|---|---|---|
| FortuneCookiee | Fortune Cookie | 99 | +1 | `[]` |
| Sushi | Sushi | 99 | +2 | `[]` |
| Yakitori | Yakitori | 99 | +3 | `[]` |

`FoodHealthModifier.asset` holds no values; the values live in each item's `ModifierData.value`. No durability.
`InventorySO.Size = 10`, `initialItems = []`.

---

## 6. Content per scene

| Scene | Enemy | Food | NPC | Door | Collider |
|---|---|---|---|---|---|
| Level1 | 14 × Enemy_1 | 3 | 0 | 1 | 1 Box, 3 Polygon, 2 TilemapCollider |
| Level2 | 12 × Enemy_2 + 6 × Enemy_3 | 5 | 0 | 1 | 1 Box, 1 Polygon, 2 TilemapCollider |
| Village | 0 | 3 | 3 | 1 (opens LevelMenu) | 4 Box, 1 Polygon, 1 TilemapCollider |
| Menu | 0 | 0 | 0 | 0 | 0 |

Level1 = 14 enemies scattered with no room split; Level2 = 18 enemies, 4 of them share coordinates, 2 pickups have a null item. No Rigidbody, no Circle/Edge/Capsule collider.

---

## 7. Audio

Total: 93 files (62 wav + 31 ogg) = **38.85 MB**, but **only 9 files are used**:

| Clip | Length | Used in |
|---|---|---|
| Adventure Begin | 82.3 s | Menu (music) |
| Village | 51.7 s | Village (music) |
| Road | 44.3 s | Level1 (music) |
| Dungeon | 60.0 s | Level2 (music) |
| Coin | 0.29 s | pickup |
| Sword2 | 0.21 s | attack (L1, Village) |
| Magic1 | 0.40 s | attack (L2) |
| PowerUp1 / PowerUp2 | 0.47 s | food |

Mixer `Volume.mixer`: 1 group, **Master**, no AudioSource routed to an output group.
→ Only carry over the 9 files (~0.3 MB) instead of 38.85 MB. The 4 music themes can be reused for now.

---

## 8. UI

- Canvas: `ReferenceResolution 800×600`, `MatchWidthOrHeight = 0` in all 4 scenes.
- GUI actually used: `GUI_1x.png` (152×112, 13 slice), `GUI_4x.png` (608×448), `Spritesheet_UI_Flat.png` (768×352). `GUI/Sliced/*` and `GUI_2x.png` are **unused**.
- Font: 1 TMP SDF only (`ThaleahFat_TTF SDF`), size 16–72 depending on screen.
- Inventory grid: cell 100×100, spacing 20×20, no fixed column count, 10 slots.

---

## 9. Ledger asset

| Group | File | Size |
|---|---|---|
| PNG (Art) | 49 | 317 KB |
| PNG (NinjaAdventure) | 974 | 2.74 MB |
| PNG total | 1038 | 8.63 MB |
| Audio | 93 | 38.85 MB |
| `.aseprite` | 34 | 151 KB |
| `.asset` | 2366 | 5.04 MB (2344 are tile assets) |
| Font ttf/otf | 8 | 742 KB |
| TMP SDF | 7 | 2.75 MB |

**1074 / 3539** png/audio/font files are unreferenced (742 NinjaAdventure Actor, 90 Items, 61 FX, 57 Sounds, 42 Backgrounds…). Unity does not use any `.aseprite` file directly.

---

## 10. Conclusions for the Cocos build

Must carry over (the numbers, not the code):
1. **16 px/tile, 32×32 character frame**, world unit = 1/100.
2. **Animation cadence**: idle 4f@10fps, run 6f@10fps, attack ~3f@20fps, death 6f@30fps, 4 directions.
3. **9 audio files** (4 music + 5 SFX) and 1 pixel font.
4. `ReferenceResolution 800×600` is not worth keeping — the web build should pick again for pixel-perfect 16:9.

Drop entirely: all C# scripts, prefabs, scenes, tile color, NinjaAdventure sprites, GUI skin, dialogue text, item data.

# Pack inventory — Ninja Adventure Update #8

Source: `art-source/ninja-adventure/` (CC0, `LICENSE.txt`). 110 MB · 1915 PNG · 188 audio · **no `.meta`** (not a Unity export — must be sliced by grid).

Differences from the Update #7 version already in the old repo: +36 characters (92 dirs), **new `CharacterAnimated`** (2 dirs), +16 monsters (66), +12 bosses (20), +12 animals (25), +3 tilesets (`camp`, `bed`, `Towers`), FX 105 files, `Ui` 361 files, audio 188 files.

---

## 1. Characters

| | `Character/` (90 dirs) | `CharacterAnimated/` (1 dir) |
|---|---|---|
| Frame | 16×16 | **32×32** (16 px art, ~8 padding) |
| Idle | 4 directions × 1 frame | 4 directions × 4 frames |
| Walk | 4 directions × 4 | 4 directions × 4 |
| Attack | 4 frames, 1 direction + flip | **4 directions × 4** |
| Roll / Hurt | **none** | **present** |
| Dead | 1 frame | 2 frames |

`CharacterAnimated/NinjaGreen` — column order **D / U / L / R**, frame **32×32**:

| Anim | File | Dir × frames |
|---|---|---|
| Idle | Idle.png | 4 × 4 |
| Walk | Walk.png | 4 × 4 |
| Attack | Attack.png | 4 × 4 |
| Roll | Roll.png | 4 × 3 |
| Hit | Hit.png | 4 × 2 |
| Jump | Jump.png | 3 dir × 4 |
| Swim / Push / Climb / Dead / Pickup | | 1 dir × 2–4 |

**This is the only character with a complete 4-direction set.** Use it as the player. The 90 `Character/` characters are only good for skins/NPCs (they have no roll/hurt).

Weapons in `CharacterAnimated/Weapon/` (Axe, Hammer, Katana, Net, Pickaxe, 256×256) — skip, the auto-fire game does not need them.

---

## 2. Monsters (66)

**All of them** share the same structure: 1 sheet 64×64 = 4 directions × 4 frames of 16×16. **None has attack/hurt/death/roll.**

⇒ Every enemy expression must come from **AI + tint + FX**, not from sprite animation.

| Role | Chapter 1 (grass) | Chapter 2 (river) | Chapter 3 (ruins) |
|---|---|---|---|
| Chaser | BlueBat | SpiderRed | Snake3 |
| Caster | Eye | GreenOctopus | LanternRed |
| Tank/charger | Bear | TRex | Cyclope |

Spares: YellowsBat, MouseBlack, LanternGreen, RedOctopus, Panda, Reptile2, Skull, GreyTrex.

---

## 3. Bosses (20 folders = 10 designs × 2 color variants)

| Boss | Idle | Walk | Attack | Charge | Jump | Hit | Other | Frame |
|---|---|---|---|---|---|---|---|---|
| TenguBlue | 6 | 10 | **15** | – | – | 8 | **Trans 11** (teleport) | **68×68** (idle/hit/trans), 82×82 (walk/attack) |
| SquidGreen | 4 | 4 | 6 + **AttackLoop 4** | – | – | 4 | **Shoot 5** | 76×79 |
| GiantBlueSamurai | 6 | 6 | 4 + 4 (L/R) | 3 + 3 (L/R) | – | 4 | | **96×48** (idle/walk/hit), 96×96 (attack/charge) |
| GiantSlime | 5 | – | – | – | **13** | 5 | slam | 62×52 |
| GiantBamboo | 6 | 12 | 5 | 3 | – | 4 | | 62×62 |
| GiantFrog | 5 | – | 3 | 7 | 6 | 3 | | 40×40 |
| GiantRacoon | 6 | – | 4 | 2 | 5 | – | | 60×60 |
| DemonCyclop | 5 | 6 | **–** | – | – | 3 | no attack | 50×50 |
| GiantFlam / GiantSpirit | 5 | – | **–** | – | – | 3 | no attack | 50×50 |
| DragonBlue / Green | – | – | – | – | – | – | **0 animations** (detached body) | 31–57 |

**3 bosses chosen:** TenguBlue (Ch1), SquidGreen (Ch2), GiantBlueSamurai (Ch3). Reason: all three have real attack/charge animations, readable silhouettes at boss scale, and animation sets that support different bullet patterns. Backup: GiantSlime (jump slam), GiantBamboo.

Dropped: DemonCyclop, GiantFlam, GiantSpirit (no attack frames), Dragon* (no animations, out of scope).

---

## 4. Tilesets (16 px grid)

| File | px | Theme | Autotile |
|---|---|---|---|
| TilesetNature | 384×336 | grassland + forest cliff | **yes** |
| TilesetRelief / ReliefDetail | 320×192 / 192×192 | cliff | yes / partial |
| TilesetField | 80×240 | rice field | yes |
| TilesetWater | 448×272 | river/lake | **yes** |
| TilesetElement | 256×240 | trees, bushes, rocks (props) | – |
| TilesetFloor / FloorB / FloorDetail | 352×**417** / 176×112 / 256×80 | floor | no |
| TilesetHouse | 528×368 | village house kit | – |
| TilesetVillageAbandoned | 320×192 | abandoned village | **yes** |
| TilesetTowers | 384×96 | tower roofs, 4 colors | – |
| tileset_camp / tileset_bed | 368×144 / 224×192 | tent, campfire, interior furniture | – |
| TilesetDesert | 320×192 | desert | yes |
| TilesetHole | 176×80 | hole | partial |
| Interior/* | 256×320, 352×272, 160×176 | indoor walls/floors | yes |
| TilesetDungeon | 192×64 | **only 12×4 props** (jars, traps) | – |

**Defect to know:** `TilesetFloor.png` is **417 px tall, not divisible by 16** → slice 26 rows, drop the last 1 px.

**3 chapter themes:** Ch1 Grassland/Forest · Ch2 River/Waterfall · Ch3 Abandoned Village. Hub/shop: `tileset_camp` + `tileset_bed` + `Interior`.

**There are no** dungeon/crypt/lava/cave themes.

---

## 5. FX (75 PNG)

| Used for | File |
|---|---|
| Projectiles | Fireball (4), EnergyBall (4), BigEnergyBall (3), ShurikenMagic (2), CanonBall (5), RockSpike (12), IceSpike (8), Kunai (20), Shuriken (27) |
| Impact | Explosion (15), Spark (24), Thunder (8), Smoke (7), SmokeCircular (16), Water (13), WaterPillar (17), Flam (11) |
| **Telegraph** | `Magic/Circle/SpriteSheetWhite` (4), Orange (4), Spark (6), Spark2 (5) |
| Melee | `Attack/` 8 sheets, `Slash/` 6 (Arc 11, Circular 9, Multi 10) |
| Other | Aura (6), Boost (18), Shield (5), Spirit (5), Fog, Raylight, 15 particle strips |

---

## 6. UI (359 PNG)

| Need | Have |
|---|---|
| Hearts | `Heart.png` 80×16 = **5 states**; `Heart2/3` 4 states |
| Health bar | `LifeBarMini` 18×4; Receptacle 8 backgrounds + 3 progress |
| **Skill icons** | **62 icons 24×24** (+62 Disabled versions): Spell 34, Item&Weapon 12, Job&Action 12, Meteo 4 |
| Gold | `Money.png` 24×24, `GoldCoin`, `Coin2` |
| Panel/buttons | `Theme/Theme Wood` 43 files: 4-state buttons, tabs, slider, checkbox, `inventory_cell` 16×16, **7 nine-paths 16×16** |
| Dialog | DialogBox 300×58, ChoiceBox, FacesetBox, Yes/No |
| Input | **109 prompts**: keyboard 60, gamepad 37, mouse 7 |
| Font | `NormalFont.ttf` (NinjaAdventure Regular), bitmap `font8x8`, `font24x30` |

Missing: a dedicated boss health bar, skill card frames, rarity art → build them from nine-paths + progress bars.

---

## 7. Audio (188)

- **SFX 147 wav**: Bonus 10 (coin/powerup), Hit&Impact 13, Elemental 26, Magic 11, Menu 25, Whoosh&Slash 9, Jump 8, Creature 5, Voice 10.
- **Jingle 15**: GameOver 4, LevelUp 3, Secret 4, Success 4.
- **Music 41 ogg** — picks: title `38 Intro` / `1 Adventure Begin` · Ch1 `11 Clearing` / `31 Sunny` · Ch2 `18 Aquatic` / `39 Boat` · Ch3 `30 Ruins` / `26 Lost Village` · boss `17 Fight` / `34 Fight` / `28 Tension`. Spares: `21 Dungeon`, `40 Crypt`, `37 Dark Forest`.

---

## 8. Palette

`Palette.png` = 53 opaque colors. Every sprite uses only 7–9 colors from this set → if you need a recolor (elite variant, hit tint), **remap by palette index**, do not multiply colors directly, so the style does not drift.

---

## 9. Coverage table — asset → role

| Role | Asset |
|---|---|
| Player | `CharacterAnimated/NinjaGreen` |
| Chaser ×3 | BlueBat / SpiderRed / Snake3 |
| Caster ×3 | Eye / GreenOctopus / LanternRed |
| Tank ×3 | Bear / TRex / Cyclope |
| Boss ×3 | TenguBlue / SquidGreen / GiantBlueSamurai |
| Backgrounds ×3 chapters | Nature+Relief / Water+Waterfall / VillageAbandoned+House+Towers |
| Props | Element, camp, bed, Interior, Flag/Plant/Flower animated |
| HUD | Heart 5-state, LifeBarMini, Receptacle, 62 skill icon, Theme Wood, Arrow |
| Projectiles | Fireball, EnergyBall, ShurikenMagic, CanonBall, Shuriken |
| VFX | Explosion, Spark, Smoke, Thunder, Circle (telegraph), Fog |
| SFX | Bonus, Hit&Impact, Elemental, Magic, Menu, Whoosh, Jingle |
| Music | Intro / Clearing / Aquatic / Ruins / Fight |
| Font | NormalFont.ttf |

**Dropped, and why:**

| Asset | Reason |
|---|---|
| `Character/` 90 sets | no roll/hurt → usable only as NPCs (not in scope) |
| `Animal/` 25 | no role in a roguelite |
| DemonCyclop, GiantFlam, GiantSpirit | no attack frames → flat bosses |
| Dragon* | no animations, out of scope |
| `TilesetDungeon` 12×4, TilesetLogic, Pipes, Vehicles | not room themes |
| Items Food/Resource/Weapons/Scroll/Tool | no inventory/economy |
| `Ui/Emote` 30, gamepad prompt 37, `Theme/Wip` | web + mouse/keyboard only |
| Gamepad/mouse prompt | keyboard prompts only |

---

## 10. Gaps that must be accepted (no extra art allowed)

1. **Only 1 animated character** → no animated skins/NPCs.
2. **No monster has attack/hurt/death** → telegraphs and death must be FX + tint.
3. **No dungeon/crypt theme** → the 3 chapters are grass / river / abandoned village.
4. **No boss health bar art, skill card frames, rarity borders** → compose them from nine-paths.
5. **`TilesetFloor` is 1 px off** → slice 26 rows.
6. **No atlas JSON** → frame tables must be declared by hand (all grids, except boss strips).
7. **No 8 directions** → diagonal movement uses L/R + flip.

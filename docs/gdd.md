# GDD — Yokai Field v2 (roguelite)

Status: draft 1, locking in the decisions from the 2026-11-15 design session. Nothing implemented yet.

---

## 1. Pitch

Single-screen bullet-dodging roguelite, top-down, 16px. The player **always auto-fires** at the nearest enemy, so the only skill is **movement**. Clear each room → pick 1 of 3 random skills. Dying ends the run; keep your gold to buy permanent upgrades.

3 chapters, each with 8 rooms + 1 boss. Settings come from tilesets that actually exist in the pack: **grassland/forest → river/waterfall → abandoned village**. No dragons, no dungeon. Bosses: **Tengu → Squid → Samurai**. Character: **NinjaGreen** (the only character in the pack with a full 4-direction animation set).

Reference: Archero (loop), but **firing is continuous even while running** — unlike Archero there is no "stand still to shoot".

---

## 2. Core loop

```text
Title → pick chapter → RUN
  room 1 → clear → pick 1 of 3 skills
  room 2 → ...
  ... 8 rooms
  room 9 = BOSS
→ results screen (rooms, gold, time)
→ meta shop (buy permanent upgrades)
→ Title
```

- 1 run = 8 normal rooms + 1 boss.
- 1 run lasts 8–12 minutes.
- 3 chapters; the next chapter unlocks when you beat the previous one.

---

## 3. Combat model

| Parameter | Value |
|---|---|
| Movement | WASD, 8 directions, no dash |
| Base run speed | 4 tiles/s |
| Firing | **automatic, continuous, even while running** |
| Aim | auto-targets the nearest enemy within 8 tiles |
| Base fire rate | 2 shots/s |
| Base bullet | 1 projectile, damage 1, speed 12 tiles/s |
| Player health | 6 hearts |
| Taking damage | 1, i-frame **0.8 s**, knockback 3 px |
| Death | run ends immediately, no revival within a run |

No attack button, no fire button. The only input: **WASD + Esc (pause)**.

---

## 4. Enemies

Constraint from the pack: **every monster has only 1 sheet of 4 directions × 4 walk frames**, no attack/hurt/death. So all enemy expression is **AI + FX + tint**:
- Telegraph = a `Magic/Circle` ring under the feet (300–700 ms) + 80 ms white flash.
- Death = `FX/Elemental/Explosion` + fade out.
- Elite = **palette remap** over the 53 colours of `Palette.png` (no multiplicative tint), scale 1.15.

| Role | Health | Speed | Behaviour | Attack | Chapter 1 / 2 / 3 |
|---|---|---|---|---|---|
| **Chaser** | 6 | 3.2 tiles/s | charges straight at the player | contact deals 1 | BlueBat / SpiderRed / Snake3 |
| **Caster** | 4 | 1.6 tiles/s | keeps 4–6 tiles away, backs off when crowded, 900 ms cooldown | slow projectile, 500 ms telegraph | Eye / GreenOctopus / LanternRed |
| **Brute** | 10 | 1.2 tiles/s | slow, walks straight, 900 ms cooldown | charges at 7 tiles/s for 450 ms, 700 ms telegraph, contact deals 2 | Bear / TRex / Cyclope |

These numbers were verified by headless simulation, not picked by feel: at 2 DPS a 6-health chaser lives 3 s — enough to cover 9.6 tiles and reach the player, so **standing still loses**. The 8-tile range (instead of 10) is the deciding number: at 10 tiles the chaser dies while still ~6.4 tiles away and the player is never touched.

All numbers live in `game/config/tuning.json`; edit there and run `bun run gen`.

Difficulty scales per chapter:

| Chapter | Enemies per room | Composition |
|---|---|---|
| 1 | 3–4 | chaser, 1 caster from room 4 |
| 2 | 5–6 | chaser + caster + 1 brute from room 3 |
| 3 | 7–8 | all 3 types + elite |

Backups if silhouettes clash: YellowsBat, MouseBlack, LanternGreen, RedOctopus, Panda, Reptile2, Skull, GreyTrex.

---

## 5. Bosses

One boss per chapter, taken from `Actor/Boss`. Arena 32×18 tiles with 4 destructible stone pillars. Health: 60 / 80 / 100.

| Chapter | Boss | Available animations | Pattern |
|---|---|---|---|
| 1 | **TenguBlue** (frames 68×68 – 82×82) | idle 6, walk 10, **attack 15**, hit 8, **Trans 11** | (1) walk-chase + attack that fires a 5-shot spread; (2) adds `Trans` to teleport randomly, then fires an 8-shot ring; (3) enrage: 3 teleports in a row, 5-shot spread ×3 volleys |
| 2 | **SquidGreen** (76×79) | idle 4, walk 4, attack 6, **AttackLoop 4**, **Shoot 5**, hit 4 | (1) swims sideways + `Shoot` 5-shot spread; (2) `AttackLoop` sprays a continuous spiral; (3) summons 2 GreenOctopus, faster spiral |
| 3 | **GiantBlueSamurai** (frames 96×48 – 96×96) | idle 6, walk 6, **attack L/R 4**, **charge L/R 3**, hit 4 | (1) charges across the arena then slashes a straight bullet wave; (2) 2 charges in a row, changing direction; (3) charge leaves a fire trail + slash sends 2 waves |

Readability rule: each phase must have **a distinct tell** — Ch1 reads the spread direction, Ch2 reads the spiral rhythm, Ch3 reads the charge direction (the L/R animation is the tell).

Rejected: DemonCyclop, GiantFlam, GiantSpirit (no attack frames), Dragon* (0 animations).

---

## 6. Skills (pool of 20, frozen at v1)

After every room (except boss rooms): pick **1 of 3** cards. Taking the same skill again **stacks** it (max 5 stacks). Rarity affects the draw weight.

| # | Name | Rarity | Effect | Stack |
|---|---|---|---|---|
| 1 | Sharpen | common | +1 damage | 5 |
| 2 | Rapid Fire | common | +25% fire rate | 5 |
| 3 | Twin Shot | rare | +1 projectile (fires at ±12°) | 3 |
| 4 | Piercing | rare | bullets pierce 1 enemy | 3 |
| 5 | Ricochet | epic | bullet bounces to another enemy 1 time | 2 |
| 6 | Homing | epic | bullets home in on the target | 1 |
| 7 | Explosive | rare | bullet explodes for 1.5-tile AoE, 50% damage | 3 |
| 8 | Crit Eye | rare | 15% crit ×2 | 3 |
| 9 | Vitality | common | +1 max heart (heals 1 heart immediately) | 5 |
| 10 | Second Wind | epic | heals 2 hearts whenever you clear a room | 2 |
| 11 | Shield | rare | blocks 1 hit, recharges after 20 s | 3 |
| 12 | Thorns | rare | touching an enemy deals 2 damage to it | 3 |
| 13 | Swift | common | +10% run speed | 5 |
| 14 | Long i-frame | rare | i-frame 0.8 → 1.1 s | 2 |
| 15 | Freeze | rare | hits slow the enemy 40% for 1 s | 2 |
| 16 | Poison | rare | 1 damage/second for 3 s | 2 |
| 17 | Lifesteal | epic | 5% of damage heals (rounded down) | 2 |
| 18 | Greed | common | +25% gold picked up | 4 |
| 19 | Luck | rare | +1% weight for high rarities | 3 |
| 20 | Executioner | epic | +50% damage against enemies below 30% health | 2 |

---

## 7. Meta progression

Gold picked up during a run is kept after death. 3 permanent tracks, 10 levels each, with rising prices:

| Track | Per level | Levels | Price level 1 → 10 |
|---|---|---|---|
| Health | +1 heart | **5** | 50 → 180 |
| Damage | +5% | 10 | 40 → 400 |
| Fire rate | +3% | 10 | 40 → 400 |

Health caps at 5 levels (not 10) because 6 base hearts + 10 = 16 hearts overflows the 512×288 HUD, and the Vitality skill only grants +5. The price table still keeps all 10 steps in code so the cap can change without retuning.

No equipment, no second character, no skill unlocks.

---

## 8. Rooms and level design

- **Each room = exactly 1 screen.** Base resolution **512×288 px = 32×18 tiles of 16px**. No scrolling, **no camera follow needed**.
- **The wave count is per-room data** (`assets/resources/data/levels/chapter-<n>/*.tmx`), not hardcoded per chapter. `RunState` only tracks the current wave, it does not define the total.
- Obstacles: pillars, pits, low walls — used to dodge bullets, they never fully block line of fire.
- 3 chapters × 9 rooms = 27 rooms, hand-designed in Tiled, fixed order (no random layout) — randomness lives in skills, not maps.

| Chapter | Theme | Tilesets used |
|---|---|---|
| 1 | Grassland / forest | `TilesetNature` + `TilesetRelief` + `TilesetElement` + `TilesetField` |
| 2 | River / waterfall | `TilesetWater` + waterfall + ripples + `TilesetNature` for banks |
| 3 | Abandoned village | `TilesetVillageAbandoned` + `TilesetHouse` + `TilesetTowers` + `TilesetHole` |
| Boss arena | Same theme as the chapter | + 4 stone pillars (from `TilesetElement`) |
| Hub / shop | Camp | `tileset_camp` + `tileset_bed` + `Interior/*` |

No dungeon/crypt theme in the pack → not doing it. `TilesetFloor.png` is 417 px tall (not divisible by 16) → keep 26 rows, drop the last 1 px.

---

## 9. UI

| Screen | Content |
|---|---|
| Title | Play, Shop, Settings, Credits |
| Chapter select | 3 buttons, locked/unlocked, shows best |
| HUD | hearts, gold, skill icons (max 8), room counter `3/9` |
| Skill pick | 3 cards, hover shows description, click to pick |
| Pause | Resume, Restart run, Quit to title, volume |
| Results | rooms reached, gold collected, time, button back to meta shop |
| Meta shop | 3 tracks + prices, shows current gold |
| Settings | volume, fullscreen, shows keybinds (no rebinding at v1) |
| Credits | pack authors (not required for CC0, but appreciated) |

Controls: **mouse + keyboard**. No gamepad, no touch.

---

## 10. Save

`localStorage`, 1 slot:

```json
{
  "version": 1,
  "gold": 0,
  "upgrades": { "hearts": 0, "damage": 0, "fireRate": 0 },
  "chaptersUnlocked": 1,
  "best": { "chapter": 0, "room": 0 },
  "settings": { "volume": 0.8, "fullscreen": false }
}
```

The keys `hearts`/`fireRate` are the **in-code** names (`UpgradeTrack`). An earlier draft of
this document said `hp`/`firerate`; `migrate()` still reads the two old names on load so old
players' saves keep their levels, but written saves always use the new names.

**No** saving of the in-progress run (user's choice: the run is lost when the tab closes).

---

## 11. Out of scope for v1

Inventory, equipment, NPCs, dialog, hub, in-level shop, multiple characters, gamepad, mobile, localization, leaderboard, daily run, dash.

> From M9, **NPCs** (heal/sell only, no dialog) and the **in-run shop** leave this list — see §13.

---

## 12. Known risks

1. **Continuous fire** removes Archero's "stand still to shoot" tension. **Measured** with headless simulation: a player standing still cleared the 9 chapter 1 rooms in 60.8 s with **0 health lost** — the chaser dies before contact (2 DPS × 3 HP = 1.5 s, only enough for 3.6 tiles), the caster dies within its 1.2 s cooldown. Retuning via `config/tuning.json` with acceptance criteria: **standing still must lose within the first 3 rooms**, and a dodging player must survive ≥2× longer. If pressure still can't be created, the fallback is to bring back the stand-still-to-shoot rule as a skill.
2. **Only 1 animated character** (NinjaGreen), and it **has no run animation**, only a 4-frame walk → animation playback speed must scale with velocity, otherwise the character "slides" when moving fast.
3. **No monster has attack/hurt/death** → telegraph, getting hit and dying are all FX + tint. Risk: the player can't read the attacks. Required test at M3: 3 enemies must be distinguishable within 2 seconds.
4. **20 skills × 3 chapters** is a large balance surface; keep the pool frozen and only tune numbers.
5. `TilesetFloor.png` is off by 1 px and has no atlas JSON → the frame/animation table must be declared by hand; one wrong cell throws off the whole animation.

---

## 13. Post-v1 expansion (M8–M9)

Agreed 2026-11-18. Tasks and detailed acceptance criteria: `docs/milestones.md` M8/M9.

### 13.1 Visuals (M8 — no balance changes)

- **Juice:** shake in whole-texel steps, squash/stretch, muzzle flash, coins flying to the HUD, damage numbers (off by default).
- **Bullets tell the build:** the player bullet sprite follows the strongest element in the loadout (Explosive > Freeze > Poison > Homing > Piercing > default), grows when Sharpen ≥ 3, with an element-coloured trail; every skill effect gets its own impact; aura when the build is strong.
- **Shape language:** player bullets are **pointed**, enemy bullets are **round + dark outline**. This is a screen-readability rule, not just style — player bullet colour now follows the build, so colour can no longer separate friend from foe.
- **Chapter atmosphere** + living decor (animals, flags, plants) with no colliders, never covering bullets/telegraphs.
- **Accessibility:** Screen shake on/off, Damage numbers on/off, Effects Full/Reduced.

### 13.2 Content (M9)

| | v1 | M9 |
|---|---|---|
| Chapter | 3 | **4** (desert added after ch3) |
| Rooms per chapter | 9 fixed | pool of 15–18, run draws 9 by seed |
| Path | straight | after each room pick 1 of 2 doors, each door shows a reward icon |
| Special rooms | – | heal, mid-run shop, chest |
| Enemy roles | chaser / caster / tank | + **sniper**, **splitter** |
| Boss | 1 / chapter | pool of 2 / chapter, own music |

Boss pool: ch1 Tengu / GiantFrog · ch2 Squid / GiantSlime · ch3 Samurai / GiantBamboo · ch4 GiantRacoon / recoloured Tengu variant.

**The mid-run shop shares meta gold** (§7): spending during a run means coming home with less gold — the trade-off of “strong now versus strong forever”. Save (§10) bumps `version` when chapter 4 lands.

# GDD — Yokai Field Baseline Systems (v1 – M15)

Parent index: [docs/gdd.md](../gdd.md). Preserves §§3–15 of the original GDD verbatim for reference.

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

From M9 these counts are ×8 per normal room, delivered in waves (§13.2).

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

- **Each room = exactly 1 screen** (v1–M8). Base resolution **512×288 px = 32×18 tiles of 16px**. No scrolling, no camera follow. **From M9, normal rooms are larger than one screen with a follow camera (64×36 since #66); boss arenas keep this rule** (§13.2, ADR-018).
- **The wave count is per-room data** (`assets/resources/data/levels/chapter-<n>/*.tmx`), not hardcoded per chapter. `RunState` only tracks the current wave, it does not define the total.
- Obstacles: pillars, pits, low walls — used to dodge bullets, they never fully block line of fire.
- **What looks solid is solid** (from M9): rocks, trees, walls, houses, crates block the player, enemies and bullets; pits block walkers only. Enemies path around obstacles instead of pushing into them. Each chapter draws on a catalogue of solid and walk-over props from the pack (§13.2). A prop blocks only at its base (a tree at its trunk); canopies and roofs draw above actors and turn see-through when someone is under them; tall grass and bushes can be walked into and show the actor faded, as if hiding. Cover is visual only — no stealth.
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
| Room size | 32×18 tiles, 1 screen, static camera | **64×36 tiles** (4 screens, #66), camera follows; boss arena stays 32×18 static |
| Enemies per room | 3–8 (§4) | **×8** (ch1 24–32, ch2 40–48, ch3 56–64), in waves, ≤ 24 alive |
| Rooms per chapter | 9 fixed | pool of 15–18, run draws 9 by seed |
| Path | straight | after each room pick 1 of 2 doors, each door shows a reward icon |
| Special rooms | – | heal, mid-run shop, chest |
| Enemy roles | chaser / caster / tank | + **sniper**, **splitter** |
| Boss | 1 / chapter | pool of 2 / chapter, own music |

Boss pool: ch1 Tengu / GiantFrog · ch2 Squid / GiantSlime · ch3 Samurai / GiantBamboo · ch4 GiantRacoon / recoloured Tengu variant.

**Big rooms (ADR-018).** The view stays 32×18 tiles at the M7 zoom and follows the player: deadzone, eased look-ahead, clamped to the room, whole-texel snap, hard cut on entry. At 5 tiles/s crossing a 64×36 room takes ~13 s (#66), so the room is a field to sweep, not an arena. Fairness: enemies only attack while on screen, spawns are telegraphed and ≥ 6 tiles from the player, edge arrows point at off-screen enemies and, after the clear, at the doors.

**Run length** goes from ~10 min to ~30–60 min with 9 big rooms; the owner accepted this (2026-11-22).

**Skills come from levels (later).** M9 keeps "clear a room → pick 1 of 3". A later milestone replaces it with XP: kills give XP, each level up → pick 1 of 3, so a room with 8× the enemies also gives more skills. Not designed yet (status: idea).

**The mid-run shop shares meta gold** (§7): spending during a run means coming home with less gold — the trade-off of “strong now versus strong forever”. Save (§10) bumps `version` when chapter 4 lands.

---

## 14. Playable characters and weapons (design — future milestone)

**Not implemented yet.** The game still has one playable character with its weapon baked into the attack sprites, and no character select. This section is the design the **art pipeline** targets today (ticket #20), so bodies and weapons can be authored before the game-side work of M10 lands.

**Principles.**

- **Monsters and bosses keep their weapons baked into the sheet.** Their weapon is part of the silhouette and reads at 16 px; splitting it would cost frames for no gameplay.
- **A playable character is drawn unarmed.** The body sheet has no weapon in any frame, so a run can give it different weapons and the same body serves every loadout.
- **A weapon is one of three things:**
  | Form | How it is drawn | Examples |
  |---|---|---|
  | **Projectile** | its own FX sprite, spawned per shot, never attached | ninja shuriken / kunai |
  | **Held attachment** (`hand`) | a separate sprite placed on the body's hand point every frame | archer bow, mage staff |
  | **Worn attachment** (`back`) | a separate sprite on the back point, hideable | cultivator sword |
- **Draw order** is a per-direction rule, not a constant:
  - a `hand` item is drawn **behind** the body only while facing `up` (the arm is on the far side), in front for `down`, `left`, `right`;
  - a `back` item is drawn **behind** for every direction except `up`, where it is in front of the chest but still behind the head;
  - an item spec may override the list (`behind: ["up", "left"]`) when its silhouette needs it.
- **Bob.** The body moves a pixel or two between frames even when idle. An attachment follows: its offset includes the body's per-frame top-row delta, recorded from the staged sheet (`frameBob`), so the sword does not float while the character breathes. Animations staged separately merge into the same rig.
- **Hide/show.** A `back` item is a plain node the game can toggle, so a skill can hide it while its own effect is on screen.

**Examples.**

- **Ninja** — shuriken and kunai are projectiles (`fx.shuriken`, `fx.kunai`); the body stays unarmed, no attachment.
- **Archer** — bow is a `hand` attachment; the arrow is a projectile. Facing `up`, the bow is drawn behind the body.
- **Mage** — staff is a `hand` attachment; the cast VFX is a separate strip.
- **Cultivator** — sword is a `back` attachment, in front of the chest when facing `up`. While “Ten Thousand Swords” is active the sword is **hidden** and the flying blades are projectiles; when the skill ends the sword reappears, still following the bob.

**Data.** `assets/resources/data/attachments.json` holds, per character, its frame size, `hand`/`back` points (output-frame pixels) and the per-animation, per-direction bob, and, per item, its slot, sprite key, frame size, grip point and optional `behind` list. A pure module (`core/art/attachments.ts`) validates it and computes an item's offset and draw order for a given body frame; the game-side node work is M10.

---

## 15. Next expansion roadmap (M11–M15)

Agreed in the 2026-11-26 grill session. Each milestone ships and locks simulation balance before the next starts (detailed acceptance in `docs/milestones.md`, architectural records in ADR-019…023).

### 15.1 Visual overhaul: map, weather & UI (M11)

- **Weather (ADR-019):** remove `raylight`, `fog`, `vignette`, and `heat-haze` completely. Replace with crisp **1:1 pixel-scale** full-opacity particles from `FX/Particle/` matching the Ninja Adventure demo scenes:
  - Ch1: green leaves (`Leaf.png`) + pink blossoms (`LeafPink.png`) drifting diagonally + soft ground cloud shadows (`under-actors`).
  - Ch2: diagonal rain (`Rain.png`) + ground splash rings (`RainOnFloor.png`) + water ripples.
  - Ch3: crisp 1:1 ash/dry leaves + smoking campfires.
  - Ch4: crisp 1:1 wind-driven sand gusts + soft desert cloud shadows (`under-actors`).
- **Maps (ADR-020):** replace scattered single-tile floor noise with cohesive clusters (dense tree borders, village yards with houses + fences + carts/crates, desert oases & outposts). Upgrade **Ch2 rivers** to bordered, **impassable water (`pit`: blocks walkers, bullets fly over) crossed via wooden/stone bridges**. Re-palette **Ch3** ground to mossy olive grass + worn dirt paths matching the pack's abandoned village demo.
- **UI & HUD:** high-contrast HUD plates + icons (readable over bright Ch4 sand, reserving space for M12 XP bar and M13 Dash/Active widgets) and a full `Theme Wood` menu refresh.
- **Enemy difficulty retune — Tier 1:** reverse the `#66` over-nerf in `tuning.json` (Tank charge faster than player walk speed, faster Chasers/Splitlings, shorter Caster/Sniper/Tank cooldowns, stronger opening wave pressure, steeper Ch1 → Ch4 enemy HP & Elite scaling) targeting a **challenging roguelite** feel where 0-Meta runs face real risk of death in Ch1–Ch2 and heavy pressure in Ch3–Ch4 (validated by `bun run sim:table`).

### 15.2 XP & level-up (M12)

- Enemies drop **XP orbs** collected via magnetic pickup radius, with **room-clear auto-vacuum** so nothing is left behind.
- **Unified skill path (ADR-021):** remove end-of-room free skill picks; convert the `skill` door into an **`xp` / Elite door**. Target **12–16 level-ups per full chapter run** (`tuning.json` + `run-simulation`).
- Mid-combat level-up pauses simulation for 1-of-3 choice + **gold Reroll** (using a dedicated **skill-roll sub-seed**); closing the modal emits a **radial enemy knockback wave + 0.6 s i-frame** (bullets remain live).

### 15.3 Build & combat depth (M13)

- **Active controls (ADR-022, amends §3 / ADR-008):** add **Dash (`Space`)** with cooldown, short i-frame, and 150 ms action buffer, plus **1 Signature Active Skill (`E` / Right-Click)** recharging on a **base time cooldown of 14.25–16.5 s per class with no hit/kill reduction** (amended by #108; originally ~10 s accelerated by hits/kills) (150 ms action buffer). Basic shots stay **100% auto-fire**.
- **Pure-combat skill pool rebuild (replaces §6):** remove `Greed`, `Luck`, and all XP/Gold cards. Rebuild into **~24–28 pure-combat skills** across 4 pillars (Weapon/Offense, Elemental/Status, Defense/Survival, Mobility/Dash & Active) + **6–8 Legendary Evolutions** unlocked into the roll pool when prerequisite pairs are owned.
- **Enemy AI & threat escalation — Tier 2:** upgrade enemy AI (predictive lead shots / bursts, flanking chasers), add 1–2 new enemy roles (e.g. Bomber / Summoner-Buffer), and update boss patterns with Dash-pressuring attacks so combat stays tense once players have Dash, Active Skills, and Evolutions.

### 15.4 Playable characters & weapons (M14)

- Complete the 4 classes from §14 across all 3 weapon forms: **Ninja** (unlocked from start, `projectile`, *Shadow Barrage*), **Archer** (Ch1 clear or Meta gold, `hand` bow, *Piercing Volley*), **Mage** (Ch2 clear or Meta gold, `hand` staff, *Arcane Nova*), and **Cultivator** (Ch3 clear or Meta gold, `back` sword, *Ten Thousand Swords* hiding the back sword; retires `cultivatorEnabled`).
- Each class differs across **3 layers**: base stats & auto-fire feel, 1 starting Passive, and 1 Signature Active Skill, sharing the M13 skill pool & Evolutions.

### 15.5 Replayability, meta & QoL (M15)

- **Mid-run Save & Resume (ADR-023, revises §10 / ADR-012):** separate `profileSave` (+ backup key) and `runSave`, autosaved on room entry / door choice, resumed via `Continue Run` on Title; death immediately deletes `runSave`.
- **Endgame:** **Ascension Ladder (1–5)** per chapter (stacking modifiers + Gold% bonus) and **Continue Endless** looping Ch1–4 after beating the Chapter 4 Boss.
- **Meta Shop (extends §7):** add 3 Utility tracks (**XP Magnet**, **Gold Bonus**, **Free Rerolls**; no Revive) alongside the 3 stat tracks + early character unlocks.
- **QoL:** detailed Results/Death screen (seed, depth, cause of death, build + Evolutions, unlocks) and separate **Music / SFX** volume sliders (squared curve) with level-up/pause music ducking.


# GDD — M19 & M20: Art Assets, Skill Pruning & Class-Exclusive Skills

**Status:** `designed` · **Milestones:** [M19](../milestones/m16-m21.md#m19--generate-bộ-art-mới--tinh-gọn-kho-skill-nền), [M20](../milestones/m16-m21.md#m20--bộ-skill-độc-quyền-theo-nhân-vật--codex-chi-tiết-skill) · **ADR:** [ADR-027](../tech-decisions.md#adr-027--pruned-core-skill-pool-class-exclusive-skills--image-generator-assets-m19m20)

---

## 1. M19 — Asset Generation Batch (`image-generator`)

All generated assets follow `docs/art/gemini-style.md` (16px Ninja Adventure aesthetic, 53-color palette discipline, transparent background, nearest-neighbor downscaling, zero bilinear blur, validated by `art-files.test.ts`):

1. **6 Character & NPC Portraits (`64×64 px` pixel-art busts):**
   - Playable heroes: **Ninja**, **Archer (Cung Thủ)**, **Mage (Pháp Sư)**, **Cultivator (Tu Tiên)** — displayed next to the top-left HUD HP bar, in Character Select / Skill Codex, and in Victory/Death summaries.
   - Village NPCs: **Shopkeeper (Chủ Shop)**, **Dojo Master (Võ Sư)** — displayed in M21 RPG dialog boxes.
2. **20 New Skill Icons (`24×24 px` pixel-art + Disabled variants):**
   - Unique, unmistakable icons for all **16 class-exclusive skills** and **4 Class Legendary Evolutions**.
3. **Class VFX & Pickup Sprites:**
   - Orbiting Spirit Sword (`fx.orbit-sword`), Sword Array rune circle (`fx.sword-array`), Meteor projectile & crater (`fx.meteor`), Orbiting Frost Orb (`fx.frost-orb`), Arrow Rain volley (`fx.arrow-rain`), Shadow Clone tint/silhouette, Crescent Sword Qi wave (`fx.sword-qi`), and glowing Health Potion (`fx.health-potion`) + Portal archway (`fx.portal-gate`, built in M17 or polished in M19).

---

## 2. M19 — Shared Core Skill Pool Pruning (`27 → 21`)

Remove **6 low-excitement / passive stat-stick skills** from `core/skills/pool.ts`:
- **Removed:** `long-iframe`, `thorns`, `iron-skin`, `corrosive`, `second-wind`, `executioner`.
- **Kept (21 high-impact shared skills):**
  - *Weapon (8):* `sharpen`, `rapid-fire`, `twin-shot`, `piercing`, `ricochet`, `homing`, `explosive`, `crit-eye`.
  - *Elemental (5):* `freeze`, `poison`, `ignite`, `chain-lightning`, `lifesteal`.
  - *Defense (2):* `vitality`, `shield`.
  - *Mobility / Active (6):* `swift`, `phantom-dash`, `dash-nova`, `shadow-conduit`, `arcane-surge`, `afterimage`.
- **Evolution update:**
  - Rewire `aegis-retribution` prerequisite from `['shield', 'thorns']` → **`['shield', 'vitality']`** (when shield absorbs a hit, emits a damaging shockwave & recharges faster).
  - Existing run saves containing removed skill IDs are silently ignored on load (`resolveOwnedSkills` already skips unknown IDs safely).

---

## 3. M20 — Class-Exclusive Skills & Class Legendary Evolutions

When rolling level-up cards (`core/skills/roll.ts`), the candidate pool is **`Shared Core (21)` + `Class-Exclusive (4)` + unlocked `Shared & Class Evolutions`**. Class-exclusive cards carry a distinct class crest badge on the skill-pick card and never appear for other classes.

### Ninja (*Nhẫn Giả*)
| ID | Vietnamese Name | Mechanic | Rarity | Max Stacks |
|---|---|---|---|---|
| `ninja-shadow-clone` | *Phân Thân Ám Ảnh* | Dashing spawns a stationary shadow decoy for `2.5 s` that auto-fires shurikens at nearby enemies (`50%` dmg). | Rare | 3 |
| `ninja-venom-shuriken` | *Phi Tiêu Độc Vụ* | Every 3rd shot throws a giant venom shuriken that bursts into a lingering poison cloud AoE. | Rare | 3 |
| `ninja-kunai-burst` | *Liên Hoàn Kunai* | Killing an enemy bursts `4` kunai radially (`+2`/stack) from the corpse. | Common | 3 |
| `ninja-smoke-bomb` | *Bom Khói Ẩn Thân* | Dash or Active (`E`) drops a smoke zone (`2.8` tiles, `3 s`) slowing enemies inside by `45%` and boosting fire rate `+30%`. | Epic | 2 |
| **Evo:** `ninja-phantom-assassin` | **Ảnh Sát Tuyệt Kỹ** | *Requires `ninja-shadow-clone` + `ninja-kunai-burst`.* Clones fire guaranteed crit shurikens and trigger *Liên Hoàn Kunai* on kill. | Legendary | 1 |

### Archer (*Cung Thủ*)
| ID | Vietnamese Name | Mechanic | Rarity | Max Stacks |
|---|---|---|---|---|
| `archer-arrow-rain` | *Mưa Tên* | Every 5th shot calls down an AoE arrow volley (`2.2` tiles) onto the target's position. | Rare | 3 |
| `archer-split-arrow` | *Tên Tách Chùm* | Arrows piercing their first target split into `2` angled secondary arrows (`±18°`). | Rare | 3 |
| `archer-hunters-mark` | *Ấn Ký Săn Mồi* | Hits apply a Hunter's Mark; critting a marked enemy detonates the mark for AoE burst damage. | Epic | 2 |
| `archer-wind-arrow` | *Phong Tiễn* | Consecutive hits stack Wind momentum (up to 10 stacks) granting faster projectile speed & fire rate. | Common | 3 |
| **Evo:** `archer-sky-tempest` | **Thiên Tiễn Lôi Đình** | *Requires `archer-arrow-rain` + `archer-split-arrow`.* Arrow Rain pierces and spawns split arrow volleys on impact. | Legendary | 1 |

### Mage (*Pháp Sư*)
| ID | Vietnamese Name | Mechanic | Rarity | Max Stacks |
|---|---|---|---|---|
| `mage-meteor` | *Thiên Thạch* | Periodically drops a blazing meteor (`every 4.5 s`, faster per stack) onto the densest enemy cluster for heavy AoE + burn. | Epic | 3 |
| `mage-frost-orbs` | *Vệ Tinh Băng* | Summons `2` (`+1`/stack) orbiting frost spheres around the Mage dealing contact damage + heavy slow. | Rare | 3 |
| `mage-storm-strike` | *Lôi Ngục* | Hits have a `20%` (`+10%`/stack) chance to call a vertical lightning bolt onto the nearest enemy. | Rare | 3 |
| `mage-arcane-pulse` | *Xung Năng Ma Pháp* | Every 4th shot triggers an arcane blast ring around the struck enemy (`1.8` tiles AoE). | Common | 3 |
| **Evo:** `mage-elemental-cataclysm` | **Thiên Tai Nguyên Tố** | *Requires `mage-meteor` + `mage-frost-orbs`.* Orbs spin faster, fire ice shards, and trigger shatter-burn double damage on ignited foes. | Legendary | 1 |

### Cultivator (*Tu Tiên*)
| ID | Vietnamese Name | Mechanic | Rarity | Max Stacks |
|---|---|---|---|---|
| `cultivator-orbit-swords` | *Ngự Kiếm Hộ Thể* | `2` (`+1`/stack) flying spirit swords orbit the Cultivator and automatically dart out to slash nearby enemies before returning. | Rare | 3 |
| `cultivator-sword-array` | *Kiếm Trận* | Casting Active (`E`) or slaying an Elite plants a `3.2`-tile Sword Array on the ground slicing all enemies inside for `3 s`. | Epic | 2 |
| `cultivator-sword-qi` | *Kiếm Khí Bán Nguyệt* | Every 3rd shot unleashes a wide crescent Sword Qi wave piercing all enemies along its path. | Common | 3 |
| `cultivator-qi-barrier` | *Hộ Tâm Linh Khí* | Dealing damage charges a Qi gauge; at 100% grants a Qi shield absorbing 1 hit and blasting sword-qi waves outward. | Rare | 3 |
| **Evo:** `cultivator-myriad-swords` | **Vạn Kiếm Quy Tông** | *Requires `cultivator-orbit-swords` + `cultivator-sword-array`.* Orbiting swords fire mini Sword Qi waves and periodically plant Sword Arrays automatically. | Legendary | 1 |

---

## 4. M20 — Character Detail & Skill Codex UI

Upgrades Character Select (and plugs directly into M21's Dojo Master) into a complete **Character & Skill Inspector**:
- Left column: 4 character tabs with **64×64 pixel portrait**, lock/unlock badge, and live animated 4-direction sprite preview (with equipped hand/back weapon).
- Right column:
  - Base HP (`100 / 85 / 85 / 120`), weapon form & attack speed summary.
  - **Nội Tại (Starting Passive)** card with icon & description.
  - **Tuyệt Kỹ `[E]` (Signature Active)** card with icon, cooldown & effect.
  - **Bộ Kỹ Năng Độc Quyền (Class-Exclusive Skills + Class Evolution)** scrollable/grid list showing all 4 class skills + their Legendary Evolution pair recipe so players understand each class's build fantasy before embarking.

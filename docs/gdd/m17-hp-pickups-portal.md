# GDD — M17: RPG HP System, Top-Left HUD, Glowing Pickups & Single North Portal

**Status:** `designed` · **Milestone:** [M17](../milestones/m16-m21.md#m17--hệ-hp-rpg-hud-mới-vật-phẩm-phát-sáng--1-cổng-bắc-vfx-mới) · **ADR:** [ADR-025](../tech-decisions.md#adr-025--rpg-hp-scale-unified-top-left-hud--single-north-portal-m17)

---

## 1. RPG HP Scale (`100 HP` Base)

Replaces the 5–7 integer heart model (`playerMaxHearts: 6`) with a granular integer HP pool so Lifesteal, healing drops, damage reduction, and class survivability scale smoothly without rounding-to-zero distortion.

| Parameter | Value | Notes |
|---|---|---|
| Base player HP (`combat.playerBaseMaxHp`) | `100` | Equivalent to 20 HP per legacy heart |
| Character base HP | Ninja `100` · Archer `85` · Mage `85` · Cultivator `120` | `characters.<id>.baseStats.maxHpDelta` (`0 / -15 / -15 / +20`) |
| Meta Shop "Máu" (`hearts` track, kept key for save compat) | `+20 HP` / level (max 5 levels → `+100 HP`) | Existing save upgrade levels migrate 1:1 with zero loss |
| Skill *Sinh Lực* (`vitality`) | `+25` max HP & heals `25` immediately per stack | Max 5 stacks |
| Normal enemy contact / bullet damage | `15 – 20 HP` | Scaled by chapter & Ascension |
| Heavy hits (Tank charge, Bomber blast, Sniper, Boss) | `25 – 35 HP` | Elite multiplier `×1.5` |
| Expected survival margin (0-Meta) | `4 – 6` hits before death | Preserves tight bullet-hell tension |
| Mid-run Heal NPC / Shop refill | Heals `50%` max HP (or `50 HP` flat `[ASSUMPTION]`) | Tuned in `config/tuning.json` |

---

## 2. Top-Left Unified HUD (HP Bar + XP Bar)

- **HP Bar** replaces the heart icon row at **top-left**:
  - High-contrast dark pixel plate + crimson/emerald-to-red health fill + **delayed white damage-drain trail** (`~350 ms` ease-out on hit, `game-feel`) + crisp numeric text `85/100`.
  - Reserves a compact portrait frame slot on the immediate left edge for the M19 Character Avatar (`24×24` / `28×28` design px).
- **XP Bar + `LV X` Badge** moves from bottom-centre to **directly underneath the HP Bar** at top-left:
  - Compact width aligned to the HP bar, cyan fill with bright highlight, gold flash on level-up.
  - Frees the entire bottom-centre edge of the playfield for dodging incoming bullets from below.
- **Event-driven updates (`game-ui-ux`)**: HUD subscribes to HP / XP / Level / Gold / Skill / Action events rather than polling per frame.

---

## 3. Small Glowing Pickups & Health Potion Drop

All combat drops become compact, readable, pooled physical world pickups:

| Pickup | Visual size | Glow / Color | Collection rule | Drop rate / source |
|---|---|---|---|---|
| **XP Crystal** (`small` / `medium` / `large`) | `6 – 9 px` (`0.4 – 0.56` tile) | Pulsing cyan / violet / gold pixel halo | Magnet radius + **room-clear auto-vacuum** | Every enemy kill (scaled by role & elite) |
| **Gold Coin** | `6 – 7 px` (`~0.4` tile) | Pulsing warm gold halo + sparkle | Magnet radius + **room-clear auto-vacuum** (flies to HUD gold counter on pickup) | Every enemy kill (replaces instant-only HUD fly) |
| **Health Potion** (`Bình Hồi Máu`) | `8 – 9 px` (`~0.55` tile) | Pulsing emerald-green / ruby halo + subtle heart/cross glint | Magnet-pulled when `hp < maxHp`; on room-clear vacuum if player is already full HP, converts to bonus gold (`+5g` `[ASSUMPTION]`) so nothing is wasted | **Low drop chance**: `3.5%` normal enemy, `14%` Elite `[ASSUMPTION]` (tuned in `tuning.json`). Heals **`25%` max HP**. |

All pickups sit on a pre-allocated pooled node layer (`0` runtime allocations per kill), render strictly below bullets and telegraphs, and respect `Effects: Reduced` (static subtle ring instead of animated pulse).

---

## 4. Single North Portal, Special Room Cadence & Portal VFX

### Flow (revises ADR-014 two-door choice)
- After clearing any normal room, **only 1 portal opens at the North (top-centre) edge** of the room (`level.doors` resolves to a single north spot).
- **Progression cadence (9 rooms per chapter):**
  - Rooms 1–4: combat rooms connected via North Portal.
  - After clearing Room 4: North Portal leads automatically to **1 mid-chapter Special Room** (seeded choice between Mid-Run Shop or Treasure Chest / Shrine, preserving existing `special-room-view` + `shop-panel` without branching doors).
  - Rooms 5–8: combat rooms scaling up in enemy density.
  - After clearing Room 8: North Portal ignites as the **Boss Portal** leading into Room 9 (Chapter Boss).
- Edge pointer arrow guides the player straight toward the single North Portal when off-screen.

### Upgraded Portal VFX
Replaces the flat static `Graphics` rectangle in `door-view.ts`:
1. **Activation burst** when the final enemy dies: bright radial flash + expanding shockwave ring + portal-open SFX.
2. **Multi-layer animated portal**: pixel-art gate/rune archway sprite (generated via `image-generator`) + **continuously rotating multi-ring energy vortex** + **upward-drifting luminous particles** (pooled, 60 fps).
3. **Color-coded by destination**:
   - **Normal Portal**: jade / arcane cyan swirl.
   - **Special Room Portal** (Shop / Chest): radiant warm gold swirl.
   - **Boss Portal**: intense crimson / violet lightning swirl with pulsing warning aura.

---

## 5. Room-Clear Movement Speed Boost

- The moment a combat room is cleared (`enemiesRemaining === 0` and all waves spawned), the player gains an **out-of-combat movement speed boost of `+45%`** (`×1.45` moveSpeed `[ASSUMPTION]`, in `tuning.json`) until entering the next room.
- Accompanied by a subtle foot-wind / dust streak feedback (`game-feel`) so crossing a `64×36` room up to the North Portal feels crisp and snappy.
- Boost immediately resets to `1.0×` on entering the next room (never leaks into combat or Boss fights).

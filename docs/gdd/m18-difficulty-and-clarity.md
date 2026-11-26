# GDD — M18: Bullet-Hell Difficulty, New Enemies & Visual Clarity

**Status:** `designed` · **Milestone:** [M18](../milestones/m16-m21.md#m18--độ-khó-bullet-hell-bỏ-knockback-2-quái-mới--chống-lẫn-môi-trường) · **ADR:** [ADR-026](../tech-decisions.md#adr-026--bullet-hell-lethality-no-enemy-knockback--combat-clarity-m18)

---

## 1. Remove Enemy Hit Knockback & Stagger (amends ADR-008)

- **Problem:** Knockback (`0.35` tiles) + stagger (`150 ms`) on every auto-fire hit lets players effortlessly stunlock and push back chasing enemies without dodging.
- **Rule:**
  - Set `combat.enemyKnockbackDistanceTiles = 0`, `combat.enemyKnockbackDurationMs = 0`, and `combat.enemyStaggerMs = 0` in `game/config/tuning.json`.
  - Keep crisp hit feedback: **white hit-flash (`80 ms`) + area-preserving squash/stretch + brief micro-hitstop on crits** (`game-feel`), so shots still feel punchy without stopping enemies in their tracks.
  - **Exception kept:** the **Level-Up resume radial push wave + 0.6 s i-frame** (ADR-021) stays active so closing the mid-combat level-up modal never causes unavoidable contact damage.

---

## 2. Difficulty Escalation & Wave Scaling

All tuning lives in `game/config/tuning.json` and is locked via `bun run sim:table`:

- **Enemy movement speed:** `+25% to +35%` across roles (e.g., Chaser `2.75 → ~3.6` tiles/s, Splitling `2.9 → ~3.8`, Caster `1.6 → ~2.1`, Bomber `2.55 → ~3.2` `[ASSUMPTION]`).
- **Enemy bullet speed:** `+40% to +60%` (e.g., Caster/Buffer `3.2–5 → ~6.5–7.5` tiles/s, Sniper `10 → ~13` tiles/s, Boss spreads faster `[ASSUMPTION]`).
- **Room-by-room & chapter scaling:**
  - Raise opening `aliveCapStart` (`4 → 7` `[ASSUMPTION]`) and per-room `aliveCapStepPerRoom` (`3 → 4`), scaling toward `28–32` alive cap in late chapters while maintaining 60 fps.
  - Steeper `chapters.enemyHealthMultipliers` and `chapters.enemyDamageMultipliers` across Ch1 → Ch4 so later rooms and chapters steadily escalate enemy volume and lethality.
- **Simulation acceptance bar (`bun run sim:table`):**
  - Standing still loses Room 1 in **`< 6 s`** across all chapters/classes.
  - 0-Meta runs with imperfect dodging face genuine death risk even in Ch1–Ch2; Ch3–Ch4 require strong movement, Dash/Active timing, good skill synergies, and Meta progression.
  - Skilled dodge + full build still clears all 4 chapters across all 4 classes deterministically.

---

## 3. Two New Enemy Roles (`dasher` & `gunner`)

Using unused monster sheets from `art-source/ninja-adventure/Actor/Monster/` (plus build-time Elite palette remaps per ADR-015):

| Role | Vietnamese Name | Behavior & Attack | Baseline Stats `[ASSUMPTION]` | Chapter Sprites (Ch1 / Ch2 / Ch3 / Ch4) |
|---|---|---|---|---|
| **`dasher`** | *Ám Sát* (Shadow Stalker) | Fast diagonal flanker (`~4.0` tiles/s); when within `3–6` tiles, plays a brief **`350 ms` telegraph** then **dashes at `9.5` tiles/s for `280 ms`** to cut off escape lines. Elite dashes twice. | HP `6`, contact `20 HP`, CD `1800 ms` | `Owl` / `Reptile` / `Spirit` / `Beast` |
| **`gunner`** | *Pháo Thủ Chùm* (Volley Shooter) | Maintains medium range (`5–8` tiles); `550 ms` telegraph then fires a **3-bullet fan spread at `7.5` tiles/s** (scaling to 5-bullet fan in Ch3–4; Elite fires 2 staggered alternating volleys). | HP `7`, bullet `18 HP`, CD `2300 ms` | `Lizard` / `Octopus2` / `Skull` / `Dragon` |

Both roles integrate cleanly with the flow-field navigator, line-of-sight checks, on-screen attack fairness gate (ADR-018), XP orb table, and headless simulator (`core/sim/`).

---

## 4. Combat Visual Clarity (amends ADR-019)

Ensures enemies and enemy bullets read instantly at a glance in every chapter (including bright Ch4 desert sand and dense Ch1 forests):

1. **Remove living animals from combat rooms:**
   - Disable `LivingDecor` wandering animals inside combat rooms (`visibleAtmosphere` combat flag). Keep animal code & sprites intact so all critters move to the **Village Hub** in M21.
   - Static/subtle background props (flags/flowers) stay strictly under actors with muted alpha (`~0.65` `[ASSUMPTION]`).
2. **Soften combat weather particles:**
   - Keep 1:1 pixel scale (ADR-019), but reduce over-actor weather opacity in combat rooms to **`30–40%`** (`alpha 80–102`) and trim particle count by `~35–40%` `[ASSUMPTION]` so drifting leaves, blossoms, rain, and sand never visually mimic projectiles.
3. **High-contrast enemies:**
   - Add a **crisp dark ground shadow ellipse** under every enemy's feet (scaled to enemy size, stronger tinted ring for Elites) + **1 px dark silhouette outline** baked into staged monster sprites (or palette-safe outline pass at staging time — zero runtime shader cost, preserving ADR-017).
4. **High-contrast enemy bullets:**
   - Every enemy bullet (`fx.energy-ball`, `fx.bubble`, `fx.canon-ball`, `fx.fireball`) renders with a **bright high-luminance inner core + thick dark outer rim + subtle hostile glow halo** (warm crimson/magenta/amber contrast against terrain) so enemy shots pop immediately against grass, water, ruins, and sand.

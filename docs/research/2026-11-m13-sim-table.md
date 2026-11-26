# M13 Balance Sim Table (Ticket T5 — Active Controls, Pure-Combat Skills, Evolutions & Tier-2 AI) — 2026-11-26

End-to-end balance proof for **M13 Ticket T5** (GDD §15.3, ADR-022), run with `cd game && bun run sim:table` on the full M13 combat stack:

- **Active controls + 150 ms game-time buffer (`core/input/{action-buffer,dash,active-skill}.ts`):**
  - **Dash (`Space`):** `DashState` (`tryStartDash`, `stepDash`, `dashVelocity`, `DASH_TUNING`) with 220 ms dodge i-frames (no Shield charge spent during Dash i-frames), `phantom-dash` / `shadowstep` cooldown scaling, `afterimage` speed + post-dash fire-rate boost, and `dash-nova` radial AoE burst.
  - **Signature Active (*Shadow Barrage*, `E` / Right-Click):** `ActiveSkillState` (`tryActivateSkill`, `stepActiveSkill`, `onActiveHit`, `onActiveKill`, `computeShadowBarrageVolley`, `ACTIVE_SKILL_TUNING`) firing 10–12 piercing + homing shadow shurikens with time + auto-fire hit + kill recharge (active blades do not self-refund their own cooldown) and `shadow-conduit` / `arcane-surge` / `tempest-barrage` scaling across normal rooms and boss arenas.
- **Rebuilt 27 pure-combat skills + 7 Legendary Evolutions (`core/skills/{pool,evolutions,derived-stats,roll}.ts`):** zero economy/luck cards (`Greed`/`Luck` removed); models Burn DoT (`ignite` / `cataclysm`), Chain Lightning shock arcs (`chain-lightning`), Status Amp (`corrosive` / `blightfrost`), Iron Skin ward & shield cooldown mult (`iron-skin`), Dash/Active modifiers, and pairing-aware 1-of-3 XP level-up rolls.
- **Tier-2 enemy AI & Boss sweeps (`core/enemies/{bomber,buffer,behaviours,navigation,wave-scheduler}.ts`, `core/boss/patterns.ts`):** predictive lead aiming & Ch3–Ch4 multi-shot bursts (`casterShotPlan`), flanking chasers (`computeFlankTarget`), Bomber fuse telegraphs + radial AoE blasts + elite double-pulse shockwaves (`919` bombers fought across 24 runs), Buffer haste auras via unclamped `EnemyBuffTracker` speed multiplier (`587` buffers fought across 24 runs), and Phase 2/3 Boss wide `'sweep'` & `'zone'` volleys.
- **M12 baseline:** `docs/research/2026-11-m12-sim-table.md` (pre-Dash, pre-Active, old skill pool with `Greed`/`Luck`, no Evolutions, Tier-1 enemies).

---

## Summary Metrics (M12 T5 vs M13 T5)

| Metric | M12 T5 (XP economy, Tier-1) | M13 T5 (Dash + Active + Evolutions + Tier-2 AI) | Delta / Notes |
| --- | --- | --- | --- |
| Stand still loses Room 1 (`0/9`, no Dash/Active/skills) | 24/24 (`7–15 s`, avg `11.2 s`) | **24/24 (`8–24 s`, avg `11.8 s`)** | 100% lethal when stationary; slight flanking approach spread in Ch3 |
| Dodge + XP kit wins (`9/9`) | 24/24 | **24/24** | 100% clearable from 0-skill start across all 4 chapters & 8 bosses |
| Level-ups per run in `12–16` band | 24/24 (`13–15`, avg `14.2`) | **24/24 (`13–16`, avg `14.7`)** | Cleanly centered across all 4 chapters (`Ch1 13–16 · Ch2 14–16 · Ch3 13–16 · Ch4 14–16`) |
| Dash activations (`Space`) | *(N/A)* | **24/24 (`2–18`, avg `6.3/run`, `151` total)** | Scales with Tier-2 pressure (`Ch1 2–4 · Ch2 2–9 · Ch3 3–9 · Ch4 6–18`; `7` boss-arena dashes) |
| Signature Active casts (*Shadow Barrage*) | *(N/A)* | **24/24 (`32–143`, avg `69.7/run`, `1,672` total)** | Active in `22/24` boss arenas (`23` boss casts) + wave rooms |
| Legendary Evolutions unlocked | *(N/A)* | **18/24 rows (`28` unlocked)** | 5 distinct Evolutions triggered (`phantom-volley` ×11, `tempest-barrage` ×6, `cataclysm` ×6, `starfall-kunai` ×3, `aegis-retribution` ×2) |
| Combat pressure & damage taken | `13/24` rows hit (`26` hits) | **`1/24` rows hit (`2` hits) + `151` reactive Dash evades + `1` Shield block** | Reactive Dash i-frames + pure-combat builds absorb hits that previously connected, while 0-skill runs still die 12/12 |
| Clear time range (9/9) | `3m09s – 11m12s` | **`2m36s – 7m23s`** | Brisker pacing from pure-combat skill pool, Shadow Barrage, and Evolutions |

---

### 0-Skill Survival Check (`BALANCE_SEEDS = [1, 7, 42]`, Ch1–Ch4)

Both baseline **0-skill dodge (no Dash/Active/skills)** and **0-skill + innate Dash & Active (still no XP skills)** were measured across all 4 chapters:

| Chapter | Seed | Stand Still | 0-Skill Dodge (baseline) | 0-Skill + Dash + Shadow Barrage |
| --- | --- | --- | --- | --- |
| Ch1 | 1 | lost, 0/9, 12.5 s | lost, 6/9, 531.1 s (42.6×), 6 hits | won, 9/9, 294.4 s, 1 hit (27 dashes, 46 actives) |
| Ch1 | 7 | lost, 0/9, 13.3 s | lost, 2/9, 350.3 s (26.3×), 4 hits | lost, 3/9, 180.2 s, 5 hits (19 dashes, 29 actives) |
| Ch1 | 42 | lost, 0/9, 11.3 s | lost, 6/9, 778.4 s (68.8×), 5 hits | won, 9/9, 313.9 s, 2 hits (37 dashes, 50 actives) |
| Ch2 | 1 | lost, 0/9, 13.1 s | lost, 2/9, 298.1 s (22.8×), 6 hits | won, 9/9, 427.2 s, 4 hits (40 dashes, 64 actives) |
| Ch2 | 7 | lost, 0/9, 9.5 s | lost, 1/9, 372.8 s (39.4×), 6 hits | lost, 4/9, 321.2 s, 5 hits (27 dashes, 48 actives) |
| Ch2 | 42 | lost, 0/9, 12.3 s | lost, 2/9, 211.4 s (17.1×), 4 hits | won, 9/9, 498.6 s, 5 hits (40 dashes, 75 actives) |
| Ch3 | 1 | lost, 0/9, 23.7 s | lost, 2/9, 551.2 s (23.2×), 2 hits | lost, 7/9, 544.4 s, 5 hits (31 dashes, 80 actives) |
| Ch3 | 7 | lost, 0/9, 17.5 s | lost, 1/9, 372.0 s (21.2×), 3 hits | lost, 4/9, 519.2 s, 4 hits (29 dashes, 74 actives) |
| Ch3 | 42 | lost, 0/9, 12.6 s | lost, 2/9, 728.7 s (57.7×), 3 hits | lost, 2/9, 285.6 s, 3 hits (11 dashes, 41 actives) |
| Ch4 | 1 | lost, 0/9, 16.3 s | lost, 2/9, 633.6 s (38.9×), 5 hits | lost, 8/9, 696.4 s, 6 hits (67 dashes, 107 actives) |
| Ch4 | 7 | lost, 0/9, 9.4 s | lost, 2/9, 958.0 s (102.2×), 4 hits | lost, 5/9, 639.5 s, 4 hits (64 dashes, 97 actives) |
| Ch4 | 42 | lost, 0/9, 12.0 s | lost, 3/9, 952.5 s (79.4×), 5 hits | lost, 2/9, 221.9 s, 5 hits (15 dashes, 31 actives) |

- **Baseline 0-skill:** **12/12 lost** (`0%` clear rate), clearing `1–6` rooms and surviving `17.1×–102.2×` longer than standing still — proving Room 1 remains fair and readable at Level 1 while full chapters strictly require build progression.
- **0-skill + Dash + Active:** loses **6/6** across Ch3–Ch4 (`2/9–8/9`) and takes heavy hit pressure (`1–5` hits) in Ch1–Ch2, proving Dash and Shadow Barrage reward mechanical play in early chapters without turning late chapters into a 0-skill cakewalk.

---

## `game/config/tuning.json` Deltas (M13 Wave 1 `3d07422d` → M13 T5 Final)

All `dash`, `activeSkill`, `xp`, `doors`, `waves`, and classic Room-1 base role stats (`chaser`/`caster`/`tank`/`sniper`/`splitter`) remain untouched so Room-1 onboarding stays crisp. Only late-chapter scaling, Boss HP, predictive aim, and M13 Bomber/Buffer tempo (which enter from Room 2+/4+) were refined to counter M13's pure-combat pool, Dash, Shadow Barrage, and Evolutions:

| Key | M13 Wave 1 (`3d07422d`) | M13 T5 (Final) | Rationale |
| --- | --- | --- | --- |
| `chapters.enemyHealthMultipliers` | `[1, 1.06, 1.11, 1.16]` | **`[1, 1.1, 1.18, 1.28]`** | Keeps Ch1 (`1.0`) unchanged while giving Ch2–Ch4 waves enough durability to pressure Dash/Evolutions |
| `boss.healthByChapter` | `[80, 110, 140, 170]` | **`[95, 135, 175, 220]`** | Ensures bosses reach and execute Phase 2/3 wide `'sweep'` & `'zone'` patterns against Shadow Barrage + Evolutions |
| `enemies.ai.predictiveLeadFactor` | `0.45` | **`0.52`** | Sharpens Ch3–Ch4 regular caster lead shots to punish linear kiting |
| `enemies.ai.elitePredictiveLeadFactor` | `0.65` | **`0.72`** | Sharpens elite caster volleys so Dash timing matters |
| `enemies.ai.predictiveMaxLeadTiles` | `2.4` | **`2.6`** | Slightly wider lead cap while remaining cleanly beatable by Dash / sharp turns |
| `enemies.roles.bomber.speedTilesPerSecond` | `2.3` | **`2.55`** | Bombers close range reliably in Rooms 2–8 |
| `enemies.roles.bomber.attackCooldownMs` | `2800` | **`2400`** | Higher fuse-blast cadence |
| `enemies.roles.bomber.blastRadiusTiles` | `2.4` | **`2.6`** | Clearer Dash-worthy radial danger zone |
| `enemies.roles.buffer.attackCooldownMs` | `4200` | **`3500`** | Buffers maintain haste uptime on nearby allies in Ch2–Ch4 |
| `enemies.roles.buffer.buffSpeedMultiplier` | `1.3` | **`1.35`** | Noticeable haste boost (now applied unclamped in `run-simulation.ts:advanceEnemy`) |

---

## 24-Row Comparison Table (M12 T5 vs M13 T5)

| ch | seed | boss | stand still | M12 dodge + XP skills | M13 dodge + M13 kit | M13 level-ups | dashes | actives | evolutions | doors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 12 s | won, 9/9, 4m32s, 0 hits | won, 9/9, 3m24s, 0 hits | 16 (Lv 17) | 2 | 40 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| 1 | 2 | frog | lost, 0/9, 10 s | won, 9/9, 4m17s, 1 hit | won, 9/9, 3m12s, 0 hits | 15 (Lv 16) | 2 | 58 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| 1 | 3 | frog | lost, 0/9, 9 s | won, 9/9, 3m09s, 0 hits | won, 9/9, 2m36s, 0 hits | 13 (Lv 14) | 4 | 32 | — | heal, xp, xp, xp, xp, heal, xp |
| 1 | 4 | frog | lost, 0/9, 14 s | won, 9/9, 3m52s, 0 hits | won, 9/9, 3m11s, 0 hits | 14 (Lv 15) | 4 | 40 | — | xp, gold, heal, xp, xp, xp, xp |
| 1 | 5 | tengu | lost, 0/9, 10 s | won, 9/9, 4m10s, 1 hit | won, 9/9, 3m03s, 0 hits | 14 (Lv 15) | 2 | 37 | cataclysm | xp, xp, heal, xp, xp, xp, xp |
| 1 | 6 | tengu | lost, 0/9, 13 s | won, 9/9, 4m05s, 0 hits | won, 9/9, 2m37s, 0 hits | 14 (Lv 15) | 3 | 42 | tempest-barrage | chest, xp, xp, xp, heal, xp, xp |
| 2 | 1 | slime | lost, 0/9, 13 s | won, 9/9, 6m14s, 0 hits | won, 9/9, 4m46s, 0 hits | 16 (Lv 17) | 4 | 57 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| 2 | 2 | squid | lost, 0/9, 10 s | won, 9/9, 6m24s, 0 hits | won, 9/9, 4m36s, 0 hits | 15 (Lv 16) | 5 | 81 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| 2 | 3 | slime | lost, 0/9, 8 s | won, 9/9, 4m13s, 1 hit | won, 9/9, 4m03s, 0 hits | 14 (Lv 15) | 7 | 46 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| 2 | 4 | slime | lost, 0/9, 16 s | won, 9/9, 6m56s, 4 hits | won, 9/9, 4m29s, 0 hits | 14 (Lv 15) | 2 | 54 | — | xp, gold, heal, xp, xp, xp, xp |
| 2 | 5 | squid | lost, 0/9, 8 s | won, 9/9, 5m44s, 0 hits | won, 9/9, 4m18s, 0 hits | 15 (Lv 16) | 7 | 50 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| 2 | 7 | squid | lost, 0/9, 9 s | won, 9/9, 5m16s, 0 hits | won, 9/9, 4m19s, 0 hits | 14 (Lv 15) | 9 | 50 | phantom-volley, cataclysm | xp, heal, xp, xp, xp, xp, xp |
| 3 | 1 | bamboo | lost, 0/9, 24 s | won, 9/9, 9m28s, 2 hits | won, 9/9, 6m41s, 0 hits | 16 (Lv 17) | 6 | 79 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| 3 | 2 | samurai | lost, 0/9, 12 s | won, 9/9, 9m03s, 1 hit | won, 9/9, 6m12s, 0 hits | 15 (Lv 16) | 3 | 112 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| 3 | 3 | samurai | lost, 0/9, 9 s | won, 9/9, 6m35s, 0 hits | won, 9/9, 5m49s, 0 hits | 13 (Lv 14) | 9 | 63 | — | heal, xp, xp, xp, xp, heal, xp |
| 3 | 4 | samurai | lost, 0/9, 13 s | won, 9/9, 8m44s, 1 hit | won, 9/9, 6m37s, 0 hits | 15 (Lv 16) | 5 | 78 | — | xp, gold, heal, xp, xp, xp, xp |
| 3 | 5 | bamboo | lost, 0/9, 12 s | won, 9/9, 9m01s, 0 hits | won, 9/9, 6m10s, 0 hits | 15 (Lv 16) | 5 | 70 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| 3 | 8 | bamboo | lost, 0/9, 9 s | won, 9/9, 8m55s, 0 hits | won, 9/9, 6m36s, 0 hits | 16 (Lv 17) | 3 | 80 | phantom-volley | xp, xp, xp, gold, xp, xp, xp |
| 4 | 1 | racoon | lost, 0/9, 16 s | won, 9/9, 10m57s, 7 hits | won, 9/9, 7m23s, 0 hits | 15 (Lv 16) | 16 | 95 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| 4 | 2 | redtengu | lost, 0/9, 10 s | won, 9/9, 11m12s, 1 hit | won, 9/9, 7m11s, 0 hits | 16 (Lv 17) | 9 | 143 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| 4 | 3 | racoon | lost, 0/9, 15 s | won, 9/9, 8m05s, 1 hit | won, 9/9, 6m00s, 0 hits | 14 (Lv 15) | 13 | 75 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| 4 | 4 | redtengu | lost, 0/9, 11 s | won, 9/9, 9m21s, 1 hit | won, 9/9, 7m17s, 2 hits | 14 (Lv 15) | 18 | 92 | — | xp, gold, heal, xp, xp, xp, xp |
| 4 | 5 | racoon | lost, 0/9, 11 s | won, 9/9, 10m30s, 2 hits | won, 9/9, 6m46s, 0 hits | 15 (Lv 16) | 7 | 83 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| 4 | 13 | redtengu | lost, 0/9, 9 s | won, 9/9, 9m48s, 3 hits | won, 9/9, 5m53s, 0 hits | 14 (Lv 15) | 6 | 115 | phantom-volley, cataclysm, tempest-barrage | heal, xp, xp, xp, xp, xp, xp |

Summary: **24/24** stand still lost Room 1 (`8–24 s`, avg `11.8 s`), **24/24** dodge + M13 kit won 9/9 (`1/24` rows hit, `2` total hits, `151` reactive Dash evades, `1` Shield block), **24/24** rows landed in the `12–16` level-ups band (**`13–16`**, avg **`14.7`**; Ch1 `13–16` · Ch2 `14–16` · Ch3 `13–16` · Ch4 `14–16`), **24/24** exercised Dash (avg **`6.3/run`**), **24/24** cast *Shadow Barrage* (avg **`69.7/run`**), and **18/24** unlocked Legendary Evolutions (**`28`** total across 5 Evolutions).

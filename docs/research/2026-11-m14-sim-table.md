# M14 Balance Sim Table (Ticket T5 — 4 Playable Classes × 4 Chapters) — 2026-11-26

End-to-end balance proof for **M14 Ticket T5** (GDD §14, §15.4), run with `cd game && bun run sim:table` on the full M14 4-class combat stack (`core/sim/run-simulation.ts` & `core/sim/boss-run.ts`):

- **3-layer class identity modeled end-to-end (`core/characters/roster.ts`, `core/meta/run-stats.ts`, `core/input/active-skill.ts`):**
  - **Ninja (`ninja`, unlocked from start):** `projectile` shuriken/kunai, 6 hearts, balanced baseline (`1.0×` dmg/fire-rate/range/proj-speed), Layer 2 ***Shadow Agility*** (`+10%` move speed, `-15%` Dash cooldown), Layer 3 ***Shadow Barrage*** (`10–12` piercing homing shadow shurikens, `10 s` CD).
  - **Archer (`archer`, Ch1 clear or 120g):** `hand` bow, 5 hearts, `1.15×` dmg, `0.90×` fire rate, `1.04×` move speed, `1.35×` projectile speed (`16.2` tiles/s), `1.25×` range (`10.0` tiles), Layer 2 ***Keen Sight*** (`+1` innate pierce, `+12%` 2× crit), Layer 3 ***Piercing Volley*** (`7–9` high-speed `18` tiles/s arrows with `5` pierce in a focused `36°` fan, `9.5 s` CD, `220 ms` hit CDR).
  - **Mage (`mage`, Ch2 clear or 220g):** `hand` staff, 5 hearts, `1.25×` dmg, `0.85×` fire rate, `0.96×` move speed, `0.95×` projectile speed, `1.15×` range (`9.2` tiles), Layer 2 ***Arcane Attunement*** (`-20%` Active cooldown, `+25%` Active & AoE power), Layer 3 ***Arcane Nova*** (`4.5`-tile base freezing radial AoE ring scaled by `activePowerMult × aoePowerMult` to `~6.0` tiles + `35%` speed chill for `2.5 s` + `8–12` outward `360°` arcane bolts, `10.5 s` CD).
  - **Cultivator (`cultivator`, Ch3 clear or 350g):** `back` sword, 7 hearts, `1.10×` dmg, `0.95×` fire rate, `1.0×` move speed, `1.10×` projectile speed, `1.05×` range (`8.4` tiles), Layer 2 ***Sword Heart*** (`+15%` dmg, `+10%` execute bonus `<30%` HP), Layer 3 ***Ten Thousand Swords*** (`14–16` sweeping homing piercing spirit blades + `1200 ms` back-sword hide window, `11 s` CD).
- **Shared M13 pure-combat stack:** All 4 classes share the identical 27 pure-combat skills, 7 Legendary Evolutions, unified XP economy (`12–16` level-ups/run), `typicalSkillChoice` + `typicalRerollPolicy` + `typicalDoorChoice`, `makeDodgePolicy()`, `smartDashPolicy`, and Tier-2 enemy AI & Boss Phase 2/3 sweeps.
- **Matrix scope (72 rows):**
  - **Ninja:** full 24-row matrix (`4 chapters × 2 bosses × 3 seeds = 24 rows`, preserving M9/M12/M13 parity).
  - **Archer, Mage, Cultivator:** `4 chapters × 2 bosses × 2 seeds = 16 rows` each (`48 rows`).
  - **`vitest` acceptance gate (`tests/integration/sim-table.acceptance.test.ts`):** all `4 classes × 4 chapters × 2 bosses = 32 rows`.
- **`game/config/tuning.json` deltas:** **None required (`0` changes from Wave 1 `47d49418`).** All 4 classes cleared 100% of chapters within ±12% of the roster median clear time while exhibiting clear mechanical identity and distinct risk/tempo profiles.

---

## Per-Class Summary Comparison (Ninja vs Archer vs Mage vs Cultivator)

| class | signature active | hearts | rows | stand still lost (Room 1) | dodge + M14 kit wins (9/9) | clear time (avg / range) | level-ups | dashes / run | actives / run | hits (rows / total) | evolutions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ninja** | *Shadow Barrage* | 6 | 24 | **24/24** (`8–24 s`) | **24/24** | **5m11s** (`2m47s–7m30s`) | **13–16** (avg `14.7`) | **7.8** (`187`, `24/24`) | **70.1** (`1,683`) | 2/24 (`3`) | 18/24 (`29`) |
| **archer** | *Piercing Volley* | 5 | 16 | **16/16** (`7–23 s`) | **16/16** | **5m39s** (`3m01s–8m43s`) | **13–16** (avg `14.8`) | **10.0** (`160`, `16/16`) | **83.1** (`1,330`) | 2/16 (`5`) | 12/16 (`18`) |
| **mage** | *Arcane Nova* | 5 | 16 | **16/16** (`7–15 s`) | **16/16** | **6m00s** (`3m10s–9m26s`) | **13–16** (avg `14.8`) | **14.1** (`225`, `15/16`) | **93.0** (`1,488`) | 3/16 (`7`) | 12/16 (`18`) |
| **cultivator** | *Ten Thousand Swords* | 7 | 16 | **16/16** (`9–25 s`) | **16/16** | **4m52s** (`2m24s–7m18s`) | **13–16** (avg `14.8`) | **5.4** (`86`, `15/16`) | **61.4** (`983`) | 2/16 (`2`) | 13/16 (`19`) |
| **ALL 4** | *(all 4 signatures)* | 5–7 | **72** | **72/72** (`7–25 s`) | **72/72** | **5m24s** (`2m24s–9m26s`) | **13–16** (avg `14.7`) | **9.1** (`658`, `70/72`; Ch2–4 `54/54`) | **76.2** (`5,484`) | 9/72 (`17`) | 55/72 (`84`) |

### Class Identity & Balance Observations

1. **Clear-time spread stays tight (`4m52s` → `6m00s`, within ±12% of median):**
   - **Cultivator** leads clear speed (`4m52s` avg) via *Sword Heart* (`+15%` dmg + execute) and 14–16 homing *Ten Thousand Swords* blades, with the fewest panic dashes (`5.4/run`) and lowest hit count (`2` hits across 16 runs) — fitting the sturdy 7-heart sword-master fantasy.
   - **Ninja** anchors the roster baseline (`5m11s` avg, `7.8` dashes/run, `70.1` actives/run, `3` hits across 24 runs), gaining slightly brisker mobility and Dash uptime over M13 (`7.8` vs `6.3` dashes/run) from *Shadow Agility*.
   - **Archer** plays as a crisp 5-heart marksman (`5m39s` avg), cycling fast *Piercing Volley* casts (`83.1/run`, `9.5 s` CD + `220 ms` hit CDR) while taking real late-chapter pressure in Ch4 (`2–3` hits on seeds 3–4, `10.0` dashes/run).
   - **Mage** plays as a high-tempo crowd-control caster (`6m00s` avg): *Arcane Attunement* (`-20%` Active CD, `+25%` Active/AoE power) produces the highest Signature Active cadence in the roster (**`93.0/run`**, up to **`188`** *Arcane Nova* casts in Ch4 seed 2), while `0.96×` move speed + 5 hearts yields the highest Dash intensity (**`14.1/run`**, up to `41` dashes in Ch4) and highest late-game tension (`4` hits on Ch4 seed 4).
2. **Stand-still lethality mirrors Layer 1 durability:** 5-heart classes (`archer` 7–23 s, `mage` 7–15 s) die fastest standing still in Room 1, 6-heart `ninja` lasts 8–24 s, and 7-heart `cultivator` lasts 9–25 s — all **72/72** die in Room 1 (`0/9`).
3. **XP economy stays locked in band across every class:** **72/72** rows hit `13–16` level-ups (avg `14.7–14.8` per class), and every class unlocks Legendary Evolutions across `75%+` of runs (`55/72` rows, `84` Evolutions unlocked, including 6 distinct Evolutions: `phantom-volley`, `tempest-barrage`, `cataclysm`, `starfall-kunai`, `aegis-retribution`, `shadowstep`).
4. **Dash utilization:** **70/72** rows overall and **54/54 (100%)** of Ch2–Ch4 rows exercise Dash. The only two `0`-dash rows are Ch1 runs (`mage` Ch1 s2 and `cultivator` Ch1 s5) where *Arcane Nova* freeze / *Ten Thousand Swords* homing cleared early waves cleanly with `0` hits taken.

---

## Full 72-Row 4-Class × 4-Chapter Sim Table

| class | chapter | seed | boss | stand still | dodge + M14 kit | level-ups | dashes | actives | evolutions | doors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ninja | 1 | 1 | tengu | lost, 0/9, 12 s | won, 9/9, 3m28s, 0 hits | 16 (Lv 17) | 3 | 40 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| ninja | 1 | 2 | frog | lost, 0/9, 10 s | won, 9/9, 3m17s, 0 hits | 15 (Lv 16) | 5 | 56 | cataclysm, shadowstep, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| ninja | 1 | 3 | frog | lost, 0/9, 9 s | won, 9/9, 2m48s, 0 hits | 13 (Lv 14) | 5 | 33 | — | heal, xp, xp, xp, xp, heal, xp |
| ninja | 1 | 4 | frog | lost, 0/9, 14 s | won, 9/9, 3m16s, 0 hits | 14 (Lv 15) | 1 | 40 | — | xp, gold, heal, xp, xp, xp, xp |
| ninja | 1 | 5 | tengu | lost, 0/9, 10 s | won, 9/9, 3m08s, 0 hits | 14 (Lv 15) | 5 | 37 | cataclysm | xp, xp, heal, xp, xp, xp, xp |
| ninja | 1 | 6 | tengu | lost, 0/9, 13 s | won, 9/9, 2m47s, 0 hits | 14 (Lv 15) | 4 | 43 | tempest-barrage | chest, xp, xp, xp, heal, xp, xp |
| ninja | 2 | 1 | slime | lost, 0/9, 13 s | won, 9/9, 4m45s, 0 hits | 16 (Lv 17) | 9 | 57 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| ninja | 2 | 2 | squid | lost, 0/9, 10 s | won, 9/9, 4m39s, 0 hits | 15 (Lv 16) | 3 | 82 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| ninja | 2 | 3 | slime | lost, 0/9, 8 s | won, 9/9, 3m51s, 2 hits | 14 (Lv 15) | 7 | 45 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| ninja | 2 | 4 | slime | lost, 0/9, 16 s | won, 9/9, 4m46s, 0 hits | 14 (Lv 15) | 8 | 56 | — | xp, gold, heal, xp, xp, xp, xp |
| ninja | 2 | 5 | squid | lost, 0/9, 8 s | won, 9/9, 4m15s, 0 hits | 15 (Lv 16) | 6 | 50 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| ninja | 2 | 7 | squid | lost, 0/9, 9 s | won, 9/9, 4m30s, 0 hits | 14 (Lv 15) | 4 | 51 | phantom-volley, cataclysm | xp, heal, xp, xp, xp, xp, xp |
| ninja | 3 | 1 | bamboo | lost, 0/9, 24 s | won, 9/9, 6m55s, 0 hits | 16 (Lv 17) | 8 | 82 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| ninja | 3 | 2 | samurai | lost, 0/9, 12 s | won, 9/9, 6m16s, 0 hits | 15 (Lv 16) | 7 | 111 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| ninja | 3 | 3 | samurai | lost, 0/9, 9 s | won, 9/9, 5m26s, 0 hits | 13 (Lv 14) | 9 | 61 | — | heal, xp, xp, xp, xp, heal, xp |
| ninja | 3 | 4 | samurai | lost, 0/9, 13 s | won, 9/9, 6m37s, 0 hits | 15 (Lv 16) | 6 | 78 | — | xp, gold, heal, xp, xp, xp, xp |
| ninja | 3 | 5 | bamboo | lost, 0/9, 12 s | won, 9/9, 5m53s, 0 hits | 15 (Lv 16) | 9 | 68 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| ninja | 3 | 8 | bamboo | lost, 0/9, 9 s | won, 9/9, 6m32s, 0 hits | 16 (Lv 17) | 12 | 80 | phantom-volley | xp, xp, xp, gold, xp, xp, xp |
| ninja | 4 | 1 | racoon | lost, 0/9, 16 s | won, 9/9, 7m19s, 0 hits | 15 (Lv 16) | 16 | 95 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| ninja | 4 | 2 | redtengu | lost, 0/9, 10 s | won, 9/9, 7m30s, 0 hits | 16 (Lv 17) | 14 | 146 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| ninja | 4 | 3 | racoon | lost, 0/9, 15 s | won, 9/9, 6m07s, 0 hits | 14 (Lv 15) | 11 | 76 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| ninja | 4 | 4 | redtengu | lost, 0/9, 11 s | won, 9/9, 7m21s, 1 hit | 14 (Lv 15) | 17 | 92 | — | xp, gold, heal, xp, xp, xp, xp |
| ninja | 4 | 5 | racoon | lost, 0/9, 11 s | won, 9/9, 6m40s, 0 hits | 15 (Lv 16) | 5 | 82 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| ninja | 4 | 13 | redtengu | lost, 0/9, 9 s | won, 9/9, 6m26s, 0 hits | 14 (Lv 15) | 13 | 122 | phantom-volley, cataclysm, tempest-barrage | heal, xp, xp, xp, xp, xp, xp |
| archer | 1 | 1 | tengu | lost, 0/9, 11 s | won, 9/9, 3m21s, 0 hits | 16 (Lv 17) | 2 | 44 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| archer | 1 | 2 | frog | lost, 0/9, 9 s | won, 9/9, 3m14s, 0 hits | 15 (Lv 16) | 3 | 65 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| archer | 1 | 3 | frog | lost, 0/9, 8 s | won, 9/9, 3m01s, 0 hits | 13 (Lv 14) | 9 | 39 | — | heal, xp, xp, xp, xp, heal, xp |
| archer | 1 | 5 | tengu | lost, 0/9, 10 s | won, 9/9, 3m06s, 0 hits | 14 (Lv 15) | 3 | 41 | cataclysm | xp, xp, heal, xp, xp, xp, xp |
| archer | 2 | 1 | slime | lost, 0/9, 12 s | won, 9/9, 4m51s, 0 hits | 16 (Lv 17) | 9 | 64 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| archer | 2 | 2 | squid | lost, 0/9, 9 s | won, 9/9, 4m53s, 0 hits | 15 (Lv 16) | 4 | 93 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| archer | 2 | 3 | slime | lost, 0/9, 7 s | won, 9/9, 4m06s, 0 hits | 14 (Lv 15) | 4 | 53 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| archer | 2 | 5 | squid | lost, 0/9, 8 s | won, 9/9, 4m31s, 0 hits | 15 (Lv 16) | 6 | 56 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| archer | 3 | 1 | bamboo | lost, 0/9, 23 s | won, 9/9, 6m47s, 0 hits | 16 (Lv 17) | 8 | 89 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| archer | 3 | 2 | samurai | lost, 0/9, 12 s | won, 9/9, 6m50s, 0 hits | 15 (Lv 16) | 11 | 132 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| archer | 3 | 3 | samurai | lost, 0/9, 9 s | won, 9/9, 6m06s, 0 hits | 13 (Lv 14) | 11 | 74 | — | heal, xp, xp, xp, xp, heal, xp |
| archer | 3 | 5 | bamboo | lost, 0/9, 9 s | won, 9/9, 6m55s, 0 hits | 15 (Lv 16) | 14 | 82 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| archer | 4 | 1 | racoon | lost, 0/9, 17 s | won, 9/9, 8m04s, 0 hits | 15 (Lv 16) | 15 | 111 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| archer | 4 | 2 | redtengu | lost, 0/9, 9 s | won, 9/9, 8m12s, 0 hits | 16 (Lv 17) | 11 | 173 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| archer | 4 | 3 | racoon | lost, 0/9, 14 s | won, 9/9, 7m35s, 2 hits | 14 (Lv 15) | 28 | 97 | — | heal, xp, xp, xp, xp, heal, xp |
| archer | 4 | 4 | redtengu | lost, 0/9, 10 s | won, 9/9, 8m43s, 3 hits | 14 (Lv 15) | 22 | 117 | — | xp, gold, heal, xp, xp, xp, xp |
| mage | 1 | 1 | tengu | lost, 0/9, 11 s | won, 9/9, 3m47s, 1 hit | 16 (Lv 17) | 4 | 52 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| mage | 1 | 2 | frog | lost, 0/9, 9 s | won, 9/9, 3m24s, 0 hits | 15 (Lv 16) | 0 | 71 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| mage | 1 | 3 | frog | lost, 0/9, 8 s | won, 9/9, 3m10s, 0 hits | 13 (Lv 14) | 7 | 43 | — | heal, xp, xp, xp, xp, heal, xp |
| mage | 1 | 5 | tengu | lost, 0/9, 9 s | won, 9/9, 3m13s, 0 hits | 14 (Lv 15) | 5 | 46 | cataclysm | xp, xp, heal, xp, xp, xp, xp |
| mage | 2 | 1 | slime | lost, 0/9, 11 s | won, 9/9, 5m08s, 0 hits | 16 (Lv 17) | 4 | 72 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| mage | 2 | 2 | squid | lost, 0/9, 9 s | won, 9/9, 5m01s, 0 hits | 15 (Lv 16) | 3 | 103 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| mage | 2 | 3 | slime | lost, 0/9, 7 s | won, 9/9, 4m43s, 0 hits | 14 (Lv 15) | 20 | 62 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| mage | 2 | 5 | squid | lost, 0/9, 7 s | won, 9/9, 4m40s, 0 hits | 15 (Lv 16) | 11 | 63 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| mage | 3 | 1 | bamboo | lost, 0/9, 10 s | won, 9/9, 7m36s, 0 hits | 16 (Lv 17) | 14 | 102 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| mage | 3 | 2 | samurai | lost, 0/9, 12 s | won, 9/9, 7m24s, 0 hits | 15 (Lv 16) | 13 | 143 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| mage | 3 | 3 | samurai | lost, 0/9, 7 s | won, 9/9, 6m41s, 0 hits | 13 (Lv 14) | 18 | 86 | — | heal, xp, xp, xp, xp, heal, xp |
| mage | 3 | 5 | bamboo | lost, 0/9, 8 s | won, 9/9, 6m30s, 0 hits | 15 (Lv 16) | 9 | 88 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| mage | 4 | 1 | racoon | lost, 0/9, 15 s | won, 9/9, 9m01s, 0 hits | 15 (Lv 16) | 26 | 127 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| mage | 4 | 2 | redtengu | lost, 0/9, 9 s | won, 9/9, 8m18s, 0 hits | 16 (Lv 17) | 20 | 188 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| mage | 4 | 3 | racoon | lost, 0/9, 10 s | won, 9/9, 7m58s, 2 hits | 14 (Lv 15) | 41 | 109 | — | heal, xp, xp, xp, xp, heal, xp |
| mage | 4 | 4 | redtengu | lost, 0/9, 9 s | won, 9/9, 9m26s, 4 hits | 14 (Lv 15) | 30 | 133 | — | xp, gold, heal, xp, xp, xp, xp |
| cultivator | 1 | 1 | tengu | lost, 0/9, 15 s | won, 9/9, 3m05s, 0 hits | 16 (Lv 17) | 3 | 35 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| cultivator | 1 | 2 | frog | lost, 0/9, 11 s | won, 9/9, 3m09s, 0 hits | 15 (Lv 16) | 2 | 52 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| cultivator | 1 | 3 | frog | lost, 0/9, 10 s | won, 9/9, 2m24s, 0 hits | 13 (Lv 14) | 3 | 27 | — | heal, xp, xp, xp, xp, heal, xp |
| cultivator | 1 | 5 | tengu | lost, 0/9, 11 s | won, 9/9, 2m50s, 0 hits | 14 (Lv 15) | 0 | 31 | cataclysm | xp, xp, heal, xp, xp, xp, xp |
| cultivator | 2 | 1 | slime | lost, 0/9, 17 s | won, 9/9, 4m28s, 0 hits | 16 (Lv 17) | 4 | 50 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| cultivator | 2 | 2 | squid | lost, 0/9, 11 s | won, 9/9, 4m21s, 0 hits | 15 (Lv 16) | 2 | 70 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| cultivator | 2 | 3 | slime | lost, 0/9, 9 s | won, 9/9, 3m36s, 0 hits | 14 (Lv 15) | 9 | 38 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| cultivator | 2 | 5 | squid | lost, 0/9, 10 s | won, 9/9, 3m55s, 0 hits | 15 (Lv 16) | 2 | 42 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| cultivator | 3 | 1 | bamboo | lost, 0/9, 25 s | won, 9/9, 6m35s, 1 hit | 16 (Lv 17) | 7 | 71 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| cultivator | 3 | 2 | samurai | lost, 0/9, 17 s | won, 9/9, 6m02s, 0 hits | 15 (Lv 16) | 5 | 98 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| cultivator | 3 | 3 | samurai | lost, 0/9, 10 s | won, 9/9, 4m54s, 0 hits | 13 (Lv 14) | 4 | 52 | — | heal, xp, xp, xp, xp, heal, xp |
| cultivator | 3 | 5 | bamboo | lost, 0/9, 13 s | won, 9/9, 5m45s, 0 hits | 15 (Lv 16) | 9 | 61 | cataclysm, starfall-kunai | xp, xp, heal, xp, xp, xp, xp |
| cultivator | 4 | 1 | racoon | lost, 0/9, 16 s | won, 9/9, 7m18s, 0 hits | 15 (Lv 16) | 8 | 84 | phantom-volley | xp, xp, xp, xp, xp, xp, xp |
| cultivator | 4 | 2 | redtengu | lost, 0/9, 11 s | won, 9/9, 6m55s, 0 hits | 16 (Lv 17) | 8 | 127 | phantom-volley, tempest-barrage | gold, xp, xp, xp, xp, xp, gold |
| cultivator | 4 | 3 | racoon | lost, 0/9, 19 s | won, 9/9, 5m51s, 0 hits | 14 (Lv 15) | 11 | 66 | aegis-retribution | heal, xp, xp, xp, xp, heal, xp |
| cultivator | 4 | 4 | redtengu | lost, 0/9, 20 s | won, 9/9, 6m45s, 1 hit | 14 (Lv 15) | 9 | 79 | — | xp, gold, heal, xp, xp, xp, xp |

Summary: **72/72** stand still lost Room 1 (`7–25 s`), **72/72** dodge + M14 kit won 9/9 across all 4 classes and 4 chapters (`9/72` rows hit, `17` total hits), **72/72** landed inside the `12–16` level-ups band (**`13–16`**, avg **`14.7`**), **70/72** exercised Dash (**`54/54`** across Ch2–Ch4, avg **`9.1/run`**), **72/72** cast their class Signature Active (avg **`76.2/run`**), and **55/72** unlocked Legendary Evolutions (**`84`** total across all 4 classes).

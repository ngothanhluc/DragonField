# M11 Balance Sim Table (Ticket T6) — 2026-11-26

Before/after verification for **M11 Ticket T6** (Tier 1 enemy difficulty retune + boss room entrance bugfix & spacing), run with `cd game && bun run sim:table` on the final M11 room pool (T1 weather, T2 Ch2 impassable rivers & bridges, T3 Ch3 mossy ruins + Ch1/Ch4 clusters, T4 HUD).

- **BEFORE baseline:** commit `ca670ee` (post-`#66` tuning on final M11 maps, before T6).
- **AFTER:** T6 Tier 1 retune in `game/config/tuning.json` + boss `nowMs` / 1.0 s intro grace / 11-tile arena separation.
- **Methodology:** real `simulateRun` across all 4 chapters × both chapter bosses × 3 ascending seeds (`balanceSeeds`, 24 rows total). Per seed: standing still (`standStill`) vs `makeDodgePolicy()` + `TYPICAL_LOADOUT` + `typicalDoorChoice` (`heal` first, then `skill`). Note: `simulateRun` also forwards boss-arena `player-hit` events in AFTER so boss pressure is reflected in the hit count.

---

## Summary Metrics (BEFORE vs AFTER)

| Metric | BEFORE (`ca670ee`) | AFTER (M11 T6) | Delta |
| --- | --- | --- | --- |
| Stand still loses Room 1 (`0/9`) | 24/24 | 24/24 | — |
| Stand still survival time (avg / range) | 17.0 s (8–34 s) | 11.2 s (7–15 s) | **-34% avg**, max 34 s → 15 s |
| Dodge + typical loadout wins (`9/9`) | 24/24 | 24/24 | 100% clearable |
| Loadout rows taking ≥ 1 hit | 4/24 (17%) | **12/24 (50%)** | **3.0×** (0-hit rows 20/24 → 12/24) |
| Hit rows by chapter (Ch1 / Ch2 / Ch3 / Ch4) | 0/6 · 0/6 · 1/6 · 3/6 | **1/6 · 1/6 · 4/6 · 6/6** | Ch3 67% hit, Ch4 **100% hit** |
| Total hits across 24 loadout runs | 6 | **20** | **3.3×** hit pressure |
| Loadout clear time range | 3m08s – 10m47s | 3m00s – 10m34s | Inside target run window |

### 0-Skill Survival Check (`BALANCE_SEEDS = [1, 7, 42]`, dodge policy, no skills)

| Chapter | Seed 1 | Seed 7 | Seed 42 |
| --- | --- | --- | --- |
| Ch1 | lost, 4/9, 386.5 s (34.0×), 6 hits | lost, 3/9, 465.2 s (35.6×), 4 hits | lost, 3/9, 340.1 s (27.4×), 4 hits |
| Ch2 | lost, 2/9, 271.1 s (19.9×), 6 hits | lost, 1/9, 306.4 s (30.9×), 5 hits | lost, 3/9, 423.5 s (23.3×), 6 hits |
| Ch3 | lost, 4/9, 1251.2 s (91.1×), 6 hits | lost, 3/9, 1081.8 s (61.8×), 4 hits | timeout, 5/9, 1500.0 s (133.4×), 3 hits |
| Ch4 | lost, 3/9, 886.8 s (57.7×), 5 hits | lost, 3/9, 1136.4 s (124.4×), 4 hits | lost, 3/9, 859.5 s (71.8×), 5 hits |

Every 0-skill run clears at least Room 1 cleanly (real runs pick Skill #1 after Room 1), survives 19.9×–133.4× longer than standing still (proving attacks remain readable/dodgeable), takes 3–6 real hits, and fails to clear the chapter without skills.

---

## Boss Entrance Bugfix & Arena Spacing

1. **`nowMs` clock alignment (`core/boss/patterns.ts`, `game/boss-view.ts`, `game/boss-flow.ts`, `game/combat-loop.ts`, `core/sim/boss-run.ts`, `core/sim/run-simulation.ts`):**
   - `initialBossState(id, position, nowMs, introGraceMs)` now anchors `stepStartedMs` and `introUntilMs` to the live simulation clock (`CombatLoop.clockMs` / `run-simulation`'s accumulated `durationMs`) instead of `0`. Entering room 9 after ~300,000 ms of rooms 1–8 no longer skips step 0 or fires attacks on frame 1.
2. **1.0 s Boss Intro Grace (`boss.introGraceMs: 1000` in `game/config/tuning.json`):**
   - While `isBossInIntro(state, nowMs)` holds (`nowMs <= state.introUntilMs`), the boss stays visible and idle with zero attacks, teleports, movement, or contact lunges (`CombatLoop` and `boss-run.ts` both gate charge contact damage on `!isBossInIntro`).
3. **Normalized 11-tile Arena Separation (`chapter-{1..4}/room-17.tmx`):**
   - All 4 boss arenas place `playerStart` at bottom-center `(16, 16)` and `bossStart` at top-center `(16, 5)` (**11.0 tiles** apart, inside `bossRoomBounds(id)` for every boss in every chapter pool, with clear line of sight).
   - Fixed Ch2 `bossStart` `(16, 8) → (16, 5)` and Ch3/Ch4 same-row spawns `playerStart (27, 6) → (16, 16)` / `bossStart (16, 6) → (16, 5)`. Enforced by `tests/core/chapter-assets.test.ts` (`distance >= 10` tiles).

---

## `game/config/tuning.json` Deltas (Tier 1)

| Key | BEFORE (`ca670ee`) | AFTER (M11 T6) | Rationale |
| --- | --- | --- | --- |
| `chapters.enemyHealthMultipliers` | `[1, 1.05, 1.05, 1.1]` | `[1, 1.06, 1.11, 1.16]` | Replace flat curve with strictly climbing Ch1 → Ch4 scaling |
| `enemies.roles.tank.chargeSpeedTilesPerSecond` | `4` | `6.6` | Restore charge speed above player's 5 tiles/s walk speed (+65%) |
| `enemies.roles.tank.chargeDurationMs` | `350` | `260` | Snappy ~1.72-tile lunge (dodgeable on telegraph, dangerous if ignored) |
| `enemies.roles.tank.attackCooldownMs` | `2200` | `2000` | Shorter tank charge cycle |
| `enemies.elite.chaser.pounceSpeedTilesPerSecond` | `5` | `6.2` | Faster than player walk speed (+24%) |
| `enemies.elite.chaser.pounceCooldownMs` | `1200` | `1050` | Stronger Elite Chaser pressure |
| `enemies.roles.chaser.speedTilesPerSecond` | `2.6` | `2.75` | Faster melee closing speed |
| `enemies.roles.splitter.speedTilesPerSecond` | `1.7` | `1.85` | Faster splitter closing speed |
| `enemies.roles.splitling.speedTilesPerSecond` | `2.6` | `2.9` | Faster splitling swarm pressure |
| `enemies.roles.caster.attackCooldownMs` | `3000` | `2800` | Shorter ranged volley cadence |
| `enemies.roles.sniper.attackCooldownMs` | `4000` | `3700` | Shorter long-range pressure cadence |
| `waves.aliveCapStart` | `3` | `4` | Stronger opening wave pressure (`aliveCap` remains `24`) |
| `boss.introGraceMs` | *(new)* | `1000` | 1.0 s boss room entrance grace window |
| `boss.healthByChapter` | `[80, 105, 130, 155]` *(hardcoded)* | `[80, 110, 140, 170]` | Tuned boss HP curve moved into `tuning.json` |

---

## 24-Row Comparison Table (BEFORE vs AFTER)

| ch | seed | boss | BEFORE stand still | AFTER stand still | BEFORE dodge + loadout | AFTER dodge + loadout | doors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 16 s | lost, 0/9, 11 s | won, 9/9, 4m13s, 0 hits | won, 9/9, 4m09s, 1 hit | skill, skill, skill, skill, skill, skill, skill |
| 1 | 2 | frog | lost, 0/9, 14 s | lost, 0/9, 10 s | won, 9/9, 4m04s, 0 hits | won, 9/9, 3m57s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 1 | 3 | frog | lost, 0/9, 10 s | lost, 0/9, 9 s | won, 9/9, 3m08s, 0 hits | won, 9/9, 3m07s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 1 | 4 | frog | lost, 0/9, 17 s | lost, 0/9, 12 s | won, 9/9, 3m42s, 0 hits | won, 9/9, 3m26s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 1 | 5 | tengu | lost, 0/9, 13 s | lost, 0/9, 10 s | won, 9/9, 3m46s, 0 hits | won, 9/9, 3m30s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 1 | 6 | tengu | lost, 0/9, 16 s | lost, 0/9, 13 s | won, 9/9, 3m16s, 0 hits | won, 9/9, 3m00s, 0 hits | chest, skill, skill, skill, heal, skill, skill |
| 2 | 1 | slime | lost, 0/9, 17 s | lost, 0/9, 14 s | won, 9/9, 5m53s, 0 hits | won, 9/9, 5m28s, 1 hit | skill, skill, skill, skill, skill, skill, skill |
| 2 | 2 | squid | lost, 0/9, 15 s | lost, 0/9, 11 s | won, 9/9, 5m51s, 0 hits | won, 9/9, 5m36s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 2 | 3 | slime | lost, 0/9, 8 s | lost, 0/9, 8 s | won, 9/9, 4m17s, 0 hits | won, 9/9, 4m10s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 2 | 4 | slime | lost, 0/9, 22 s | lost, 0/9, 15 s | won, 9/9, 4m55s, 0 hits | won, 9/9, 4m46s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 2 | 5 | squid | lost, 0/9, 8 s | lost, 0/9, 7 s | won, 9/9, 5m24s, 0 hits | won, 9/9, 5m03s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 2 | 7 | squid | lost, 0/9, 14 s | lost, 0/9, 10 s | won, 9/9, 4m51s, 0 hits | won, 9/9, 4m43s, 0 hits | skill, heal, skill, skill, skill, skill, skill |
| 3 | 1 | bamboo | lost, 0/9, 25 s | lost, 0/9, 14 s | won, 9/9, 8m45s, 0 hits | won, 9/9, 8m29s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 3 | 2 | samurai | lost, 0/9, 28 s | lost, 0/9, 12 s | won, 9/9, 8m30s, 0 hits | won, 9/9, 8m23s, 2 hits | gold, skill, skill, skill, skill, skill, gold |
| 3 | 3 | samurai | lost, 0/9, 10 s | lost, 0/9, 9 s | won, 9/9, 6m10s, 0 hits | won, 9/9, 6m12s, 1 hit | heal, skill, skill, skill, skill, heal, skill |
| 3 | 4 | samurai | lost, 0/9, 18 s | lost, 0/9, 12 s | won, 9/9, 7m31s, 0 hits | won, 9/9, 7m31s, 1 hit | skill, gold, heal, skill, skill, skill, skill |
| 3 | 5 | bamboo | lost, 0/9, 34 s | lost, 0/9, 9 s | won, 9/9, 7m26s, 2 hits | won, 9/9, 7m16s, 2 hits | skill, skill, heal, skill, skill, skill, skill |
| 3 | 8 | bamboo | lost, 0/9, 16 s | lost, 0/9, 9 s | won, 9/9, 8m41s, 0 hits | won, 9/9, 8m36s, 0 hits | skill, skill, skill, gold, skill, skill, skill |
| 4 | 1 | racoon | lost, 0/9, 33 s | lost, 0/9, 15 s | won, 9/9, 9m29s, 2 hits | won, 9/9, 9m44s, 1 hit | skill, skill, skill, skill, skill, skill, skill |
| 4 | 2 | redtengu | lost, 0/9, 14 s | lost, 0/9, 10 s | won, 9/9, 10m47s, 1 hit | won, 9/9, 10m34s, 3 hits | gold, skill, skill, skill, skill, skill, gold |
| 4 | 3 | racoon | lost, 0/9, 16 s | lost, 0/9, 13 s | won, 9/9, 7m18s, 1 hit | won, 9/9, 7m07s, 1 hit | heal, skill, skill, skill, skill, heal, skill |
| 4 | 4 | redtengu | lost, 0/9, 15 s | lost, 0/9, 15 s | won, 9/9, 8m39s, 0 hits | won, 9/9, 8m22s, 2 hits | skill, gold, heal, skill, skill, skill, skill |
| 4 | 5 | racoon | lost, 0/9, 18 s | lost, 0/9, 11 s | won, 9/9, 8m58s, 0 hits | won, 9/9, 9m01s, 4 hits | skill, skill, heal, skill, skill, skill, skill |
| 4 | 13 | redtengu | lost, 0/9, 12 s | lost, 0/9, 10 s | won, 9/9, 8m16s, 0 hits | won, 9/9, 7m47s, 1 hit | heal, skill, skill, skill, skill, skill, skill |

Summary: **24/24** stand still lost room 1, **24/24** dodge + typical loadout won 9/9 (`12/24` rows hit, `20` total hits vs `4/24` rows, `6` total hits BEFORE).

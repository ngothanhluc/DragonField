# M12 Balance Sim Table (Ticket T5 — Unified XP Level-Up Economy) — 2026-11-26

End-to-end balance proof for **M12 Ticket T5** (GDD §15.2, ADR-021), run with `cd game && bun run sim:table` on the real M12 unified XP economy (`XpOrbPool` + `XpTracker` + dedicated `createSkillRollRng` sub-seed + Gold Reroll + `'xp'` Elite challenge doors + radial level-up knockback wave & 0.6 s resume i-frame).

- **M11 baseline:** `docs/research/2026-11-m11-sim-table.md` (preloaded 10-skill `TYPICAL_LOADOUT` from Room 1 frame 1; no XP orbs, no `'xp'` challenge doors, no mid-combat level-ups).
- **M12 (this report):** **0-skill start** on Room 1 frame 1; every skill in the run is earned dynamically from XP orbs dropped by enemies (`xpForKill`, `splitling` = 0 XP), magnetic pickup during combat + full-room auto-vacuum on room clear, `'xp'` Elite challenge rooms (`xpRoomExtraElites = 2` promoted elites, `xpRoomXpMultiplier = 1.2`, `xpDoorClearBonus` on clear), 1-of-3 offers rolled via `createSkillRollRng(seed)`, frugal Gold Rerolls (`<= 40g` on weak hands), and modal-resume safety (`computeLevelUpKnockback` + 600 ms i-frame, enemy bullets left live).
- **Enemy combat tuning:** **100% unchanged from M11 T6** — only `xp.curve.quadraticStep`, `doors.xpBonus`, and `doors.xpRoomXpMultiplier` were tuned to land every chapter strictly inside the **12–16 level-ups/run** target band.

---

## Summary Metrics (M11 T6 vs M12 T5)

| Metric | M11 T6 (preloaded loadout) | M12 T5 (0-skill start + XP economy) | Delta / Notes |
| --- | --- | --- | --- |
| Stand still loses Room 1 (`0/9`) | 24/24 | **24/24** | Unchanged (`7–15 s`, avg `11.2 s`) |
| Dodge + skills wins (`9/9`) | 24/24 | **24/24** | 100% clearable from 0-skill start |
| Level-ups per run in `12–16` band | *(N/A — preloaded 10 stacks)* | **24/24 (`13–15`, avg `14.2`)** | Dead-center across all 4 chapters (`Ch1 13–15 · Ch2 13–15 · Ch3 13–15 · Ch4 13–15`) |
| Rows taking ≥ 1 hit | 12/24 (50%) | **13/24 (54%)** | Sustained roguelite hit pressure (`Ch1 2/6 · Ch2 2/6 · Ch3 3/6 · Ch4 6/6`) |
| Total hits across 24 winning runs | 20 | **26** | **+30%** hit pressure from 0-skill Room 1 ramp + `'xp'` Elite challenge rooms |
| Clear time range (9/9) | 3m00s – 10m34s | **3m09s – 11m12s** | Tightly aligned with M11 target run window |

### 0-Skill Survival Check (`BALANCE_SEEDS = [1, 7, 42]`, dodge policy, no skills acquired)

| Chapter | Seed 1 | Seed 7 | Seed 42 |
| --- | --- | --- | --- |
| Ch1 | lost, 6/9, 505.3 s (44.5×), 4 hits | lost, 4/9, 572.9 s (43.8×), 4 hits | lost, 3/9, 277.6 s (22.4×), 4 hits |
| Ch2 | lost, 2/9, 246.9 s (18.1×), 3 hits | lost, 2/9, 358.7 s (36.2×), 6 hits | lost, 2/9, 239.9 s (13.2×), 6 hits |
| Ch3 | lost, 6/9, 1379.0 s (100.4×), 4 hits | timeout, 4/9, 1500.0 s (85.7×), 1 hit | lost, 2/9, 717.5 s (63.8×), 3 hits |
| Ch4 | lost, 3/9, 936.3 s (60.9×), 4 hits | lost, 3/9, 1177.5 s (128.9×), 4 hits | lost, 3/9, 730.2 s (61.0×), 5 hits |

Every 0-skill run clears at least 2 rooms and survives `13.2×–128.9×` longer than standing still (proving early rooms stay readable/dodgeable at Level 1), yet still faces lethal danger and fails to clear any chapter without XP-earned skills.

---

## `game/config/tuning.json` Deltas (M12 T1 → M12 T5)

All M11 T6 enemy combat stats remain untouched. Only 3 XP/door-economy values were refined after measuring full 24-row real runs (where 6–7 `'xp'` door routes originally reached 17 level-ups on Ch1–Ch3):

| Key | M12 T1 (`5b87c5e3`) | M12 T5 (Final) | Rationale |
| --- | --- | --- | --- |
| `xp.curve.quadraticStep` | `1.1` | **`1.4`** | Tightens late-run Levels 13–16 tail without slowing Room 1's first 2–3 level-ups (`baseThreshold = 70`, `linearStep = 15`, `chapterMultipliers = [1, 1.48, 2.22, 2.52]` unchanged) |
| `doors.xpBonus` | `80` | **`60`** | Keeps 7-`'xp'`-door runs capped at 15 level-ups while keeping 2-heal routes at 13+ |
| `doors.xpRoomXpMultiplier` | `1.25` | **`1.2`** | Balances `'xp'` challenge rooms alongside `xpRoomExtraElites = 2` promoted elites |

---

## 24-Row Comparison Table (M11 T6 vs M12 T5)

| ch | seed | boss | stand still | M11 dodge + loadout | M12 dodge + XP skills | M12 level-ups | M12 doors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 11 s | won, 9/9, 4m09s, 1 hit | won, 9/9, 4m32s, 0 hits | 15 (Lv 16) | xp, xp, xp, xp, xp, xp, xp |
| 1 | 2 | frog | lost, 0/9, 10 s | won, 9/9, 3m57s, 0 hits | won, 9/9, 4m17s, 1 hit | 15 (Lv 16) | gold, xp, xp, xp, xp, xp, gold |
| 1 | 3 | frog | lost, 0/9, 9 s | won, 9/9, 3m07s, 0 hits | won, 9/9, 3m09s, 0 hits | 13 (Lv 14) | heal, xp, xp, xp, xp, heal, xp |
| 1 | 4 | frog | lost, 0/9, 12 s | won, 9/9, 3m26s, 0 hits | won, 9/9, 3m52s, 0 hits | 13 (Lv 14) | xp, gold, heal, xp, xp, xp, xp |
| 1 | 5 | tengu | lost, 0/9, 10 s | won, 9/9, 3m30s, 0 hits | won, 9/9, 4m10s, 1 hit | 14 (Lv 15) | xp, xp, heal, xp, xp, xp, xp |
| 1 | 6 | tengu | lost, 0/9, 13 s | won, 9/9, 3m00s, 0 hits | won, 9/9, 4m05s, 0 hits | 14 (Lv 15) | chest, xp, xp, xp, heal, xp, xp |
| 2 | 1 | slime | lost, 0/9, 14 s | won, 9/9, 5m28s, 1 hit | won, 9/9, 6m14s, 0 hits | 15 (Lv 16) | xp, xp, xp, xp, xp, xp, xp |
| 2 | 2 | squid | lost, 0/9, 11 s | won, 9/9, 5m36s, 0 hits | won, 9/9, 6m24s, 0 hits | 15 (Lv 16) | gold, xp, xp, xp, xp, xp, gold |
| 2 | 3 | slime | lost, 0/9, 8 s | won, 9/9, 4m10s, 0 hits | won, 9/9, 4m13s, 1 hit | 13 (Lv 14) | heal, xp, xp, xp, xp, heal, xp |
| 2 | 4 | slime | lost, 0/9, 15 s | won, 9/9, 4m46s, 0 hits | won, 9/9, 6m56s, 4 hits | 13 (Lv 14) | xp, gold, heal, xp, xp, xp, xp |
| 2 | 5 | squid | lost, 0/9, 7 s | won, 9/9, 5m03s, 0 hits | won, 9/9, 5m44s, 0 hits | 15 (Lv 16) | xp, xp, heal, xp, xp, xp, xp |
| 2 | 7 | squid | lost, 0/9, 10 s | won, 9/9, 4m43s, 0 hits | won, 9/9, 5m16s, 0 hits | 14 (Lv 15) | xp, heal, xp, xp, xp, xp, xp |
| 3 | 1 | bamboo | lost, 0/9, 14 s | won, 9/9, 8m29s, 0 hits | won, 9/9, 9m28s, 2 hits | 15 (Lv 16) | xp, xp, xp, xp, xp, xp, xp |
| 3 | 2 | samurai | lost, 0/9, 12 s | won, 9/9, 8m23s, 2 hits | won, 9/9, 9m03s, 1 hit | 15 (Lv 16) | gold, xp, xp, xp, xp, xp, gold |
| 3 | 3 | samurai | lost, 0/9, 9 s | won, 9/9, 6m12s, 1 hit | won, 9/9, 6m35s, 0 hits | 13 (Lv 14) | heal, xp, xp, xp, xp, heal, xp |
| 3 | 4 | samurai | lost, 0/9, 12 s | won, 9/9, 7m31s, 1 hit | won, 9/9, 8m44s, 1 hit | 14 (Lv 15) | xp, gold, heal, xp, xp, xp, xp |
| 3 | 5 | bamboo | lost, 0/9, 9 s | won, 9/9, 7m16s, 2 hits | won, 9/9, 9m01s, 0 hits | 14 (Lv 15) | xp, xp, heal, xp, xp, xp, xp |
| 3 | 8 | bamboo | lost, 0/9, 9 s | won, 9/9, 8m36s, 0 hits | won, 9/9, 8m55s, 0 hits | 15 (Lv 16) | xp, xp, xp, gold, xp, xp, xp |
| 4 | 1 | racoon | lost, 0/9, 15 s | won, 9/9, 9m44s, 1 hit | won, 9/9, 10m57s, 7 hits | 15 (Lv 16) | xp, xp, xp, xp, xp, xp, xp |
| 4 | 2 | redtengu | lost, 0/9, 10 s | won, 9/9, 10m34s, 3 hits | won, 9/9, 11m12s, 1 hit | 15 (Lv 16) | gold, xp, xp, xp, xp, xp, gold |
| 4 | 3 | racoon | lost, 0/9, 13 s | won, 9/9, 7m07s, 1 hit | won, 9/9, 8m05s, 1 hit | 13 (Lv 14) | heal, xp, xp, xp, xp, heal, xp |
| 4 | 4 | redtengu | lost, 0/9, 15 s | won, 9/9, 8m22s, 2 hits | won, 9/9, 9m21s, 1 hit | 14 (Lv 15) | xp, gold, heal, xp, xp, xp, xp |
| 4 | 5 | racoon | lost, 0/9, 11 s | won, 9/9, 9m01s, 4 hits | won, 9/9, 10m30s, 2 hits | 14 (Lv 15) | xp, xp, heal, xp, xp, xp, xp |
| 4 | 13 | redtengu | lost, 0/9, 10 s | won, 9/9, 7m47s, 1 hit | won, 9/9, 9m48s, 3 hits | 14 (Lv 15) | heal, xp, xp, xp, xp, xp, xp |

Summary: **24/24** stand still lost Room 1 (`7–15 s`), **24/24** dodge + XP-earned skills won 9/9 (`13/24` rows hit, `26` total hits), and **24/24** rows landed in the `12–16` level-ups band (**`13–15`**, avg **`14.2`**; Ch1 `13–15` · Ch2 `13–15` · Ch3 `13–15` · Ch4 `13–15`).

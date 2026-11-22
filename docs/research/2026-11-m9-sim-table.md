# M9 balance sim table — 2026-11-22

`cd game && bun run sim:table` (real `simulateRun`, 3 seeds per boss of every chapter pool; ~86 s).
`config/tuning.json` is unchanged since #45 — this run records the balance the owner approves, it does not retune it.
Per seed: stand still (no keys) vs dodge policy + a typical loadout (`TYPICAL_LOADOUT`) with the door choice modelled (`heal` first, then `skill`).

| chapter | seed | boss | stand still | dodge + loadout | doors |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 12 s | won, 9/9, 4m02s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 1 | 2 | frog | lost, 0/9, 10 s | won, 9/9, 4m06s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 1 | 3 | frog | lost, 0/9, 14 s | won, 9/9, 2m58s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 1 | 4 | frog | lost, 0/9, 13 s | won, 9/9, 3m48s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 1 | 5 | tengu | lost, 0/9, 17 s | won, 9/9, 3m53s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 1 | 6 | tengu | lost, 0/9, 10 s | won, 9/9, 3m11s, 0 hits | chest, skill, skill, skill, heal, skill, skill |
| 2 | 1 | slime | lost, 0/9, 11 s | won, 9/9, 5m58s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 2 | 2 | squid | lost, 0/9, 16 s | won, 9/9, 6m06s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 2 | 3 | slime | lost, 0/9, 8 s | won, 9/9, 4m35s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 2 | 4 | slime | lost, 0/9, 18 s | won, 9/9, 4m55s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 2 | 5 | squid | lost, 0/9, 6 s | won, 9/9, 5m21s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 2 | 7 | squid | lost, 0/9, 11 s | won, 9/9, 4m54s, 0 hits | skill, heal, skill, skill, skill, skill, skill |
| 3 | 1 | bamboo | lost, 0/9, 25 s | won, 9/9, 8m36s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 3 | 2 | samurai | lost, 0/9, 20 s | won, 9/9, 8m26s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 3 | 3 | samurai | lost, 0/9, 10 s | won, 9/9, 5m59s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 3 | 4 | samurai | lost, 0/9, 16 s | won, 9/9, 7m32s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 3 | 5 | bamboo | lost, 0/9, 14 s | won, 9/9, 7m04s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 3 | 8 | bamboo | lost, 0/9, 16 s | won, 9/9, 8m37s, 0 hits | skill, skill, skill, gold, skill, skill, skill |
| 4 | 1 | racoon | lost, 0/9, 21 s | won, 9/9, 9m49s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 4 | 2 | redtengu | lost, 0/9, 12 s | won, 9/9, 11m08s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 4 | 3 | racoon | lost, 0/9, 18 s | won, 9/9, 7m42s, 2 hits | heal, skill, skill, skill, skill, heal, skill |
| 4 | 4 | redtengu | lost, 0/9, 34 s | won, 9/9, 8m52s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 4 | 5 | racoon | lost, 0/9, 14 s | won, 9/9, 9m22s, 1 hit | skill, skill, heal, skill, skill, skill, skill |
| 4 | 13 | redtengu | lost, 0/9, 9 s | won, 9/9, 8m40s, 0 hits | heal, skill, skill, skill, skill, skill, skill |

Summary: 24 rows — stand still lost room 1 in 24/24, dodge + typical loadout won 9/9 in 24/24.

Notes:

- Seeds are the smallest ascending seeds that cover both bosses of the chapter pool 3 times each (`balanceSeeds`), so a rerun of this command is reproducible.
- A won run takes 7 normal-slot doors and then the boss door; the `doors` column lists those 7 picks. When the pick is `heal`, the special room replaces the next drawn room, so the door out of it carries a single `skill` offer.
- Chapter 4 is the slowest (7m42s–11m08s simulated), chapter 1 the fastest (2m58s–4m06s); the whole table stays inside the owner-accepted 30–60 min run and well under the 60 min sim cap.

---

## Update 2026-11-22 (#66) — after normal rooms shrank to 64×36 and the speed/fire-rate retune

Normal rooms are 2×2 screens (64×36) and the player moves at 5 tiles/s. Same seeds, same door choice,
same command. The M9 table above is kept as the record of what shipped at M9; this is the post-#66 rerun.

`config/tuning.json` changed since the table above, only in speed / fire-rate keys (plus the wave
ramp): `combat.moveSpeedTilesPerSecond` 4 → 5, `enemies.roles.caster.attackCooldownMs` 900 → 1200,
`enemies.roles.tank` cooldown 900 → 1600, charge speed 7 → 5, charge 450 → 350 ms, and
`waves.aliveCapStepPerRoom` 3 → 1 (the alive cap itself stays 24). Reasons: the same enemy totals in
half the floor area reach the player sooner, and a no-skill dodge run of chapter 3 lost room 2.

| chapter | seed | boss | stand still | dodge + loadout | doors |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 10 s | won, 9/9, 4m26s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 1 | 2 | frog | lost, 0/9, 13 s | won, 9/9, 4m45s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 1 | 3 | frog | lost, 0/9, 10 s | won, 9/9, 3m31s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 1 | 4 | frog | lost, 0/9, 11 s | won, 9/9, 3m51s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 1 | 5 | tengu | lost, 0/9, 16 s | won, 9/9, 4m20s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 1 | 6 | tengu | lost, 0/9, 14 s | won, 9/9, 3m26s, 0 hits | chest, skill, skill, skill, heal, skill, skill |
| 2 | 1 | slime | lost, 0/9, 16 s | won, 9/9, 6m39s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 2 | 2 | squid | lost, 0/9, 16 s | won, 9/9, 7m01s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 2 | 3 | slime | lost, 0/9, 11 s | won, 9/9, 5m08s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 2 | 4 | slime | lost, 0/9, 17 s | won, 9/9, 5m47s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 2 | 5 | squid | lost, 0/9, 7 s | won, 9/9, 5m54s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 2 | 7 | squid | lost, 0/9, 11 s | won, 9/9, 5m38s, 0 hits | skill, heal, skill, skill, skill, skill, skill |
| 3 | 1 | bamboo | lost, 0/9, 16 s | won, 9/9, 9m49s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 3 | 2 | samurai | lost, 0/9, 13 s | won, 9/9, 9m35s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 3 | 3 | samurai | lost, 0/9, 9 s | won, 9/9, 7m08s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 3 | 4 | samurai | lost, 0/9, 12 s | won, 9/9, 8m40s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 3 | 5 | bamboo | lost, 0/9, 14 s | won, 9/9, 8m37s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 3 | 8 | bamboo | lost, 0/9, 10 s | won, 9/9, 10m03s, 0 hits | skill, skill, skill, gold, skill, skill, skill |
| 4 | 1 | racoon | lost, 0/9, 12 s | won, 9/9, 11m26s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 4 | 2 | redtengu | lost, 0/9, 17 s | won, 9/9, 12m20s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 4 | 3 | racoon | lost, 0/9, 16 s | won, 9/9, 8m58s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 4 | 4 | redtengu | lost, 0/9, 17 s | won, 9/9, 10m06s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 4 | 5 | racoon | lost, 0/9, 18 s | won, 9/9, 10m38s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 4 | 13 | redtengu | lost, 0/9, 14 s | won, 9/9, 9m42s, 0 hits | heal, skill, skill, skill, skill, skill, skill |

Summary: 24 rows — stand still lost room 1 in 24/24, dodge + typical loadout won 9/9 in 24/24.

The first run on the 64×36 pool *before* those tuning keys (same table, old numbers) lost 5 of 24
loadout rows: ch3 seed 4 (7/9 rooms) and ch4 seeds 1, 2, 4 and 13 (5–8/9). Enemy counts are
unchanged, so the table is shorter per chapter only because the rooms are.

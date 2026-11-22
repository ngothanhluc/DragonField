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
same command. The M9 table above is kept as the record of what shipped at M9; this is the post-#66
rerun after review restored the 24-alive cap ramp.

`config/tuning.json` changed only in speed / fire-rate keys (the alive cap is untouched:
`waves.aliveCap` 24, `waves.aliveCapStepPerRoom` 3): `combat.moveSpeedTilesPerSecond` 4 → 5,
`enemies.roles.caster` cooldown 900 → 3000 ms, `enemies.roles.tank` cooldown 900 → 2200 ms, charge
speed 7 → 4 tiles/s, charge 450 → 350 ms, `enemies.roles.sniper` cooldown 1800 → 4000 ms, projectile
11 → 10 tiles/s, `enemies.roles.chaser` speed 3.2 → 2.6, `splitter` 2.1 → 1.7, `splitling` 3.6 → 2.6,
and `enemies.elite.chaser` pounce speed 6 → 5, pounce cooldown 900 → 1200 ms.

Why this much: the same enemy totals in a quarter of the floor area reach the player about four times
as fast (the 16×16-screen room is gone). Fire rates and closing speeds absorb that; the first run on
the 64×36 pool *before* these keys lost 5 of 24 loadout rows (ch3 seed 4 and ch4 seeds 1, 2, 4, 13),
and the chapter-3 no-skill gate died in room 2. Because a fresh enemy waited a whole attack cooldown
before its first shot, the slow caster cooldown alone made some casters die without firing; the wave
scheduler now caps that first wait at the role's telegraph (between-shots cooldowns are unchanged).

| chapter | seed | boss | stand still | dodge + loadout | doors |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | tengu | lost, 0/9, 18 s | won, 9/9, 4m11s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 1 | 2 | frog | lost, 0/9, 17 s | won, 9/9, 4m04s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 1 | 3 | frog | lost, 0/9, 13 s | won, 9/9, 3m05s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 1 | 4 | frog | lost, 0/9, 18 s | won, 9/9, 3m30s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 1 | 5 | tengu | lost, 0/9, 27 s | won, 9/9, 3m45s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 1 | 6 | tengu | lost, 0/9, 19 s | won, 9/9, 3m10s, 0 hits | chest, skill, skill, skill, heal, skill, skill |
| 2 | 1 | slime | lost, 0/9, 22 s | won, 9/9, 5m49s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 2 | 2 | squid | lost, 0/9, 20 s | won, 9/9, 5m59s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 2 | 3 | slime | lost, 0/9, 14 s | won, 9/9, 4m27s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 2 | 4 | slime | lost, 0/9, 22 s | won, 9/9, 5m01s, 0 hits | skill, gold, heal, skill, skill, skill, skill |
| 2 | 5 | squid | lost, 0/9, 7 s | won, 9/9, 5m16s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 2 | 7 | squid | lost, 0/9, 16 s | won, 9/9, 5m09s, 0 hits | skill, heal, skill, skill, skill, skill, skill |
| 3 | 1 | bamboo | lost, 0/9, 28 s | won, 9/9, 8m12s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 3 | 2 | samurai | lost, 0/9, 22 s | won, 9/9, 8m05s, 0 hits | gold, skill, skill, skill, skill, skill, gold |
| 3 | 3 | samurai | lost, 0/9, 11 s | won, 9/9, 6m15s, 0 hits | heal, skill, skill, skill, skill, heal, skill |
| 3 | 4 | samurai | lost, 0/9, 14 s | won, 9/9, 7m31s, 1 hit | skill, gold, heal, skill, skill, skill, skill |
| 3 | 5 | bamboo | lost, 0/9, 17 s | won, 9/9, 7m30s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 3 | 8 | bamboo | lost, 0/9, 12 s | won, 9/9, 8m28s, 0 hits | skill, skill, skill, gold, skill, skill, skill |
| 4 | 1 | racoon | lost, 0/9, 22 s | won, 9/9, 9m39s, 0 hits | skill, skill, skill, skill, skill, skill, skill |
| 4 | 2 | redtengu | lost, 0/9, 23 s | won, 9/9, 10m32s, 1 hit | gold, skill, skill, skill, skill, skill, gold |
| 4 | 3 | racoon | lost, 0/9, 21 s | won, 9/9, 7m31s, 3 hits | heal, skill, skill, skill, skill, heal, skill |
| 4 | 4 | redtengu | lost, 0/9, 27 s | won, 9/9, 8m41s, 1 hit | skill, gold, heal, skill, skill, skill, skill |
| 4 | 5 | racoon | lost, 0/9, 24 s | won, 9/9, 9m04s, 0 hits | skill, skill, heal, skill, skill, skill, skill |
| 4 | 13 | redtengu | lost, 0/9, 16 s | won, 9/9, 8m37s, 0 hits | heal, skill, skill, skill, skill, skill, skill |
Summary: 24 rows — stand still lost room 1 in 24/24, dodge + typical loadout won 9/9 in 24/24.

The 128×72 table above is the M9 record; this one is what the 64×36 pool plays, still inside the
owner-accepted 30–60 min run (4m11s–10m32s simulated).

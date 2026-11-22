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

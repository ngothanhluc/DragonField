# M20 Balance Simulation Table (`bun run sim:table`)

Generated for **Milestone M20** (spec #82, ADR-027: Class-Exclusive Skills & Skill Codex), on
`master` after #83–#88. The table adds a **`class skills`** column: every owned class-exclusive
skill or Class Evolution at run end, in `CLASS_SKILLS` then `CLASS_EVOLUTIONS` order. The column is
built by walking `SimulationResult.acquiredSkills` and keeping ids `findClassSkillOrEvolution`
knows, so a cross-class leak would show up as a foreign id instead of being hidden.

## Key Tuning Summary

- **No `tuning.json` change was needed.** All **72/72** rows clear the bar without a single balance
  delta; the class-exclusive numbers from #84–#87 are unchanged.
- **Matrix:** `ninja` 3 seeds per boss (`24` rows), `archer`/`mage`/`cultivator` 2 seeds per boss
  (`16` rows each) — **72 rows** across every `class × chapter × boss`.
- **Class-pool pick model (`tests/helpers/sim-table.ts`):** the competent-player policy now knows
  all 16 exclusives and all 4 Class Evolutions. Ninja and Cultivator kits are taken early (their
  exclusives carry their own damage), capped at **1 stack** each so they unlock the Class Evolution
  and then hand the picks back to the shared DPS curve. Archer and Mage start their kit at
  **level 5** (`ARCHER_MAGE_KIT_LEVEL`): the sim first secures `twin-shot` / `sharpen` / `shield`,
  then takes *Mưa Tên* + *Tên Tách Chùm* + *Ấn Ký Săn Mồi* + *Phong Tiễn* (and *Thiên Thạch* +
  *Vệ Tinh Băng* + *Lôi Ngục* + *Xung Năng Ma Pháp*). Taking the two kits before the shared core
  made two seeds die in Rooms 1–2; the level gate is the only policy difference and no game number
  changed.
- **Class Evolutions are reported:** `simulateRun` still returns the shared `EVOLUTIONS` in
  `evolutions`; the helper appends owned Class Evolutions there too, so the table's `evolutions`
  column and the new `class skills` column agree.
- **Meta progression (M18):** Ch1 runs at 0-Meta; Ch2–Ch4 model earned chapter Meta
  (`Ch2: 4/2/2`, `Ch3: 4/3/3`, `Ch4: 5/4/4`). Stand-still rows always run at 0-Meta.

## Full 72-Row Matrix (`4 classes × 4 chapters × both bosses`)

| class | chapter | seed | boss | stand still | dodge + M14 kit | level-ups | dashes | actives | evolutions | class skills | doors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ninja | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 2m26s, 1 hit | 16 (Lv 17) | 36 | 34 | phantom-volley, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m28s, 1 hit | 16 (Lv 17) | 30 | 46 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 2m34s, 0 hits | 16 (Lv 17) | 30 | 37 | — | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 1 | 4 | frog | lost, 0/9, 5 s | won, 9/9, 2m26s, 1 hit | 16 (Lv 17) | 30 | 45 | tempest-barrage | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 5 | tengu | lost, 0/9, 5 s | won, 9/9, 2m36s, 0 hits | 16 (Lv 17) | 28 | 40 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 6 | tengu | lost, 0/9, 6 s | won, 9/9, 2m51s, 2 hits | 16 (Lv 17) | 26 | 37 | aegis-retribution | ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 1 | slime | lost, 0/9, 6 s | won, 9/9, 3m38s, 5 hits | 16 (Lv 17) | 53 | 48 | phantom-volley, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 3m30s, 2 hits | 16 (Lv 17) | 35 | 65 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 3 | slime | lost, 0/9, 6 s | won, 9/9, 3m33s, 4 hits | 16 (Lv 17) | 52 | 50 | — | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 4 | slime | lost, 0/9, 6 s | won, 9/9, 3m41s, 1 hit | 16 (Lv 17) | 42 | 66 | tempest-barrage | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m34s, 7 hits | 16 (Lv 17) | 50 | 54 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 7 | squid | lost, 0/9, 5 s | won, 9/9, 3m38s, 1 hit | 16 (Lv 17) | 42 | 48 | cataclysm, aegis-retribution | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 4m51s, 8 hits | 16 (Lv 17) | 80 | 66 | phantom-volley, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 5m07s, 10 hits | 16 (Lv 17) | 81 | 67 | aegis-retribution, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 5m11s, 13 hits | 16 (Lv 17) | 65 | 68 | — | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 3 | 4 | samurai | lost, 0/9, 5 s | won, 9/9, 5m13s, 3 hits | 16 (Lv 17) | 52 | 91 | tempest-barrage | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 5m34s, 4 hits | 16 (Lv 17) | 61 | 78 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 8 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m56s, 5 hits | 16 (Lv 17) | 60 | 70 | aegis-retribution, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 1 | racoon | lost, 0/9, 6 s | won, 9/9, 5m40s, 18 hits | 16 (Lv 17) | 78 | 81 | phantom-volley, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 2 | redtengu | lost, 0/9, 5 s | won, 9/9, 6m39s, 12 hits | 16 (Lv 17) | 103 | 90 | aegis-retribution, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 5m37s, 9 hits | 16 (Lv 17) | 78 | 84 | — | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 5m53s, 10 hits | 16 (Lv 17) | 66 | 105 | tempest-barrage | ninja-venom-shuriken, ninja-kunai-burst | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 5 | racoon | lost, 0/9, 5 s | won, 9/9, 6m09s, 14 hits | 16 (Lv 17) | 84 | 94 | tempest-barrage, ninja-phantom-assassin | ninja-shadow-clone, ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb, ninja-phantom-assassin | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 13 | redtengu | lost, 0/9, 5 s | won, 9/9, 5m26s, 13 hits | 16 (Lv 17) | 66 | 84 | phantom-volley | ninja-venom-shuriken, ninja-kunai-burst, ninja-smoke-bomb | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 2m52s, 2 hits | 16 (Lv 17) | 30 | 40 | phantom-volley, shadowstep | archer-arrow-rain | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m51s, 1 hit | 16 (Lv 17) | 31 | 41 | aegis-retribution, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-hunters-mark, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 3m14s, 3 hits | 16 (Lv 17) | 24 | 47 | aegis-retribution | archer-wind-arrow | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 1 | 5 | tengu | lost, 0/9, 5 s | won, 9/9, 2m52s, 0 hits | 16 (Lv 17) | 27 | 42 | cataclysm, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 2 | 1 | slime | lost, 0/9, 5 s | won, 9/9, 4m12s, 8 hits | 16 (Lv 17) | 75 | 58 | phantom-volley, shadowstep | archer-arrow-rain | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 3m58s, 1 hit | 16 (Lv 17) | 46 | 57 | aegis-retribution, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-hunters-mark, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 4m30s, 9 hits | 16 (Lv 17) | 53 | 66 | aegis-retribution | archer-wind-arrow | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m49s, 1 hit | 16 (Lv 17) | 50 | 55 | cataclysm, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 5m58s, 7 hits | 16 (Lv 17) | 92 | 82 | phantom-volley, shadowstep | archer-arrow-rain | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 5m26s, 9 hits | 16 (Lv 17) | 76 | 79 | aegis-retribution, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-hunters-mark, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 5m48s, 14 hits | 16 (Lv 17) | 67 | 84 | aegis-retribution | archer-wind-arrow | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 5m50s, 10 hits | 16 (Lv 17) | 65 | 81 | cataclysm, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 4 | 1 | racoon | lost, 0/9, 5 s | won, 9/9, 6m44s, 12 hits | 16 (Lv 17) | 101 | 100 | phantom-volley, shadowstep | archer-arrow-rain | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 4 | 2 | redtengu | lost, 0/9, 4 s | won, 9/9, 6m24s, 12 hits | 16 (Lv 17) | 80 | 100 | aegis-retribution, archer-sky-tempest | archer-arrow-rain, archer-split-arrow, archer-hunters-mark, archer-wind-arrow, archer-sky-tempest | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 7m11s, 15 hits | 16 (Lv 17) | 97 | 110 | aegis-retribution | archer-wind-arrow | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 6m50s, 7 hits | 16 (Lv 17) | 78 | 134 | aegis-retribution, tempest-barrage | archer-split-arrow, archer-wind-arrow | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 3m08s, 0 hits | 16 (Lv 17) | 41 | 47 | phantom-volley, shadowstep | mage-frost-orbs | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m48s, 0 hits | 16 (Lv 17) | 40 | 45 | aegis-retribution, mage-elemental-cataclysm | mage-meteor, mage-frost-orbs, mage-storm-strike, mage-arcane-pulse, mage-elemental-cataclysm | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 2m37s, 6 hits | 16 (Lv 17) | 30 | 47 | aegis-retribution | mage-arcane-pulse | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 1 | 5 | tengu | lost, 0/9, 4 s | won, 9/9, 2m45s, 1 hit | 16 (Lv 17) | 33 | 46 | cataclysm | mage-frost-orbs, mage-storm-strike, mage-arcane-pulse | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 2 | 1 | slime | lost, 0/9, 5 s | won, 9/9, 4m43s, 8 hits | 16 (Lv 17) | 64 | 69 | phantom-volley, shadowstep | mage-frost-orbs | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 4m17s, 1 hit | 16 (Lv 17) | 56 | 66 | aegis-retribution, mage-elemental-cataclysm | mage-meteor, mage-frost-orbs, mage-storm-strike, mage-arcane-pulse, mage-elemental-cataclysm | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 4m14s, 9 hits | 16 (Lv 17) | 52 | 69 | aegis-retribution | mage-arcane-pulse | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m27s, 6 hits | 16 (Lv 17) | 42 | 58 | cataclysm | mage-frost-orbs, mage-storm-strike, mage-arcane-pulse | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 7m03s, 17 hits | 16 (Lv 17) | 121 | 102 | phantom-volley, shadowstep | mage-frost-orbs | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 5m37s, 7 hits | 16 (Lv 17) | 70 | 87 | aegis-retribution, mage-elemental-cataclysm | mage-meteor, mage-frost-orbs, mage-storm-strike, mage-arcane-pulse, mage-elemental-cataclysm | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 6m05s, 14 hits | 16 (Lv 17) | 80 | 94 | aegis-retribution | mage-arcane-pulse | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 5m33s, 14 hits | 16 (Lv 17) | 74 | 85 | cataclysm | mage-frost-orbs, mage-storm-strike, mage-arcane-pulse | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 4 | 1 | racoon | lost, 0/9, 5 s | won, 9/9, 7m41s, 19 hits | 16 (Lv 17) | 140 | 120 | shadowstep | mage-frost-orbs | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 4 | 2 | redtengu | lost, 0/9, 4 s | won, 9/9, 7m42s, 10 hits | 16 (Lv 17) | 121 | 121 | aegis-retribution, mage-elemental-cataclysm | mage-meteor, mage-frost-orbs, mage-storm-strike, mage-arcane-pulse, mage-elemental-cataclysm | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 4 | 3 | racoon | lost, 0/9, 5 s | won, 9/9, 7m53s, 9 hits | 16 (Lv 17) | 99 | 126 | aegis-retribution | mage-arcane-pulse | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 7m28s, 8 hits | 16 (Lv 17) | 85 | 148 | aegis-retribution, tempest-barrage | mage-storm-strike, mage-arcane-pulse | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 1 | 1 | tengu | lost, 0/9, 7 s | won, 9/9, 2m27s, 0 hits | 16 (Lv 17) | 22 | 31 | phantom-volley | cultivator-orbit-swords, cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m17s, 1 hit | 16 (Lv 17) | 21 | 40 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-qi-barrier, cultivator-myriad-swords | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 1 | 3 | frog | lost, 0/9, 6 s | won, 9/9, 2m24s, 1 hit | 16 (Lv 17) | 23 | 32 | — | cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 1 | 5 | tengu | lost, 0/9, 6 s | won, 9/9, 2m18s, 2 hits | 16 (Lv 17) | 23 | 35 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-myriad-swords | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 2 | 1 | slime | lost, 0/9, 7 s | won, 9/9, 3m23s, 0 hits | 16 (Lv 17) | 37 | 42 | phantom-volley | cultivator-orbit-swords, cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 2 | 2 | squid | lost, 0/9, 6 s | won, 9/9, 3m05s, 1 hit | 16 (Lv 17) | 31 | 56 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-qi-barrier, cultivator-myriad-swords | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 3m28s, 1 hit | 16 (Lv 17) | 30 | 44 | — | cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m08s, 1 hit | 16 (Lv 17) | 32 | 47 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-myriad-swords | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 3 | 1 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m47s, 1 hit | 16 (Lv 17) | 51 | 59 | phantom-volley | cultivator-orbit-swords, cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 3 | 2 | samurai | lost, 0/9, 6 s | won, 9/9, 4m24s, 3 hits | 16 (Lv 17) | 47 | 77 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-qi-barrier, cultivator-myriad-swords | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 3 | 3 | samurai | lost, 0/9, 6 s | won, 9/9, 4m12s, 2 hits | 16 (Lv 17) | 55 | 55 | — | cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m37s, 11 hits | 16 (Lv 17) | 51 | 67 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-myriad-swords | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 4 | 1 | racoon | lost, 0/9, 6 s | won, 9/9, 4m59s, 1 hit | 16 (Lv 17) | 59 | 68 | phantom-volley | cultivator-orbit-swords, cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 4 | 2 | redtengu | lost, 0/9, 5 s | won, 9/9, 5m17s, 4 hits | 16 (Lv 17) | 60 | 100 | tempest-barrage, cultivator-myriad-swords | cultivator-orbit-swords, cultivator-sword-array, cultivator-sword-qi, cultivator-qi-barrier, cultivator-myriad-swords | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 4m52s, 3 hits | 16 (Lv 17) | 56 | 70 | — | cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 4m58s, 14 hits | 16 (Lv 17) | 52 | 68 | cataclysm | cultivator-sword-qi, cultivator-qi-barrier | xp, xp, xp, shop, xp, xp, xp, xp |

## Per-Class Summary

| class | rows | stand still lost | wins (9/9) | clear time (avg / range) | level-ups | dashes/run | actives/run | hits (rows / total) | evolutions | class skills | class evolution |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ninja | 24 | 24/24 | 24/24 | 4m18s (2m26s–6m39s) | 16–16 (avg 16.0) | 55.3 | 64.5 | 22/24 (144) | 20/24 (34) | 24/24 | 13/24 |
| archer | 16 | 16/16 | 16/16 | 4m54s (2m51s–7m11s) | 16–16 (avg 16.0) | 62.0 | 73.5 | 15/16 (111) | 16/16 (28) | 16/16 | 7/16 |
| mage | 16 | 16/16 | 16/16 | 5m11s (2m37s–7m53s) | 16–16 (avg 16.0) | 71.8 | 83.1 | 14/16 (129) | 16/16 (24) | 16/16 | 4/16 |

Summary: 72 rows across 4 classes — stand still lost room 1 in 72/72, dodge + M14 kit won 9/9 in
72/72 (65/72 rows hit, 430 total hits), level-ups in 12–16 band in 72/72 (range 16–16, avg 16.0),
dashes 72/72 (Ch2–Ch4 54/54, avg 57.2/run), actives 72/72 (avg 68.7/run), evolutions 64/72 (105
unlocked), class skills 72/72 rows (219 owned).

## Exit Gates (`scripts/sim-table.ts`)

`bun run sim:table` exits `1` when any of these fails (it mirrors
`tests/integration/m20-class-pool-sim.acceptance.test.ts`):

- stand-still did not lose Room 1 on every row, or the dodge + kit run did not win 9/9;
- any row is outside the `12–16` level-up band;
- Ch2–Ch4 rows are not dashing, or a class dashes in fewer than `rows - 1` rows;
- a row casts no Signature Active;
- a class has **0** rows with an Evolution, or **0** rows with its Class Evolution;
- any row earned **no** own class-exclusive skill, or owns another class's skill/Evolution
  (cross-class leak).

## Glossary

- **Shared Core pool** — the 21 pruned shared skills every class rolls (`SKILLS`).
- **Class-Exclusive skill** — one of the 4 skills only the active class's roll can offer
  (`CLASS_SKILLS`, 16 total).
- **Class Evolution (Legendary)** — the class's single ultimate, unlocked by owning its recipe
  (`CLASS_EVOLUTIONS`, 4 total).
- **Skill Codex** — the Character Select panel listing a class's portrait, stats, Signature Active,
  4 exclusive skills and Class Evolution recipe.
- **class crest** — the per-class colour + glyph drawn on exclusive pick cards (`CLASS_CRESTS`).

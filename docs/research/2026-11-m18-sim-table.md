# M18 Balance Simulation Table (`bun run sim:table`)

Generated for **Milestone M18** (ADR-026: Bullet-Hell Lethality, Zero Enemy Hit Knockback/Stagger, `dasher` & `gunner` Roles, and Combat Visual Clarity), rebased onto `master` (`7b4c6be7`, M19 pruned 21-skill pool).

## Key Tuning Summary
- **Enemy Hit Knockback & Stagger:** `enemyKnockbackDistanceTiles = 0`, `enemyKnockbackDurationMs = 0`, `enemyStaggerMs = 0` (Level-Up resume radial push wave + 0.6 s i-frame kept active).
- **Enemy Speed & Bullet Speed:** `+25–35%` movement speed across roles (`chaser 3.45`, `caster 2.1`, `tank 1.55`, `sniper 1.45`, `splitter 2.35`, `splitling 3.65`, `bomber 3.25`, `buffer 1.9`, `dasher 4.0`, `gunner 2.0`), `+40–60%` enemy bullet speed (`caster 6.2`, `buffer 5.0`, `gunner 7.5`, `sniper 13.5`).
- **Wave Density & Scaling:** `aliveCapStart = 7`, `aliveCapStepPerRoom = 4`, `aliveCap = 30`, `chapters.enemyHealthMultipliers = [1, 1.15, 1.28, 1.42]`, `chapters.enemyDamageMultipliers = [1, 1.05, 1.12, 1.2]`.
- **New Roles:** `dasher` (*Ám Sát*, diagonal flanker + 9.5 t/s dash, Elite dashes twice) & `gunner` (*Pháo Thủ Chùm*, 3→5 bullet fan at 7.5 t/s, Elite fires 2 staggered alternating volleys).
- **Meta Progression in Sim:** Ch1 runs at **0-Meta**; Ch2–Ch4 model earned chapter Meta progression (`Ch2: 4/2/2`, `Ch3: 4/3/3`, `Ch4: 5/4/4`), while all `stand still` rows run at **0-Meta**.

## Full 72-Row Matrix (`4 classes × 4 chapters × both bosses`)

| class | chapter | seed | boss | stand still | dodge + M14 kit | level-ups | dashes | actives | evolutions | doors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ninja | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 2m36s, 0 hits | 16 (Lv 17) | 29 | 34 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m17s, 1 hit | 16 (Lv 17) | 27 | 48 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 2m57s, 0 hits | 16 (Lv 17) | 29 | 49 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 1 | 4 | frog | lost, 0/9, 5 s | won, 9/9, 2m42s, 2 hits | 16 (Lv 17) | 36 | 41 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 5 | tengu | lost, 0/9, 5 s | won, 9/9, 2m28s, 0 hits | 16 (Lv 17) | 28 | 36 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 1 | 6 | tengu | lost, 0/9, 6 s | won, 9/9, 2m29s, 2 hits | 16 (Lv 17) | 22 | 51 | aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 1 | slime | lost, 0/9, 6 s | won, 9/9, 3m33s, 0 hits | 16 (Lv 17) | 49 | 47 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 3m17s, 1 hit | 16 (Lv 17) | 38 | 69 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 3 | slime | lost, 0/9, 6 s | won, 9/9, 3m57s, 4 hits | 16 (Lv 17) | 56 | 67 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 2 | 4 | slime | lost, 0/9, 6 s | won, 9/9, 4m00s, 4 hits | 16 (Lv 17) | 45 | 57 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m26s, 1 hit | 16 (Lv 17) | 47 | 50 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 2 | 7 | squid | lost, 0/9, 5 s | won, 9/9, 3m35s, 2 hits | 16 (Lv 17) | 46 | 47 | phantom-volley, cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 4m44s, 3 hits | 16 (Lv 17) | 69 | 65 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 4m33s, 2 hits | 16 (Lv 17) | 47 | 96 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 5m53s, 2 hits | 16 (Lv 17) | 80 | 92 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 3 | 4 | samurai | lost, 0/9, 5 s | won, 9/9, 5m34s, 0 hits | 16 (Lv 17) | 69 | 78 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m44s, 3 hits | 16 (Lv 17) | 59 | 66 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 3 | 8 | bamboo | lost, 0/9, 6 s | won, 9/9, 5m00s, 7 hits | 16 (Lv 17) | 64 | 71 | phantom-volley, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 1 | racoon | lost, 0/9, 6 s | won, 9/9, 5m27s, 4 hits | 16 (Lv 17) | 75 | 78 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 2 | redtengu | lost, 0/9, 5 s | won, 9/9, 5m30s, 5 hits | 16 (Lv 17) | 57 | 126 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 6m43s, 3 hits | 16 (Lv 17) | 104 | 116 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| ninja | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 6m07s, 3 hits | 16 (Lv 17) | 79 | 93 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 5 | racoon | lost, 0/9, 5 s | won, 9/9, 5m37s, 6 hits | 16 (Lv 17) | 72 | 84 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| ninja | 4 | 13 | redtengu | lost, 0/9, 5 s | won, 9/9, 6m11s, 3 hits | 16 (Lv 17) | 79 | 89 | phantom-volley, cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 2m53s, 2 hits | 16 (Lv 17) | 28 | 40 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m43s, 1 hit | 16 (Lv 17) | 25 | 59 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 3m30s, 1 hit | 16 (Lv 17) | 34 | 60 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 1 | 5 | tengu | lost, 0/9, 5 s | won, 9/9, 3m04s, 0 hits | 16 (Lv 17) | 32 | 45 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 2 | 1 | slime | lost, 0/9, 5 s | won, 9/9, 4m02s, 3 hits | 16 (Lv 17) | 66 | 58 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 3m50s, 4 hits | 16 (Lv 17) | 41 | 84 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 5m11s, 7 hits | 16 (Lv 17) | 68 | 88 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m58s, 1 hit | 16 (Lv 17) | 51 | 59 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 5m51s, 7 hits | 16 (Lv 17) | 79 | 81 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 6m04s, 10 hits | 16 (Lv 17) | 84 | 99 | aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 6m35s, 4 hits | 16 (Lv 17) | 86 | 111 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 6m00s, 2 hits | 16 (Lv 17) | 77 | 84 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 4 | 1 | racoon | lost, 0/9, 5 s | won, 9/9, 6m30s, 6 hits | 16 (Lv 17) | 84 | 97 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| archer | 4 | 2 | redtengu | lost, 0/9, 4 s | won, 9/9, 5m49s, 9 hits | 16 (Lv 17) | 68 | 149 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 8m15s, 7 hits | 16 (Lv 17) | 120 | 146 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| archer | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 7m30s, 7 hits | 16 (Lv 17) | 93 | 113 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 1 | 1 | tengu | lost, 0/9, 5 s | won, 9/9, 3m01s, 0 hits | 16 (Lv 17) | 39 | 47 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m34s, 1 hit | 16 (Lv 17) | 23 | 61 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 1 | 3 | frog | lost, 0/9, 5 s | won, 9/9, 3m20s, 3 hits | 16 (Lv 17) | 38 | 63 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 1 | 5 | tengu | lost, 0/9, 4 s | won, 9/9, 2m48s, 1 hit | 16 (Lv 17) | 29 | 46 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 2 | 1 | slime | lost, 0/9, 5 s | won, 9/9, 4m41s, 0 hits | 16 (Lv 17) | 53 | 68 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 2 | 2 | squid | lost, 0/9, 5 s | won, 9/9, 3m50s, 4 hits | 16 (Lv 17) | 36 | 90 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 4m22s, 8 hits | 16 (Lv 17) | 62 | 86 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m35s, 3 hits | 16 (Lv 17) | 51 | 63 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 3 | 1 | bamboo | lost, 0/9, 5 s | won, 9/9, 5m42s, 8 hits | 16 (Lv 17) | 77 | 88 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 3 | 2 | samurai | lost, 0/9, 5 s | won, 9/9, 5m01s, 7 hits | 16 (Lv 17) | 50 | 123 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 3 | 3 | samurai | lost, 0/9, 5 s | won, 9/9, 7m29s, 4 hits | 16 (Lv 17) | 100 | 129 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 5m44s, 8 hits | 16 (Lv 17) | 78 | 90 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 4 | 1 | racoon | lost, 0/9, 5 s | won, 9/9, 6m45s, 9 hits | 16 (Lv 17) | 99 | 111 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| mage | 4 | 2 | redtengu | lost, 0/9, 4 s | won, 9/9, 6m25s, 6 hits | 16 (Lv 17) | 66 | 162 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 4 | 3 | racoon | lost, 0/9, 5 s | won, 9/9, 9m36s, 6 hits | 16 (Lv 17) | 138 | 171 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| mage | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 7m41s, 2 hits | 16 (Lv 17) | 94 | 128 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 1 | 1 | tengu | lost, 0/9, 7 s | won, 9/9, 2m23s, 0 hits | 16 (Lv 17) | 22 | 30 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 1 | 2 | frog | lost, 0/9, 6 s | won, 9/9, 2m08s, 1 hit | 16 (Lv 17) | 14 | 42 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 1 | 3 | frog | lost, 0/9, 6 s | won, 9/9, 2m37s, 0 hits | 16 (Lv 17) | 27 | 41 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 1 | 5 | tengu | lost, 0/9, 6 s | won, 9/9, 2m14s, 1 hit | 16 (Lv 17) | 25 | 31 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 2 | 1 | slime | lost, 0/9, 7 s | won, 9/9, 3m24s, 0 hits | 16 (Lv 17) | 42 | 42 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 2 | 2 | squid | lost, 0/9, 6 s | won, 9/9, 3m00s, 1 hit | 16 (Lv 17) | 25 | 60 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 2 | 3 | slime | lost, 0/9, 5 s | won, 9/9, 3m42s, 2 hits | 16 (Lv 17) | 38 | 59 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 2 | 5 | squid | lost, 0/9, 4 s | won, 9/9, 3m08s, 1 hit | 16 (Lv 17) | 35 | 43 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 3 | 1 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m13s, 4 hits | 16 (Lv 17) | 51 | 55 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 3 | 2 | samurai | lost, 0/9, 6 s | won, 9/9, 4m07s, 1 hit | 16 (Lv 17) | 34 | 84 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 3 | 3 | samurai | lost, 0/9, 6 s | won, 9/9, 4m40s, 2 hits | 16 (Lv 17) | 56 | 74 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 3 | 5 | bamboo | lost, 0/9, 6 s | won, 9/9, 4m03s, 3 hits | 16 (Lv 17) | 44 | 55 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 4 | 1 | racoon | lost, 0/9, 6 s | won, 9/9, 5m03s, 2 hits | 16 (Lv 17) | 69 | 69 | cataclysm, aegis-retribution | xp, xp, xp, shop, xp, xp, xp, xp |
| cultivator | 4 | 2 | redtengu | lost, 0/9, 5 s | won, 9/9, 4m37s, 7 hits | 16 (Lv 17) | 46 | 106 | phantom-volley, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 4 | 3 | racoon | lost, 0/9, 6 s | won, 9/9, 5m32s, 0 hits | 16 (Lv 17) | 65 | 95 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, chest, xp, xp, xp, xp |
| cultivator | 4 | 4 | redtengu | lost, 0/9, 5 s | won, 9/9, 4m55s, 0 hits | 16 (Lv 17) | 49 | 74 | cataclysm, aegis-retribution, tempest-barrage | xp, xp, xp, shop, xp, xp, xp, xp |

| class | rows | stand still lost | wins (9/9) | clear time (avg / range) | level-ups | dashes/run | actives/run | hits (rows / total) | evolutions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ninja | 24 | 24/24 | 24/24 | 4m18s (2m17s–6m43s) | 16–16 (avg 16.0) | 54.4 | 68.8 | 19/24 (58) | 24/24 (62) |
| archer | 16 | 16/16 | 16/16 | 5m07s (2m43s–8m15s) | 16–16 (avg 16.0) | 64.8 | 85.8 | 15/16 (71) | 16/16 (40) |
| mage | 16 | 16/16 | 16/16 | 5m10s (2m34s–9m36s) | 16–16 (avg 16.0) | 64.6 | 95.4 | 14/16 (70) | 16/16 (40) |
| cultivator | 16 | 16/16 | 16/16 | 3m44s (2m08s–5m32s) | 16–16 (avg 16.0) | 40.1 | 60.0 | 11/16 (25) | 16/16 (40) |

Summary: 72 rows across 4 classes — stand still lost room 1 in 72/72, dodge + M14 kit won 9/9 in 72/72 (59/72 rows hit, 224 total hits), level-ups in 12–16 band in 72/72 (range 16–16, avg 16.0), dashes 72/72 (Ch2–Ch4 54/54, avg 55.8/run), actives 72/72 (avg 76.5/run), evolutions 72/72 (182 unlocked).

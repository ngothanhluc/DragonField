/**
 * Balance sim table acceptance (ADR-013, `docs/milestones.md` §M9 / §M12 / §M13 / §M14,
 * GDD §15.4, ADR-021, ADR-022, #108).
 *
 * Across all 4 playable classes (`ninja`, `archer`, `mage`, `cultivator`), all 4 chapters, and
 * both chapter bosses, on the exact `bun run sim:table` matrix:
 * - Standing still (no Dash, no Active, no skills) loses Room 1 (`0/9`).
 * - Dodging from a **0-skill start** with the full M14 kit (class Layer 1/2 stats + Dash +
 *   class Signature Active + XP-earned pure-combat skills & Legendary Evolutions +
 *   `typicalDoorChoice`) genuinely exercises Dash, class Signature Active and Evolutions against
 *   Tier-2 enemy AI, and meets the #108 win floor (`BALANCE_FLOOR`): 55/72 overall, and per class
 *   ninja 19/24, archer 12/16, mage 8/16, cultivator 16/16. Every winning row still lands inside
 *   the **12–16 level-ups/run** band; a lost run ends early and is not held to it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import { CHARACTER_IDS, type CharacterId } from '../../assets/scripts/core/characters/roster';
import { getEvolution, isEvolutionId } from '../../assets/scripts/core/skills/evolutions';
import { getSkill } from '../../assets/scripts/core/skills/pool';
import {
  BALANCE_FLOOR,
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  SIM_TABLE_SEEDS_PER_BOSS,
  balanceSeeds,
  formatSimTable,
  simTableGateFailures,
  simTableRows,
  typicalDoorChoice,
  typicalRerollPolicy,
  typicalSkillChoice,
  type SimTableRow,
} from '../helpers/sim-table';

/** Same macrotask yield as `run-simulation.test.ts`: long synchronous sims starve vitest's RPC. */
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

const CHAPTERS = [1, 2, 3, 4] as const;
const SEEDS_PER_BOSS = 2;

describe('typical door choice', () => {
  it('takes heal first, then xp, else the first door', () => {
    expect(typicalDoorChoice(['xp', 'heal'])).toBe(1);
    expect(typicalDoorChoice(['heal', 'gold'])).toBe(0);
    expect(typicalDoorChoice(['gold', 'xp'])).toBe(1);
    expect(typicalDoorChoice(['xp', 'gold'])).toBe(0);
    expect(typicalDoorChoice(['gold', 'chest'])).toBe(0);
    expect(typicalDoorChoice(['shop', 'gold'])).toBe(0);
  });
});

describe('typical XP skill & reroll policies', () => {
  it('picks high-impact DPS/survival/Evolution cards over secondary modifiers and protects low hearts', () => {
    const empty = new Map<string, number>();
    const healthy = { hearts: 6, maxHearts: 6 };
    const lowHp = { hearts: 2, maxHearts: 6 };

    expect(
      typicalSkillChoice(
        [getSkill('afterimage'), getSkill('sharpen'), getSkill('dash-nova')],
        empty,
        2,
        healthy,
      ),
    ).toBe(1);
    expect(
      typicalSkillChoice(
        [getSkill('sharpen'), getSkill('shield'), getSkill('afterimage')],
        new Map([['sharpen', 3]]),
        6,
        healthy,
      ),
    ).toBe(1);
    expect(
      typicalSkillChoice(
        [getSkill('sharpen'), getSkill('vitality'), getSkill('swift')],
        new Map([['sharpen', 4]]),
        9,
        lowHp,
      ),
    ).toBe(1);
    expect(
      typicalSkillChoice(
        [getSkill('sharpen'), getEvolution('phantom-volley'), getSkill('twin-shot')],
        new Map([
          ['twin-shot', 1],
          ['piercing', 1],
        ]),
        8,
        healthy,
      ),
    ).toBe(1);
    // Completing an unlocked Evolution pair gets prioritized over lower filler cards.
    expect(
      typicalSkillChoice(
        [getSkill('rapid-fire'), getSkill('shadow-conduit'), getSkill('swift')],
        new Map([['rapid-fire', 2]]),
        7,
        healthy,
      ),
    ).toBe(1);
  });

  it('only rerolls weak hands within the cost cap and keeps Evolution pair completers', () => {
    const empty = new Map<string, number>();
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('dash-nova'), getSkill('vitality')],
        empty,
        50,
        10,
        0,
      ),
    ).toBe(true);
    // `vitality` completes `aegis-retribution` when `shield` is already owned (M19 ADR-027).
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('dash-nova'), getSkill('vitality')],
        new Map([['shield', 1]]),
        50,
        10,
        0,
      ),
    ).toBe(false);
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('sharpen'), getSkill('vitality')],
        empty,
        50,
        10,
        0,
      ),
    ).toBe(false);
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('dash-nova'), getSkill('vitality')],
        empty,
        100,
        50,
        4,
      ),
    ).toBe(false);
  });
});

describe('balance seeds', () => {
  it('cover every boss of the chapter pool, `perBoss` seeds each, in ascending order', () => {
    for (const chapter of CHAPTERS) {
      const seeds = balanceSeeds(chapter, SEEDS_PER_BOSS);
      const pool = BOSS_POOLS[chapter] ?? [];

      expect(pool.length, `chapter ${chapter}`).toBe(2);
      expect(seeds, `chapter ${chapter}`).toHaveLength(pool.length * SEEDS_PER_BOSS);
      expect([...seeds].sort((a, b) => a - b)).toEqual(seeds);
      expect(new Set(seeds).size).toBe(seeds.length);
      for (const boss of pool) {
        expect(
          seeds.filter((seed) => pickBoss(chapter, seed) === boss),
          `chapter ${chapter} boss ${boss}`,
        ).toHaveLength(SEEDS_PER_BOSS);
      }
    }
  });

  it('are the smallest positive seeds that do so (chapter 1: 1, 2, 3, 5)', () => {
    // Measured with `pickBoss`: ch1 seeds 1 → tengu, 2 → frog, 3 → frog, 5 → tengu.
    expect(balanceSeeds(1, 2)).toEqual([1, 2, 3, 5]);
  });
});

describe('M14 4-class × 4-chapter sim table (all classes, Dash, Signature Actives & Evolutions)', () => {
  const rowsByClass = new Map<CharacterId, SimTableRow[]>();

  for (const characterId of CHARACTER_IDS) {
    const seedsPerBoss = SIM_TABLE_SEEDS_PER_BOSS[characterId];
    it(`${characterId}: all 4 chapters × both bosses — stand still loses room 1 and dodge + M14 kit meets the #108 win floor`, () => {
      const rows = simTableRows({
        chapters: CHAPTERS,
        seedsPerBoss,
        characters: [characterId],
      });
      rowsByClass.set(characterId, rows);

      const floor = BALANCE_FLOOR.byClass[characterId];
      expect(rows).toHaveLength(CHAPTERS.length * 2 * seedsPerBoss);
      expect(rows.length, `${characterId} rows`).toBe(floor.rows);

      for (const chapter of CHAPTERS) {
        const chapterRows = rows.filter((row) => row.chapter === chapter);
        expect(chapterRows.map((row) => row.seed)).toEqual(balanceSeeds(chapter, seedsPerBoss));
        expect(new Set(chapterRows.map((row) => row.boss))).toEqual(new Set(BOSS_POOLS[chapter]));
      }

      for (const row of rows) {
        const label = `${characterId} chapter ${row.chapter} seed ${row.seed} (${row.boss})`;
        expect(row.characterId, label).toBe(characterId);
        expect(row.boss, label).toBe(pickBoss(row.chapter, row.seed));

        expect(row.standStill.status, `${label} stand still`).toBe('lost');
        expect(row.standStill.roomsCleared, `${label} stand still`).toBe(0);
        expect(row.standStill.dashesUsed, `${label} stand still dashes`).toBe(0);
        expect(row.standStill.activeSkillsUsed, `${label} stand still actives`).toBe(0);
        expect(row.standStill.evolutions, `${label} stand still evolutions`).toEqual([]);

        // Winners only: a lost run ends early, so its level-ups and doors say nothing about balance.
        const won = row.loadout.status === 'won' && row.loadout.roomsCleared === 9;
        if (won) {
          expect(row.loadout.levelUps, `${label} levelUps`).toBeGreaterThanOrEqual(
            LEVEL_UP_TARGET_MIN,
          );
          expect(row.loadout.levelUps, `${label} levelUps`).toBeLessThanOrEqual(
            LEVEL_UP_TARGET_MAX,
          );
          // Door choice is modelled: the 7 normal-slot doors before the boss door are recorded.
          expect(row.loadout.doors.length, `${label} doors`).toBeGreaterThanOrEqual(7);
        }
        expect(row.loadout.finalLevel, `${label} finalLevel`).toBe(row.loadout.levelUps + 1);
        expect(row.loadout.xpEarned, `${label} xpEarned`).toBeGreaterThan(0);
        if (row.chapter >= 2) {
          expect(row.loadout.dashesUsed, `${label} dashesUsed`).toBeGreaterThan(0);
        }
        expect(row.loadout.activeSkillsUsed, `${label} activeSkillsUsed`).toBeGreaterThan(0);
        for (const evoId of row.loadout.evolutions) {
          expect(isEvolutionId(evoId), `${label} evolution ${evoId}`).toBe(true);
        }
        expect(row.loadout.durationMs, label).toBeGreaterThan(row.standStill.durationMs);
        expect(row.loadout.hits, label).toBeGreaterThanOrEqual(0);
      }

      const wins = rows.filter(
        (row) => row.loadout.status === 'won' && row.loadout.roomsCleared === 9,
      ).length;
      expect(wins, `${characterId} wins`).toBeGreaterThanOrEqual(floor.won);

      const rowsUsingDash = rows.filter((row) => row.loadout.dashesUsed > 0).length;
      expect(rowsUsingDash, `${characterId} dash coverage`).toBeGreaterThanOrEqual(rows.length - 1);
    }, 300_000);
  }

  it('meets the #108 balance floor, unlocks Legendary Evolutions for every class, and formats M14 Markdown table columns', () => {
    const rows = CHARACTER_IDS.flatMap((characterId) => rowsByClass.get(characterId) ?? []);
    expect(rows).toHaveLength(BALANCE_FLOOR.total.rows);
    expect(simTableGateFailures(rows)).toEqual([]);

    for (const characterId of CHARACTER_IDS) {
      const classRows = rowsByClass.get(characterId) ?? [];
      const classEvos = classRows.filter((row) => row.loadout.evolutions.length > 0);
      expect(classEvos.length, `${characterId} evolutions`).toBeGreaterThanOrEqual(1);
    }

    const rowsWithEvolution = rows.filter((row) => row.loadout.evolutions.length > 0);
    expect(rowsWithEvolution.length).toBeGreaterThanOrEqual(Math.ceil(rows.length / 2));

    const lines = formatSimTable(rows).trim().split('\n');
    expect(lines[0]).toMatch(
      /^\|.*class.*\|.*chapter.*\|.*seed.*\|.*boss.*\|.*level-ups.*\|.*dashes.*\|.*actives.*\|.*evolutions.*\|/i,
    );
    expect(lines[1]).toMatch(/^\|[\s:|-]+\|$/);
    expect(lines.slice(2)).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const line = lines[index + 2] ?? '';
      expect(line).toContain(`| ${row.characterId} |`);
      expect(line).toContain(`| ${row.chapter} |`);
      expect(line).toContain(`| ${row.seed} |`);
      expect(line).toContain(row.boss);
      expect(line).toContain(`${row.loadout.levelUps} (Lv ${row.loadout.finalLevel})`);
      expect(line).toContain(`| ${row.loadout.dashesUsed} | ${row.loadout.activeSkillsUsed} |`);
    }
  });
});

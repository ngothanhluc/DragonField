/**
 * Balance sim table acceptance (ADR-013, `docs/milestones.md` §M9 / §M12, ADR-021).
 *
 * Across all 4 chapters and both chapter bosses:
 * - Standing still loses Room 1 (`0/9`).
 * - Dodging from a **0-skill start** with XP-earned skills (`XpOrbPool` + `XpTracker` +
 *   dedicated `createSkillRollRng` sub-seed + `typicalSkillChoice` + `typicalRerollPolicy` +
 *   `typicalDoorChoice`) lands cleanly inside **12–16 level-ups/run** and wins `9/9`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import { getEvolution } from '../../assets/scripts/core/skills/evolutions';
import { getSkill } from '../../assets/scripts/core/skills/pool';
import {
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  balanceSeeds,
  formatSimTable,
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
        [getSkill('afterimage'), getSkill('sharpen'), getSkill('iron-skin')],
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
  });

  it('only rerolls weak hands within the cost cap', () => {
    const empty = new Map<string, number>();
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('iron-skin'), getSkill('thorns')],
        empty,
        50,
        10,
        0,
      ),
    ).toBe(true);
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('sharpen'), getSkill('thorns')],
        empty,
        50,
        10,
        0,
      ),
    ).toBe(false);
    expect(
      typicalRerollPolicy(
        [getSkill('afterimage'), getSkill('iron-skin'), getSkill('thorns')],
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

describe('M12 sim table (unified XP level-up economy)', () => {
  const rowsByChapter = new Map<number, SimTableRow[]>();

  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: stand still loses room 1, dodge + XP skills wins 9/9 with 12–16 level-ups`, () => {
      const rows = simTableRows({ chapters: [chapter], seedsPerBoss: SEEDS_PER_BOSS });
      rowsByChapter.set(chapter, rows);

      expect(rows.map((row) => row.seed)).toEqual(balanceSeeds(chapter, SEEDS_PER_BOSS));
      expect(new Set(rows.map((row) => row.boss))).toEqual(new Set(BOSS_POOLS[chapter]));

      for (const row of rows) {
        const label = `chapter ${chapter} seed ${row.seed} (${row.boss})`;
        expect(row.chapter, label).toBe(chapter);
        expect(row.boss, label).toBe(pickBoss(chapter, row.seed));

        expect(row.standStill.status, `${label} stand still`).toBe('lost');
        expect(row.standStill.roomsCleared, `${label} stand still`).toBe(0);

        expect(row.loadout.status, `${label} dodge + XP skills`).toBe('won');
        expect(row.loadout.roomsCleared, `${label} dodge + XP skills`).toBe(9);
        expect(row.loadout.levelUps, `${label} levelUps`).toBeGreaterThanOrEqual(LEVEL_UP_TARGET_MIN);
        expect(row.loadout.levelUps, `${label} levelUps`).toBeLessThanOrEqual(LEVEL_UP_TARGET_MAX);
        expect(row.loadout.finalLevel, `${label} finalLevel`).toBe(row.loadout.levelUps + 1);
        expect(row.loadout.xpEarned, `${label} xpEarned`).toBeGreaterThan(0);
        // Door choice is modelled: the 7 normal-slot doors before the boss door are recorded.
        expect(row.loadout.doors.length, `${label} doors`).toBeGreaterThanOrEqual(7);
        expect(row.loadout.durationMs, label).toBeGreaterThan(row.standStill.durationMs);
        expect(row.loadout.hits, label).toBeGreaterThanOrEqual(0);
      }
    }, 300_000);
  }

  it('formats one Markdown row per sim row under a header including level-ups', () => {
    const rows = CHAPTERS.flatMap((chapter) => rowsByChapter.get(chapter) ?? []);
    expect(rows).toHaveLength(CHAPTERS.length * 2 * SEEDS_PER_BOSS);

    const lines = formatSimTable(rows).trim().split('\n');
    expect(lines[0]).toMatch(/^\|.*chapter.*\|.*seed.*\|.*boss.*\|.*level-ups.*\|/i);
    expect(lines[1]).toMatch(/^\|[\s:|-]+\|$/);
    expect(lines.slice(2)).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const line = lines[index + 2] ?? '';
      expect(line).toContain(`| ${row.chapter} |`);
      expect(line).toContain(`| ${row.seed} |`);
      expect(line).toContain(row.boss);
      expect(line).toContain(`${row.loadout.levelUps} (Lv ${row.loadout.finalLevel})`);
    }
  });
});

/**
 * Ticket #46 acceptance: the M9 balance sim table (ADR-013, `docs/milestones.md` §M9).
 *
 * "Sim (multiple seeds, both bosses per chapter): standing still loses room 1; dodging + a typical
 * loadout wins all 4 chapters." The door choice is modelled (a typical player takes heal, then
 * skill). The same rows feed `bun run sim:table`, whose Markdown output goes in the PR for the
 * owner to approve.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import {
  balanceSeeds,
  formatSimTable,
  simTableRows,
  typicalDoorChoice,
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

describe('M9 sim table', () => {
  const rowsByChapter = new Map<number, SimTableRow[]>();

  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: standing still loses room 1, dodge + loadout wins, both bosses`, () => {
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

        expect(row.loadout.status, `${label} loadout`).toBe('won');
        expect(row.loadout.roomsCleared, `${label} loadout`).toBe(9);
        // Door choice is modelled: the 7 two-door picks before the boss door are recorded.
        expect(row.loadout.doors.length, `${label} doors`).toBeGreaterThanOrEqual(7);
        expect(row.loadout.durationMs, label).toBeGreaterThan(row.standStill.durationMs);
        expect(row.loadout.hits, label).toBeGreaterThanOrEqual(0);
      }
    }, 300_000);
  }

  it('formats one Markdown row per sim row under a header', () => {
    const rows = CHAPTERS.flatMap((chapter) => rowsByChapter.get(chapter) ?? []);
    expect(rows).toHaveLength(CHAPTERS.length * 2 * SEEDS_PER_BOSS);

    const lines = formatSimTable(rows).trim().split('\n');
    expect(lines[0]).toMatch(/^\|.*chapter.*\|.*seed.*\|.*boss.*\|/i);
    expect(lines[1]).toMatch(/^\|[\s:|-]+\|$/);
    expect(lines.slice(2)).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const line = lines[index + 2] ?? '';
      expect(line).toContain(`| ${row.chapter} |`);
      expect(line).toContain(`| ${row.seed} |`);
      expect(line).toContain(row.boss);
    }
  });
});

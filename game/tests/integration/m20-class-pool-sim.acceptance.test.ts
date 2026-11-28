/**
 * Ticket #89 acceptance (M20 close-out, spec #82, ADR-027), amended by #108.
 *
 * `bun run sim:table` must model the class-exclusive pools: every class × chapter × boss row
 * earns its own class's exclusive skills through XP level-ups, never another class's (zero
 * cross-class leaks), and every class unlocks its Class Evolution at least once. The #108 balance
 * floor replaces "dodge + kit wins 9/9 in every row": per class at least `BALANCE_FLOOR.byClass[id].won`
 * winning rows, at least that many rows owning one of the class's own exclusive skills, and winning
 * rows inside the 12–16 level-ups band (a lost run ends early). The table is recorded in
 * `docs/research/2026-11-m20-sim-table.md`, and the M16–M20 status lines in the milestone docs say Done.
 *
 * Seam: `simTableRows` / `formatSimTable` in `tests/helpers/sim-table.ts`, the same helpers
 * `scripts/sim-table.ts` prints.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_IDS, type CharacterId } from '../../assets/scripts/core/characters/roster';
import { classEvolutionFor, classSkillsFor } from '../../assets/scripts/core/skills/class-skills';
import {
  BALANCE_FLOOR,
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  SIM_TABLE_SEEDS_PER_BOSS,
  formatSimTable,
  simTableRows,
  type SimTableRow,
} from '../helpers/sim-table';

/** Same macrotask yield as `sim-table.acceptance.test.ts`: long synchronous sims starve vitest's RPC. */
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../..');

const CHAPTERS = [1, 2, 3, 4] as const;

/** The field this ticket adds to each sim outcome: class-exclusive skills + Class Evolution owned at run end. */
function classSkillsOf(outcome: SimTableRow['standStill']): readonly string[] {
  return (outcome as { readonly classSkills?: readonly string[] }).classSkills as readonly string[];
}

const rowsByClass = new Map<CharacterId, SimTableRow[]>();

describe('#89 sim table models the class-exclusive pools (4 classes × 4 chapters)', () => {
  for (const characterId of CHARACTER_IDS) {
    const ownSkillIds = classSkillsFor(characterId).map((skill) => skill.id);
    const evolutionId = classEvolutionFor(characterId).id;
    const ownIds = new Set([...ownSkillIds, evolutionId]);
    const floor = BALANCE_FLOOR.byClass[characterId];
    const seedsPerBoss = SIM_TABLE_SEEDS_PER_BOSS[characterId];

    it(`${characterId}: every row earns its own class skills, never another class's, and meets the #108 win floor`, () => {
      const rows = simTableRows({
        chapters: CHAPTERS,
        seedsPerBoss,
        characters: [characterId],
      });
      rowsByClass.set(characterId, rows);
      expect(rows).toHaveLength(CHAPTERS.length * 2 * seedsPerBoss);
      expect(rows.length, `${characterId} rows`).toBe(floor.rows);

      for (const row of rows) {
        const label = `${characterId} chapter ${row.chapter} seed ${row.seed} (${row.boss})`;

        // Stand still picks nothing.
        expect(classSkillsOf(row.standStill), `${label} stand still class skills`).toEqual([]);

        const classSkills = classSkillsOf(row.loadout);
        expect(Array.isArray(classSkills), `${label} loadout.classSkills is a list`).toBe(true);
        // Zero cross-class leaks.
        for (const id of classSkills) {
          expect(ownIds.has(id), `${label} leaked ${id}`).toBe(true);
        }
        // An owned Class Evolution shows in the evolutions column too.
        if (classSkills.includes(evolutionId)) {
          expect(row.loadout.evolutions, `${label} evolutions`).toContain(evolutionId);
        }

        // The pre-M20 stand-still contract still holds with class pools in play.
        expect(row.standStill.status, `${label} stand still`).toBe('lost');
        expect(row.standStill.roomsCleared, `${label} stand still`).toBe(0);

        // Winners only: a lost run ends early, so it is not held to the level-up band.
        const won = row.loadout.status === 'won' && row.loadout.roomsCleared === 9;
        if (won) {
          expect(row.loadout.levelUps, `${label} levelUps`).toBeGreaterThanOrEqual(
            LEVEL_UP_TARGET_MIN,
          );
          expect(row.loadout.levelUps, `${label} levelUps`).toBeLessThanOrEqual(
            LEVEL_UP_TARGET_MAX,
          );
        }
      }

      const wins = rows.filter(
        (row) => row.loadout.status === 'won' && row.loadout.roomsCleared === 9,
      ).length;
      expect(wins, `${characterId} wins`).toBeGreaterThanOrEqual(floor.won);

      // At least as many rows as the win floor own one of the class's own exclusive skills.
      const classSkillRows = rows.filter((row) =>
        classSkillsOf(row.loadout).some((id) => ownSkillIds.includes(id)),
      ).length;
      expect(classSkillRows, `${characterId} rows owning a class skill`).toBeGreaterThanOrEqual(
        floor.won,
      );

      // All 4 exclusive skills of the class show up somewhere across its rows.
      const earned = new Set(rows.flatMap((row) => classSkillsOf(row.loadout)));
      for (const id of ownSkillIds) {
        expect(earned.has(id), `${characterId} never earned ${id}`).toBe(true);
      }

      // The Class Evolution unlocks in at least one row, and is reported in `evolutions`.
      const evolutionRows = rows.filter((row) => row.loadout.evolutions.includes(evolutionId));
      expect(evolutionRows.length, `${characterId} rows unlocking ${evolutionId}`).toBeGreaterThanOrEqual(1);
    }, 300_000);
  }

  it('formats a class skills column holding each row\'s class skills', () => {
    const rows = CHARACTER_IDS.flatMap((characterId) => rowsByClass.get(characterId) ?? []);
    expect(rows).toHaveLength(BALANCE_FLOOR.total.rows);

    const lines = formatSimTable(rows).trim().split('\n');
    expect(lines[0]).toMatch(/\|\s*class skills\s*\|/i);
    expect(lines.slice(2)).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const line = lines[index + 2] ?? '';
      const classSkills = classSkillsOf(row.loadout);
      expect(line).toContain(`| ${classSkills.length > 0 ? classSkills.join(', ') : '—'} |`);
    }
  });
});

describe('#89 M20 docs', () => {
  it('records the M20 sim table with every class and every Class Evolution', () => {
    const path = join(REPO_ROOT, 'docs/research/2026-11-m20-sim-table.md');
    expect(existsSync(path), 'docs/research/2026-11-m20-sim-table.md exists').toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/\|\s*class skills\s*\|/i);
    for (const characterId of CHARACTER_IDS) {
      expect(text, `${characterId} rows`).toContain(`| ${characterId} |`);
      expect(text, `${characterId} Class Evolution`).toContain(classEvolutionFor(characterId).id);
    }
  });

  it('marks M16–M20 Done (M21 stays open) in the milestone docs', () => {
    const detail = readFileSync(join(REPO_ROOT, 'docs/milestones/m16-m21.md'), 'utf8');
    const sections = detail.split(/^## /m).slice(1);
    const statusOf = (milestone: string): string => {
      const section = sections.find((s) => s.startsWith(`${milestone} `)) ?? '';
      return section.match(/^\*\*Status:.*$/m)?.[0] ?? '';
    };
    for (const milestone of ['M16', 'M17', 'M18', 'M19', 'M20']) {
      expect(statusOf(milestone), `${milestone} status line`).toMatch(/^\*\*Status: ✅ Done/);
    }

    const overview = readFileSync(join(REPO_ROOT, 'docs/milestones.md'), 'utf8');
    for (const milestone of ['M16', 'M17', 'M18', 'M19', 'M20']) {
      const row = overview.split('\n').find((line) => line.startsWith(`| **${milestone}** |`)) ?? '';
      expect(row, `${milestone} overview row`).toContain('✅ Done');
    }
  });
});

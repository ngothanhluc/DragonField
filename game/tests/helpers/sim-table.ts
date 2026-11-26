/**
 * Test-only balance sim table (ADR-013, `docs/milestones.md` §M9).
 *
 * The M9 acceptance says "sim (multiple seeds, both bosses per chapter): standing still loses
 * room 1; dodging + a typical loadout wins all 4 chapters". This helper turns that sentence into
 * rows: for each chapter and seed it runs the real `simulateRun` twice — a player who presses no
 * key, and one who dodges with a typical loadout and models the door choice (heal first, then
 * skill) — so the table the owner approves comes from the shipped rules, not from a spreadsheet.
 *
 * Nothing under `assets/` imports this file: it is the test/CLI seam over `core/sim`.
 */
import { join } from 'node:path';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import type { BossId } from '../../assets/scripts/core/boss/boss-defs';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData } from '../../assets/scripts/core/level/level-data';
import type { DoorReward } from '../../assets/scripts/core/run/doors';
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  type InputPolicy,
  type SimulationStatus,
} from '../../assets/scripts/core/sim/run-simulation';
import { makeDodgePolicy } from './dodge-policy';
import { LEVELS_ROOT, loadTmxLevels } from './tmx-levels';

/** A typical loadout of a player who picked up a few cards during the run. */
export const TYPICAL_LOADOUT: ReadonlyMap<string, number> = new Map([
  ['sharpen', 2],
  ['rapid-fire', 2],
  ['twin-shot', 1],
  ['vitality', 1],
  ['swift', 1],
  ['piercing', 1],
  ['crit-eye', 1],
  ['shield', 1],
]);

/** No keys pressed: the "standing still" player. */
const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });

/**
 * Which door a typical player takes: heal when offered (survivability first), else the xp door,
 * else the first door (`chooseDoor` for `simulateRun`).
 */
export function typicalDoorChoice(offers: readonly DoorReward[]): number {
  const heal = offers.indexOf('heal');
  if (heal !== -1) return heal;
  const xp = offers.indexOf('xp');
  if (xp !== -1) return xp;
  return 0;
}

/**
 * Ascending seeds of `chapter` that together meet every boss of the chapter pool `perBoss` times.
 * Seeds are scanned from 1, so the table is reproducible and short (chapter 1, 2 → 1, 2, 3, 5).
 */
export function balanceSeeds(chapter: number, perBoss: number): number[] {
  const pool = BOSS_POOLS[chapter] ?? [];
  if (pool.length === 0 || perBoss <= 0) return [];

  const kept = new Map<BossId, number>();
  for (const boss of pool) kept.set(boss, 0);

  const seeds: number[] = [];
  // Bounded scan: `pickBoss` hashes each seed into the pool, so a few hundred seeds always
  // cover it; the cap only keeps a broken hash from looping forever.
  const MAX_SEED = 100_000;
  for (let seed = 1; seed <= MAX_SEED; seed += 1) {
    const boss = pickBoss(chapter, seed);
    const count = kept.get(boss) ?? 0;
    if (count >= perBoss) continue;

    kept.set(boss, count + 1);
    seeds.push(seed);
    if (Array.from(kept.values()).every((value) => value >= perBoss)) return seeds;
  }

  throw new Error(`balanceSeeds(${chapter}, ${perBoss}) found no full cover within ${MAX_SEED} seeds`);
}

/** The four numbers of one run that make a table cell. */
export interface SimOutcome {
  readonly status: SimulationStatus;
  readonly roomsCleared: number;
  readonly durationMs: number;
  /** Number of `player-hit` events (0 for the standing player only if it never got touched). */
  readonly hits: number;
}

export interface SimTableRow {
  readonly chapter: number;
  readonly seed: number;
  /** The boss this seed meets (`pickBoss`), i.e. the one the run must beat. */
  readonly boss: BossId;
  readonly standStill: SimOutcome;
  /** The dodge + typical loadout run, plus the door picks it made before the boss door. */
  readonly loadout: SimOutcome & { readonly doors: DoorReward[] };
}

function outcomeOf(result: ReturnType<typeof simulateRun>): SimOutcome {
  return {
    status: result.status,
    roomsCleared: result.roomsCleared,
    durationMs: result.durationMs,
    hits: result.events.filter((event) => event.kind === 'player-hit').length,
  };
}

function chapterLevels(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

/**
 * One row per (chapter, seed): the standing-still run and the dodge + typical-loadout run.
 * Both use the default `maxDurationMs`; the door choice is modelled by `typicalDoorChoice`.
 */
export function simTableRows(options: {
  readonly chapters: readonly number[];
  readonly seedsPerBoss: number;
}): SimTableRow[] {
  const rows: SimTableRow[] = [];

  for (const chapter of options.chapters) {
    const level = chapterLevels(chapter);

    for (const seed of balanceSeeds(chapter, options.seedsPerBoss)) {
      const standStillRun = simulateRun({
        seed,
        level,
        policy: standStill,
        maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
      });
      const loadoutRun = simulateRun({
        seed,
        level,
        policy: makeDodgePolicy(),
        skills: TYPICAL_LOADOUT,
        chooseDoor: typicalDoorChoice,
        maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
      });

      rows.push({
        chapter,
        seed,
        boss: pickBoss(chapter, seed),
        standStill: outcomeOf(standStillRun),
        loadout: {
          ...outcomeOf(loadoutRun),
          /**
           * Every door the run walked through before the boss door. `offers.length > 1` cannot be
           * the filter: taking `heal` enters a special room that replaces the next slot, and the
           * door out of it carries a single (`skill`) offer — filtering those out would drop real
           * picks and make the count depend on how many heals the seed drew (ch3 seed 3 → 5).
           * A won run always takes exactly the 7 normal-slot doors, then the boss door.
           */
          doors: loadoutRun.events.flatMap((event) =>
            event.kind === 'door' && event.chosen !== 'boss' ? [event.chosen] : [],
          ),
        },
      });
    }
  }

  return rows;
}

/** `12 s`, `3m07s` — compact enough to keep one sim row on one table line. */
function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function formatOutcome(outcome: SimOutcome): string {
  return `${outcome.status}, ${outcome.roomsCleared}/9, ${formatDuration(outcome.durationMs)}`;
}

/** `0 hits`, `1 hit`. */
function formatHits(hits: number): string {
  return `${hits} ${hits === 1 ? 'hit' : 'hits'}`;
}

/**
 * The Markdown table for the PR: one line per row, in the order given.
 *
 * `| chapter | seed | boss | stand still | dodge + loadout | doors |`
 */
export function formatSimTable(rows: readonly SimTableRow[]): string {
  const lines = [
    '| chapter | seed | boss | stand still | dodge + loadout | doors |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const doors = row.loadout.doors.join(', ') || '—';
    lines.push(
      `| ${row.chapter} | ${row.seed} | ${row.boss} | ${formatOutcome(row.standStill)} | ` +
        `${formatOutcome(row.loadout)}, ${formatHits(row.loadout.hits)} | ${doors} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

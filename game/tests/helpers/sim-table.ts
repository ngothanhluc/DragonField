/**
 * Test-only balance sim table (ADR-013, `docs/milestones.md` §M9 / §M12, ADR-021).
 *
 * Runs the real `simulateRun` twice per (chapter, seed):
 * 1. `standStill`: presses no keys and acquires no skills — must lose Room 1.
 * 2. `loadout` (M12 unified XP economy): starts with **0 skills**, dodges, models door choice
 *    (`heal` first, then `xp`), and earns every skill purely through XP level-ups (`XpOrbPool` +
 *    `XpTracker` + dedicated `createSkillRollRng` sub-seed + `typicalSkillChoice`), landing in
 *    the 12–16 level-ups/run target band across Ch1–Ch4 and winning 9/9.
 *
 * Nothing under `assets/` imports this file: it is the test/CLI seam over `core/sim`.
 */
import { join } from 'node:path';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import type { BossId } from '../../assets/scripts/core/boss/boss-defs';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData } from '../../assets/scripts/core/level/level-data';
import type { DoorReward } from '../../assets/scripts/core/run/doors';
import type { SkillDef } from '../../assets/scripts/core/skills/pool';
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  type InputPolicy,
  type SimulationStatus,
  type SkillPickPolicy,
  type SkillRerollPolicy,
} from '../../assets/scripts/core/sim/run-simulation';
import { makeDodgePolicy } from './dodge-policy';
import { LEVELS_ROOT, loadTmxLevels } from './tmx-levels';

/** M12 target band for level-ups earned during a full 9-room chapter run (GDD §15.2, ADR-021). */
export const LEVEL_UP_TARGET_MIN = 12;
export const LEVEL_UP_TARGET_MAX = 16;

/** A fixed mid-run loadout used by unit/integration tests that compare DPS with vs without skills. */
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

/**
 * Competent-player skill preference order for 1-of-3 XP level-up picks (M12, ADR-021).
 * Prioritises core DPS (`twin-shot`, `sharpen`), premier defense (`shield`, `second-wind`),
 * fire rate & wave-clear (`rapid-fire`, `piercing`, `ricochet`, `explosive`), then sustain and
 * secondary combat modifiers over economy cards (`luck`, `greed`).
 */
const SKILL_PRIORITY: readonly string[] = [
  'twin-shot',
  'sharpen',
  'shield',
  'second-wind',
  'rapid-fire',
  'piercing',
  'ricochet',
  'explosive',
  'lifesteal',
  'vitality',
  'crit-eye',
  'homing',
  'swift',
  'freeze',
  'executioner',
  'poison',
  'long-iframe',
  'thorns',
  'luck',
  'greed',
];

/** Skills strong enough to accept without spending gold on an M12 reroll. */
const CORE_COMBAT_SKILLS: ReadonlySet<string> = new Set([
  'twin-shot',
  'sharpen',
  'shield',
  'second-wind',
  'rapid-fire',
  'piercing',
  'ricochet',
  'explosive',
  'lifesteal',
]);

/** Max gold a frugal player spends on a single level-up reroll (`10g → 20g → 30g → 40g`). */
const TYPICAL_REROLL_MAX_COST = 40;

/**
 * Pick the highest-priority card from a 1-of-3 level-up offer.
 * - While healthy: prioritises core DPS (`twin-shot`, `sharpen` 1–2), then `shield`/`second-wind`,
 *   then further `sharpen`/`rapid-fire`/wave-clear.
 * - When low on hearts (`hearts <= 4`): prioritises immediate survival (`second-wind`, `vitality`,
 *   `shield`, `lifesteal`) just as a real player reading their HUD hearts would.
 */
export const typicalSkillChoice: SkillPickPolicy = (
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  _level: number,
  context,
): number => {
  const sharpenStacks = owned.get('sharpen') ?? 0;
  const lowHearts = context.hearts <= 4;
  let bestIndex = 0;
  let bestRank = Number.POSITIVE_INFINITY;
  for (let index = 0; index < offers.length; index += 1) {
    const skill = offers[index];
    if (skill === undefined) continue;
    const rank = SKILL_PRIORITY.indexOf(skill.id);
    let effectiveRank = rank === -1 ? SKILL_PRIORITY.length : rank;
    if (skill.id === 'sharpen' && sharpenStacks >= 2) {
      // Ranks behind `shield` (2) and `second-wind` (3) once base damage is already 3+.
      effectiveRank = 3.5;
    }
    if (lowHearts) {
      if (skill.id === 'second-wind') effectiveRank = -3;
      else if (skill.id === 'vitality') effectiveRank = -2;
      else if (skill.id === 'shield') effectiveRank = -1;
      else if (skill.id === 'lifesteal') effectiveRank = 0.5;
    }
    if (effectiveRank < bestRank) {
      bestRank = effectiveRank;
      bestIndex = index;
    }
  }
  return bestIndex;
};

/**
 * Competent-player M12 gold reroll policy: spend run gold (up to 40g/reroll) only when a
 * level-up hand offers zero core combat/survival cards (`CORE_COMBAT_SKILLS`).
 */
export const typicalRerollPolicy: SkillRerollPolicy = (
  offers: readonly SkillDef[],
  _owned: ReadonlyMap<string, number>,
  _availableGold: number,
  nextCost: number,
): boolean => {
  if (nextCost > TYPICAL_REROLL_MAX_COST) return false;
  return !offers.some((skill) => CORE_COMBAT_SKILLS.has(skill.id));
};

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

/** The summary numbers of one run that make a table cell. */
export interface SimOutcome {
  readonly status: SimulationStatus;
  readonly roomsCleared: number;
  readonly durationMs: number;
  /** Number of `player-hit` events (0 for the standing player only if it never got touched). */
  readonly hits: number;
  /** Total XP level-ups earned during the run (M12, ADR-021). */
  readonly levelUps: number;
  /** Final player level (`1 + levelUps`). */
  readonly finalLevel: number;
  /** Cumulative XP collected during the run. */
  readonly xpEarned: number;
}

export interface SimTableRow {
  readonly chapter: number;
  readonly seed: number;
  /** The boss this seed meets (`pickBoss`), i.e. the one the run must beat. */
  readonly boss: BossId;
  readonly standStill: SimOutcome;
  /** The dodge + XP-earned skills run, plus the door picks it made before the boss door. */
  readonly loadout: SimOutcome & { readonly doors: DoorReward[] };
}

function outcomeOf(result: ReturnType<typeof simulateRun>): SimOutcome {
  return {
    status: result.status,
    roomsCleared: result.roomsCleared,
    durationMs: result.durationMs,
    hits: result.events.filter((event) => event.kind === 'player-hit').length,
    levelUps: result.levelUps,
    finalLevel: result.finalLevel,
    xpEarned: result.xpEarned,
  };
}

function chapterLevels(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

/**
 * One row per (chapter, seed): the standing-still run and the dodge + XP-earned skills run.
 * Both use the default `maxDurationMs`; doors follow `typicalDoorChoice` and level-up skill picks
 * flow through `typicalSkillChoice` on the dedicated skill-roll sub-seed (ADR-021).
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
        chooseSkill: typicalSkillChoice,
        shouldReroll: typicalRerollPolicy,
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
           * door out of it carries a single (`xp`) offer — filtering those out would drop real
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
 * `| chapter | seed | boss | stand still | dodge + XP skills | level-ups | doors |`
 */
export function formatSimTable(rows: readonly SimTableRow[]): string {
  const lines = [
    '| chapter | seed | boss | stand still | dodge + XP skills | level-ups | doors |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const doors = row.loadout.doors.join(', ') || '—';
    lines.push(
      `| ${row.chapter} | ${row.seed} | ${row.boss} | ${formatOutcome(row.standStill)} | ` +
        `${formatOutcome(row.loadout)}, ${formatHits(row.loadout.hits)} | ` +
        `${row.loadout.levelUps} (Lv ${row.loadout.finalLevel}) | ${doors} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

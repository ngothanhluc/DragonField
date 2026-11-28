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
 * Nothing under `assets/` imports this file: it is the test/CLI seam over `sim/`.
 */
import { join } from 'node:path';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import type { BossId } from '../../assets/scripts/core/boss/boss-defs';
import {
  CHARACTER_IDS,
  DEFAULT_CHARACTER_ID,
  type CharacterId,
} from '../../assets/scripts/core/characters/roster';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData } from '../../assets/scripts/core/level/level-data';
import type { UpgradeState } from '../../assets/scripts/core/meta/upgrades';
import type { DoorReward } from '../../assets/scripts/core/run/doors';
import {
  CLASS_EVOLUTIONS,
  CLASS_SKILLS,
  classEvolutionFor,
  classSkillsFor,
  findClassSkillOrEvolution,
  isClassEvolutionId,
} from '../../assets/scripts/core/skills/class-skills';
import { evolutionHintsForSkill } from '../../assets/scripts/core/skills/evolutions';
import type { SkillDef } from '../../assets/scripts/core/skills/pool';
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  smartActiveSkillPolicy,
  smartDashPolicy,
  type InputPolicy,
  type SimulationStatus,
  type SkillPickPolicy,
  type SkillRerollPolicy,
} from '../../sim/run-simulation';
import { makeDodgePolicy } from './dodge-policy';
import { LEVELS_ROOT, loadTmxLevels } from './tmx-levels';

/** M12 target band for level-ups earned during a full 9-room chapter run (GDD §15.2, ADR-021). */
export const LEVEL_UP_TARGET_MIN = 12;
export const LEVEL_UP_TARGET_MAX = 16;

/** A row count that is both a minimum and the exact size of the matrix it was measured on. */
export interface FloorCount {
  readonly won: number;
  readonly rows: number;
}

/**
 * The #108 balance floor: the measured ×1.5 `bun run sim:table` table (owner decision, board #13).
 *
 * "Win" is a 9/9 clear. The floor only means something on the exact sim:table matrix, which is why
 * every count carries the row total it was measured against. Raising a floor is fine; lowering one
 * needs an owner decision (ADR-013 consequences).
 */
export const BALANCE_FLOOR: {
  readonly total: FloorCount;
  readonly byClass: Readonly<Record<CharacterId, FloorCount>>;
} = {
  total: { won: 55, rows: 72 },
  byClass: {
    ninja: { won: 19, rows: 24 },
    archer: { won: 12, rows: 16 },
    mage: { won: 8, rows: 16 },
    cultivator: { won: 16, rows: 16 },
  },
};

/** Seeds per boss of the `bun run sim:table` matrix: ninja 3, archer 2, mage 2, cultivator 2. */
export const SIM_TABLE_SEEDS_PER_BOSS: Readonly<Record<CharacterId, number>> = {
  ninja: 3,
  archer: 2,
  mage: 2,
  cultivator: 2,
};

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
 * Competent-player skill preference order for 1-of-3 XP level-up picks (M12/M13/M19, ADR-021,
 * ADR-022, ADR-027). Prioritises unlocked Legendary Evolutions first, then core DPS (`twin-shot`,
 * `sharpen`), premier defense (`shield`), fire rate & wave-clear (`rapid-fire`, `piercing`,
 * `ricochet`, `explosive`), then sustain and pure-combat mobility/elemental modifiers across the
 * pruned 21-skill shared pool.
 */
const SKILL_PRIORITY: readonly string[] = [
  'ninja-phantom-assassin',
  'archer-sky-tempest',
  'mage-elemental-cataclysm',
  'phantom-volley',
  'cataclysm',
  'starfall-kunai',
  'aegis-retribution',
  'tempest-barrage',
  'blightfrost',
  'shadowstep',
  'ninja-kunai-burst',
  'ninja-shadow-clone',
  'ninja-venom-shuriken',
  'ninja-smoke-bomb',
  'cultivator-myriad-swords',
  'cultivator-sword-array',
  'cultivator-orbit-swords',
  'cultivator-qi-barrier',
  'cultivator-sword-qi',
  'twin-shot',
  'sharpen',
  'shield',
  'archer-arrow-rain',
  'archer-split-arrow',
  'archer-hunters-mark',
  'archer-wind-arrow',
  'mage-meteor',
  'mage-frost-orbs',
  'mage-storm-strike',
  'mage-arcane-pulse',
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
  'poison',
  'chain-lightning',
  'ignite',
  'phantom-dash',
  'dash-nova',
  'shadow-conduit',
  'arcane-surge',
  'afterimage',
];

/** Ninja class-exclusive skills: one stack each is enough to exercise them and unlock the Evolution. */
const NINJA_SKILLS: ReadonlySet<string> = new Set([
  'ninja-kunai-burst',
  'ninja-shadow-clone',
  'ninja-venom-shuriken',
  'ninja-smoke-bomb',
]);

/** Skills strong enough to accept without spending gold on a level-up reroll. */
const CORE_COMBAT_SKILLS: ReadonlySet<string> = new Set([
  'ninja-phantom-assassin',
  'archer-sky-tempest',
  'mage-elemental-cataclysm',
  'ninja-kunai-burst',
  'ninja-shadow-clone',
  'ninja-venom-shuriken',
  'ninja-smoke-bomb',
  'cultivator-myriad-swords',
  'cultivator-sword-array',
  'cultivator-orbit-swords',
  'cultivator-qi-barrier',
  'cultivator-sword-qi',
  'archer-arrow-rain',
  'archer-split-arrow',
  'archer-hunters-mark',
  'archer-wind-arrow',
  'mage-meteor',
  'mage-frost-orbs',
  'mage-storm-strike',
  'mage-arcane-pulse',
  'phantom-volley',
  'cataclysm',
  'starfall-kunai',
  'aegis-retribution',
  'tempest-barrage',
  'blightfrost',
  'shadowstep',
  'twin-shot',
  'sharpen',
  'shield',
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
 * - While healthy: prioritises Evolutions, core DPS (`twin-shot`, `sharpen` 1–2), then
 *   `shield`, then further `sharpen`/`rapid-fire`/wave-clear, plus a slight synergy bonus when a
 *   card completes an unlocked Evolution pair.
 * - When low on hearts (`hearts <= 60%`): prioritises immediate survival (`vitality`, `shield`,
 *   `lifesteal`) just as a real player reading their HUD HP bar would.
 */
const SHARPEN_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('shield') + 0.5;
const RAPID_FIRE_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('explosive') + 0.5;
const EVOLUTION_PAIR_READY_RANK = SKILL_PRIORITY.indexOf('shield') + 0.25;
/**
 * The sim must *exercise* the Ninja exclusives without them monopolising every level-up: one stack
 * each is enough to fire their mechanics and unlock Ảnh Sát Tuyệt Kỹ, then the shared DPS curve
 * takes the picks again so the 9/9 + 12–16 level-up contract stays intact.
 */
const NINJA_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('shield') + 0.75;

/** Cultivator exclusives: same rule as Ninja — one stack each, then the shared DPS curve. */
const CULTIVATOR_SKILLS: ReadonlySet<string> = new Set([
  'cultivator-orbit-swords',
  'cultivator-sword-array',
  'cultivator-sword-qi',
  'cultivator-qi-barrier',
]);

const CULTIVATOR_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('shield') + 0.75;

/** Archer exclusives: same rule as Ninja — one stack each, then the shared DPS curve. */
const ARCHER_SKILLS: ReadonlySet<string> = new Set([
  'archer-arrow-rain',
  'archer-split-arrow',
  'archer-hunters-mark',
  'archer-wind-arrow',
]);

const ARCHER_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('shield') + 0.75;

/** Mage exclusives: same rule as Ninja — one stack each, then the shared DPS curve. */
const MAGE_SKILLS: ReadonlySet<string> = new Set([
  'mage-meteor',
  'mage-frost-orbs',
  'mage-storm-strike',
  'mage-arcane-pulse',
]);

const MAGE_CAP_AFTER_RANK = SKILL_PRIORITY.indexOf('shield') + 0.75;

/**
 * Archer/Mage kits are taken after the core shared build, unlike Ninja/Cultivator whose
 * exclusives carry enough early damage on their own. A competent player secures `twin-shot`,
 * `sharpen` and `shield` first, then adds the class kit from this level on (M20, #89).
 */
const ARCHER_MAGE_KIT_LEVEL = 8;

function completesEvolutionPair(skill: SkillDef, owned: ReadonlyMap<string, number>): boolean {
  if (skill.rarity === 'legendary') return false;
  return evolutionHintsForSkill(skill.id, owned).some((hint) => hint.ready);
}

export const typicalSkillChoice: SkillPickPolicy = (
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  level: number,
  context,
): number => {
  const sharpenStacks = owned.get('sharpen') ?? 0;
  const rapidFireStacks = owned.get('rapid-fire') ?? 0;
  const lowHearts = context.hearts <= context.maxHearts * 0.6;
  const classKitReady = level >= ARCHER_MAGE_KIT_LEVEL;
  let bestIndex = 0;
  let bestRank = Number.POSITIVE_INFINITY;
  for (let index = 0; index < offers.length; index += 1) {
    const skill = offers[index];
    if (skill === undefined) continue;
    const rank = SKILL_PRIORITY.indexOf(skill.id);
    let effectiveRank = rank === -1 ? SKILL_PRIORITY.length : rank;
    if (!classKitReady && (ARCHER_SKILLS.has(skill.id) || MAGE_SKILLS.has(skill.id))) {
      // Early shared build first: the kit only competes from `ARCHER_MAGE_KIT_LEVEL` on.
      effectiveRank = SKILL_PRIORITY.length + 1;
    }
    if (skill.id === 'sharpen' && sharpenStacks >= 2) {
      // Ranks behind `shield` once base damage is already stacked 2+.
      effectiveRank = SHARPEN_CAP_AFTER_RANK;
    }
    if (skill.id === 'rapid-fire' && rapidFireStacks >= 2) {
      effectiveRank = RAPID_FIRE_CAP_AFTER_RANK;
    }
    if (NINJA_SKILLS.has(skill.id) && (owned.get(skill.id) ?? 0) >= 1) {
      effectiveRank = Math.max(effectiveRank, NINJA_CAP_AFTER_RANK);
    }
    if (CULTIVATOR_SKILLS.has(skill.id) && (owned.get(skill.id) ?? 0) >= 1) {
      effectiveRank = Math.max(effectiveRank, CULTIVATOR_CAP_AFTER_RANK);
    }
    if (ARCHER_SKILLS.has(skill.id) && (owned.get(skill.id) ?? 0) >= 1) {
      effectiveRank = Math.max(effectiveRank, ARCHER_CAP_AFTER_RANK);
    }
    if (MAGE_SKILLS.has(skill.id) && (owned.get(skill.id) ?? 0) >= 1) {
      effectiveRank = Math.max(effectiveRank, MAGE_CAP_AFTER_RANK);
    }
    if (!lowHearts && completesEvolutionPair(skill, owned)) {
      effectiveRank = Math.min(effectiveRank, EVOLUTION_PAIR_READY_RANK);
    }
    if (lowHearts) {
      if (skill.id === 'vitality') effectiveRank = -2;
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
 * Competent-player gold reroll policy: spend run gold (up to 40g/reroll) when a level-up hand
 * offers zero non-saturated core combat/survival cards (`CORE_COMBAT_SKILLS`) or Evolution pair
 * completers.
 */
export const typicalRerollPolicy: SkillRerollPolicy = (
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  _availableGold: number,
  nextCost: number,
): boolean => {
  if (nextCost > TYPICAL_REROLL_MAX_COST) return false;
  return !offers.some((skill) => {
    if (completesEvolutionPair(skill, owned)) return true;
    if (!CORE_COMBAT_SKILLS.has(skill.id)) return false;
    if ((skill.id === 'sharpen' || skill.id === 'rapid-fire') && (owned.get(skill.id) ?? 0) >= 2) {
      return false;
    }
    return true;
  });
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
  /** Total Dash activations used across the run (M13, ADR-022). */
  readonly dashesUsed: number;
  /** Total Signature Active (*Shadow Barrage*) casts used across the run (M13, ADR-022). */
  readonly activeSkillsUsed: number;
  /** Legendary Evolution ids unlocked and acquired during the run (M13, ADR-022; M20 class Evolutions). */
  readonly evolutions: readonly string[];
  /**
   * Every owned class-exclusive skill **or** Class Evolution id at run end (M20, ADR-027), in
   * `CLASS_SKILLS` then `CLASS_EVOLUTIONS` order. Empty for the standing player. Listing ids of
   * any class keeps a cross-class leak visible in the table.
   */
  readonly classSkills: readonly string[];
}

export interface SimTableRow {
  /** Playable character class simulated for this row (M14). */
  readonly characterId: CharacterId;
  readonly chapter: number;
  readonly seed: number;
  /** The boss this seed meets (`pickBoss`), i.e. the one the run must beat. */
  readonly boss: BossId;
  readonly standStill: SimOutcome;
  /** The dodge + M14 class kit + XP-earned skills run, plus the door picks it made before the boss door. */
  readonly loadout: SimOutcome & { readonly doors: DoorReward[] };
}

/** Stable id order for the `classSkills` column: all 16 exclusives, then the 4 Evolutions. */
const CLASS_SKILL_ORDER: ReadonlyMap<string, number> = new Map(
  [...CLASS_SKILLS.map((skill) => skill.id), ...CLASS_EVOLUTIONS.map((evolution) => evolution.id)].map(
    (id, index) => [id, index] as const,
  ),
);

/**
 * Owned class-exclusive skills + Class Evolutions at run end, in `CLASS_SKILL_ORDER`. Iterating
 * `acquiredSkills` (not the row's class) is deliberate: another class's id can only appear if the
 * roll leaked, and the table must show that.
 */
function classSkillsOf(result: ReturnType<typeof simulateRun>): readonly string[] {
  const owned: string[] = [];
  for (const [id, stacks] of result.acquiredSkills) {
    if (stacks > 0 && findClassSkillOrEvolution(id) !== undefined) owned.push(id);
  }
  return owned.sort((left, right) => (CLASS_SKILL_ORDER.get(left) ?? 0) - (CLASS_SKILL_ORDER.get(right) ?? 0));
}

function outcomeOf(result: ReturnType<typeof simulateRun>): SimOutcome {
  const classSkills = classSkillsOf(result);
  return {
    status: result.status,
    roomsCleared: result.roomsCleared,
    durationMs: result.durationMs,
    hits: result.events.filter((event) => event.kind === 'player-hit').length,
    levelUps: result.levelUps,
    finalLevel: result.finalLevel,
    xpEarned: result.xpEarned,
    dashesUsed: result.dashesUsed,
    activeSkillsUsed: result.activeSkillsUsed,
    // `simulateRun` reports shared Evolutions only; the owning helper adds Class Evolutions.
    evolutions: [
      ...result.evolutions,
      ...classSkills.filter((id) => isClassEvolutionId(id)),
    ],
    classSkills,
  };
}

/** Both halves of a row's own class pool: its exclusive skills and its Class Evolution. */
function ownClassIds(characterId: CharacterId): ReadonlySet<string> {
  return new Set([
    ...classSkillsFor(characterId).map((skill) => skill.id),
    classEvolutionFor(characterId).id,
  ]);
}

/** A 9/9 clear: the only kind of row the #108 floor is about. */
function isWin(row: SimTableRow): boolean {
  return row.loadout.status === 'won' && row.loadout.roomsCleared === 9;
}

/**
 * Every reason the `sim:table` exit gate fails; `[]` = the gate passes. Pure: reads the table only.
 *
 * The win-dependent rules (#108) are floors on the measured ×1.5 matrix, because the Signature
 * nerf costs rows and the owner replaced "every row wins 9/9" with that floor. Every rule that does
 * not depend on winning stays as strict as it was before #108.
 */
export function simTableGateFailures(rows: readonly SimTableRow[]): string[] {
  const failures: string[] = [];

  if (rows.length !== BALANCE_FLOOR.total.rows) {
    failures.push(`matrix: ${rows.length} rows, expected ${BALANCE_FLOOR.total.rows}`);
  }

  const wins = rows.filter(isWin);
  if (wins.length < BALANCE_FLOOR.total.won) {
    failures.push(
      `total: ${wins.length}/${BALANCE_FLOOR.total.rows} rows won 9/9, floor ${BALANCE_FLOOR.total.won}`,
    );
  }

  // Winners only: a lost run ends early, so its level-ups and doors say nothing about balance.
  for (const row of wins) {
    if (
      row.loadout.levelUps < LEVEL_UP_TARGET_MIN ||
      row.loadout.levelUps > LEVEL_UP_TARGET_MAX
    ) {
      failures.push(
        `${row.characterId} chapter ${row.chapter} seed ${row.seed}: ${row.loadout.levelUps} level-ups, ` +
          `expected ${LEVEL_UP_TARGET_MIN}–${LEVEL_UP_TARGET_MAX}`,
      );
    }
  }

  for (const characterId of CHARACTER_IDS) {
    const floor = BALANCE_FLOOR.byClass[characterId];
    const classRows = rows.filter((row) => row.characterId === characterId);
    if (classRows.length !== floor.rows) {
      failures.push(`${characterId}: ${classRows.length} rows, expected ${floor.rows}`);
    }

    const classWins = classRows.filter(isWin).length;
    if (classWins < floor.won) {
      failures.push(`${characterId}: ${classWins}/${floor.rows} rows won 9/9, floor ${floor.won}`);
    }

    const ownSkillIds = classSkillsFor(characterId).map((skill) => skill.id);
    const classSkillRows = classRows.filter((row) =>
      row.loadout.classSkills.some((id) => ownSkillIds.includes(id)),
    ).length;
    if (classSkillRows < floor.won) {
      failures.push(
        `${characterId}: ${classSkillRows}/${floor.rows} rows own a class skill, floor ${floor.won}`,
      );
    }

    const classDashRows = classRows.filter((row) => row.loadout.dashesUsed > 0).length;
    if (classDashRows < classRows.length - 1) {
      failures.push(
        `${characterId}: only ${classDashRows}/${classRows.length} rows dashed, expected all but at most one`,
      );
    }

    if (!classRows.some((row) => row.loadout.evolutions.length > 0)) {
      failures.push(`${characterId}: no row unlocked an Evolution`);
    }

    const evolutionId = classEvolutionFor(characterId).id;
    if (!classRows.some((row) => row.loadout.classSkills.includes(evolutionId))) {
      failures.push(`${characterId}: no row owns its Class Evolution ${evolutionId}`);
    }
  }

  // Rules that do not depend on winning: still checked over every row.
  const standStillLost = rows.filter(
    (row) => row.standStill.status === 'lost' && row.standStill.roomsCleared === 0,
  ).length;
  if (standStillLost !== rows.length) {
    failures.push(
      `stand still lost room 1 in ${standStillLost}/${rows.length} rows, expected every row`,
    );
  }

  const lateRows = rows.filter((row) => row.chapter >= 2);
  const lateRowsWithDash = lateRows.filter((row) => row.loadout.dashesUsed > 0).length;
  if (lateRowsWithDash !== lateRows.length) {
    failures.push(
      `Ch2+ rows dashed in ${lateRowsWithDash}/${lateRows.length}, expected every row`,
    );
  }

  const rowsWithActive = rows.filter((row) => row.loadout.activeSkillsUsed > 0).length;
  if (rowsWithActive !== rows.length) {
    failures.push(
      `${rowsWithActive}/${rows.length} rows cast a Signature, expected every row`,
    );
  }

  if (!rows.some((row) => row.loadout.evolutions.length > 0)) {
    failures.push('no row unlocked an Evolution');
  }

  for (const row of rows) {
    const ownIds = ownClassIds(row.characterId);
    for (const id of row.loadout.classSkills) {
      if (findClassSkillOrEvolution(id) !== undefined && !ownIds.has(id)) {
        failures.push(
          `${row.characterId} chapter ${row.chapter} seed ${row.seed}: owns another class's ${id}`,
        );
      }
    }
  }

  return failures;
}

function chapterLevels(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

/**
 * M18 chapter-progression Meta upgrades (ADR-026):
 * - Ch1: 0-Meta (proves skilled dodging + in-run kit clears Ch1 with zero Meta upgrades).
 * - Ch2–Ch4: realistic earned Meta progression bought with prior chapter gold
 *   (Ch2: Lv 2/1/1, Ch3: Lv 3/2/2, Ch4: Lv 5/4/4 full build).
 */
function metaForChapter(chapter: number): UpgradeState | undefined {
  const zeroUtility = { xpMagnet: 0, goldBonus: 0, freeRerolls: 0 };
  if (chapter <= 1) return undefined;
  if (chapter === 2) return { upgrades: { hearts: 4, damage: 2, fireRate: 2, ...zeroUtility } };
  if (chapter === 3) return { upgrades: { hearts: 4, damage: 3, fireRate: 3, ...zeroUtility } };
  return { upgrades: { hearts: 5, damage: 4, fireRate: 4, ...zeroUtility } };
}

/**
 * One row per (character, chapter, seed): the standing-still run (no Dash/Active/skills/Meta) and
 * the dodge + M14 kit (class Layer 1/2 stats + chapter Meta + Dash + Signature Active + XP-earned
 * skills & Evolutions) run.
 */
export function simTableRows(options: {
  readonly chapters: readonly number[];
  readonly seedsPerBoss: number;
  readonly characters?: readonly CharacterId[];
}): SimTableRow[] {
  const characters = options.characters ?? [DEFAULT_CHARACTER_ID];
  const levelsByChapter = new Map<number, ChapterData>();
  for (const chapter of options.chapters) {
    levelsByChapter.set(chapter, chapterLevels(chapter));
  }

  const rows: SimTableRow[] = [];

  for (const characterId of characters) {
    for (const chapter of options.chapters) {
      const level = levelsByChapter.get(chapter);
      if (level === undefined) continue;
      const meta = metaForChapter(chapter);

      for (const seed of balanceSeeds(chapter, options.seedsPerBoss)) {
        const standStillRun = simulateRun({
          seed,
          characterId,
          level,
          policy: standStill,
          maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
        });
        const loadoutRun = simulateRun({
          seed,
          characterId,
          level,
          policy: makeDodgePolicy(),
          chooseDash: smartDashPolicy,
          chooseActive: smartActiveSkillPolicy,
          chooseSkill: typicalSkillChoice,
          shouldReroll: typicalRerollPolicy,
          chooseDoor: typicalDoorChoice,
          maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
          ...(meta !== undefined ? { meta } : {}),
        });

        rows.push({
          characterId,
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
  }

  return rows;
}

/** `12 s`, `3m07s` — compact enough to keep one sim row on one table line. */
export function formatDuration(durationMs: number): string {
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
 * `| class | chapter | seed | boss | stand still | dodge + M14 kit | level-ups | dashes | actives | evolutions | class skills | doors |`
 */
export function formatSimTable(rows: readonly SimTableRow[]): string {
  const lines = [
    '| class | chapter | seed | boss | stand still | dodge + M14 kit | level-ups | dashes | actives | evolutions | class skills | doors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const doors = row.loadout.doors.join(', ') || '—';
    const evolutions = row.loadout.evolutions.join(', ') || '—';
    const classSkills = row.loadout.classSkills.join(', ') || '—';
    lines.push(
      `| ${row.characterId} | ${row.chapter} | ${row.seed} | ${row.boss} | ${formatOutcome(row.standStill)} | ` +
        `${formatOutcome(row.loadout)}, ${formatHits(row.loadout.hits)} | ` +
        `${row.loadout.levelUps} (Lv ${row.loadout.finalLevel}) | ` +
        `${row.loadout.dashesUsed} | ${row.loadout.activeSkillsUsed} | ${evolutions} | ${classSkills} | ${doors} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

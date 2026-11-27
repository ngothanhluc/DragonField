/**
 * Cultivator class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * #83 shipped the data only; #87 implements the four mechanics as pure, stateless hooks. Every
 * number comes from `config/tuning.json` (`TUNING.classSkills.cultivator`), never from this file.
 *
 * Hooks return `ClassSkillEffect[]` requests and hold no state: orbiting swords, arrays, waves and
 * the Qi gauge/shield live in `core/skills/cultivator-runtime.ts`, which both the headless sim and
 * the Cocos combat loop drive.
 *
 * Per-stack scaling follows the GDD: stack 1 is exactly the GDD number, and every extra stack is no
 * weaker in any field and strictly stronger in at least one (the acceptance test pins this).
 */
import { CLASS_SKILLS_TUNING } from '../../enemies/tuning';
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillHook,
  ClassSkillHooks,
  ClassSkillStackSource,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

const T = CLASS_SKILLS_TUNING.cultivator;

export const CULTIVATOR_ORBIT_ID = 'cultivator-orbit-swords';
export const CULTIVATOR_ARRAY_ID = 'cultivator-sword-array';
export const CULTIVATOR_QI_ID = 'cultivator-sword-qi';
export const CULTIVATOR_BARRIER_ID = 'cultivator-qi-barrier';
export const CULTIVATOR_EVOLUTION_ID = 'cultivator-myriad-swords';

export const CULTIVATOR_SKILLS: readonly SkillDef[] = [
  {
    id: CULTIVATOR_ORBIT_ID,
    short: 'OS',
    name: 'Orbit Swords',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: CULTIVATOR_ARRAY_ID,
    short: 'SR',
    name: 'Sword Array',
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: CULTIVATOR_QI_ID,
    short: 'SQ',
    name: 'Sword Qi',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: CULTIVATOR_BARRIER_ID,
    short: 'QB',
    name: 'Qi Barrier',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
];

export const CULTIVATOR_EVOLUTION: ClassEvolutionDef = {
  id: CULTIVATOR_EVOLUTION_ID,
  short: 'MS',
  name: 'Myriad Swords',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'cultivator',
  requires: [CULTIVATOR_ORBIT_ID, CULTIVATOR_ARRAY_ID],
  minStacksEach: 1,
  tags: [],
};

/** Max stacks per Cultivator skill, read from the data above (never duplicated as a magic number). */
const MAX_STACKS: ReadonlyMap<string, number> = new Map(
  CULTIVATOR_SKILLS.map((skill) => [skill.id, skill.maxStacks]),
);

/** Owned stacks clamped to the skill's max (0 when not owned). */
export function cultivatorStacksOf(owned: ClassSkillStackSource, id: string): number {
  const raw = owned(id);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const max = MAX_STACKS.get(id) ?? 1;
  return Math.min(Math.floor(raw), max);
}

/** Value for `stack` (1-based), clamped to the table length. */
function atStack(table: readonly number[], stack: number): number {
  const index = Math.max(0, Math.min(table.length - 1, stack - 1));
  return table[index] ?? 0;
}

/** True when *Vạn Kiếm Quy Tông* is owned together with both of its prerequisites. */
export function hasMyriadSwords(owned: ClassSkillStackSource): boolean {
  return (
    owned(CULTIVATOR_EVOLUTION_ID) > 0 &&
    owned(CULTIVATOR_ORBIT_ID) > 0 &&
    owned(CULTIVATOR_ARRAY_ID) > 0
  );
}

/**
 * Stateless periodic crossing: true on the tick where `nowMs` crosses a multiple of `periodMs`.
 * With `nowMs`/`dtMs` missing (older call sites) nothing periodic fires.
 */
export function crossesPeriod(
  nowMs: number | undefined,
  dtMs: number | undefined,
  periodMs: number,
): boolean {
  if (nowMs === undefined || dtMs === undefined) return false;
  if (!(periodMs > 0) || !Number.isFinite(nowMs) || !Number.isFinite(dtMs)) return false;
  return Math.floor(nowMs / periodMs) > Math.floor((nowMs - dtMs) / periodMs);
}

/** One Sword Array request with the stack-scaled GDD values. */
function arrayEffect(
  owned: ClassSkillStackSource,
  position: NonNullable<ClassSkillEventContext['position']>,
): ClassSkillEffect {
  const stacks = cultivatorStacksOf(owned, CULTIVATOR_ARRAY_ID);
  return {
    kind: 'spawn',
    skillId: CULTIVATOR_ARRAY_ID,
    position,
    amount: atStack(T.swordArray.damageRatioByStack, stacks),
    radiusTiles: atStack(T.swordArray.radiusTilesByStack, stacks),
    durationMs: atStack(T.swordArray.durationMsByStack, stacks),
  };
}

/** *Ngự Kiếm Hộ Thể* + *Vạn Kiếm Quy Tông*: one dart per sword, one mini wave per sword. */
const tick: ClassSkillHook = (context) => {
  const position = context.position;
  const nowMs = context.nowMs;
  const dtMs = context.dtMs;
  if (position === undefined) return NO_CLASS_SKILL_EFFECTS;

  const effects: ClassSkillEffect[] = [];
  const evolved = hasMyriadSwords(context.owned);
  const orbitStacks = cultivatorStacksOf(context.owned, CULTIVATOR_ORBIT_ID);

  if (orbitStacks > 0 && crossesPeriod(nowMs, dtMs, T.orbitSwords.slashIntervalMs)) {
    const swords = atStack(T.orbitSwords.swordsByStack, orbitStacks);
    const amount = atStack(T.orbitSwords.damageRatioByStack, orbitStacks);
    const radiusTiles = atStack(T.orbitSwords.reachTilesByStack, orbitStacks);
    for (let index = 0; index < swords; index += 1) {
      effects.push({
        kind: 'spawn',
        skillId: CULTIVATOR_ORBIT_ID,
        position,
        amount,
        radiusTiles,
      });
      if (evolved) {
        effects.push({
          kind: 'spawn',
          skillId: CULTIVATOR_EVOLUTION_ID,
          position,
          amount: T.myriadSwords.miniWaveDamageRatio,
          radiusTiles: T.myriadSwords.miniWaveRadiusTiles,
          durationMs: T.myriadSwords.miniWaveDurationMs,
        });
      }
    }
  }

  // *Vạn Kiếm Quy Tông* also plants its own Sword Array on a slower cadence.
  if (
    evolved &&
    cultivatorStacksOf(context.owned, CULTIVATOR_ARRAY_ID) > 0 &&
    crossesPeriod(nowMs, dtMs, T.myriadSwords.arrayIntervalMs)
  ) {
    effects.push(arrayEffect(context.owned, position));
  }

  return effects.length > 0 ? effects : NO_CLASS_SKILL_EFFECTS;
};

/** *Kiếm Trận*: casting the Signature Active plants an array under the player. */
const onActive: ClassSkillHook = (context) => {
  if (context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  if (cultivatorStacksOf(context.owned, CULTIVATOR_ARRAY_ID) <= 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }
  return [arrayEffect(context.owned, context.position)];
};

/** *Kiếm Trận* also plants an array where an Elite dies. */
const onKill: ClassSkillHook = (context) => {
  if (context.elite !== true || context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  if (cultivatorStacksOf(context.owned, CULTIVATOR_ARRAY_ID) <= 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }
  return [arrayEffect(context.owned, context.position)];
};

/** *Kiếm Khí Bán Nguyệt*: every Nth auto-fire shot unleashes one crescent wave. */
const onShot: ClassSkillHook = (context) => {
  const stacks = cultivatorStacksOf(context.owned, CULTIVATOR_QI_ID);
  if (stacks <= 0 || context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  const shotCount = context.shotCount;
  if (shotCount === undefined || shotCount % T.swordQi.everyNShots !== 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }
  return [
    {
      kind: 'spawn',
      skillId: CULTIVATOR_QI_ID,
      position: context.position,
      amount: atStack(T.swordQi.damageRatioByStack, stacks),
      radiusTiles: atStack(T.swordQi.halfWidthTilesByStack, stacks),
      durationMs: atStack(T.swordQi.durationMsByStack, stacks),
    },
  ];
};

/** *Hộ Tâm Linh Khí*: every damaging player-weapon hit charges the Qi gauge. */
const onHit: ClassSkillHook = (context) => {
  const stacks = cultivatorStacksOf(context.owned, CULTIVATOR_BARRIER_ID);
  if (stacks <= 0 || context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  return [
    {
      kind: 'buff',
      skillId: CULTIVATOR_BARRIER_ID,
      position: context.position,
      amount: atStack(T.qiBarrier.chargeByStack, stacks),
    },
  ];
};

const onDash: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** Cultivator mechanics (M20, #87). All six hooks, pure and stateless (context → effects). */
export const CULTIVATOR_HOOKS: ClassSkillHooks = {
  onShot,
  onHit,
  onKill,
  onDash,
  onActive,
  tick,
};

/** Jade crest. */
export const CULTIVATOR_CREST: ClassCrest = { color: '#52D9B4', glyph: 'C' };

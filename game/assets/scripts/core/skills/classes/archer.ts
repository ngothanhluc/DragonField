/**
 * Archer class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * Data + pure mechanics (#85). The hooks only *request* effects; the combat loop and the
 * balance sim apply them. Every number comes from `tuning.json` via `CLASS_SKILLS_TUNING`.
 */
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillHook,
  ClassSkillHooks,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { Vec2 } from '../../math/vec2';
import { CLASS_SKILLS_TUNING } from '../../enemies/tuning';
import type { SkillDef } from '../pool';

export const ARCHER_SKILLS: readonly SkillDef[] = [
  {
    id: 'archer-arrow-rain',
    short: 'RN',
    name: 'Arrow Rain',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-split-arrow',
    short: 'SA',
    name: 'Split Arrow',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-hunters-mark',
    short: 'HM',
    name: "Hunter's Mark",
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-wind-arrow',
    short: 'WA',
    name: 'Wind Arrow',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
];

export const ARCHER_EVOLUTION: ClassEvolutionDef = {
  id: 'archer-sky-tempest',
  short: 'ST',
  name: 'Sky Tempest',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'archer',
  requires: ['archer-arrow-rain', 'archer-split-arrow'],
  minStacksEach: 1,
  tags: [],
};

const RAIN = 'archer-arrow-rain';
const SPLIT = 'archer-split-arrow';
const MARK = 'archer-hunters-mark';
const WIND = 'archer-wind-arrow';
const TEMPEST = 'archer-sky-tempest';

/** Manifest key for the Arrow Rain impact FX (see `animation-manifest`). */
const ARROW_RAIN_FX = 'fx.arrow-rain';

/** Memory key for a marked enemy's armed-at timestamp, namespaced per hook. */
const MARK_KEY = `${MARK}:`;
const WIND_LAST_HIT_KEY = `${WIND}:lastHit`;
const WIND_MOMENTUM_KEY = `${WIND}:momentum`;

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Owned stacks clamped to the skill's declared maximum (0 = not owned). */
function stacksOf(context: ClassSkillEventContext, id: string, maxStacks: number): number {
  const raw = context.owned(id);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(maxStacks, Math.floor(raw));
}

/** Per-stack ratio for `stacks` (already clamped): extra stacks past the table reuse the last. */
function ratioFor(ratios: readonly number[], stacks: number): number {
  const index = Math.min(Math.max(1, stacks), ratios.length) - 1;
  return ratios[index] ?? 0;
}

/** Rotate a unit vector by `degrees` (positive = clockwise in y-down room space). */
function rotate(direction: Vec2, degrees: number): Vec2 {
  const radians = degrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  };
}

/** Mưa Tên: every 5th shot drops a volley on the auto-fire target; Sky Tempest adds a volley. */
const onShot: ClassSkillHook = (context) => {
  const rainStacks = stacksOf(context, RAIN, 3);
  if (rainStacks === 0) return NO_CLASS_SKILL_EFFECTS;

  const target = context.targetPosition;
  const damage = context.damage;
  const shotCount = context.shotCount ?? 0;
  if (target === undefined || damage === undefined || shotCount <= 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const tuning = CLASS_SKILLS_TUNING.archer;
  if (shotCount % tuning.arrowRain.everyShots !== 0) return NO_CLASS_SKILL_EFFECTS;

  const effects: ClassSkillEffect[] = [
    {
      kind: 'damage',
      skillId: RAIN,
      position: target,
      amount: damage * ratioFor(tuning.arrowRain.damageRatioByStack, rainStacks),
      radiusTiles: tuning.arrowRain.radiusTiles,
      fx: ARROW_RAIN_FX,
    },
  ];

  // Thiên Tiễn Lôi Đình: the Evolution needs both prerequisites and rides the same rain beat.
  if (stacksOf(context, TEMPEST, 1) > 0 && context.owned(SPLIT) > 0) {
    const tempest = tuning.skyTempest;
    const step = (Math.PI * 2) / tempest.arrows;
    for (let index = 0; index < tempest.arrows; index += 1) {
      const angle = index * step;
      effects.push({
        kind: 'spawn',
        skillId: TEMPEST,
        position: target,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        pierce: tempest.pierce,
        amount: damage * tempest.damageRatio,
      });
    }
  }

  return effects;
};

/**
 * Tên Tách Chùm: the first enemy a shot hits splits into two arrows at ±18°.
 * Split arrows carry `projectileSkillId`, so they never split again.
 */
function splitArrow(context: ClassSkillEventContext): readonly ClassSkillEffect[] {
  const stacks = stacksOf(context, SPLIT, 3);
  if (stacks === 0) return NO_CLASS_SKILL_EFFECTS;
  if (context.firstHit !== true || context.projectileSkillId !== undefined) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const direction = context.direction;
  const damage = context.damage;
  const position = context.position ?? context.targetPosition;
  if (direction === undefined || damage === undefined || position === undefined) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const tuning = CLASS_SKILLS_TUNING.archer.splitArrow;
  const amount = damage * ratioFor(tuning.damageRatioByStack, stacks);
  const effects: ClassSkillEffect[] = [];
  for (let index = 0; index < tuning.arrows; index += 1) {
    const sign = index % 2 === 0 ? 1 : -1;
    const effect: ClassSkillEffect = {
      kind: 'spawn',
      skillId: SPLIT,
      position,
      direction: rotate(direction, sign * tuning.angleDegrees),
      amount,
      ...(context.targetId !== undefined ? { ignoreTargetId: context.targetId } : {}),
    };
    effects.push(effect);
  }
  return effects;
}

/**
 * Ấn Ký Săn Mồi: a hit marks the target for 4 s; a crit on a marked target detonates the mark
 * for AoE damage and consumes it. A crit on an unmarked target only marks it.
 */
function huntersMark(context: ClassSkillEventContext): readonly ClassSkillEffect[] {
  const stacks = stacksOf(context, MARK, 2);
  const memory = context.memory;
  const targetId = context.targetId;
  const nowMs = context.nowMs;
  const damage = context.damage;
  if (
    stacks === 0 ||
    memory === undefined ||
    targetId === undefined ||
    nowMs === undefined ||
    damage === undefined
  ) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const tuning = CLASS_SKILLS_TUNING.archer.huntersMark;
  const key = `${MARK_KEY}${targetId}`;
  const armedAt = memory.get(key);
  const armed = armedAt !== undefined && nowMs - armedAt <= tuning.durationMs;

  if (context.crit === true && armed) {
    memory.delete(key);
    const position = context.targetPosition ?? context.position;
    if (position === undefined) return NO_CLASS_SKILL_EFFECTS;
    return [
      {
        kind: 'damage',
        skillId: MARK,
        position,
        amount: damage * ratioFor(tuning.damageRatioByStack, stacks),
        radiusTiles: tuning.radiusTiles,
      },
    ];
  }

  if (!armed) {
    memory.set(key, nowMs);
    const position = context.targetPosition ?? context.position;
    if (position === undefined) return NO_CLASS_SKILL_EFFECTS;
    return [
      {
        kind: 'status',
        skillId: MARK,
        position,
        targetId,
        durationMs: tuning.durationMs,
      },
    ];
  }

  return NO_CLASS_SKILL_EFFECTS;
}

/**
 * Phong Tiễn: each hit adds Wind momentum (cap 10). More than 1500 ms between hits resets it
 * to 1. The buff lasts 1500 ms and scales with momentum × stacks.
 */
function windArrow(context: ClassSkillEventContext): readonly ClassSkillEffect[] {
  const stacks = stacksOf(context, WIND, 3);
  const memory = context.memory;
  const nowMs = context.nowMs;
  if (stacks === 0 || memory === undefined || nowMs === undefined) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const tuning = CLASS_SKILLS_TUNING.archer.windArrow;
  const lastHit = memory.get(WIND_LAST_HIT_KEY);
  const previous =
    lastHit !== undefined && nowMs - lastHit <= tuning.resetMs
      ? (memory.get(WIND_MOMENTUM_KEY) ?? 0)
      : 0;
  const momentum = Math.min(tuning.momentumCap, previous + 1);
  memory.set(WIND_LAST_HIT_KEY, nowMs);
  memory.set(WIND_MOMENTUM_KEY, momentum);

  return [
    {
      kind: 'buff',
      skillId: WIND,
      position: context.position ?? context.targetPosition ?? { x: 0, y: 0 },
      durationMs: tuning.buffDurationMs,
      fireRateMult: 1 + tuning.fireRatePerMomentum * momentum * stacks,
      projectileSpeedMult: 1 + tuning.projectileSpeedPerMomentum * momentum * stacks,
    },
  ];
}

const onHit: ClassSkillHook = (context) => {
  const split = splitArrow(context);
  const mark = huntersMark(context);
  const wind = windArrow(context);
  if (split.length === 0 && mark.length === 0 && wind.length === 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }
  return [...split, ...mark, ...wind];
};

/** A dead enemy can never be detonated again: drop its mark so `memory` cannot grow. */
const onKill: ClassSkillHook = (context) => {
  if (context.memory !== undefined && context.targetId !== undefined) {
    context.memory.delete(`${MARK_KEY}${context.targetId}`);
  }
  return NO_CLASS_SKILL_EFFECTS;
};

/** Archer mechanics defend on `onShot`/`onHit` only; the other events stay no-ops. */
const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

export const ARCHER_HOOKS: ClassSkillHooks = {
  onShot,
  onHit,
  onKill,
  onDash: noop,
  onActive: noop,
  tick: noop,
};

/** Forest-green arrow crest. */
export const ARCHER_CREST: ClassCrest = { color: '#4FBF7A', glyph: 'A' };

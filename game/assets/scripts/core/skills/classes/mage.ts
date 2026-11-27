/**
 * Mage class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * #83 registered the data; #86 implements the mechanics here:
 * - *Thiên Thạch* (`mage-meteor`): a meteor on the densest enemy cluster, on a game-time interval.
 * - *Vệ Tinh Băng* (`mage-frost-orbs`): orbiting contact spheres that damage and heavily slow.
 * - *Lôi Ngục* (`mage-storm-strike`): an on-hit proc that drops a bolt on the nearest other foe.
 * - *Xung Năng Ma Pháp* (`mage-arcane-pulse`): an on-hit ring every 4th auto-fire shot.
 * - *Thiên Tai Nguyên Tố* (`mage-elemental-cataclysm`): faster orbs, ice shards, shatter-burn.
 *
 * Hooks are pure functions of their context: no module-level mutable state, all randomness through
 * `context.rng`, every number from `config/tuning.json` (`CLASS_SKILLS_TUNING.mage`).
 */
import type { SfxId } from '../../audio/sfx-bank';
import { CLASS_SKILLS_TUNING } from '../../enemies/tuning';
import { distance, type Vec2 } from '../../math/vec2';
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillHook,
  ClassSkillHooks,
  ClassSkillStackSource,
  ClassSkillTarget,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

export const MAGE_SKILLS: readonly SkillDef[] = [
  {
    id: 'mage-meteor',
    short: 'MT',
    name: 'Meteor',
    rarity: 'epic',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-frost-orbs',
    short: 'FO',
    name: 'Frost Orbs',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-storm-strike',
    short: 'TH',
    name: 'Storm Strike',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-arcane-pulse',
    short: 'AP',
    name: 'Arcane Pulse',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
];

export const MAGE_EVOLUTION: ClassEvolutionDef = {
  id: 'mage-elemental-cataclysm',
  short: 'EC',
  name: 'Elemental Cataclysm',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'mage',
  requires: ['mage-meteor', 'mage-frost-orbs'],
  minStacksEach: 1,
  tags: [],
};

const METEOR_ID = 'mage-meteor';
const ORBS_ID = 'mage-frost-orbs';
const STORM_ID = 'mage-storm-strike';
const PULSE_ID = 'mage-arcane-pulse';
const EVO_ID = 'mage-elemental-cataclysm';

/** Every Mage base skill caps at 3 stacks (see `MAGE_SKILLS`). */
const MAGE_MAX_STACKS = 3;

const M = CLASS_SKILLS_TUNING.mage;

/** Clamped integer stacks of one skill (0 when not owned / malformed). */
function stacksOf(owned: ClassSkillStackSource, id: string): number {
  const raw = owned(id);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(MAGE_MAX_STACKS, Math.floor(raw));
}

/** True when `nowMs` crosses a multiple of `intervalMs` during the last `dtMs` of game time. */
function crossedInterval(nowMs: number, dtMs: number, intervalMs: number): boolean {
  if (!(intervalMs > 0) || !(dtMs > 0)) return false;
  return Math.floor(nowMs / intervalMs) > Math.floor((nowMs - dtMs) / intervalMs);
}

/** True when `point` is inside any of `orbs` by `radiusTiles`. */
function touchesAnyOrb(point: Vec2, orbs: readonly Vec2[], radiusTiles: number): boolean {
  for (const orb of orbs) {
    if (distance(point, orb) <= radiusTiles) return true;
  }
  return false;
}

/**
 * Orbit of the Frost Orbs, shared by the tick damage and the view that draws them.
 *
 * `2 (+1/stack)` orbs on one equal radius, evenly spaced, rotating with game time; the Evolution
 * spins them faster. Returns `[]` at 0 stacks.
 */
export function frostOrbPositions(
  stacks: number,
  evolved: boolean,
  nowMs: number,
  center: Vec2,
): readonly Vec2[] {
  const safeStacks = Number.isFinite(stacks) ? Math.max(0, Math.floor(stacks)) : 0;
  if (safeStacks <= 0) return [];

  const count = M.frostOrbs.baseCount + (safeStacks - 1) * M.frostOrbs.countPerStack;
  if (count <= 0) return [];

  const speed =
    M.frostOrbs.orbitRadiansPerSecond * (evolved ? M.frostOrbs.evolvedOrbitMultiplier : 1);
  const baseAngle = ((Number.isFinite(nowMs) ? nowMs : 0) / 1000) * speed;
  const positions: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = baseAngle + (index * Math.PI * 2) / count;
    positions.push({
      x: center.x + Math.cos(angle) * M.frostOrbs.radiusTiles,
      y: center.y + Math.sin(angle) * M.frostOrbs.radiusTiles,
    });
  }
  return positions;
}

/** Enemy with the most neighbours inside `radiusTiles` (ties keep the first in room order). */
function densestCluster(enemies: readonly ClassSkillTarget[], radiusTiles: number): ClassSkillTarget {
  let best = enemies[0]!;
  let bestCount = -1;
  for (const candidate of enemies) {
    let count = 0;
    for (const other of enemies) {
      if (other === candidate) continue;
      if (distance(candidate.position, other.position) <= radiusTiles) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Periodic tick: Meteor drops, Frost Orb contact, and the Evolution's ice shards. */
const tick: ClassSkillHook = (context) => {
  const effects: ClassSkillEffect[] = [];
  collectMeteors(context, effects);
  collectOrbContact(context, effects);
  collectIceShards(context, effects);
  return effects.length > 0 ? effects : NO_CLASS_SKILL_EFFECTS;
};

function collectMeteors(
  context: ClassSkillEventContext,
  effects: ClassSkillEffect[],
): void {
  const stacks = stacksOf(context.owned, METEOR_ID);
  if (stacks <= 0) return;

  const { nowMs, dtMs, enemies, damage, position } = context;
  if (
    nowMs === undefined ||
    dtMs === undefined ||
    enemies === undefined ||
    damage === undefined ||
    position === undefined ||
    enemies.length === 0
  ) {
    return;
  }

  const intervalMs = Math.max(
    1,
    M.meteor.intervalMs - M.meteor.intervalStepMs * (stacks - 1),
  );
  if (!crossedInterval(nowMs, dtMs, intervalMs)) return;

  const target = densestCluster(enemies, M.meteor.radiusTiles);
  effects.push({
    kind: 'damage',
    skillId: METEOR_ID,
    position: target.position,
    radiusTiles: M.meteor.radiusTiles,
    amount: damage * M.meteor.damageRatio,
  });
  effects.push({
    kind: 'status',
    skillId: METEOR_ID,
    position: target.position,
    radiusTiles: M.meteor.radiusTiles,
    burnDps: damage * M.meteor.burnDpsRatio,
    durationMs: M.meteor.burnDurationMs,
  });
}

function collectOrbContact(
  context: ClassSkillEventContext,
  effects: ClassSkillEffect[],
): void {
  const stacks = stacksOf(context.owned, ORBS_ID);
  if (stacks <= 0) return;

  const { nowMs, dtMs, enemies, damage, position } = context;
  if (
    nowMs === undefined ||
    dtMs === undefined ||
    enemies === undefined ||
    damage === undefined ||
    position === undefined ||
    enemies.length === 0
  ) {
    return;
  }

  const evolved = context.owned(EVO_ID) > 0;
  const orbs = frostOrbPositions(stacks, evolved, nowMs, position);
  if (orbs.length === 0) return;

  const tickDamage = (damage * M.frostOrbs.damagePerSecondRatio * dtMs) / 1000;
  for (const enemy of enemies) {
    if (!touchesAnyOrb(enemy.position, orbs, M.frostOrbs.hitRadiusTiles)) continue;
    const multiplier =
      evolved && enemy.ignited === true ? M.evolution.shatterBurnMultiplier : 1;
    effects.push({
      kind: 'damage',
      skillId: ORBS_ID,
      position: enemy.position,
      targetId: enemy.id,
      amount: tickDamage * multiplier,
    });
    effects.push({
      kind: 'status',
      skillId: ORBS_ID,
      position: enemy.position,
      targetId: enemy.id,
      slowFactor: M.frostOrbs.slowFactor,
      durationMs: M.frostOrbs.slowDurationMs,
    });
  }
}

function collectIceShards(
  context: ClassSkillEventContext,
  effects: ClassSkillEffect[],
): void {
  if (context.owned(EVO_ID) <= 0) return;

  const stacks = stacksOf(context.owned, ORBS_ID);
  if (stacks <= 0) return;

  const { nowMs, dtMs, enemies, damage, position } = context;
  if (
    nowMs === undefined ||
    dtMs === undefined ||
    enemies === undefined ||
    damage === undefined ||
    position === undefined ||
    enemies.length === 0
  ) {
    return;
  }
  if (!crossedInterval(nowMs, dtMs, M.evolution.shardIntervalMs)) return;

  const orbs = frostOrbPositions(stacks, true, nowMs, position);
  let target: ClassSkillTarget | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (touchesAnyOrb(enemy.position, orbs, M.frostOrbs.hitRadiusTiles)) continue;
    const gap = distance(position, enemy.position);
    if (gap < bestGap) {
      target = enemy;
      bestGap = gap;
    }
  }
  if (target === undefined) return;

  effects.push({
    kind: 'damage',
    skillId: EVO_ID,
    position: target.position,
    targetId: target.id,
    amount: damage * M.evolution.shardDamageRatio,
  });
}

/** On-hit: Storm Strike proc + Arcane Pulse on every 4th shot. */
const onHit: ClassSkillHook = (context) => {
  const effects: ClassSkillEffect[] = [];
  collectStormStrike(context, effects);
  collectArcanePulse(context, effects);
  return effects.length > 0 ? effects : NO_CLASS_SKILL_EFFECTS;
};

function collectStormStrike(
  context: ClassSkillEventContext,
  effects: ClassSkillEffect[],
): void {
  const stacks = stacksOf(context.owned, STORM_ID);
  if (stacks <= 0) return;

  const { rng, enemies, damage, targetId, targetPosition } = context;
  if (rng === undefined || enemies === undefined || damage === undefined) return;

  const chance = Math.min(1, M.stormStrike.procChance + M.stormStrike.procChancePerStack * (stacks - 1));
  if (!(rng.next() < chance)) return;

  const struck =
    targetId !== undefined ? enemies.find((enemy) => enemy.id === targetId) : undefined;
  const origin = struck?.position ?? targetPosition;
  if (origin === undefined) return;

  let nearest: ClassSkillTarget | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (enemy.id === targetId) continue;
    const gap = distance(origin, enemy.position);
    if (gap < bestGap) {
      nearest = enemy;
      bestGap = gap;
    }
  }
  const target = nearest ?? struck;
  if (target === undefined) return;

  effects.push({
    kind: 'damage',
    skillId: STORM_ID,
    position: target.position,
    targetId: target.id,
    amount: damage * M.stormStrike.damageRatio,
  });
}

function collectArcanePulse(
  context: ClassSkillEventContext,
  effects: ClassSkillEffect[],
): void {
  const stacks = stacksOf(context.owned, PULSE_ID);
  if (stacks <= 0) return;

  const { shotCount, targetPosition, damage } = context;
  if (shotCount === undefined || targetPosition === undefined || damage === undefined) return;
  if (shotCount <= 0 || shotCount % M.arcanePulse.shotEvery !== 0) return;

  const ratio = M.arcanePulse.damageRatio + M.arcanePulse.damageRatioPerStack * (stacks - 1);
  effects.push({
    kind: 'damage',
    skillId: PULSE_ID,
    position: targetPosition,
    radiusTiles: M.arcanePulse.radiusTiles,
    amount: damage * ratio,
  });
}

const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** Mage mechanics (M20, #86). */
export const MAGE_HOOKS: ClassSkillHooks = {
  onShot: noop,
  onHit,
  onKill: noop,
  onDash: noop,
  onActive: noop,
  tick,
};

/** Pooled `fx.*` manifest key per Mage skill (M19 art for Meteor and Frost Orbs). */
export const MAGE_SKILL_FX: Readonly<Record<string, string>> = {
  [METEOR_ID]: 'fx.meteor',
  [ORBS_ID]: 'fx.frost-orb',
  [STORM_ID]: 'fx.spark',
  [PULSE_ID]: 'fx.arcane-bolt',
  [EVO_ID]: 'fx.ice-spike',
};

/** SFX bank id per Mage skill (existing clips, no new audio files). */
export const MAGE_SKILL_SFX: Readonly<Record<string, SfxId>> = {
  [METEOR_ID]: 'explosion',
  [ORBS_ID]: 'freeze',
  [STORM_ID]: 'enemy-hit',
  [PULSE_ID]: 'shield',
  [EVO_ID]: 'freeze',
};

/** Arcane-cyan crest. */
export const MAGE_CREST: ClassCrest = { color: '#4FC3E8', glyph: 'M' };

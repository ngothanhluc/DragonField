/**
 * Legendary Evolutions — 7 build-defining synergies unlocked by owning prerequisite pairs (M13, ADR-022).
 *
 * Each Evolution requires 2 distinct base skills at `minStacksEach` (default 1, tuned so
 * Evolutions trigger realistically within a 12–16 level-up run). Once unlocked and not yet
 * owned, it enters the level-up roll pool at `'legendary'` rarity.
 */
import type { CharacterId } from '../characters/roster';
import { getLocale, localizeSkillName, t, type Locale } from '../i18n';
import {
  CLASS_EVOLUTIONS,
  classEvolutionFor,
  findClassEvolution,
  findClassSkillOrEvolution,
} from './class-skills';
import type { ClassEvolutionDef } from './class-skill-hooks';
import { clampSkillStacks, getSkill, type SkillDef } from './pool';

export interface EvolutionDef extends SkillDef {
  readonly rarity: 'legendary';
  readonly maxStacks: 1;
  readonly requires: readonly [string, string];
  readonly minStacksEach: number;
}

export interface OwnedEvolutionStacks {
  readonly def: EvolutionDef;
  readonly stacks: number;
}

export interface EvolutionHint {
  readonly evolution: EvolutionDef;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly partnerOwned: boolean;
  /** True when picking this prerequisite skill completes (or already satisfies) the Evolution unlock. */
  readonly ready: boolean;
  readonly text: string;
}

export const EVOLUTIONS: readonly EvolutionDef[] = [
  {
    id: 'phantom-volley',
    short: 'PV',
    name: 'Phantom Volley',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['twin-shot', 'piercing'],
    minStacksEach: 1,
    tags: [
      { kind: 'projectile-add', amount: 2 },
      { kind: 'pierce-add', amount: 2 },
    ],
  },
  {
    id: 'cataclysm',
    short: 'CA',
    name: 'Cataclysm',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['explosive', 'crit-eye'],
    minStacksEach: 1,
    tags: [
      { kind: 'explosive', radiusTiles: 2.5, damageRatio: 0.35 },
      { kind: 'crit-chance', chance: 0.2, multiplier: 2.5 },
      { kind: 'burn', dps: 2, durationMs: 3000 },
    ],
  },
  {
    id: 'blightfrost',
    short: 'BF',
    name: 'Blightfrost',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['freeze', 'poison'],
    minStacksEach: 1,
    tags: [
      { kind: 'slow-on-hit', factor: 0.25, durationMs: 1500 },
      { kind: 'poison', dps: 2.5, durationMs: 4000 },
      { kind: 'status-amp', bonusRatio: 0.35 },
    ],
  },
  {
    id: 'starfall-kunai',
    short: 'SK',
    name: 'Starfall Kunai',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['homing', 'ricochet'],
    minStacksEach: 1,
    tags: [
      { kind: 'ricochet-add', bounces: 2 },
      { kind: 'fire-rate-mult', amount: 0.35 },
      { kind: 'damage-add', amount: 1 },
    ],
  },
  {
    id: 'aegis-retribution',
    short: 'AR',
    name: 'Aegis Retribution',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['shield', 'vitality'],
    minStacksEach: 1,
    tags: [
      { kind: 'shield', cooldownMs: 12_000 },
      { kind: 'thorns', damage: 5 },
      { kind: 'shield-recharge-mult', factor: 0.75 },
    ],
  },
  {
    id: 'shadowstep',
    short: 'SS',
    name: 'Shadowstep',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['swift', 'phantom-dash'],
    minStacksEach: 1,
    tags: [
      { kind: 'move-speed-mult', amount: 0.2 },
      { kind: 'dash-cooldown-mult', factor: 0.7 },
      { kind: 'dash-nova', radiusTiles: 2.5, damage: 4 },
    ],
  },
  {
    id: 'tempest-barrage',
    short: 'TB',
    name: 'Tempest Barrage',
    rarity: 'legendary',
    maxStacks: 1,
    requires: ['rapid-fire', 'shadow-conduit'],
    minStacksEach: 1,
    tags: [
      { kind: 'fire-rate-mult', amount: 0.4 },
      { kind: 'active-cooldown-mult', factor: 0.7 },
      { kind: 'active-power-mult', amount: 0.5 },
    ],
  },
];

const EVOLUTIONS_BY_ID: ReadonlyMap<string, EvolutionDef> = new Map(
  EVOLUTIONS.map((evo) => [evo.id, evo]),
);

export function isEvolutionId(id: string): boolean {
  return EVOLUTIONS_BY_ID.has(id) || findClassEvolution(id) !== undefined;
}

/** Look up an Evolution by id (shared or Class Evolution). Throws when unknown. */
export function getEvolution(id: string): EvolutionDef {
  const evo = EVOLUTIONS_BY_ID.get(id) ?? findClassEvolution(id);
  if (evo === undefined) {
    throw new Error(`Evolution does not exist: "${id}"`);
  }
  return evo;
}

/** Look up either a base skill or an Evolution by id; returns `undefined` if missing. */
export function findSkillOrEvolution(id: string): SkillDef | undefined {
  const evo = EVOLUTIONS_BY_ID.get(id);
  if (evo !== undefined) return evo;
  const classCard = findClassSkillOrEvolution(id);
  if (classCard !== undefined) return classCard;
  try {
    return getSkill(id);
  } catch {
    return undefined;
  }
}

/** True when every prerequisite skill meets `minStacksEach` (and the Evolution is not yet owned). */
export function isEvolutionUnlocked(
  evo: EvolutionDef,
  owned: ReadonlyMap<string, number>,
): boolean {
  const ownedEvoStacks = clampSkillStacks(owned.get(evo.id) ?? 0, evo.maxStacks);
  if (ownedEvoStacks >= evo.maxStacks) return false;

  for (const reqId of evo.requires) {
    const reqDef = findSkillOrEvolution(reqId);
    if (reqDef === undefined) return false;
    const stacks = clampSkillStacks(owned.get(reqId) ?? 0, reqDef.maxStacks);
    if (stacks < evo.minStacksEach) return false;
  }
  return true;
}

/** All Evolutions currently unlocked and not yet owned, in `EVOLUTIONS` order. */
export function unlockedEvolutions(owned: ReadonlyMap<string, number>): EvolutionDef[] {
  return EVOLUTIONS.filter((evo) => isEvolutionUnlocked(evo, owned));
}

/**
 * The Class Evolution of `characterId` when both of its prerequisites are owned and it is not
 * yet owned; `undefined` otherwise. Never returns another class's Evolution.
 */
export function unlockedClassEvolution(
  characterId: CharacterId,
  owned: ReadonlyMap<string, number>,
): ClassEvolutionDef | undefined {
  const evo = classEvolutionFor(characterId);
  return isEvolutionUnlocked(evo, owned) ? evo : undefined;
}

/** Owned Evolutions in deterministic `EVOLUTIONS` order, clamped to [0, 1]. */
export function resolveOwnedEvolutions(
  owned: ReadonlyMap<string, number>,
): OwnedEvolutionStacks[] {
  const result: OwnedEvolutionStacks[] = [];
  for (const def of EVOLUTIONS) {
    const stacks = clampSkillStacks(owned.get(def.id) ?? 0, def.maxStacks);
    if (stacks > 0) result.push({ def, stacks });
  }
  return result;
}

/**
 * Pairing hints for a base skill card: shows which partner skill unlocks an Evolution,
 * or highlights `Evolve: <Name>!` once the partner is already owned.
 */
export function evolutionHintsForSkill(
  skillId: string,
  owned: ReadonlyMap<string, number>,
  locale: Locale = getLocale(),
): EvolutionHint[] {
  const hints: EvolutionHint[] = [];

  for (const evo of [...EVOLUTIONS, ...CLASS_EVOLUTIONS]) {
    const [a, b] = evo.requires;
    if (a !== skillId && b !== skillId) continue;
    if (clampSkillStacks(owned.get(evo.id) ?? 0, evo.maxStacks) >= evo.maxStacks) continue;

    const partnerId = a === skillId ? b : a;
    const partnerDef = findSkillOrEvolution(partnerId);
    const selfDef = findSkillOrEvolution(skillId);
    if (partnerDef === undefined || selfDef === undefined) continue;
    const partnerStacks = clampSkillStacks(owned.get(partnerId) ?? 0, partnerDef.maxStacks);
    const selfStacksAfterPick = Math.min(
      selfDef.maxStacks,
      clampSkillStacks(owned.get(skillId) ?? 0, selfDef.maxStacks) + 1,
    );
    const partnerOwned = partnerStacks >= evo.minStacksEach;
    const ready = partnerOwned && selfStacksAfterPick >= evo.minStacksEach;
    const localizedPartner = localizeSkillName(partnerDef.id, partnerDef.name, locale);
    const localizedEvo = localizeSkillName(evo.id, evo.name, locale);

    hints.push({
      evolution: evo,
      partnerId,
      partnerName: localizedPartner,
      partnerOwned,
      ready,
      text: ready
        ? t('skillPick.hintReady', { name: localizedEvo }, locale)
        : t('skillPick.hintPair', { name: localizedPartner }, locale),
    });
  }

  return hints;
}

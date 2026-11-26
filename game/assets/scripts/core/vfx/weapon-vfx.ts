/**
 * Weapon VFX selection rules (ticket #3) — pure, no `cc` import.
 *
 * Everything here answers one question from the loadout alone: which sprite, which
 * colour, whether to show the aura, which ball the enemies throw. The adapter
 * (`game/bullet-view.ts`, `game/fx/effect-pool.ts`, `game/combat-loop.ts`) only draws it,
 * so "the visual reflects the build" is testable without the engine.
 *
 * Loadout input is `SkillLoadout.snapshot()`: skill id → stacks. It is read through
 * `resolveOwnedSkills`, exactly like stats: unknown ids and 0/negative/NaN stacks are ignored,
 * stacks are clamped to `maxStacks`.
 */
import { resolveOwnedEvolutions } from '../skills/evolutions';
import { resolveOwnedSkills } from '../skills/pool';
import type { Rarity } from '../skills/pool';

/** A visual element: the four loadout elements plus `crit` (a per-bullet moment, never a loadout element). */
export type VfxElement = 'fire' | 'ice' | 'poison' | 'homing' | 'crit';

/** Loadout element = every element except `crit`. */
export type LoadoutElement = Exclude<VfxElement, 'crit'>;

/** 0..255 RGB. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `Settings.effects`. */
export type EffectsMode = 'full' | 'reduced';

/** Which VFX layers are drawn under an effects mode. */
export interface EffectsLayers {
  readonly trail: boolean;
  readonly aura: boolean;
  readonly secondaryParticles: boolean;
  readonly impacts: boolean;
  readonly telegraphs: boolean;
}

/** Player projectile look: manifest key + optional element tint (Explosive → `fire`). */
export interface ProjectileLook {
  readonly key: string;
  readonly tint: VfxElement | null;
}

/** The element each loadout skill brings, in **priority order** (Explosive first). */
const ELEMENT_SKILLS: readonly (readonly [string, LoadoutElement])[] = [
  ['explosive', 'fire'],
  ['freeze', 'ice'],
  ['poison', 'poison'],
  ['homing', 'homing'],
];

/**
 * Tint per element. Fire is orange rather than red, ice cyan rather than white and crit
 * yellow: on a busy room the colour has to read at a glance, not just be "a colour".
 */
export const ELEMENT_TINTS: Readonly<Record<VfxElement, Rgb>> = {
  fire: { r: 255, g: 150, b: 40 },
  ice: { r: 90, g: 220, b: 255 },
  poison: { r: 110, g: 235, b: 80 },
  homing: { r: 190, g: 100, b: 255 },
  crit: { r: 255, g: 235, b: 60 },
};

/** Sharpen at this many stacks upgrades the plain shuriken/kunai to its Big variant. */
export const SHARPEN_BIG_STACKS = 3;

/** Total stacks at which the aura appears even without an Epic skill. */
export const AURA_STACK_THRESHOLD = 8;

/** The top rarity: one Epic skill is enough to show the aura. */
const AURA_RARITY: Rarity = 'epic';

/** Chapter → round enemy projectile. Chapter 4 (Fireball) has art ready but no level data yet. */
const ENEMY_PROJECTILES: Readonly<Record<number, string>> = {
  1: 'fx.energy-ball',
  2: 'fx.bubble',
  3: 'fx.canon-ball',
  4: 'fx.fireball',
};

const DEFAULT_ENEMY_PROJECTILE = 'fx.energy-ball';

/** Effective stacks of one skill id after the loadout clamp (0 = not owned). */
function stacksOf(owned: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const skill of resolveOwnedSkills(owned)) {
    result.set(skill.def.id, skill.stacks);
  }
  return result;
}

/** The strongest element in the loadout, or `null` when none is owned. */
export function strongestElement(owned: ReadonlyMap<string, number>): LoadoutElement | null {
  const stacks = stacksOf(owned);
  for (const [id, element] of ELEMENT_SKILLS) {
    if ((stacks.get(id) ?? 0) > 0) return element;
  }
  return null;
}

/**
 * Player projectile sprite by element, then Piercing, then the default shuriken.
 * Sharpen ≥ 3 upgrades **only** the shuriken/kunai — an element sprite has no Big variant.
 */
export function playerProjectileLook(owned: ReadonlyMap<string, number>): ProjectileLook {
  const stacks = stacksOf(owned);
  const element = strongestElement(owned);

  if (element === 'fire') return { key: 'fx.big-energy-ball', tint: 'fire' };
  if (element === 'ice') return { key: 'fx.ice-spike', tint: null };
  if (element === 'poison') return { key: 'fx.plant-spike', tint: null };
  if (element === 'homing') return { key: 'fx.shuriken-magic', tint: null };

  const big = (stacks.get('sharpen') ?? 0) >= SHARPEN_BIG_STACKS;
  if ((stacks.get('piercing') ?? 0) > 0) {
    return { key: big ? 'fx.big-kunai' : 'fx.kunai', tint: null };
  }
  return { key: big ? 'fx.big-shuriken' : 'fx.shuriken', tint: null };
}

/**
 * Trail colour of one player bullet: a crit is always yellow, whatever the loadout;
 * otherwise the strongest element; no element → no trail (`null`).
 */
export function trailElement(
  owned: ReadonlyMap<string, number>,
  crit: boolean,
): VfxElement | null {
  if (crit) return 'crit';
  return strongestElement(owned);
}

/**
 * Aura at the player's feet: any Epic skill or Legendary Evolution held, or
 * `AURA_STACK_THRESHOLD` stacks in total (after clamping — 99 Sharpen stacks are still 5).
 */
export function showAura(owned: ReadonlyMap<string, number>): boolean {
  if (resolveOwnedEvolutions(owned).length > 0) return true;
  let total = 0;
  for (const skill of resolveOwnedSkills(owned)) {
    if (skill.def.rarity === AURA_RARITY) return true;
    total += skill.stacks;
  }
  return total >= AURA_STACK_THRESHOLD;
}

/** Round enemy projectile for a chapter; an unknown chapter falls back to the ch1 ball. */
export function enemyProjectileKey(chapter: number): string {
  if (!Number.isInteger(chapter)) return DEFAULT_ENEMY_PROJECTILE;
  return ENEMY_PROJECTILES[chapter] ?? DEFAULT_ENEMY_PROJECTILE;
}

/** Which VFX layers survive an effects mode. Impacts and telegraphs always stay. */
export function effectsLayers(mode: EffectsMode): EffectsLayers {
  const full = mode !== 'reduced';
  return {
    trail: full,
    aura: full,
    secondaryParticles: full,
    impacts: true,
    telegraphs: true,
  };
}

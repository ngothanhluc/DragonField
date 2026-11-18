/**
 * Weapon VFX selection rules (ticket #3) — pure, no `cc` import.
 *
 * STUB written with the red acceptance test (`tests/core/weapon-vfx.test.ts`): the signatures are
 * the contract, the bodies are placeholders the executor replaces.
 */

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

export const ELEMENT_TINTS: Readonly<Record<VfxElement, Rgb>> = {
  fire: { r: 255, g: 255, b: 255 },
  ice: { r: 255, g: 255, b: 255 },
  poison: { r: 255, g: 255, b: 255 },
  homing: { r: 255, g: 255, b: 255 },
  crit: { r: 255, g: 255, b: 255 },
};

export function playerProjectileLook(_owned: ReadonlyMap<string, number>): ProjectileLook {
  return { key: 'fx.shuriken', tint: null };
}

export function strongestElement(_owned: ReadonlyMap<string, number>): LoadoutElement | null {
  return null;
}

export function trailElement(_owned: ReadonlyMap<string, number>, _crit: boolean): VfxElement | null {
  return null;
}

export function showAura(_owned: ReadonlyMap<string, number>): boolean {
  return false;
}

export function enemyProjectileKey(_chapter: number): string {
  return 'fx.energy-ball';
}

export function effectsLayers(_mode: EffectsMode): EffectsLayers {
  return { trail: true, aura: true, secondaryParticles: true, impacts: true, telegraphs: true };
}

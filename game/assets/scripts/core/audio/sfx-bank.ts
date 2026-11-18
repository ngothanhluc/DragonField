/**
 * SFX bank + variant selection (#9).
 *
 * One event → the files it may play. Events with several files are picked by `VariantPicker`
 * (never the same file twice in a row) and played with a small random volume scale, which is
 * the variation Cocos 3.8 allows (its `AudioSource` has no pitch on `playOneShot`).
 *
 * Pure TS: paths are relative to `assets/resources`, no `cc`.
 */
import type { SeededRng } from '../rng';

/** Every SFX event the game can play → resource paths (under `assets/resources`, no extension). */
export const SFX_BANK = {
  shoot: ['audio/sfx/shoot', 'audio/sfx/shoot-2', 'audio/sfx/shoot-3'],
  'enemy-hit': [
    'audio/sfx/enemy-hit',
    'audio/sfx/enemy-hit-2',
    'audio/sfx/enemy-hit-3',
    'audio/sfx/enemy-hit-4',
  ],
  'player-hurt': ['audio/sfx/player-hurt'],
  'enemy-death': ['audio/sfx/enemy-death', 'audio/sfx/enemy-death-2', 'audio/sfx/enemy-death-3'],
  explosion: ['audio/sfx/explosion'],
  'boss-phase': ['audio/sfx/boss-phase'],
  'ui-move': ['audio/sfx/ui-move'],
  'ui-confirm': ['audio/sfx/ui-confirm'],
  gold: ['audio/sfx/gold', 'audio/sfx/gold-2', 'audio/sfx/gold-3'],
  'chapter-clear': ['audio/sfx/chapter-clear'],
  'game-over': ['audio/sfx/game-over'],
  shield: ['audio/sfx/shield'],
  freeze: ['audio/sfx/freeze'],
  poison: ['audio/sfx/poison'],
  'room-clear': ['audio/sfx/room-clear'],
  'skill-acquired': ['audio/sfx/skill-acquired'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type SfxId = keyof typeof SFX_BANK;

/** Lowest volume scale a one-shot may get (variation instead of pitch, which Cocos 3.8 does not expose). */
export const SFX_VOLUME_MIN = 0.85;

/** Random volume scale in [SFX_VOLUME_MIN, 1]. */
export function sfxVolumeScale(rng: SeededRng): number {
  return SFX_VOLUME_MIN + (1 - SFX_VOLUME_MIN) * rng.next();
}

/** Picks one variant per event, uniformly at random, never the same file twice in a row for that event. */
export class VariantPicker {
  /** Last picked file per event id (undefined = nothing picked yet). */
  private readonly lastIndex = new Map<string, number>();

  constructor(
    private readonly rng: SeededRng,
    private readonly bank: Readonly<Record<string, readonly string[]>> = SFX_BANK,
  ) {}

  pick(id: string): string {
    const files = this.bank[id];
    if (files === undefined || files.length === 0) {
      throw new Error(`VariantPicker: unknown or empty SFX id "${id}"`);
    }
    const solo = files[0];
    if (files.length === 1 && solo !== undefined) return solo;

    const previous = this.lastIndex.get(id);
    let index = this.rng.int(files.length);
    if (previous !== undefined && index === previous) {
      // Shift within the remaining (length - 1) slots: uniform over every index except `previous`.
      index = this.rng.int(files.length - 1);
      if (index >= previous) index += 1;
    }

    this.lastIndex.set(id, index);
    const chosen = files[index];
    if (chosen === undefined) {
      throw new Error(`VariantPicker: index ${index} out of range for "${id}"`);
    }
    return chosen;
  }
}

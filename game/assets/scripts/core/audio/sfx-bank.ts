/**
 * SFX bank + variant selection (#9). STUB written by the orchestrator with the agreed
 * signatures only; the executor implements it. Pure TS: must not import 'cc'.
 */
import type { SeededRng } from '../rng';

/** Every SFX event the game can play → resource paths (under `assets/resources`, no extension). */
export const SFX_BANK = {} as const;

export type SfxId = keyof typeof SFX_BANK;

/** Lowest volume scale a one-shot may get (variation instead of pitch, which Cocos 3.8 does not expose). */
export const SFX_VOLUME_MIN = 1;

/** Random volume scale in [SFX_VOLUME_MIN, 1]. */
export function sfxVolumeScale(_rng: SeededRng): number {
  throw new Error('not implemented');
}

/** Picks one variant per event, uniformly at random, never the same file twice in a row for that event. */
export class VariantPicker {
  constructor(
    private readonly rng: SeededRng,
    private readonly bank: Readonly<Record<string, readonly string[]>> = SFX_BANK,
  ) {}

  pick(_id: string): string {
    void this.rng;
    void this.bank;
    throw new Error('not implemented');
  }
}

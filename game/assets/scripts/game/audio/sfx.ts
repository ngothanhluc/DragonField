/**
 * One-way SFX channel: gameplay imports no `cc` and holds no AudioSource.
 *
 * `AudioManager` (game/audio/audio-manager.ts) registers as the sink at boot. Before a sink
 * exists (menu/title while boot is unfinished) every sound is silently dropped — no unbounded
 * queue and no error.
 */

export type SfxId =
  | 'shoot'
  | 'enemy-hit'
  | 'player-hurt'
  | 'enemy-death'
  | 'explosion'
  | 'boss-phase'
  | 'skill-pick'
  | 'ui-move'
  | 'ui-confirm'
  | 'gold'
  | 'chapter-clear'
  | 'game-over'
  | 'shield'
  | 'freeze'
  | 'poison';

export const SFX_IDS: readonly SfxId[] = [
  'shoot',
  'enemy-hit',
  'player-hurt',
  'enemy-death',
  'explosion',
  'boss-phase',
  'skill-pick',
  'ui-move',
  'ui-confirm',
  'gold',
  'chapter-clear',
  'game-over',
  'shield',
  'freeze',
  'poison',
];

export type SfxSink = (id: SfxId) => void;

let sink: SfxSink | null = null;

/** Register the sink (pass `null` to remove it on teardown). */
export function setSfxSink(next: SfxSink | null): void {
  sink = next;
}

/** Play one SFX; skipped when there is no sink. */
export function playSfx(id: SfxId): void {
  sink?.(id);
}

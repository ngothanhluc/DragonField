/**
 * One-way SFX channel: gameplay imports no `cc` and holds no AudioSource.
 *
 * `AudioManager` (game/audio/audio-manager.ts) registers as the sink at boot. Before a sink
 * exists (menu/title while boot is unfinished) every sound is silently dropped — no unbounded
 * queue and no error.
 *
 * The ids and their files live in `core/audio/sfx-bank.ts` (`SFX_BANK`), the single source.
 */
import { SFX_BANK, type SfxId } from '../../core/audio/sfx-bank';

export { SFX_BANK };
export type { SfxId };

/** `Object.keys` typed as ids — no spread of iterators (the build flattens `[...keys]` wrongly). */
function bankIds(bank: Readonly<Record<string, readonly string[]>>): SfxId[] {
  return Object.keys(bank) as SfxId[];
}

export const SFX_IDS: readonly SfxId[] = bankIds(SFX_BANK);

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

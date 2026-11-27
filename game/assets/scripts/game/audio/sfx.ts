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
import type { SignatureSkillId } from '../../core/input/active-skill';

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

/** Semantic M13 cues routed through existing validated `SFX_BANK` clips. */
export function playDashSfx(): void {
  playSfx('ui-move');
}

export function playDashNovaSfx(): void {
  playSfx('shield');
}

/** Distinct 2-layer SFX cues for all 4 Signature Active skills (routed through validated `SFX_BANK`). */
export function playActiveSkillSfx(skillId: SignatureSkillId = 'shadow-barrage'): void {
  switch (skillId) {
    case 'shadow-barrage':
      playSfx('shoot');
      playSfx('skill-acquired');
      break;
    case 'piercing-volley':
      playSfx('shoot');
      playSfx('ui-confirm');
      break;
    case 'arcane-nova':
      playSfx('freeze');
      playSfx('explosion');
      break;
    case 'ten-thousand-swords':
      playSfx('shield');
      playSfx('skill-acquired');
      break;
  }
}

export function playEvolutionPickSfx(): void {
  playSfx('level-up');
  playSfx('skill-acquired');
}

export function playBurnSfx(): void {
  playSfx('poison');
}

export function playShockSfx(): void {
  playSfx('enemy-hit');
}

export function playBomberBlastSfx(): void {
  playSfx('explosion');
}

export function playBufferPulseSfx(): void {
  playSfx('xp-pickup');
}

/** M17 North Portal activation burst SFX (deeper warning cue for crimson Boss portals). */
export function playPortalOpenSfx(isBoss = false): void {
  if (isBoss) {
    playSfx('explosion');
    playSfx('shield');
    return;
  }
  playSfx('shield');
  playSfx('ui-confirm');
}

/** M17 Health Potion (*Bình Hồi Máu*) collection heal chime. */
export function playPotionHealSfx(): void {
  playSfx('skill-acquired');
}

/** M20 Ninja exclusive-skill cues (#84) — one distinct pair of existing bank clips per skill. */
export function playNinjaCloneSfx(): void {
  playSfx('freeze');
  playSfx('ui-move');
}

export function playNinjaVenomSfx(): void {
  playSfx('poison');
  playSfx('shoot');
}

export function playNinjaKunaiSfx(): void {
  playSfx('enemy-hit');
  playSfx('shoot');
}

export function playNinjaSmokeSfx(): void {
  playSfx('shield');
  playSfx('ui-confirm');
}

/** M20 Cultivator exclusive-skill cues (#87) — one distinct pair of existing bank clips per skill. */
export function playCultivatorOrbitSfx(): void {
  playSfx('shoot');
  playSfx('ui-move');
}

export function playCultivatorArraySfx(): void {
  playSfx('freeze');
  playSfx('skill-acquired');
}

export function playCultivatorQiSfx(): void {
  playSfx('shoot');
  playSfx('enemy-hit');
}

export function playCultivatorBarrierSfx(): void {
  playSfx('shield');
  playSfx('level-up');
}

export function playCultivatorEvolutionSfx(): void {
  playSfx('level-up');
  playSfx('skill-acquired');
}

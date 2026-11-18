/**
 * Wires the core boss into the scene: builds a `BossView` from `LevelData` and shows
 * the phase-change banner.
 *
 * Split from `bootstrap.ts` so the run-flow file needs one line to call the boss. There are
 * no patterns/AI here — everything lives in `core/boss/` and `boss-view.ts`.
 */
import { bossForSpriteName, type BossDef } from '../core/boss/boss-defs';
import type { LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { playSfx } from './audio/sfx';
import type { CombatLoop } from './combat-loop';

/** Minimal Cocos `Color` RGBA shape — no value import, type use only. */
export interface PhaseColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** The minimal node a banner needs; avoids the `cc` type in a file that builds no nodes. */
export interface DestroyableNode {
  destroy(): void;
}

/** Where the boss stands when the TMX has no `bossStart` object (tile units, y down). */
export const BOSS_START_FALLBACK: Vec2 = { x: 16, y: 5 };

/**
 * Spawn the room's real boss. Returns the def so the caller can log; throws if the TMX lacks
 * `boss` or the sprite name is not in `BOSSES` (bad data must surface immediately).
 */
export function spawnBossForRoom(combat: CombatLoop, level: LevelData): BossDef {
  const bossName = level.boss?.name;
  if (bossName === undefined) {
    throw new Error(`Room ${level.room} is a boss room but is missing the map property "boss"`);
  }

  const def = bossForSpriteName(bossName);
  if (def === undefined) {
    throw new Error(
      `No boss "${bossName}" in BOSSES (TMX room-${level.room}); ` +
        'the "boss" map property must be a spriteName, e.g. TenguBlue.',
    );
  }

  const start = level.bossStart ?? BOSS_START_FALLBACK;
  combat.spawnBoss(def, start);
  console.log(
    `[YokaiField] Boss ${def.displayName} (${def.maxHealth} HP, 3 phases) at ` +
      `${start.x},${start.y} — pattern ${def.id}.`,
  );
  return def;
}

export interface PhaseBannerUi {
  /** UI node that already has a Canvas; the banner is created under it. */
  readonly showBanner: (
    name: string,
    text: string,
    color: PhaseColor,
    fontSize: number,
  ) => DestroyableNode;
  /** Cocos scheduler (bootstrap passes `scheduleOnce`). */
  readonly schedule: (callback: () => void, delaySeconds: number) => void;
  readonly winColor: PhaseColor;
  readonly lossColor: PhaseColor;
}

/**
 * The `PHASE 2` / `ENRAGE` banner. Each phase change replaces the old banner; it turns
 * itself off after 1.2 s. No state is kept outside the banner node.
 */
export class BossPhaseBanner {
  private banner: DestroyableNode | null = null;

  constructor(private readonly ui: PhaseBannerUi) {}

  show(phase: number): void {
    this.banner?.destroy();
    playSfx('boss-phase');
    const text = phase >= 3 ? 'ENRAGE' : `PHASE ${phase}`;
    const color = phase >= 3 ? this.ui.lossColor : this.ui.winColor;
    const banner = this.ui.showBanner(`boss-phase-${phase}`, text, color, 22);
    this.banner = banner;
    this.ui.schedule(() => {
      // Only turn off the banner this call created; the next phase may have replaced it within 1.2 s.
      if (this.banner === banner) {
        banner.destroy();
        this.banner = null;
      }
    }, 1.2);
  }

  destroy(): void {
    this.banner?.destroy();
    this.banner = null;
  }
}

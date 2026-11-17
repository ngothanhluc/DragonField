/**
 * Nối boss core vào scene: tạo `BossView` từ `LevelData` và hiện banner đổi phase.
 *
 * Tách khỏi `bootstrap.ts` để file run-flow chỉ còn một dòng gọi boss. Không có
 * pattern/AI ở đây — mọi thứ nằm trong `core/boss/` và `boss-view.ts`.
 */
import { bossForSpriteName, type BossDef } from '../core/boss/boss-defs';
import type { LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { playSfx } from './audio/sfx';
import type { CombatLoop } from './combat-loop';

/** Màu RGBA tối thiểu của Cocos `Color` — không import value chỉ dùng ở type. */
export interface PhaseColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Node tối thiểu mà banner cần; tránh type `cc` trong file không dựng node. */
export interface DestroyableNode {
  destroy(): void;
}

/** Chỗ boss đứng khi TMX không có object `bossStart` (tile unit, y hướng xuống). */
export const BOSS_START_FALLBACK: Vec2 = { x: 16, y: 5 };

/**
 * Sinh boss thật cho phòng. Trả def để caller log; ném lỗi nếu TMX thiếu
 * `boss` hoặc tên sprite không có trong `BOSSES` (dữ liệu sai phải nổi ngay).
 */
export function spawnBossForRoom(combat: CombatLoop, level: LevelData): BossDef {
  const bossName = level.boss?.name;
  if (bossName === undefined) {
    throw new Error(`Phòng ${level.room} là boss room nhưng thiếu map property "boss"`);
  }

  const def = bossForSpriteName(bossName);
  if (def === undefined) {
    throw new Error(
      `Không có boss "${bossName}" trong BOSSES (TMX room-${level.room}); ` +
        'map property "boss" phải là spriteName, ví dụ TenguBlue.',
    );
  }

  const start = level.bossStart ?? BOSS_START_FALLBACK;
  combat.spawnBoss(def, start);
  console.log(
    `[YokaiField] Boss ${def.displayName} (${def.maxHealth} HP, 3 phase) tại ` +
      `${start.x},${start.y} — pattern ${def.id}.`,
  );
  return def;
}

export interface PhaseBannerUi {
  /** Node UI đã có Canvas; banner tạo dưới node này. */
  readonly showBanner: (
    name: string,
    text: string,
    color: PhaseColor,
    fontSize: number,
  ) => DestroyableNode;
  /** Hẹn giờ của Cocos (bootstrap truyền `scheduleOnce`). */
  readonly schedule: (callback: () => void, delaySeconds: number) => void;
  readonly winColor: PhaseColor;
  readonly lossColor: PhaseColor;
}

/**
 * Banner `PHASE 2` / `ENRAGE`. Mỗi phase đổi phase lại thay banner cũ; tự tắt
 * sau 1.2 s. Không giữ state ngoài node banner.
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
      // Chỉ tắt banner mình vừa tạo; phase kế có thể đã thay nó trong 1.2 s.
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

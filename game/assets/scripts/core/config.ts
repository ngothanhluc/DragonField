/**
 * Số liệu combat. Đây là nguồn duy nhất; không hardcode số trong component.
 * Xem docs/gdd.md §3.
 *
 * Số thật nằm trong `game/config/tuning.json`, được `scripts/gen-tuning.ts`
 * biên dịch sang `enemies/tuning.generated.ts`, và `enemies/tuning.ts`
 * validate; file này chỉ giữ **tên + kiểu** để phần còn lại của code import
 * một interface ổn định. Đổi balance = sửa JSON + `bun run gen`, không sửa file này.
 */
import { COMBAT_TUNING } from './enemies/tuning';

export interface CombatConfig {
  /** Số phát bắn mỗi giây ở trạng thái cơ bản. */
  readonly fireRatePerSecond: number;
  /** Tốc độ đạn, tính theo tile/giây (1 tile = 16 px). */
  readonly projectileSpeedTilesPerSecond: number;
  /** Sát thương mỗi viên đạn cơ bản. */
  readonly damage: number;
  /** Số viên đạn mỗi phát ở trạng thái cơ bản. */
  readonly projectiles: number;
  /** Tốc chạy cơ bản, tile/giây. */
  readonly moveSpeedTilesPerSecond: number;
  /** Số tim tối đa của player. */
  readonly playerMaxHearts: number;
  /** Thời gian bất tử sau khi trúng đòn, ms. */
  readonly invulnerabilityMs: number;
  /** Sát thương khi enemy chạm player. */
  readonly contactDamage: number;
  /** Tầm auto-aim, tính theo tile. */
  readonly targetingRangeTiles: number;
  /** Quãng đường knockback player khi trúng đòn, tile. */
  readonly playerKnockbackDistanceTiles: number;
  /** Thời gian đi hết quãng knockback player, ms. */
  readonly playerKnockbackDurationMs: number;
  /** Quãng đường knockback enemy khi trúng đạn, tile. */
  readonly enemyKnockbackDistanceTiles: number;
  /** Thời gian đi hết quãng knockback enemy, ms. */
  readonly enemyKnockbackDurationMs: number;
  /** Hitstop toàn cục khi đạn player trúng enemy, ms (ADR-008: 70). */
  readonly enemyHitstopMs: number;
  /** Thời gian enemy đứng yên sau khi trúng đạn, ms (ADR-008: 150). */
  readonly enemyStaggerMs: number;
}

/** Số liệu combat cơ bản, đọc từ `config/tuning.json` (không chép lại số). */
export const DEFAULT_COMBAT: CombatConfig = COMBAT_TUNING;

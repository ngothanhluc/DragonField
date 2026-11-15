/**
 * Số liệu combat. Đây là nguồn duy nhất; không hardcode số trong component.
 * Xem docs/gdd.md §3.
 */
export interface CombatConfig {
  /** Số phát bắn mỗi giây ở trạng thái cơ bản. */
  readonly fireRatePerSecond: number;
  /** Tốc độ đạn, tính theo tile/giây (1 tile = 16 px). */
  readonly projectileSpeedTilesPerSecond: number;
  /** Số tim tối đa của player. */
  readonly playerMaxHearts: number;
  /** Thời gian bất tử sau khi trúng đòn, ms. */
  readonly invulnerabilityMs: number;
  /** Sát thương khi enemy chạm player. */
  readonly contactDamage: number;
  /** Tầm auto-aim, tính theo tile. */
  readonly targetingRangeTiles: number;
}

export const DEFAULT_COMBAT: CombatConfig = {
  fireRatePerSecond: 2,
  projectileSpeedTilesPerSecond: 12,
  playerMaxHearts: 6,
  invulnerabilityMs: 800,
  contactDamage: 1,
  targetingRangeTiles: 10,
};

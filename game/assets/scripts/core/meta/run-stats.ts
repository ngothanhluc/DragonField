/**
 * Meta upgrade → chỉ số gốc của một run (GDD §7).
 *
 * `core/meta/upgrades.ts` chỉ quy đổi cấp thành 3 bonus; file này áp chúng vào
 * `StatsBaseline` **trước** khi skill layer cộng dồn. Nhờ vậy:
 *
 * - meta là nền của mọi run (mua càng nhiều, mọi run sau càng mạnh);
 * - skill vẫn nhân/cộng trên nền đó, không có hai nguồn sự thật;
 * - test được bằng vitest, không cần engine.
 *
 * Quy ước: damage và nhịp bắn của meta là **hệ số trên chỉ số gốc**, tim là
 * **cộng thẳng** vào trần máu. Không áp hệ số lên phần skill cộng thêm — skill
 * đã có luật cộng dồn riêng trong `core/skills/derived-stats.ts`.
 */
import type { StatsBaseline } from '../skills/derived-stats';
import { applyUpgrades, type UpgradeBonuses, type UpgradeState } from './upgrades';

function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Áp bonus meta đã tính sẵn vào baseline. Không sửa `base`. */
export function applyUpgradesToBaseline(
  base: StatsBaseline,
  bonuses: UpgradeBonuses,
): StatsBaseline {
  return {
    ...base,
    damage: sanitize(roundTo(base.damage * bonuses.damageMultiplier, 4)),
    fireRatePerSecond: sanitize(
      roundTo(base.fireRatePerSecond * bonuses.fireRateMultiplier, 4),
    ),
    playerMaxHearts: Math.max(
      1,
      Math.floor(sanitize(base.playerMaxHearts + bonuses.maxHeartsBonus)),
    ),
  };
}

/** Một cửa vào cho bootstrap: save → baseline của run. */
export function metaBaseline(base: StatsBaseline, state: UpgradeState): StatsBaseline {
  return applyUpgradesToBaseline(base, applyUpgrades(state));
}

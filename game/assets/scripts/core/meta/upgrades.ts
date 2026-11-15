/**
 * Meta progression: 3 track vĩnh viễn, mua bằng vàng giữ lại sau mỗi run (GDD §7).
 *
 * File này chỉ định nghĩa **dữ liệu + luật**; không biết gì về `localStorage`
 * hay engine (adapter trình duyệt nằm ở `assets/scripts/game/`). Mọi hàm là
 * pure: `buy` trả state mới, không sửa state đầu vào.
 */

export const UPGRADE_TRACKS = ['hearts', 'damage', 'fireRate'] as const;
export type UpgradeTrack = (typeof UPGRADE_TRACKS)[number];

/** Số cấp tối đa của một track (GDD §7: mỗi track 10 cấp). */
export const MAX_LEVEL = 10;

/**
 * Riêng track máu bị chặn ở 5 cấp, không phải 10.
 *
 * GDD §7 ghi 10 cấp cho track máu với bảng giá 50 → 500. Nhưng mỗi cấp là
 * **+1 tim** trên nền 6 tim (`DEFAULT_COMBAT.playerMaxHearts`), nên 10 cấp cho
 * 16 tim — không vừa HUD 512×288 và phá curve độ khó; skill Vitality (GDD §6)
 * cũng chỉ cộng tối đa +5 tim. Vì vậy track vĩnh viễn giữ đúng ngưỡng +5 tim.
 * Bảng giá vẫn giữ đủ 10 mốc của GDD để đối chiếu và để có thể nâng cap sau này
 * mà không phải tune lại giá.
 */
export const MAX_HEARTS_TRACK = 5;

/**
 * Giá mua cho từng cấp, index 0 = giá để lên cấp 1. Bảng tường minh (không dùng
 * công thức) để review được từng con số: hearts 50 → 500 (≈×1.29/cấp),
 * damage/fireRate 40 → 400, đúng khoảng GDD §7.
 */
const HEARTS_COSTS: readonly number[] = Object.freeze([
  50, 65, 85, 110, 140, 180, 235, 300, 390, 500,
]);

/** Damage và nhịp bắn dùng chung một đường giá theo GDD §7. */
const COMBAT_COSTS: readonly number[] = Object.freeze([
  40, 50, 65, 85, 110, 145, 185, 240, 310, 400,
]);

export const UPGRADE_COSTS: Readonly<Record<UpgradeTrack, readonly number[]>> = Object.freeze({
  hearts: HEARTS_COSTS,
  damage: COMBAT_COSTS,
  fireRate: COMBAT_COSTS,
});

/** +5% damage mỗi cấp. */
export const DAMAGE_PER_LEVEL = 0.05;
/** +3% nhịp bắn mỗi cấp. */
export const FIRE_RATE_PER_LEVEL = 0.03;

/** Phần state mà luật mua cần. `SaveData` thoả interface này nên dùng trực tiếp được. */
export interface UpgradeState {
  readonly upgrades: Record<UpgradeTrack, number>;
}

/**
 * Hệ số cộng/ nhân do meta mang lại, để skill layer merge vào `DerivedStats`.
 * Không khai báo lại `DerivedStats` ở đây — tránh hai nguồn sự thật.
 */
export interface UpgradeBonuses {
  /** Số tim cộng thêm vào máu tối đa (+1/cấp). */
  readonly maxHeartsBonus: number;
  /** Nhân vào damage gốc, 1 = không đổi. */
  readonly damageMultiplier: number;
  /** Nhân vào nhịp bắn gốc, 1 = không đổi. */
  readonly fireRateMultiplier: number;
}

export interface BuyResult {
  /** State mới; state truyền vào không bị sửa. */
  readonly state: UpgradeState;
  /** Vàng còn lại. */
  readonly gold: number;
}

/** Cấp 0 cho cả 3 track. Dùng làm mặc định cho save mới. */
export function createDefaultUpgrades(): Record<UpgradeTrack, number> {
  return { hearts: 0, damage: 0, fireRate: 0 };
}

/** Cấp tối đa của một track; hearts thấp hơn vì lý do ở `MAX_HEARTS_TRACK`. */
export function maxLevelFor(track: UpgradeTrack): number {
  return track === 'hearts' ? MAX_HEARTS_TRACK : MAX_LEVEL;
}

/** Giá để đi từ cấp `nextLevel - 1` lên `nextLevel` (1-based, như UI hiển thị). */
export function costFor(track: UpgradeTrack, nextLevel: number): number {
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > MAX_LEVEL) {
    throw new Error(`Cấp mua phải là số nguyên 1..${MAX_LEVEL}, nhận ${nextLevel} (track '${track}')`);
  }

  const cost = UPGRADE_COSTS[track][nextLevel - 1];
  if (cost === undefined) {
    throw new Error(`Bảng giá của track '${track}' thiếu cấp ${nextLevel}`);
  }
  return cost;
}

/**
 * Cấp hiện tại đã chuẩn hoá: số nguyên trong 0..max. Save hỏng không thể biến
 * thành bonus vô hạn.
 */
function safeLevel(state: UpgradeState, track: UpgradeTrack): number {
  const level = state.upgrades[track];
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.trunc(level), 0), maxLevelFor(track));
}

/** Đủ điều kiện mua cấp kế của `track` hay không. Không ném lỗi. */
export function canBuy(state: UpgradeState, track: UpgradeTrack, gold: number): boolean {
  const level = safeLevel(state, track);
  if (level >= maxLevelFor(track)) return false;
  if (!Number.isFinite(gold)) return false;
  return gold >= costFor(track, level + 1);
}

/**
 * Mua một cấp. Ném lỗi khi track đã max hoặc không đủ vàng — đây là bug hoặc
 * UI hỏng, không phải trạng thái bình thường nên không im lặng trả state cũ.
 */
export function buy(state: UpgradeState, track: UpgradeTrack, gold: number): BuyResult {
  const level = safeLevel(state, track);
  const maxLevel = maxLevelFor(track);

  if (level >= maxLevel) {
    throw new Error(`Track '${track}' đã đạt cấp tối đa ${maxLevel}`);
  }

  const price = costFor(track, level + 1);
  if (!Number.isFinite(gold) || gold < price) {
    throw new Error(
      `Không đủ vàng để mua '${track}' cấp ${level + 1}: cần ${price}, đang có ${gold}`,
    );
  }

  return {
    state: { upgrades: withLevel(state.upgrades, track, level + 1) },
    gold: gold - price,
  };
}

/** Copy có chủ đích: giữ đúng kiểu Record và không mutate state cũ. */
function withLevel(
  levels: Record<UpgradeTrack, number>,
  track: UpgradeTrack,
  level: number,
): Record<UpgradeTrack, number> {
  return {
    hearts: track === 'hearts' ? level : levels.hearts,
    damage: track === 'damage' ? level : levels.damage,
    fireRate: track === 'fireRate' ? level : levels.fireRate,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Quy đổi cấp meta thành bonus tiêu thụ được. Làm tròn 4 chữ số thập phân để
 * tránh rác dấu phẩy động (1 + 3×0.03 = 1.0900000000000001) khi so sánh/hiển thị.
 */
export function applyUpgrades(state: UpgradeState): UpgradeBonuses {
  const hearts = safeLevel(state, 'hearts');
  const damage = safeLevel(state, 'damage');
  const fireRate = safeLevel(state, 'fireRate');

  return {
    maxHeartsBonus: hearts,
    damageMultiplier: roundTo(1 + damage * DAMAGE_PER_LEVEL, 4),
    fireRateMultiplier: roundTo(1 + fireRate * FIRE_RATE_PER_LEVEL, 4),
  };
}

/**
 * Hiệu ứng skill lên **một phát bắn** và **một lần trúng đòn**.
 *
 * Tách khỏi adapter vì đây là nơi dễ lệch giữa game và simulation nhất:
 * số đạn, góc xoè, crit, execute, lifesteal, nảy, nổ. Cả `game/player-controller.ts`
 * và `core/sim/*` gọi đúng những hàm này; chúng chỉ thuần số học + `SeededRng`.
 *
 * Quy ước damage: damage của viên đạn đã gồm crit (roll lúc bắn). Execute là
 * hệ số **áp lúc trúng** vì nó phụ thuộc máu mục tiêu tại thời điểm đó.
 */
import type { SeededRng } from '../rng';
import type { DerivedStats } from '../skills/derived-stats';

/** Tổng góc xoè của Twin Shot (GDD §6: ±12°). */
export const TWIN_SPREAD_RADIANS = (12 * Math.PI) / 180;

/** Bán kính nảy sang mục tiêu khác, tile. Xa hơn nữa thì coi như không có mục tiêu. */
export const RICOCHET_RANGE_TILES = 8;

/** Tốc độ quay tối đa của đạn homing, radian/giây. Đủ nhanh để thấy "bám". */
export const HOMING_TURN_RATE_RADIANS_PER_SECOND = (720 * Math.PI) / 180;

/** Một viên trong loạt bắn, đã chốt damage/flags để adapter chỉ việc spawn. */
export interface ProjectilePlan {
  /** Lệch so với hướng aim, radian. */
  readonly angleOffset: number;
  readonly damage: number;
  readonly crit: boolean;
  /** Số enemy còn xuyên qua được. */
  readonly pierce: number;
  /** Số lần còn nảy được. */
  readonly ricochet: number;
  readonly homing: boolean;
  readonly explosiveRadiusTiles: number;
  /** Damage vụ nổ, đã tính crit + ratio. 0 = không nổ. */
  readonly explosiveDamage: number;
}

/**
 * Chia một phát bắn thành `stats.projectiles` viên.
 *
 * **Luôn có một viên đi thẳng** (góc 0): nếu mọi viên đều lệch ±12°, ở tầm xa
 * hai viên của Twin Shot 1 stack đều trượt enemy 0.8 tile và DPS thành 0 — bug
 * lộ ra ở simulation khi cộng dồn Twin Shot + Rapid Fire. Các viên thêm lần lượt
 * lệch +12° / −12° (GDD §6 "bắn chéo ±12°"), nên stack thêm vẫn là bonus ở tầm
 * gần chứ không làm mất viên giữa.
 *
 * Crit roll **mỗi viên một lần** (đạn nổ/crit độc lập), chỉ tiêu RNG khi
 * `critChance > 0` để loadout không crit không làm lệch chuỗi RNG của roll skill.
 */
export function planVolley(stats: DerivedStats, rng: SeededRng): ProjectilePlan[] {
  const count = Math.max(1, Math.round(stats.projectiles));
  const plans: ProjectilePlan[] = [];

  for (let index = 0; index < count; index += 1) {
    // index 0 = viên giữa; 1 = +12°, 2 = −12°, 3 = +12°, …
    const angleOffset =
      index === 0
        ? 0
        : (index % 2 === 1 ? 1 : -1) * TWIN_SPREAD_RADIANS;
    const crit = stats.critChance > 0 && rng.next() < stats.critChance;
    const damage = stats.damage * (crit ? Math.max(1, stats.critMultiplier) : 1);
    const explosive = stats.explosive;

    plans.push({
      angleOffset,
      damage,
      crit,
      pierce: Math.max(0, Math.floor(stats.pierce)),
      ricochet: Math.max(0, Math.floor(stats.ricochetBounces ?? 0)),
      homing: stats.homing === true,
      explosiveRadiusTiles: explosive === undefined ? 0 : Math.max(0, explosive.radiusTiles),
      explosiveDamage:
        explosive === undefined ? 0 : damage * Math.max(0, explosive.damageRatio),
    });
  }

  return plans;
}

/**
 * Damage cuối lên mục tiêu đang còn `healthFraction` máu (0..1).
 *
 * Executioner: cộng `executeBonus` (theo stack) khi máu dưới ngưỡng. Với 2 stack
 * bonus = 1.0 tức ×2 damage; không áp cho vụ nổ (vụ nổ đã là damage phụ).
 */
export function damageAfterExecute(
  stats: Pick<DerivedStats, 'executeThreshold' | 'executeBonus'>,
  damage: number,
  healthFraction: number,
): number {
  if (stats.executeThreshold <= 0 || stats.executeBonus <= 0) return damage;
  const fraction = Number.isFinite(healthFraction) ? Math.max(0, Math.min(1, healthFraction)) : 1;
  if (fraction >= stats.executeThreshold) return damage;
  return damage * (1 + stats.executeBonus);
}

/**
 * Máu hồi từ damage vừa gây. GDD §6 ghi "làm tròn xuống": 5% của 3 damage = 0,
 * nên lifesteal 1 stack không hồi gì với đạn 1 damage — đúng chữ của bảng.
 */
export function lifestealHeal(
  stats: Pick<DerivedStats, 'lifestealPercent'>,
  damageDealt: number,
): number {
  if (stats.lifestealPercent <= 0 || !(damageDealt > 0)) return 0;
  return Math.max(0, Math.floor(damageDealt * stats.lifestealPercent));
}

export interface RicochetCandidate {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
}

export interface RicochetTarget {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Mục tiêu kế tiếp cho đạn nảy: gần nhất trong `RICOCHET_RANGE_TILES`, bỏ qua
 * chính mục tiêu vừa trúng và những mục tiêu đạn đã chạm (`alreadyHit`).
 * Trả `null` khi không còn ai — đạn bị thu hồi như bình thường.
 */
export function ricochetTarget(
  from: { readonly x: number; readonly y: number },
  candidates: readonly RicochetCandidate[],
  alreadyHit: readonly string[],
): RicochetTarget | null {
  let best: RicochetTarget | null = null;
  let bestDistance = RICOCHET_RANGE_TILES;

  for (const candidate of candidates) {
    if (alreadyHit.includes(candidate.id)) continue;
    const dx = candidate.position.x - from.x;
    const dy = candidate.position.y - from.y;
    const gap = Math.hypot(dx, dy);
    if (gap > bestDistance) continue;
    bestDistance = gap;
    best = { id: candidate.id, position: { x: candidate.position.x, y: candidate.position.y } };
  }

  return best;
}

/**
 * Xoay vận tốc về phía `to` nhưng không quá `maxTurnRadians`, giữ nguyên tốc độ.
 * Dùng cho Homing: mỗi frame gọi một lần, đạn không bao giờ "teleport" hướng.
 */
export function steerVelocity(
  velocity: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  maxTurnRadians: number,
): { x: number; y: number } {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!(speed > 0) || !(maxTurnRadians >= 0)) {
    return { x: velocity.x, y: velocity.y };
  }

  const currentAngle = Math.atan2(velocity.y, velocity.x);
  const desiredAngle = Math.atan2(to.y - from.y, to.x - from.x);
  let delta = desiredAngle - currentAngle;
  // Chuẩn hoá về (-π, π]: rẽ phải ngắn nhất thay vì quay gần cả vòng.
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const turn = Math.max(-maxTurnRadians, Math.min(maxTurnRadians, delta));
  const angle = currentAngle + turn;

  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

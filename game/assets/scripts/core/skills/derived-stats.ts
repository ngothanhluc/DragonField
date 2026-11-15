import { DEFAULT_COMBAT } from '../config';
import { resolveOwnedSkills } from './pool';

/**
 * Chỉ số combat sau khi cộng dồn toàn bộ skill đang sở hữu.
 *
 * Mọi trường là **số cuối cùng** engine dùng trực tiếp (damage mỗi phát, nhịp
 * bắn mỗi giây, …), không phải hệ số. Nhờ vậy component chỉ đọc một object,
 * không phải tự nhớ thứ tự nhân/cộng.
 */
export interface DerivedStats {
  readonly damage: number;
  readonly fireRatePerSecond: number;
  readonly projectiles: number;
  readonly pierce: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly maxHearts: number;
  readonly moveSpeedTilesPerSecond: number;
  readonly invulnerabilityMs: number;
  readonly lifestealPercent: number;
  readonly goldMultiplier: number;
  /** 0 = không có Executioner. */
  readonly executeThreshold: number;
  readonly executeBonus: number;

  /** Số lần đạn nảy sang enemy khác; vắng mặt = không nảy. */
  readonly ricochetBounces?: number;
  /** Vắng mặt = đạn không nổ. */
  readonly explosive?: ExplosiveStat;
  /** Vắng mặt = đạn không bám mục tiêu. */
  readonly homing?: boolean;
  readonly slowOnHit?: SlowOnHit;
  readonly poisonOnHit?: PoisonOnHit;
  readonly shield?: ShieldStat;
  readonly thorns?: ThornsStat;
  /** Số tim hồi sau mỗi phòng; vắng mặt = không hồi. */
  readonly healPerRoom?: number;
}

export interface SlowOnHit {
  /** Hệ số tốc độ còn lại, 0..1 (0.4 = chậm 60%). */
  readonly factor: number;
  readonly durationMs: number;
}

export interface PoisonOnHit {
  readonly dps: number;
  readonly durationMs: number;
}

export interface ShieldStat {
  /** Số đòn chặn được trước khi phải hồi. */
  readonly charges: number;
  readonly cooldownMs: number;
}

export interface ThornsStat {
  readonly damage: number;
}

export interface ExplosiveStat {
  readonly radiusTiles: number;
  /** Phần damage của đạn chính mà vụ nổ gây ra. */
  readonly damageRatio: number;
}

/**
 * Đầu vào tĩnh của `computeDerivedStats`.
 *
 * `DEFAULT_COMBAT` (assets/scripts/core/config.ts) đã có đủ cả 9 số combat, nên
 * mọi field ở đây **bắt buộc** — không còn fallback ngầm nào khi thiếu. Caller
 * muốn baseline khác (test, meta upgrade) thì truyền object đủ field.
 */
export interface StatsBaseline {
  readonly fireRatePerSecond: number;
  readonly damage: number;
  readonly projectiles: number;
  readonly playerMaxHearts: number;
  readonly invulnerabilityMs: number;
  readonly moveSpeedTilesPerSecond: number;
}

/**
 * Cộng dồn skill thành chỉ số cuối.
 *
 * Thứ tự cố định:
 * 1. Chuẩn hoá stack: floor, kẹp [0, maxStacks], duyệt theo thứ tự `SKILLS`.
 * 2. Cộng dồn các hiệu ứng **cộng** (damage, số đạn, xuyên, tim, crit, vàng,
 *    luck, lifesteal, execute, thorns, hồi máu).
 * 3. Áp các hiệu ứng **nhân** đúng một lần trên giá trị base:
 *    `rate = base × (1 + Σ)`, `speed = base × (1 + Σ)`,
 *    `i-frame = base × 1.375^stack` (GDD ghi 0.8 → 1.1 s ở 1 stack).
 * 4. Kẹp và làm sạch: mọi số hữu hạn, không âm; critChance/lifesteal ≤ 1,
 *    critMultiplier ≥ 1, projectiles ≥ 1, maxHearts ≥ 1.
 *
 * Nhờ bước 3 chỉ nhân một lần, thứ tự skill trong `owned` không đổi kết quả.
 */
export function computeDerivedStats(
  owned: ReadonlyMap<string, number>,
  base: StatsBaseline = DEFAULT_COMBAT,
): DerivedStats {
  let damageAdd = 0;
  let fireRateAdd = 0;
  let projectileAdd = 0;
  let pierce = 0;
  let critChance = 0;
  let critMultiplier = 1;
  let heartsAdd = 0;
  let moveSpeedAdd = 0;
  let iframeMultiplier = 1;
  let lifestealPercent = 0;
  let goldAdd = 0;
  let executeThreshold = 0;
  let executeBonus = 0;
  let ricochetBounces = 0;
  let homing = false;
  let explosiveRadius = 0;
  let explosiveRatio = 0;
  let slowFactor = 1;
  let slowDurationMs = 0;
  let poisonDps = 0;
  let poisonDurationMs = 0;
  let shieldCharges = 0;
  let shieldCooldownMs = Number.POSITIVE_INFINITY;
  let thornsDamage = 0;
  let healPerRoom = 0;

  for (const skill of resolveOwnedSkills(owned)) {
    for (const tag of skill.def.tags) {
      const stacks = skill.stacks;

      switch (tag.kind) {
        case 'damage-add':
          damageAdd += tag.amount * stacks;
          break;
        case 'fire-rate-mult':
          fireRateAdd += tag.amount * stacks;
          break;
        case 'projectile-add':
          projectileAdd += tag.amount * stacks;
          break;
        case 'pierce-add':
          pierce += stacks;
          break;
        case 'crit-chance':
          critChance += tag.chance * stacks;
          critMultiplier = Math.max(critMultiplier, tag.multiplier);
          break;
        case 'max-hearts':
          heartsAdd += tag.amount * stacks;
          break;
        case 'heal-per-room':
          healPerRoom += tag.amount * stacks;
          break;
        case 'shield':
          shieldCharges += stacks;
          shieldCooldownMs = Math.min(shieldCooldownMs, tag.cooldownMs);
          break;
        case 'thorns':
          thornsDamage += tag.damage * stacks;
          break;
        case 'move-speed-mult':
          moveSpeedAdd += tag.amount * stacks;
          break;
        case 'iframe-mult':
          iframeMultiplier *= Math.pow(tag.amount, stacks);
          break;
        case 'slow-on-hit':
          // Nhiều nguồn làm chậm: lấy hệ số mạnh nhất, cộng dồn thời gian.
          slowFactor = Math.min(slowFactor, tag.factor);
          slowDurationMs += tag.durationMs * stacks;
          break;
        case 'poison':
          poisonDps += tag.dps * stacks;
          poisonDurationMs = Math.max(poisonDurationMs, tag.durationMs);
          break;
        case 'lifesteal':
          lifestealPercent += tag.percent * stacks;
          break;
        case 'gold-mult':
          goldAdd += tag.amount * stacks;
          break;
        case 'execute':
          executeThreshold = Math.max(executeThreshold, tag.threshold);
          executeBonus += tag.bonus * stacks;
          break;
        case 'ricochet-add':
          ricochetBounces += tag.bounces * stacks;
          break;
        case 'homing-add':
          homing = true;
          break;
        case 'explosive':
          explosiveRadius = Math.max(explosiveRadius, tag.radiusTiles);
          // 3 stack = 150% damage; kẹp 1 để vụ nổ không mạnh hơn đạn chính.
          explosiveRatio = Math.min(1, explosiveRatio + tag.damageRatio * stacks);
          break;
      }
    }
  }

  return {
    damage: sanitize(base.damage + damageAdd),
    fireRatePerSecond: sanitize(base.fireRatePerSecond * (1 + fireRateAdd)),
    projectiles: Math.max(1, Math.round(sanitize(base.projectiles + projectileAdd))),
    pierce: Math.floor(sanitize(pierce)),
    critChance: clamp01(sanitize(critChance)),
    critMultiplier: Math.max(1, sanitize(critMultiplier)),
    maxHearts: Math.max(1, Math.floor(sanitize(base.playerMaxHearts + heartsAdd))),
    moveSpeedTilesPerSecond: sanitize(base.moveSpeedTilesPerSecond * (1 + moveSpeedAdd)),
    invulnerabilityMs: sanitize(base.invulnerabilityMs * iframeMultiplier),
    lifestealPercent: clamp01(sanitize(lifestealPercent)),
    goldMultiplier: 1 + sanitize(goldAdd),
    executeThreshold: clamp01(sanitize(executeThreshold)),
    executeBonus: sanitize(executeBonus),
    ...(ricochetBounces > 0 ? { ricochetBounces: Math.floor(ricochetBounces) } : {}),
    ...(explosiveRadius > 0
      ? { explosive: { radiusTiles: sanitize(explosiveRadius), damageRatio: explosiveRatio } }
      : {}),
    ...(homing ? { homing: true } : {}),
    ...(slowDurationMs > 0
      ? { slowOnHit: { factor: clamp01(sanitize(slowFactor)), durationMs: sanitize(slowDurationMs) } }
      : {}),
    ...(poisonDps > 0
      ? {
          poisonOnHit: {
            dps: sanitize(poisonDps),
            durationMs: sanitize(poisonDurationMs),
          },
        }
      : {}),
    ...(shieldCharges > 0
      ? {
          shield: {
            charges: Math.floor(shieldCharges),
            cooldownMs: Number.isFinite(shieldCooldownMs) ? Math.max(0, shieldCooldownMs) : 0,
          },
        }
      : {}),
    ...(thornsDamage > 0 ? { thorns: { damage: sanitize(thornsDamage) } } : {}),
    ...(healPerRoom > 0 ? { healPerRoom: sanitize(healPerRoom) } : {}),
  };
}

/**
 * DPS lý thuyết lên **một mục tiêu**, dùng cho test cân bằng và cho tooltip:
 *
 * ```text
 * dps = damage × projectiles × rate × (1 + critChance × (critMultiplier − 1))
 * ```
 *
 * Không tính pierce/ricochet/explosive/execute vì chúng phụ thuộc số enemy và
 * máu enemy — đó là việc của test combat, không phải của một con số ước lượng.
 */
export function estimateDps(stats: DerivedStats): number {
  const critExpectation = 1 + clamp01(stats.critChance) * (Math.max(1, stats.critMultiplier) - 1);
  const dps =
    sanitize(stats.damage) *
    Math.max(1, sanitize(stats.projectiles)) *
    sanitize(stats.fireRatePerSecond) *
    critExpectation;

  return sanitize(dps);
}

/** Số hữu hạn, không âm. NaN/Infinity/âm đều về 0 thay vì lan ra toàn bộ combat. */
function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

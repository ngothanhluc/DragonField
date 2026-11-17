/**
 * Trạng thái bị đòn của enemy: Freeze (làm chậm) và Poison (sát thương theo thời gian).
 *
 * State nhỏ, mutable, mỗi enemy một instance. Toàn bộ luật thời gian nằm ở đây
 * để adapter chỉ gọi `apply`, `speedMultiplier`, `poisonDamage` mỗi frame —
 * không tự đếm giờ ở ba chỗ khác nhau.
 *
 * Số liệu lấy từ `DerivedStats.slowOnHit` / `poisonOnHit`, tức đã cộng dồn stack
 * (2 Poison = 2 dps; 2 Freeze = chậm 40% trong 2 s).
 */
import type { DerivedStats, PoisonOnHit, SlowOnHit } from '../skills/derived-stats';

/** Dưới ngưỡng này coi như hết hiệu lực. */
const EPSILON_MS = 1e-6;

export class StatusEffects {
  private slowUntilMs = Number.NEGATIVE_INFINITY;
  private slowFactor = 1;
  private poisonUntilMs = Number.NEGATIVE_INFINITY;
  private poisonDps = 0;

  /** Áp slow/poison mới. Hiệu ứng mạnh hơn thắng, thời gian không cộng dồn vô hạn. */
  apply(
    stats: Pick<DerivedStats, 'slowOnHit' | 'poisonOnHit'>,
    nowMs: number,
  ): void {
    if (stats.slowOnHit !== undefined) this.applySlow(stats.slowOnHit, nowMs);
    if (stats.poisonOnHit !== undefined) this.applyPoison(stats.poisonOnHit, nowMs);
  }

  applySlow(slow: SlowOnHit, nowMs: number): void {
    if (!(slow.durationMs > 0)) return;
    const factor = Math.max(0, Math.min(1, slow.factor));
    // Cùng lúc: lấy hệ số mạnh nhất, kéo dài tới mốc muộn nhất.
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowUntilMs = Math.max(this.slowUntilMs, nowMs + slow.durationMs);
  }

  applyPoison(poison: PoisonOnHit, nowMs: number): void {
    if (!(poison.durationMs > 0) || !(poison.dps > 0)) return;
    this.poisonDps = Math.max(this.poisonDps, poison.dps);
    this.poisonUntilMs = Math.max(this.poisonUntilMs, nowMs + poison.durationMs);
  }

  /** Hệ số tốc độ hiện tại: 1 = bình thường, 0.6 = chậm 40%. */
  speedMultiplier(nowMs: number): number {
    if (nowMs >= this.slowUntilMs - EPSILON_MS) return 1;
    return this.slowFactor;
  }

  isSlowed(nowMs: number): boolean {
    return this.speedMultiplier(nowMs) < 1;
  }

  isPoisoned(nowMs: number): boolean {
    return nowMs < this.poisonUntilMs - EPSILON_MS && this.poisonDps > 0;
  }

  /**
   * Damage poison trong `deltaMs` vừa trôi. Không vượt quá thời gian còn lại —
   * frame dài không được "ăn" thêm poison sau khi hiệu ứng đã hết.
   */
  poisonDamage(nowMs: number, deltaMs: number): number {
    if (!(deltaMs > 0) || this.poisonDps <= 0) return 0;
    const endMs = Math.min(nowMs + deltaMs, this.poisonUntilMs);
    const activeMs = Math.max(0, endMs - nowMs);
    return (this.poisonDps * activeMs) / 1000;
  }

  /** Xoá sạch khi enemy hồi sinh / đổi phòng. */
  clear(): void {
    this.slowUntilMs = Number.NEGATIVE_INFINITY;
    this.slowFactor = 1;
    this.poisonUntilMs = Number.NEGATIVE_INFINITY;
    this.poisonDps = 0;
  }
}

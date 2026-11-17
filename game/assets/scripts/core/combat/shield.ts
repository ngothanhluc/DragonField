/**
 * Khiên của Shield (GDD §6): chặn N đòn rồi hồi lại sau 20 s.
 *
 * Mô hình: mỗi stack = một charge. Dùng hết charge thì **tất cả** hồi cùng lúc
 * sau `cooldownMs` kể từ đòn bị chặn cuối. Đơn giản, đọc được trên HUD, và
 * không cần bộ đếm riêng cho từng charge.
 *
 * Không import `cc`, không đọc `Date.now`: caller truyền `nowMs` của run.
 */
export class ShieldCharger {
  private ready = 0;
  private readyAtMs = Number.POSITIVE_INFINITY;

  constructor(
    readonly maxCharges: number,
    readonly cooldownMs: number,
  ) {
    if (!Number.isInteger(maxCharges) || maxCharges < 0) {
      throw new Error(`ShieldCharger cần maxCharges là số nguyên >= 0, nhận ${maxCharges}`);
    }
    if (!(cooldownMs >= 0)) {
      throw new Error(`ShieldCharger cần cooldownMs >= 0, nhận ${cooldownMs}`);
    }
    this.ready = maxCharges;
  }

  get charges(): number {
    return this.ready;
  }

  get isFull(): boolean {
    return this.ready >= this.maxCharges;
  }

  /** Hồi charge khi đã đủ thời gian. Gọi mỗi frame; idempotent. */
  update(nowMs: number): void {
    if (this.ready >= this.maxCharges) return;
    if (nowMs >= this.readyAtMs) this.ready = this.maxCharges;
  }

  /**
   * Thử chặn một đòn. Trả `true` khi đòn bị chặn (và tiêu một charge).
   * Charge cuối bị tiêu thì bắt đầu đồng hồ hồi.
   */
  tryBlock(nowMs: number): boolean {
    this.update(nowMs);
    if (this.ready <= 0) return false;

    this.ready -= 1;
    if (this.ready === 0) this.readyAtMs = nowMs + this.cooldownMs;
    return true;
  }

  /** Đặt lại về đầy charge (đổi phòng / nhặt thêm stack). */
  refill(): void {
    this.ready = this.maxCharges;
  }
}

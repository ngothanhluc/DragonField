/**
 * Nhịp bắn. `tick` được gọi mỗi frame với delta ms; trả về true nếu frame đó được bắn.
 *
 * Phần dư được giữ lại (không reset cứng), nên nhịp bắn không trôi khi frame time
 * thay đổi — quan trọng vì game chạy trên web với frame time không ổn định.
 */
export class FireControl {
  private remainingMs = 0;

  constructor(readonly intervalMs: number) {
    if (intervalMs <= 0) {
      throw new Error(`FireControl cần intervalMs > 0, nhận ${intervalMs}`);
    }
  }

  static fromRate(fireRatePerSecond: number): FireControl {
    return new FireControl(1000 / fireRatePerSecond);
  }

  tick(deltaMs: number): boolean {
    this.remainingMs -= deltaMs;
    if (this.remainingMs > 0) return false;

    this.remainingMs += this.intervalMs;
    return true;
  }

  /** Đặt lại để phát tiếp theo xảy ra ngay lập tức. */
  reset(): void {
    this.remainingMs = 0;
  }
}

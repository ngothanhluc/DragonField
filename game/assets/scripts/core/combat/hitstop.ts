/**
 * Hitstop: đóng băng mô phỏng một nhịp ngắn khi đòn trúng (ADR-008: 70 ms), để
 * cú đánh "nặng tay" mà không phải chỉnh gì trong combat.
 *
 * ## Quyết định thiết kế: đóng băng **thời gian mô phỏng**, không đóng băng từng hệ
 *
 * Mọi thứ trong game đều chạy trên **một** đồng hồ `nowMs` do adapter cộng dồn từ
 * `deltaMs` đã kẹp (telegraph, i-frame, cooldown, TTL đạn). Vì vậy hitstop không
 * "tắt" riêng hệ nào: nó trả `0` cho frame bị đóng băng, nên `nowMs` **không tăng**
 * và mọi hệ già đi cùng một nhịp. Không có chuyện telegraph chạy tiếp trong lúc
 * i-frame đứng yên — đó là kiểu desync mà milestone M3 yêu cầu phải tránh.
 *
 * Hệ quả có chủ ý:
 *
 * - Thời gian **thật** trôi qua trong hitstop, thời gian **mô phỏng** thì không.
 *   Run dài hơn đồng hồ tường đúng bằng tổng hitstop; không ảnh hưởng balance vì
 *   mọi thứ đều đo bằng `nowMs`.
 * - Một frame thật dài hơn phần hitstop còn lại **không bị mất**: `step` trả phần
 *   thừa để mô phỏng chạy tiếp ngay trong frame đó.
 * - Nhiều yêu cầu trong lúc đang đóng băng **không cộng dồn** (sẽ thành 140 ms nếu
 *   hai viên đạn trúng liên tiếp); lấy `max` để hitstop luôn đúng "một nhịp".
 *
 * File này không biết engine, không đọc thời gian: caller truyền thời gian thật.
 */
export class HitstopClock {
  private remainingMs = 0;

  constructor(readonly defaultDurationMs: number) {
    if (!Number.isFinite(defaultDurationMs) || defaultDurationMs < 0) {
      throw new Error(`HitstopClock cần duration hữu hạn >= 0, nhận ${defaultDurationMs}`);
    }
  }

  /** Thời gian đóng băng còn lại, ms (0 = đang chạy bình thường). */
  get remaining(): number {
    return this.remainingMs;
  }

  get isFrozen(): boolean {
    return this.remainingMs > 0;
  }

  /**
   * Yêu cầu đóng băng. Đang đóng băng thì lấy **max** (không cộng dồn); tham số
   * mặc định là `defaultDurationMs`.
   */
  request(durationMs: number = this.defaultDurationMs): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(`HitstopClock.request cần ms hữu hạn >= 0, nhận ${durationMs}`);
    }
    if (durationMs > this.remainingMs) this.remainingMs = durationMs;
  }

  /**
   * Ăn `realDeltaMs` thời gian thật, trả về **thời gian mô phỏng** được chạy
   * trong frame này (0 khi vừa đóng băng hết frame).
   */
  step(realDeltaMs: number): number {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) {
      throw new Error(`HitstopClock.step cần deltaMs hữu hạn >= 0, nhận ${realDeltaMs}`);
    }
    if (this.remainingMs <= 0) return realDeltaMs;

    const consumed = Math.min(this.remainingMs, realDeltaMs);
    this.remainingMs -= consumed;
    // Đóng băng hết frame này; frame sau chạy tiếp với phần chưa bị "ăn".
    return realDeltaMs - consumed;
  }

  /** Bỏ mọi đóng băng đang chờ (đổi phòng, về menu). */
  reset(): void {
    this.remainingMs = 0;
  }
}

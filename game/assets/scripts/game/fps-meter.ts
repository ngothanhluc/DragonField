/**
 * Đo fps/frame time thật của vòng lặp game cho debug `?debug=1`.
 *
 * Tách khỏi bootstrap: chỉ là ring buffer N frame và một phép chia. Dùng frame
 * thật (trước khi kẹp `MAX_STEP_MS`) để số đo không bị "đẹp hoá" khi tab bị ẩn.
 */
const SAMPLE_COUNT = 120;

export class FpsMeter {
  private readonly frameTimesMs: number[] = [];

  record(frameMs: number): void {
    this.frameTimesMs.push(Math.max(0, frameMs));
    if (this.frameTimesMs.length > SAMPLE_COUNT) this.frameTimesMs.shift();
  }

  info(): { readonly fps: number; readonly frameMs: number; readonly samples: number } {
    const samples = this.frameTimesMs.length;
    if (samples === 0) return { fps: 0, frameMs: 0, samples: 0 };

    let total = 0;
    for (const frameMs of this.frameTimesMs) total += frameMs;
    const frameMs = total / samples;
    return { fps: frameMs > 0 ? 1000 / frameMs : 0, frameMs, samples };
  }

  clear(): void {
    this.frameTimesMs.length = 0;
  }
}

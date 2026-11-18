/**
 * Measure real fps/frame time of the game loop for the `?debug=1` debug hook.
 *
 * Split from bootstrap: just a ring buffer of N frames and one division. Uses real frame times
 * (before the `MAX_STEP_MS` cap) so the numbers are not prettified while the tab is hidden.
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

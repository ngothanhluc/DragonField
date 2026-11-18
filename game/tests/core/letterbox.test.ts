import { describe, expect, it } from 'vitest';
import { letterboxRect, pixelPerfectRect, worldToUiScale } from '../../assets/scripts/core/view/letterbox';

const DESIGN_WIDTH = 512;
const DESIGN_HEIGHT = 288;
const DESIGN_ASPECT = DESIGN_WIDTH / DESIGN_HEIGHT;

/** px/unit of the rect applied to the canvas — must be equal on both axes (square pixels). */
function pxPerUnit(rect: { width: number; height: number }, canvasWidth: number, canvasHeight: number) {
  return {
    x: (rect.width * canvasWidth) / DESIGN_WIDTH,
    y: (rect.height * canvasHeight) / DESIGN_HEIGHT,
  };
}

describe('letterboxRect', () => {
  it('a 16:9 canvas fills the whole canvas with the band', () => {
    const rect = letterboxRect(1280, 720, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('a 4:3 canvas letterboxes top and bottom, the band fills the full width', () => {
    // 1280×960: scale = 1280/512 = 2.5 (smaller than 960/288) → band 1280×720.
    const rect = letterboxRect(1280, 960, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1, 10);
    expect(rect.height).toBeCloseTo(0.75, 10);
    expect(rect.x).toBeCloseTo(0, 10);
    expect(rect.y).toBeCloseTo(0.125, 10);
  });

  it('a 21:9 canvas pillarboxes the sides, the band fills the full height', () => {
    // 2520×1080: scale = 1080/288 = 3.75 → band 1920×1080.
    const rect = letterboxRect(2520, 1080, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1920 / 2520, 10);
    expect(rect.height).toBeCloseTo(1, 10);
    expect(rect.x).toBeCloseTo((1 - 1920 / 2520) / 2, 10);
    expect(rect.y).toBeCloseTo(0, 10);
  });

  it('a portrait canvas (800×1000) still keeps the 16:9 ratio and stays centred', () => {
    const rect = letterboxRect(800, 1000, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1, 10);
    expect(rect.height).toBeCloseTo((288 * (800 / 512)) / 1000, 10);
    expect(rect.x).toBeCloseTo(0, 10);
    expect(rect.y).toBeCloseTo((1 - rect.height) / 2, 10);
  });

  it('for any ratio: square pixels and the rect stays inside the canvas', () => {
    const canvases: ReadonlyArray<readonly [number, number]> = [
      [640, 480],
      [1280, 720],
      [1024, 768],
      [2560, 1080],
      [800, 1000],
      [1440, 900],
      [1366, 768],
    ];

    for (const [width, height] of canvases) {
      const rect = letterboxRect(width, height, DESIGN_WIDTH, DESIGN_HEIGHT);
      const px = pxPerUnit(rect, width, height);

      expect(px.x).toBeCloseTo(px.y, 10);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1);
      // The band always fills one axis (never smaller than the design on both axes).
      expect(Math.max(rect.width, rect.height)).toBeCloseTo(1, 10);
      // The band has exactly the design ratio.
      expect((rect.width * width) / (rect.height * height)).toBeCloseTo(DESIGN_ASPECT, 10);
    }
  });

  it('invalid sizes return the whole canvas instead of NaN', () => {
    expect(letterboxRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(letterboxRect(1280, 720, 0, DESIGN_HEIGHT)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('pixelPerfectRect', () => {
  function px(rect: { x: number; y: number; width: number; height: number }, w: number, h: number) {
    return { x: rect.x * w, y: rect.y * h, width: rect.width * w, height: rect.height * h };
  }

  it('1920×1080 → ×3 = 1536×864, centred on whole pixels', () => {
    const rect = px(pixelPerfectRect(1920, 1080, DESIGN_WIDTH, DESIGN_HEIGHT), 1920, 1080);
    expect(rect.width).toBeCloseTo(1536, 6);
    expect(rect.height).toBeCloseTo(864, 6);
    expect(rect.x).toBeCloseTo(192, 6);
    expect(rect.y).toBeCloseTo(108, 6);
  });

  it('1280×720 → ×2, 2048×1152 → ×4, 1024×768 (4:3) → ×2', () => {
    expect(px(pixelPerfectRect(1280, 720, DESIGN_WIDTH, DESIGN_HEIGHT), 1280, 720).width).toBeCloseTo(1024, 6);
    expect(px(pixelPerfectRect(2048, 1152, DESIGN_WIDTH, DESIGN_HEIGHT), 2048, 1152).width).toBeCloseTo(2048, 6);
    expect(px(pixelPerfectRect(1024, 768, DESIGN_WIDTH, DESIGN_HEIGHT), 1024, 768).height).toBeCloseTo(576, 6);
  });

  it('odd sizes: margins round down to whole pixels', () => {
    const rect = px(pixelPerfectRect(1601, 901, DESIGN_WIDTH, DESIGN_HEIGHT), 1601, 901);
    expect(Number.isInteger(Math.round(rect.x * 1e6) / 1e6)).toBe(true);
    expect(rect.x).toBeCloseTo(32, 6); // (1601 − 1536) / 2 = 32.5 → 32
    expect(rect.y).toBeCloseTo(18, 6); // (901 − 864) / 2 = 18.5 → 18
  });

  it('a canvas smaller than the design falls back to regular letterboxing', () => {
    expect(pixelPerfectRect(400, 300, DESIGN_WIDTH, DESIGN_HEIGHT)).toEqual(
      letterboxRect(400, 300, DESIGN_WIDTH, DESIGN_HEIGHT),
    );
  });
});

describe('worldToUiScale', () => {
  it('1920×1080: world ×3 trong band UI ×3.75 → 0.8', () => {
    expect(worldToUiScale(1920, 1080, DESIGN_WIDTH, DESIGN_HEIGHT)).toBeCloseTo(0.8, 10);
  });

  it('a canvas that is an exact multiple → 1', () => {
    expect(worldToUiScale(1536, 864, DESIGN_WIDTH, DESIGN_HEIGHT)).toBeCloseTo(1, 10);
  });
});

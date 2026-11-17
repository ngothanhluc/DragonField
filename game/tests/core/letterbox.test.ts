import { describe, expect, it } from 'vitest';
import { letterboxRect, pixelPerfectRect, worldToUiScale } from '../../assets/scripts/core/view/letterbox';

const DESIGN_WIDTH = 512;
const DESIGN_HEIGHT = 288;
const DESIGN_ASPECT = DESIGN_WIDTH / DESIGN_HEIGHT;

/** px/unit của rect khi áp lên canvas — phải bằng nhau ở hai trục (pixel vuông). */
function pxPerUnit(rect: { width: number; height: number }, canvasWidth: number, canvasHeight: number) {
  return {
    x: (rect.width * canvasWidth) / DESIGN_WIDTH,
    y: (rect.height * canvasHeight) / DESIGN_HEIGHT,
  };
}

describe('letterboxRect', () => {
  it('canvas đúng 16:9 thì band phủ kín canvas', () => {
    const rect = letterboxRect(1280, 720, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('canvas 4:3 thì letterbox trên dưới, band phủ hết chiều rộng', () => {
    // 1280×960: scale = 1280/512 = 2.5 (nhỏ hơn 960/288) → band 1280×720.
    const rect = letterboxRect(1280, 960, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1, 10);
    expect(rect.height).toBeCloseTo(0.75, 10);
    expect(rect.x).toBeCloseTo(0, 10);
    expect(rect.y).toBeCloseTo(0.125, 10);
  });

  it('canvas 21:9 thì pillarbox hai bên, band phủ hết chiều cao', () => {
    // 2520×1080: scale = 1080/288 = 3.75 → band 1920×1080.
    const rect = letterboxRect(2520, 1080, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1920 / 2520, 10);
    expect(rect.height).toBeCloseTo(1, 10);
    expect(rect.x).toBeCloseTo((1 - 1920 / 2520) / 2, 10);
    expect(rect.y).toBeCloseTo(0, 10);
  });

  it('canvas dọc (800×1000) vẫn giữ đúng tỉ lệ 16:9 và canh giữa', () => {
    const rect = letterboxRect(800, 1000, DESIGN_WIDTH, DESIGN_HEIGHT);
    expect(rect.width).toBeCloseTo(1, 10);
    expect(rect.height).toBeCloseTo((288 * (800 / 512)) / 1000, 10);
    expect(rect.x).toBeCloseTo(0, 10);
    expect(rect.y).toBeCloseTo((1 - rect.height) / 2, 10);
  });

  it('mọi tỉ lệ: pixel vuông và rect nằm trong canvas', () => {
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
      // Band luôn phủ hết một trục (không bao giờ nhỏ hơn design ở cả hai trục).
      expect(Math.max(rect.width, rect.height)).toBeCloseTo(1, 10);
      // Band có đúng tỉ lệ design.
      expect((rect.width * width) / (rect.height * height)).toBeCloseTo(DESIGN_ASPECT, 10);
    }
  });

  it('kích thước không hợp lệ thì trả về cả canvas thay vì NaN', () => {
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

  it('1920×1080 → ×3 = 1536×864, canh giữa đúng pixel nguyên', () => {
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

  it('kích thước lẻ: lề làm tròn xuống pixel nguyên', () => {
    const rect = px(pixelPerfectRect(1601, 901, DESIGN_WIDTH, DESIGN_HEIGHT), 1601, 901);
    expect(Number.isInteger(Math.round(rect.x * 1e6) / 1e6)).toBe(true);
    expect(rect.x).toBeCloseTo(32, 6); // (1601 − 1536) / 2 = 32.5 → 32
    expect(rect.y).toBeCloseTo(18, 6); // (901 − 864) / 2 = 18.5 → 18
  });

  it('canvas nhỏ hơn design thì lùi về letterbox thường', () => {
    expect(pixelPerfectRect(400, 300, DESIGN_WIDTH, DESIGN_HEIGHT)).toEqual(
      letterboxRect(400, 300, DESIGN_WIDTH, DESIGN_HEIGHT),
    );
  });
});

describe('worldToUiScale', () => {
  it('1920×1080: world ×3 trong band UI ×3.75 → 0.8', () => {
    expect(worldToUiScale(1920, 1080, DESIGN_WIDTH, DESIGN_HEIGHT)).toBeCloseTo(0.8, 10);
  });

  it('canvas đúng bội số nguyên → 1', () => {
    expect(worldToUiScale(1536, 864, DESIGN_WIDTH, DESIGN_HEIGHT)).toBeCloseTo(1, 10);
  });
});

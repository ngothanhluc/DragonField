/**
 * Letterbox geometry for screens of any aspect ratio.
 *
 * The game has exactly one correct "frame": 512×288 (32×18 tiles of 16 px). On a 4:3, 21:9 or
 * portrait canvas that frame must be **exactly fitting, centred, uniformly scaled** (square pixels), with the
 * remainder as dark bars. `Camera.rect` takes a rect normalised to the canvas, so all the maths
 * lives here (pure arithmetic, tested with vitest, no `cc` import).
 */

/** Rect normalised to the canvas: (0,0) = bottom-left, (1,1) = top-right. */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Canvas has no size yet (first frame, resize in progress) → use the whole canvas, no letterbox. */
const FULL_CANVAS: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Rect (normalised) the design resolution occupies on the canvas: keeps the design ratio,
 * scales uniformly by the shorter side, centred on both axes.
 *
 * Same formula as `ResolutionPolicy.SHOW_ALL` (`ContentStrategy.ShowAll` in
 * `cocos/ui/view.ts`), so a world camera using this rect lines up exactly with the UI band.
 */
export function letterboxRect(
  canvasWidth: number,
  canvasHeight: number,
  designWidth: number,
  designHeight: number,
): NormalizedRect {
  if (!(canvasWidth > 0 && canvasHeight > 0 && designWidth > 0 && designHeight > 0)) {
    return FULL_CANVAS;
  }

  const scale = Math.min(canvasWidth / designWidth, canvasHeight / designHeight);
  const width = (designWidth * scale) / canvasWidth;
  const height = (designHeight * scale) / canvasHeight;

  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/**
 * **Pixel-perfect** band for the world camera: scale the design up by the largest integer
 * multiple that still fits the canvas (512×288 × 2/3/4…), centred, margins rounded to whole
 * pixels so every 16 px texel maps to exactly k×k screen pixels (never a half pixel).
 *
 * If the canvas is smaller than the design (k < 1) no integer multiple fits: fall back to
 * `letterboxRect` (a fractional scale beats cropping).
 */
export function pixelPerfectRect(
  canvasWidth: number,
  canvasHeight: number,
  designWidth: number,
  designHeight: number,
): NormalizedRect {
  if (!(canvasWidth > 0 && canvasHeight > 0 && designWidth > 0 && designHeight > 0)) {
    return FULL_CANVAS;
  }

  const scale = Math.floor(Math.min(canvasWidth / designWidth, canvasHeight / designHeight));
  if (scale < 1) return letterboxRect(canvasWidth, canvasHeight, designWidth, designHeight);

  const widthPx = designWidth * scale;
  const heightPx = designHeight * scale;
  const leftPx = Math.floor((canvasWidth - widthPx) / 2);
  const bottomPx = Math.floor((canvasHeight - heightPx) / 2);

  return {
    x: leftPx / canvasWidth,
    y: bottomPx / canvasHeight,
    width: widthPx / canvasWidth,
    height: heightPx / canvasHeight,
  };
}

/**
 * Ratio of the world band (pixel-perfect) to the UI band (`SHOW_ALL`), ≤ 1.
 *
 * The HUD is built along the design edge of the UI band; multiplying HUD nodes by this makes the HUD
 * edge follow the room edge instead of drifting into the bar area when the world is smaller than the UI band.
 */
export function worldToUiScale(
  canvasWidth: number,
  canvasHeight: number,
  designWidth: number,
  designHeight: number,
): number {
  const ui = letterboxRect(canvasWidth, canvasHeight, designWidth, designHeight);
  const world = pixelPerfectRect(canvasWidth, canvasHeight, designWidth, designHeight);
  if (ui.width <= 0) return 1;
  return world.width / ui.width;
}

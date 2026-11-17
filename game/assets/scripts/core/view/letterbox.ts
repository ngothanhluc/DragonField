/**
 * Hình học letterbox cho màn hình có tỉ lệ bất kỳ.
 *
 * Game chỉ có một "khung" đúng: 512×288 (32×18 tile 16 px). Trên canvas 4:3, 21:9 hay
 * canvas dọc, khung đó phải **vừa khít, canh giữa, scale đều** (pixel vuông), phần thừa
 * là bar tối. `Camera.rect` nhận rect chuẩn hoá theo canvas, nên toàn bộ phần tính toán
 * nằm ở đây (thuần số học, test bằng vitest, không import `cc`).
 */

/** Rect chuẩn hoá theo canvas: (0,0) = góc dưới-trái, (1,1) = góc trên-phải. */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Canvas chưa có kích thước (frame đầu, resize dở) → dùng cả canvas, không letterbox. */
const FULL_CANVAS: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Rect (chuẩn hoá) mà design resolution chiếm trên canvas: giữ đúng tỉ lệ design,
 * scale đều theo cạnh nhỏ hơn, canh giữa cả hai trục.
 *
 * Cùng công thức với `ResolutionPolicy.SHOW_ALL` (`ContentStrategy.ShowAll` trong
 * `cocos/ui/view.ts`), nên camera world dùng rect này sẽ trùng khít band của UI.
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
 * Band **pixel-perfect** cho camera world: phóng design lên bội số nguyên lớn nhất
 * còn vừa canvas (512×288 × 2/3/4…), canh giữa, lề làm tròn về pixel nguyên để
 * mỗi texel 16 px luôn thành đúng k×k pixel màn hình (không lệch nửa pixel).
 *
 * Canvas nhỏ hơn design (k < 1) thì không có bội số nguyên nào vừa: lùi về
 * `letterboxRect` (scale lẻ còn hơn bị cắt).
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
 * Tỉ lệ band world (pixel-perfect) so với band UI (`SHOW_ALL`), ≤ 1.
 *
 * HUD dựng theo mép design của band UI; nhân node HUD với số này thì mép HUD
 * trùng mép phòng thay vì trôi ra vùng bar khi world nhỏ hơn band UI.
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

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

/**
 * Font pixel của pack (`NormalFont.ttf`) cho **mọi** label UI.
 *
 * `createLabel` là sync, còn load font là async — nên label được tạo bằng font hệ
 * thống trước, rồi đổi sang font pixel ngay khi clip về (cùng một promise cho cả
 * scene). Font chỉ dùng pixel-perfect khi cỡ chữ là số nguyên, nên các màn M5
 * giữ cỡ 9–30.
 */
import { Font as CocosFont, resources, warn } from 'cc';
import type { Label as CocosLabel } from 'cc';

type Font = InstanceType<typeof CocosFont>;
type Label = InstanceType<typeof CocosLabel>;

const FONT_PATH = 'art/ui/fonts/NormalFont';

let loaded: Font | null = null;
let promise: Promise<Font> | null = null;
let warned = false;

function ensureFont(): Promise<Font> {
  if (loaded !== null) return Promise.resolve(loaded);
  if (promise !== null) return promise;

  promise = new Promise<Font>((resolve, reject) => {
    resources.load(FONT_PATH, CocosFont, (err: Error | null, font: Font | null) => {
      if (err || !font) {
        reject(new Error(`Không load được font "${FONT_PATH}": ${err?.message ?? 'font rỗng'}`));
        return;
      }
      loaded = font;
      resolve(font);
    });
  });
  promise.catch(() => {
    if (!warned) {
      warned = true;
      warn(`[YokaiField] Font pixel lỗi — label giữ font hệ thống.`);
    }
  });
  return promise;
}

/** Gán font pixel cho label; an toàn khi label đã bị destroy. */
export function applyPixelFont(label: Label): void {
  if (loaded !== null) {
    setFont(label, loaded);
    return;
  }

  void ensureFont()
    .then((font) => {
      if (label.isValid) setFont(label, font);
    })
    .catch(() => undefined);
}

function setFont(label: Label, font: Font): void {
  label.useSystemFont = false;
  label.font = font;
  // Đổi font đổi metrics: label wrap/RESIZE_HEIGHT phải layout lại.
  label.updateRenderData?.(true);
}

/** Chỉ dùng test/dev: biết font đã load chưa. */
export function pixelFontReady(): boolean {
  return loaded !== null;
}

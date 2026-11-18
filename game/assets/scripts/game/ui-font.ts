/**
 * The pack's pixel font (`NormalFont.ttf`) for **every** UI label.
 *
 * `createLabel` is sync while loading a font is async — so labels are created with the system
 * font first, then switch to the pixel font as soon as the clip arrives (one promise per
 * scene). The font is only pixel-perfect at integer sizes, so M5 screens keep sizes at 9–30.
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
        reject(new Error(`Could not load font "${FONT_PATH}": ${err?.message ?? 'empty font'}`));
        return;
      }
      loaded = font;
      resolve(font);
    });
  });
  promise.catch(() => {
    if (!warned) {
      warned = true;
      warn(`[YokaiField] Pixel font failed — labels keep the system font.`);
    }
  });
  return promise;
}

/** Assign the pixel font to a label; safe when the label is already destroyed. */
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
  // A font change changes metrics: wrapping/RESIZE_HEIGHT labels must relayout.
  label.updateRenderData?.(true);
}

/** Test/dev only: whether the font has loaded. */
export function pixelFontReady(): boolean {
  return loaded !== null;
}

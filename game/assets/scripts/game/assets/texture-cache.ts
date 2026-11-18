/**
 * `Texture2D` cache keyed by sheet.
 *
 * Each PNG under `assets/resources/art/**` imports as one texture (sub-asset `<path>/texture`).
 * Many animation keys share one sheet (`player.idle.down/up/left/right`), so loading must
 * de-duplicate both in flight and after completion: 94 PNG files, never reload per animation change.
 */
import { resources, Texture2D as CocosTexture2D } from 'cc';
import { toResourcesPath } from '../../core/art/runtime';
/**
 * The `types/cc.d.ts` stub declares `cc` as empty, so names imported from `cc` are namespaces
 * and cannot be used in type position. `InstanceType` keeps the meaning (with the engine's real
 * types this is exactly `Texture2D`) while still passing `tsc` in this repo.
 */
type Texture2D = InstanceType<typeof CocosTexture2D>;

/** Promises instead of textures: a second caller during loading gets the in-flight promise. */
const textures = new Map<string, Promise<Texture2D>>();

/**
 * Load the texture of one sheet (path exactly as written in the manifest).
 * Throws an `Error` naming both the sheet and the resources path — the first thing to read when
 * art imports wrong (Type = `texture` instead of `sprite-frame`, missing file, wrong folder name).
 */
export function loadTexture(sheet: string): Promise<Texture2D> {
  const cached = textures.get(sheet);
  if (cached !== undefined) {
    return cached;
  }

  const path = toResourcesPath(sheet);
  const task = new Promise<Texture2D>((resolve, reject) => {
    resources.load(
      `${path}/texture`,
      CocosTexture2D,
      (err: Error | null, texture: Texture2D | null) => {
        if (err || !texture) {
          const cause = err ? err.message : 'no texture returned';
          reject(
            new Error(
              `Could not load the texture for sheet "${sheet}" (resources: "${path}/texture"). ` +
                `Check that the PNG is imported with Type = sprite-frame and at the right path. Cause: ${cause}`,
            ),
          );
          return;
        }
        resolve(texture);
      },
    );
  });

  textures.set(sheet, task);
  // Pixel art: every world/UI texture loaded here is NEAREST. Before M6 only UI used this;
  // world art was bilinear, so 16 px scaled up looked blurry.
  task
    .then((texture) => {
      texture.setFilters(CocosTexture2D.Filter.NEAREST, CocosTexture2D.Filter.NEAREST);
    })
    .catch(() => undefined);
  // On failure, drop it from the cache so a later attempt can retry (only successful loads are permanent).
  task.catch(() => {
    if (textures.get(sheet) === task) {
      textures.delete(sheet);
    }
  });
  return task;
}

/** Preload several sheets (used by the chapter start loading screen). Duplicate sheets load once. */
export function preloadSheets(sheets: readonly string[]): Promise<void> {
  return Promise.all(Array.from(new Set(sheets), (sheet) => loadTexture(sheet))).then(() => undefined);
}

/**
 * Like `loadTexture` but forces **NEAREST** filtering for pixel-art UI.
 *
 * Imported assets default to bilinear, so a 16×8 wooden button scaled to 300×38 and skill
 * cards come out blurry. UI frames/cards/chapter buttons use this; world art keeps
 * `loadTexture` for M6 to decide separately.
 */
export function loadPixelTexture(sheet: string): Promise<Texture2D> {
  return loadTexture(sheet).then((texture) => {
    texture.setFilters(CocosTexture2D.Filter.NEAREST, CocosTexture2D.Filter.NEAREST);
    return texture;
  });
}

/** Clear the cache — test/dev only; textures are not destroyed because live sprites may still use them. */
export function clearTextureCache(): void {
  textures.clear();
}

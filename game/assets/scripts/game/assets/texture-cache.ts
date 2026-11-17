/**
 * Cache `Texture2D` theo sheet.
 *
 * Mỗi PNG trong `assets/resources/art/**` import thành 1 texture (sub-asset `<path>/texture`).
 * Nhiều animation key dùng chung một sheet (`player.idle.down/up/left/right`), nên load phải
 * de-dup cả lúc đang bay lẫn sau khi xong: 94 file PNG, không được load lại mỗi lần đổi animation.
 */
import { resources, Texture2D as CocosTexture2D } from 'cc';
import { toResourcesPath } from '../../core/art/runtime';
/**
 * `types/cc.d.ts` stub khai báo `cc` rỗng nên tên import từ `cc` là namespace, không dùng được ở
 * vị trí type. `InstanceType` giữ nguyên nghĩa (khi có type thật của engine thì đây chính là
 * `Texture2D`) mà vẫn qua được `tsc` trong repo.
 */
type Texture2D = InstanceType<typeof CocosTexture2D>;

/** Promise thay vì texture: caller thứ hai trong lúc load nhận đúng promise đang bay. */
const textures = new Map<string, Promise<Texture2D>>();

/**
 * Load texture của một sheet (đường dẫn y nguyên trong manifest).
 * Ném `Error` nêu cả tên sheet lẫn path resources — đây là thứ đầu tiên người ta đọc khi art
 * import sai (Type = `texture` thay vì `sprite-frame`, thiếu file, sai tên thư mục).
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
          const cause = err ? err.message : 'không trả về texture';
          reject(
            new Error(
              `Không load được texture cho sheet "${sheet}" (resources: "${path}/texture"). ` +
                `Kiểm tra PNG đã import với Type = sprite-frame và đúng đường dẫn chưa. Nguyên nhân: ${cause}`,
            ),
          );
          return;
        }
        resolve(texture);
      },
    );
  });

  textures.set(sheet, task);
  // Pixel art: mọi texture world/UI load qua đây đều NEAREST. Trước M6 chỉ UI dùng;
  // world art vẫn bilinear nên 16 px phóng lên bị nhoè.
  task
    .then((texture) => {
      texture.setFilters(CocosTexture2D.Filter.NEAREST, CocosTexture2D.Filter.NEAREST);
    })
    .catch(() => undefined);
  // Load hỏng thì bỏ khỏi cache để lần sau còn thử lại (cache chỉ vĩnh viễn khi thành công).
  task.catch(() => {
    if (textures.get(sheet) === task) {
      textures.delete(sheet);
    }
  });
  return task;
}

/** Load trước nhiều sheet (dùng ở màn load đầu chapter). Sheet trùng chỉ load một lần. */
export function preloadSheets(sheets: readonly string[]): Promise<void> {
  return Promise.all(Array.from(new Set(sheets), (sheet) => loadTexture(sheet))).then(() => undefined);
}

/**
 * Như `loadTexture` nhưng ép lọc **NEAREST** cho pixel-art UI.
 *
 * Mặc định asset import là bilinear, nên nút gỗ 16×8 phóng lên 300×38 và thẻ
 * skill bị nhoè. UI frame/thẻ/chapter button dùng hàm này; world art giữ đường
 * `loadTexture` để M6 quyết riêng.
 */
export function loadPixelTexture(sheet: string): Promise<Texture2D> {
  return loadTexture(sheet).then((texture) => {
    texture.setFilters(CocosTexture2D.Filter.NEAREST, CocosTexture2D.Filter.NEAREST);
    return texture;
  });
}

/** Xoá cache — chỉ dùng cho test/dev; không destroy texture vì sprite đang dùng có thể còn sống. */
export function clearTextureCache(): void {
  textures.clear();
}

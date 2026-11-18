/**
 * Manifest animation — nguồn duy nhất cho đường dẫn sprite.
 *
 * Code game chỉ tham chiếu animation bằng key logic (`player.idle.down`), không bao giờ ghép
 * đường dẫn file. Dữ liệu thật nằm ở `assets/resources/data/animations.json`; module này giữ type,
 * validate và tra cứu. Thuần TS: không import `cc`, test được bằng vitest.
 *
 * Key: `<actor>.<animation>.<direction>` cho animation có hướng (`player.walk.left`),
 * `<actor>.<animation>` cho animation không hướng (`player.dead`, `tengu.trans`).
 *
 * Cách cắt sheet (pack không có atlas JSON, mọi sheet đều cắt theo grid):
 * - `layout: "grid"`: **cột = direction** theo đúng thứ tự `directions` (pack dùng D/U/L/R),
 *   **hàng = frame**. Ví dụ Idle.png 128×128, frame 32×32, 4 directions = 4 cột × 4 hàng.
 *   Sheet một cột (Dead.png 32×64) cũng là grid với `directions: []`.
 * - `layout: "strip"`: một hàng duy nhất, frame chạy từ trái sang phải (sheet boss).
 *
 * `sheet` là đường dẫn tương đối so với `game/assets/` (ví dụ `art/characters/ninja-green/Idle.png`),
 * KHÔNG phải đường dẫn trong pack gốc: pack nằm ở `art-source/` và bị gitignore, chỉ subset
 * dùng thật mới được copy vào `game/assets/art/`.
 */

/** 4 hướng có art thật trong pack. */
export type Direction = 'down' | 'up' | 'left' | 'right';

/** Thứ tự cột chuẩn của pack Ninja Adventure: D / U / L / R. */
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

/** Cách đọc sheet: xem mô tả đầu file. */
export type SheetLayout = 'grid' | 'strip';

/** Một animation đã cắt được từ sheet. */
export interface SpriteEntry {
  /** Đường dẫn tương đối so với `game/assets/`. */
  readonly sheet: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly layout: SheetLayout;
  /** Rỗng khi animation không có hướng. */
  readonly directions: readonly Direction[];
  /** Số frame của **một** direction (hoặc tổng số frame nếu không hướng). */
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  /**
   * Cách neo frame vào node: actor đứng bằng **chân** (`feet`), FX nổ giữa
   * (`center`). Mặc định `feet` khi entry cũ chưa khai.
   */
  readonly anchor: SpriteAnchor;
  /**
   * Số pixel trong suốt từ đáy frame tới pixel đặc thấp nhất (đọc từ PNG).
   * `SpriteAnimator` dùng `footPx / frameHeight` làm anchor dọc, nên frame
   * 96×48 và 96×96 vẫn đặt chân lên cùng một đường.
   */
  readonly footPx: number;
}

/** Cách neo một sprite vào node. */
export type SpriteAnchor = 'feet' | 'center';


/** Nội dung `assets/resources/data/animations.json` sau khi validate. */
export interface AnimationManifest {
  readonly version: number;
  readonly sprites: Readonly<Record<string, SpriteEntry>>;
}

/** Phiên bản schema mà module này hiểu. */
export const MANIFEST_VERSION = 1;

/**
 * Định dạng key hợp lệ: các segment `[a-z0-9-]` nối bằng dấu chấm, ít nhất 2 segment.
 * Cấm chữ hoa, khoảng trắng, gạch dưới, `/` để key không thể trượt thành đường dẫn file.
 */
export const ANIMATION_KEY_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/**
 * Key bắt buộc của M6, gom theo actor. Test dùng bảng này để chứng minh **mỗi
 * vai trò** có đủ bộ animation tối thiểu, không chỉ "manifest có nhiều key".
 */
export const REQUIRED_ACTOR_ANIMATIONS: Readonly<Record<string, readonly string[]>> = {
  player: [
    ...DIRECTIONS.map((dir) => `player.idle.${dir}`),
    ...DIRECTIONS.map((dir) => `player.walk.${dir}`),
    ...DIRECTIONS.map((dir) => `player.attack.${dir}`),
    ...DIRECTIONS.map((dir) => `player.hit.${dir}`),
    ...DIRECTIONS.map((dir) => `player.roll.${dir}`),
    'player.dead',
  ],
  bluebat: monsterAnimations('bluebat'),
  spiderred: monsterAnimations('spiderred'),
  snake3: monsterAnimations('snake3'),
  eye: monsterAnimations('eye'),
  greenoctopus: monsterAnimations('greenoctopus'),
  lanternred: monsterAnimations('lanternred'),
  bear: monsterAnimations('bear'),
  trex: monsterAnimations('trex'),
  cyclope: monsterAnimations('cyclope'),
  tengu: ['tengu.idle', 'tengu.walk', 'tengu.attack', 'tengu.hit', 'tengu.trans'],
  squid: [
    'squid.idle',
    'squid.walk',
    'squid.attack',
    'squid.attack-loop',
    'squid.shoot',
    'squid.hit',
  ],
  samurai: [
    'samurai.idle',
    'samurai.walk',
    'samurai.attack.left',
    'samurai.attack.right',
    'samurai.charge.left',
    'samurai.charge.right',
    'samurai.hit',
  ],
  fx: [
    'fx.shuriken',
    'fx.coin',
    'fx.energy-ball',
    'fx.impact',
    'fx.explosion',
    'fx.smoke',
    'fx.shield',
    'fx.ice',
    'fx.poison',
  ],
};

function monsterAnimations(actor: string): readonly string[] {
  return [
    ...DIRECTIONS.map((dir) => `${actor}.idle.${dir}`),
    ...DIRECTIONS.map((dir) => `${actor}.walk.${dir}`),
  ];
}

/** Danh sách phẳng của mọi key bắt buộc — dùng cho test "resolve được". */
export const REQUIRED_KEYS: readonly string[] = Object.values(REQUIRED_ACTOR_ANIMATIONS).flat();

/** Một key bắt buộc. */
export type RequiredKey = string;


/**
 * Validate JSON thô và trả manifest đã chuẩn hoá.
 * Ném **một** `Error` liệt kê **toàn bộ** lỗi tìm được, không dừng ở lỗi đầu tiên.
 */
export function validateManifest(raw: unknown): AnimationManifest {
  const problems: string[] = [];

  if (!isRecord(raw)) {
    throw new Error(formatProblems([`root phải là object, nhận ${describeValue(raw)}`]));
  }

  if (raw['version'] !== MANIFEST_VERSION) {
    problems.push(`version phải là ${MANIFEST_VERSION}, nhận ${describeValue(raw['version'])}`);
  }

  const spritesRaw = raw['sprites'];
  if (!isRecord(spritesRaw)) {
    problems.push(`sprites phải là object map key → entry, nhận ${describeValue(spritesRaw)}`);
    // Không có gì để duyệt tiếp: ném luôn nhưng vẫn kèm lỗi version nếu có.
    throw new Error(formatProblems(problems));
  }

  const keys = Object.keys(spritesRaw);
  if (keys.length === 0) {
    problems.push('sprites rỗng: cần ít nhất một animation');
  }

  const sprites: Record<string, SpriteEntry> = {};
  for (const key of keys) {
    const entry = validateEntry(key, spritesRaw[key], problems);
    if (entry !== undefined) {
      sprites[key] = entry;
    }
  }

  if (problems.length > 0) {
    throw new Error(formatProblems(problems));
  }

  return { version: MANIFEST_VERSION, sprites };
}

/**
 * Tra một key. Ưu tiên key chính; nếu không có thì dùng `fallbackKey` (theo quy tắc
 * "pack thiếu thì khai báo fallback" trong AGENTS.md). Không có cả hai thì ném lỗi kèm gợi ý.
 */
export function resolve(
  manifest: AnimationManifest,
  key: string,
  fallbackKey?: string,
): SpriteEntry {
  if (key.length === 0) {
    throw new Error('resolve: key rỗng.');
  }

  const direct = manifest.sprites[key];
  if (direct !== undefined) {
    return direct;
  }

  if (fallbackKey !== undefined) {
    const fallback = manifest.sprites[fallbackKey];
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(
      `Không có animation "${key}" lẫn fallback "${fallbackKey}". ${suggestKeys(manifest, key)}`,
    );
  }

  throw new Error(`Không có animation "${key}". ${suggestKeys(manifest, key)}`);
}

// ---------------------------------------------------------------------------
// Validator nội bộ
// ---------------------------------------------------------------------------

function validateEntry(
  key: string,
  raw: unknown,
  problems: string[],
): SpriteEntry | undefined {
  const at = `sprites["${key}"]`;

  if (!ANIMATION_KEY_PATTERN.test(key)) {
    problems.push(
      `${at}: key phải dạng <actor>.<animation>[.<direction>], chỉ gồm [a-z0-9-] và dấu chấm`,
    );
  }

  if (!isRecord(raw)) {
    problems.push(`${at}: entry phải là object, nhận ${describeValue(raw)}`);
    return undefined;
  }

  const sheet = readSheet(raw, at, problems);
  const layout = readLayout(raw, at, problems);
  const frameWidth = readPositiveInteger(raw, 'frameWidth', at, problems);
  const frameHeight = readPositiveInteger(raw, 'frameHeight', at, problems);
  const frames = readPositiveInteger(raw, 'frames', at, problems);
  const fps = readPositiveNumber(raw, 'fps', at, problems);
  const loop = readBoolean(raw, 'loop', at, problems);
  const directions = readDirections(raw, at, problems);
  const anchor = readAnchor(raw, at, problems);
  const footPx = readFootPx(raw, at, frameHeight, problems);

  if (directions !== undefined) {
    checkKeyMatchesDirections(key, directions, layout, at, problems);
  }

  if (
    sheet === undefined ||
    layout === undefined ||
    frameWidth === undefined ||
    frameHeight === undefined ||
    frames === undefined ||
    fps === undefined ||
    loop === undefined ||
    directions === undefined ||
    anchor === undefined ||
    footPx === undefined
  ) {
    return undefined;
  }

  return { sheet, frameWidth, frameHeight, layout, directions, frames, fps, loop, anchor, footPx };
}

/** Key kết thúc bằng direction ⇒ entry phải có direction đó; không kết thúc bằng direction ⇒ rỗng. */
function checkKeyMatchesDirections(
  key: string,
  directions: readonly Direction[],
  layout: SheetLayout | undefined,
  at: string,
  problems: string[],
): void {
  const segments = key.split('.');
  const last = segments[segments.length - 1];
  const keyDirection = last !== undefined && isDirection(last) ? last : undefined;

  if (keyDirection !== undefined) {
    if (!directions.includes(keyDirection)) {
      problems.push(
        `${at}: key trỏ tới direction "${keyDirection}" nhưng directions = [${directions.join(', ')}]`,
      );
    }
  } else if (directions.length > 0) {
    problems.push(
      `${at}: key không có direction ở cuối nên directions phải rỗng, nhận [${directions.join(', ')}]`,
    );
  }

  if (layout === 'strip' && directions.length > 1) {
    problems.push(`${at}: layout "strip" chỉ có một hàng nên directions tối đa 1 phần tử`);
  }
}

function readSheet(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): string | undefined {
  const value = record['sheet'];
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`${at}.sheet phải là đường dẫn không rỗng, nhận ${describeValue(value)}`);
    return undefined;
  }
  if (!isAssetRelativePath(value)) {
    problems.push(
      `${at}.sheet phải là đường dẫn tương đối trong game/assets/ (tương đối, kết thúc bằng .png, không có ".."), nhận "${value}"`,
    );
    return undefined;
  }
  return value;
}

function readLayout(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): SheetLayout | undefined {
  const value = record['layout'];
  if (value === 'grid' || value === 'strip') {
    return value;
  }
  problems.push(`${at}.layout phải là "grid" hoặc "strip", nhận ${describeValue(value)}`);
  return undefined;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  problems.push(`${at}.${field} phải là số nguyên dương, nhận ${describeValue(value)}`);
  return undefined;
}

function readPositiveNumber(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  problems.push(`${at}.${field} phải là số hữu hạn > 0, nhận ${describeValue(value)}`);
  return undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): boolean | undefined {
  const value = record[field];
  if (typeof value === 'boolean') {
    return value;
  }
  problems.push(`${at}.${field} phải là boolean, nhận ${describeValue(value)}`);
  return undefined;
}

function readDirections(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): Direction[] | undefined {
  const value = record['directions'];
  if (!Array.isArray(value)) {
    problems.push(
      `${at}.directions phải là array (rỗng nếu animation không có hướng), nhận ${describeValue(value)}`,
    );
    return undefined;
  }

  const items: readonly unknown[] = value;
  const parsed: Direction[] = [];
  items.forEach((item: unknown, index: number) => {
    if (!isDirection(item)) {
      problems.push(
        `${at}.directions[${index}] phải là một trong ${DIRECTIONS.join('/')}, nhận ${describeValue(item)}`,
      );
      return;
    }
    if (parsed.includes(item)) {
      problems.push(`${at}.directions[${index}] trùng direction "${item}"`);
      return;
    }
    parsed.push(item);
  });

  if (parsed.length !== items.length) {
    return undefined;
  }

  if (!isCanonicalOrder(parsed)) {
    problems.push(
      `${at}.directions phải theo thứ tự cột của pack (${DIRECTIONS.join(', ')}), nhận [${parsed.join(', ')}]`,
    );
    return undefined;
  }

  return parsed;
}

function readAnchor(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): SpriteAnchor | undefined {
  const value = record['anchor'];
  if (value === undefined) return 'feet';
  if (value === 'feet' || value === 'center') return value;
  problems.push(`${at}.anchor phải là "feet" hoặc "center", nhận ${describeValue(value)}`);
  return undefined;
}

function readFootPx(
  record: Record<string, unknown>,
  at: string,
  frameHeight: number | undefined,
  problems: string[],
): number | undefined {
  const value = record['footPx'];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.push(`${at}.footPx phải là số nguyên >= 0, nhận ${describeValue(value)}`);
    return undefined;
  }
  if (frameHeight !== undefined && value >= frameHeight) {
    problems.push(
      `${at}.footPx (${value}) phải nhỏ hơn frameHeight (${frameHeight}) để anchor nằm trong frame`,
    );
    return undefined;
  }
  return value;
}

/** Thứ tự cột trong sheet là cố định; đảo thứ tự array sẽ cắt sai sprite. */
function isCanonicalOrder(directions: readonly Direction[]): boolean {
  let previousIndex = -1;
  for (const direction of directions) {
    const index = DIRECTIONS.indexOf(direction);
    if (index <= previousIndex) {
      return false;
    }
    previousIndex = index;
  }
  return true;
}

function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Đường dẫn phải tương đối, dùng `/`, không thoát khỏi pack, và trỏ tới file png. */
function isAssetRelativePath(value: string): boolean {
  if (!value.endsWith('.png')) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  return !value.split('/').some((segment) => segment === '..' || segment === '');
}

function suggestKeys(manifest: AnimationManifest, key: string): string {
  const allKeys = Object.keys(manifest.sprites);
  const actor = key.split('.')[0];
  const sameActor =
    actor === undefined ? [] : allKeys.filter((candidate) => candidate.startsWith(`${actor}.`));

  if (sameActor.length === 0) {
    return `Manifest có ${allKeys.length} key, xem assets/resources/data/animations.json.`;
  }

  const shown = sameActor.slice(0, 8).join(', ');
  const suffix = sameActor.length > 8 ? ', …' : '';
  return `Actor "${actor}" có: ${shown}${suffix}.`;
}

function formatProblems(problems: readonly string[]): string {
  const header = `animations.json không hợp lệ — ${problems.length} lỗi:`;
  return [header, ...problems.map((problem) => `  - ${problem}`)].join('\n');
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `array(${items.length})`;
  }
  return typeof value;
}

/**
 * Số cột của sheet.
 *
 * `grid` lấy cột theo `directions`; sheet một cột (`Dead.png`, `directions: []`) thì cột = 1.
 * Nếu để loader tự suy ra từ `directions.length` thì sheet chết sẽ ra 0 cột và chia cho 0.
 */
export function frameColumns(entry: SpriteEntry): number {
  return entry.layout === 'strip' ? entry.frames : Math.max(1, entry.directions.length);
}

/** Số hàng: strip luôn 1, grid thì mỗi hàng là một frame. */
export function frameRows(entry: SpriteEntry): number {
  return entry.layout === 'strip' ? 1 : entry.frames;
}

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rect pixel của một frame, gốc trên-trái (thứ tự đọc của ảnh).
 * Với `strip`, `direction` bị bỏ qua vì sheet chỉ có một hàng.
 */
export function frameRect(entry: SpriteEntry, direction: Direction, frame: number): FrameRect {
  if (!Number.isInteger(frame) || frame < 0 || frame >= entry.frames) {
    throw new Error(`frame phải là số nguyên trong [0, ${entry.frames}), nhận ${frame}`);
  }

  // Strip chạy ngang; grid chạy dọc theo hàng, ngang theo cột direction.
  if (entry.layout === 'strip') {
    return {
      x: frame * entry.frameWidth,
      y: 0,
      width: entry.frameWidth,
      height: entry.frameHeight,
    };
  }

  let column = 0;
  if (entry.directions.length > 0) {
    column = entry.directions.indexOf(direction);
    if (column < 0) {
      throw new Error(
        `direction "${direction}" không có trong sheet (chỉ có: ${entry.directions.join(', ')})`,
      );
    }
  }

  return {
    x: column * entry.frameWidth,
    y: frame * entry.frameHeight,
    width: entry.frameWidth,
    height: entry.frameHeight,
  };
}

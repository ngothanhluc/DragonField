/**
 * Schema save 1 slot (GDD §10, ADR-012). **Chỉ meta**: vàng, upgrade, chapter đã
 * mở, best, settings. Không lưu run đang chơi — tắt tab là mất run.
 *
 * Ba cửa vào:
 * - `parseSaveData` — validate nghiêm ngặt, gom **mọi** lỗi vào một `Error`.
 * - `migrate` — nâng save cũ/thiếu `version` lên `SAVE_VERSION`.
 * - `serializeSave` — JSON canonical, thứ tự key cố định để diff được.
 */
import { UPGRADE_TRACKS, createDefaultUpgrades, maxLevelFor } from '../meta/upgrades';
import type { UpgradeTrack } from '../meta/upgrades';
import { CHAPTERS_PER_RUN } from '../run/run-state';
import { DEFAULT_SETTINGS, applySettings } from './settings';
import type { Settings } from './settings';

export const SAVE_VERSION = 1;

/** Kỷ lục xa nhất đã tới. `chapter`/`room` = 0 nghĩa là chưa chơi lần nào. */
export interface BestProgress {
  readonly chapter: number;
  readonly room: number;
}

export interface SaveData {
  readonly version: number;
  readonly gold: number;
  /** Cấp meta hiện có của từng track, 0..`maxLevelFor(track)`. */
  readonly upgrades: Record<UpgradeTrack, number>;
  /** Số chapter đã mở, 1..`CHAPTERS_PER_RUN`. */
  readonly chaptersUnlocked: number;
  readonly best: BestProgress;
  readonly settings: Settings;
}

/** Gom toàn bộ lỗi rồi ném một `Error` duy nhất, thay vì dừng ở lỗi đầu tiên. */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(header: string): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${header} (${this.items.length} lỗi)\n${details}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Đọc một số nguyên trong khoảng đóng [min, max]; sai thì ghi lỗi và trả `fallback`. */
function readInteger(
  value: unknown,
  path: string,
  min: number,
  max: number,
  fallback: number,
  problems: ProblemList,
): number {
  if (!isInteger(value)) {
    problems.add(path, `phải là số nguyên, nhận ${describeValue(value)}`);
    return fallback;
  }
  if (value < min || value > max) {
    problems.add(path, `phải nằm trong ${min}..${max}, nhận ${value}`);
    return fallback;
  }
  return value;
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    gold: 0,
    upgrades: createDefaultUpgrades(),
    chaptersUnlocked: 1,
    best: { chapter: 0, room: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Validate một save **đã ở `SAVE_VERSION`**. Dùng `migrate` cho save cũ.
 *
 * Mọi lỗi được gom lại: save hỏng thường hỏng nhiều chỗ cùng lúc, và người sửa
 * cần thấy hết trong một lần chạy thay vì sửa từng field một.
 */
export function parseSaveData(raw: unknown): SaveData {
  if (!isRecord(raw)) {
    throw new Error(`SaveData không hợp lệ: phải là object, nhận ${describeValue(raw)}`);
  }

  const problems = new ProblemList();

  if (raw.version !== SAVE_VERSION) {
    problems.add(
      'version',
      `phải bằng ${SAVE_VERSION}, nhận ${describeValue(raw.version)}; save cũ phải đi qua migrate()`,
    );
  }

  const gold = readInteger(raw.gold, 'gold', 0, Number.MAX_SAFE_INTEGER, 0, problems);
  const chaptersUnlocked = readInteger(
    raw.chaptersUnlocked,
    'chaptersUnlocked',
    1,
    CHAPTERS_PER_RUN,
    1,
    problems,
  );

  const upgrades = createDefaultUpgrades();
  const rawUpgrades = raw.upgrades;
  if (!isRecord(rawUpgrades)) {
    problems.add(
      'upgrades',
      `phải là object { ${UPGRADE_TRACKS.join(', ')} }, nhận ${describeValue(rawUpgrades)}`,
    );
  } else {
    for (const track of UPGRADE_TRACKS) {
      upgrades[track] = readInteger(
        rawUpgrades[track],
        `upgrades.${track}`,
        0,
        maxLevelFor(track),
        upgrades[track],
        problems,
      );
    }
  }

  let bestChapter = 0;
  let bestRoom = 0;
  const rawBest = raw.best;
  if (!isRecord(rawBest)) {
    problems.add('best', `phải là object { chapter, room }, nhận ${describeValue(rawBest)}`);
  } else {
    bestChapter = readInteger(rawBest.chapter, 'best.chapter', 0, CHAPTERS_PER_RUN, 0, problems);
    // Số phòng của chapter là dữ liệu (`roomsInChapter` từ số file `.tmx`), nên
    // không chặn trần theo hằng số cũ — save của chapter 10 phòng vẫn phải load được.
    bestRoom = readInteger(
      rawBest.room,
      'best.room',
      0,
      Number.MAX_SAFE_INTEGER,
      0,
      problems,
    );
  }

  let settings: Settings = { ...DEFAULT_SETTINGS };
  const rawSettings = raw.settings;
  if (!isRecord(rawSettings)) {
    problems.add(
      'settings',
      `phải là object { volume, fullscreen }, nhận ${describeValue(rawSettings)}`,
    );
  } else {
    const volume = rawSettings.volume;
    const volumeOk = isFiniteNumber(volume) && volume >= 0 && volume <= 1;
    if (!volumeOk) {
      problems.add('settings.volume', `phải là số trong 0..1, nhận ${describeValue(volume)}`);
    }

    const fullscreen = rawSettings.fullscreen;
    if (typeof fullscreen !== 'boolean') {
      problems.add(
        'settings.fullscreen',
        `phải là boolean, nhận ${describeValue(fullscreen)}`,
      );
    }

    // Chỉ dùng giá trị đọc được khi cả hai field hợp lệ; nếu không, giữ mặc định.
    settings = applySettings({
      ...(volumeOk ? { volume } : {}),
      ...(typeof fullscreen === 'boolean' ? { fullscreen } : {}),
    });
  }

  problems.throwIfAny('SaveData không hợp lệ');

  return {
    version: SAVE_VERSION,
    gold,
    upgrades,
    chaptersUnlocked,
    best: { chapter: bestChapter, room: bestRoom },
    settings,
  };
}

/**
 * JSON canonical: thứ tự key cố định theo GDD §10, chỉ chứa field đã validate.
 * Ném lỗi nếu `data` không hợp lệ — thà mất một lần save hơn ghi rác vào slot.
 */
export function serializeSave(data: SaveData): string {
  const valid = parseSaveData(data);

  return JSON.stringify({
    version: SAVE_VERSION,
    gold: valid.gold,
    upgrades: {
      hearts: valid.upgrades.hearts,
      damage: valid.upgrades.damage,
      fireRate: valid.upgrades.fireRate,
    },
    chaptersUnlocked: valid.chaptersUnlocked,
    best: { chapter: valid.best.chapter, room: valid.best.room },
    settings: { volume: valid.settings.volume, fullscreen: valid.settings.fullscreen },
  });
}

/** Đọc `migrated[key]` nếu khác `undefined`, ngược lại lấy mặc định. */
function pick(raw: Record<string, unknown>, key: string, fallback: unknown): unknown {
  const value = raw[key];
  return value === undefined ? fallback : value;
}

/**
 * Trả save mới với `best` = xa hơn giữa kỷ lục cũ và `(chapter, room)`.
 *
 * So sánh theo chapter trước rồi tới room — "tới phòng 5 chapter 1" không thể
 * ghi đè "tới phòng 2 chapter 2". Dùng ở bootstrap mỗi lần vào phòng mới và ở
 * màn kết thúc run; save không hợp lệ sẽ ném (đừng ghi rác vào slot).
 */
export function withBest(save: SaveData, chapter: number, room: number): SaveData {
  const valid = parseSaveData(save);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
    throw new Error(`withBest: chapter phải là số nguyên 1..${CHAPTERS_PER_RUN}, nhận ${chapter}`);
  }
  if (!Number.isInteger(room) || room < 1) {
    throw new Error(`withBest: room phải là số nguyên >= 1, nhận ${room}`);
  }

  const previous = valid.best;
  const further =
    chapter > previous.chapter || (chapter === previous.chapter && room > previous.room);
  if (!further) return valid;

  return { ...valid, best: { chapter, room } };
}

/**
 * Mở chapter kế sau khi dọn boss chapter `clearedChapter` (GDD §2: "chapter sau
 * mở khi thắng chapter trước"). Không bao giờ thu hẹp tiến trình đã mở.
 *
 * Trả save **mới**; save đầu vào không bị sửa. Save hỏng ném lỗi như `withBest`.
 */
export function unlockNextChapter(save: SaveData, clearedChapter: number): SaveData {
  const valid = parseSaveData(save);
  if (!Number.isInteger(clearedChapter) || clearedChapter < 1 || clearedChapter > CHAPTERS_PER_RUN) {
    throw new Error(
      `unlockNextChapter: chapter phải là số nguyên 1..${CHAPTERS_PER_RUN}, nhận ${clearedChapter}`,
    );
  }

  const unlocked = Math.min(CHAPTERS_PER_RUN, Math.max(valid.chaptersUnlocked, clearedChapter + 1));
  if (unlocked === valid.chaptersUnlocked) return valid;
  return { ...valid, chaptersUnlocked: unlocked };
}

/**
 * Track máu/nhịp bắn từng tên là `hp`/`firerate` trong bản nháp GDD §10; nay đổi
 * sang key của `UpgradeTrack`. Vẫn đọc tên cũ khi migrate để không mất tiến trình.
 */
const LEGACY_UPGRADE_KEYS: Readonly<Partial<Record<UpgradeTrack, string>>> = {
  hearts: 'hp',
  fireRate: 'firerate',
};

function migrateUpgrades(raw: unknown, fallback: Record<UpgradeTrack, number>): unknown {
  if (raw === undefined) return fallback;
  // Trả nguyên value hỏng để `parseSaveData` báo lỗi thay vì im lặng bỏ qua.
  if (!isRecord(raw)) return raw;

  const levels: Record<UpgradeTrack, unknown> = {
    hearts: fallback.hearts,
    damage: fallback.damage,
    fireRate: fallback.fireRate,
  };

  for (const track of UPGRADE_TRACKS) {
    const legacyKey = LEGACY_UPGRADE_KEYS[track];
    const own = raw[track];
    const legacy = legacyKey === undefined ? undefined : raw[legacyKey];
    const value = own === undefined ? legacy : own;
    if (value !== undefined) levels[track] = value;
  }

  return levels;
}

function migrateBest(raw: unknown, fallback: BestProgress): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  return {
    chapter: pick(raw, 'chapter', fallback.chapter),
    room: pick(raw, 'room', fallback.room),
  };
}

function migrateSettings(raw: unknown, fallback: Settings): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  return {
    volume: pick(raw, 'volume', fallback.volume),
    fullscreen: pick(raw, 'fullscreen', fallback.fullscreen),
  };
}

/**
 * Nâng save cũ lên `SAVE_VERSION`.
 *
 * - `version` thiếu → coi là 0 (save trước khi có version).
 * - Field thiếu → lấy mặc định; field sai kiểu → để `parseSaveData` báo.
 * - `version` mới hơn game → ném lỗi rõ ràng, **không** đoán mò rồi ghi đè save
 *   của bản game mới hơn (sẽ làm mất dữ liệu).
 */
export function migrate(raw: unknown): SaveData {
  if (!isRecord(raw)) {
    throw new Error(`Save không migrate được: phải là object, nhận ${describeValue(raw)}`);
  }

  const version = raw.version === undefined ? 0 : raw.version;
  if (!isInteger(version) || version < 0) {
    throw new Error(
      `Save không migrate được: version phải là số nguyên >= 0, nhận ${describeValue(raw.version)}`,
    );
  }
  if (version > SAVE_VERSION) {
    throw new Error(
      `Save version ${version} mới hơn bản game hỗ trợ (${SAVE_VERSION}); hãy cập nhật game`,
    );
  }

  const defaults = createDefaultSave();

  // Hiện chỉ có v1 nên "migrate" = vá field thiếu + đổi tên key cũ. Khi thêm
  // SAVE_VERSION 2, thêm nhánh `if (version < 2)` ở đây thay vì sửa parseSaveData.
  const migrated = {
    version: SAVE_VERSION,
    gold: pick(raw, 'gold', defaults.gold),
    upgrades: migrateUpgrades(raw.upgrades, defaults.upgrades),
    chaptersUnlocked: pick(raw, 'chaptersUnlocked', defaults.chaptersUnlocked),
    best: migrateBest(raw.best, defaults.best),
    settings: migrateSettings(raw.settings, defaults.settings),
  };

  return parseSaveData(migrated);
}

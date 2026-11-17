/**
 * `window.__yokai` — API chỉ tồn tại khi URL có `?debug=1`.
 *
 * Hàm dựng object ở đây, không ở `bootstrap.ts`: acceptance headless cần một
 * bề mặt ổn định, còn bootstrap chỉ cấp dữ liệu qua `DebugProvider`. Nhờ vậy
 * thêm hook M5 không làm file run-flow phình tiếp.
 */
import type { DerivedStats } from '../core/skills/derived-stats';

export type DebugStatus =
  | 'loading'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'room-clear'
  | 'skill-pick'
  | 'dying'
  | 'lost'
  | 'won'
  | 'error';

/** Id màn hình cho `screen()` — UI hiển thị, không phải status của run. */
export type DebugScreenId =
  | 'title'
  | 'chapter-select'
  | 'playing'
  | 'paused'
  | 'result'
  | 'shop'
  | 'settings'
  | 'credits'
  | 'skill-pick';

/** Một Label đang hiển thị + rect trong canvas để acceptance kiểm "không text bị cắt". */
export interface DebugUiText {
  readonly text: string;
  /** Rect trong pixel canvas (gốc dưới-trái), gồm cả phần chữ render. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly insideCanvas: boolean;
  /** Tên node Label (`effect`, `name`, `detail`, `label`, …). */
  readonly node: string;
  /** Tên node cha gần nhất có UITransform (button/card/…), `null` nếu không có. */
  readonly parent: string | null;
  /** Rect chữ có nằm trọn trong rect cha không (bắt text tràn khỏi card/button). */
  readonly insideParent: boolean;
}

export interface DebugEnemySnapshot {
  readonly id: string;
  readonly role: string | null;
  readonly elite: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly action: string;
  readonly x: number;
  readonly y: number;
}

export interface DebugBossSnapshot {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: number;
}

/** Trạng thái audio để acceptance headless kiểm không cần nghe. */
export interface DebugAudioSnapshot {
  readonly unlocked: boolean;
  readonly volume: number;
  readonly music: string | null;
  readonly lastSfx: readonly string[];
}

/** Animation đang phát của từng actor (key manifest). */
export interface DebugAnimationSnapshot {
  readonly player: string | null;
  readonly enemies: Readonly<Record<string, string>>;
  readonly boss: string | null;
}

/** Dữ liệu bootstrap cấp cho API; mọi method đều là closure sống. */
export interface DebugProvider {
  readonly status: () => DebugStatus;
  readonly chapter: () => number;
  readonly room: () => number;
  readonly roomTotal: () => number;
  readonly killAll: () => number;
  readonly spawn: (
    role: string,
    elite?: boolean,
    at?: { readonly x: number; readonly y: number },
  ) => string;
  readonly stress: () => boolean;
  readonly fps: () => { readonly fps: number; readonly frameMs: number; readonly samples: number };
  readonly godMode: (on: boolean) => boolean;
  readonly enemies: () => readonly DebugEnemySnapshot[];
  readonly bulletCount: () => number;
  readonly skillChoices: () => string[] | null;
  readonly pickSkill: (indexOrId: number | string) => boolean;
  readonly grantSkill: (id: string, stacks?: number) => number;
  readonly stats: () => DerivedStats;
  readonly boss: () => DebugBossSnapshot | null;
  readonly setBossHp: (fraction: number) => boolean;
  readonly startChapter: (chapter: number, seed?: number) => Promise<boolean>;
  /** Màn hình hiện tại (title/chapter-select/playing/...). */
  readonly screen: () => DebugScreenId;
  /** Bản save đang dùng (object, không phải chuỗi). */
  readonly save: () => unknown;
  /** Debug-only: đặt vàng để test shop; `false` khi giá trị không hợp lệ. */
  readonly setGold: (gold: number) => boolean;
  /** Mọi Label đang hiển thị + rect, để assert không bị cắt. */
  readonly uiText: () => readonly DebugUiText[];
  /** Debug: mở màn xem trước N skill (không grant) để test text fit. */
  readonly skillPreview: (ids: readonly string[]) => Promise<boolean>;
  readonly closeSkillPreview: () => boolean;
  /** Node/anim còn dùng art tạm hoặc key animation hỏng (rỗng = sạch). */
  readonly placeholders: () => readonly string[];
  /** Trạng thái audio: đã unlock chưa, volume, track, SFX gần nhất. */
  readonly audio: () => DebugAudioSnapshot;
  /** Animation key đang phát; truyền tên node để lấy một actor. */
  readonly anim: (nodeName?: string) => string | DebugAnimationSnapshot | null;
}

export type YokaiDebugApi = Omit<
  DebugProvider,
  'status' | 'chapter' | 'room' | 'roomTotal'
> & {
  readonly status: DebugStatus;
  readonly chapter: number;
  readonly room: number;
  readonly roomTotal: number;
};

/** Cài API nếu `?debug=1`; trả `true` khi đã cài. */
export function installDebugApi(provider: DebugProvider): boolean {
  if (!isDebugEnabled()) return false;

  const api: YokaiDebugApi = Object.defineProperties({} as YokaiDebugApi, {
    status: { get: provider.status, enumerable: true },
    chapter: { get: provider.chapter, enumerable: true },
    room: { get: provider.room, enumerable: true },
    roomTotal: { get: provider.roomTotal, enumerable: true },
    killAll: { value: provider.killAll, enumerable: true },
    spawn: { value: provider.spawn, enumerable: true },
    stress: { value: provider.stress, enumerable: true },
    fps: { value: provider.fps, enumerable: true },
    godMode: { value: provider.godMode, enumerable: true },
    enemies: { value: provider.enemies, enumerable: true },
    bulletCount: { value: provider.bulletCount, enumerable: true },
    skillChoices: { value: provider.skillChoices, enumerable: true },
    pickSkill: { value: provider.pickSkill, enumerable: true },
    grantSkill: { value: provider.grantSkill, enumerable: true },
    stats: { value: provider.stats, enumerable: true },
    boss: { value: provider.boss, enumerable: true },
    setBossHp: { value: provider.setBossHp, enumerable: true },
    startChapter: { value: provider.startChapter, enumerable: true },
    screen: { value: provider.screen, enumerable: true },
    save: { value: provider.save, enumerable: true },
    setGold: { value: provider.setGold, enumerable: true },
    uiText: { value: provider.uiText, enumerable: true },
    skillPreview: { value: provider.skillPreview, enumerable: true },
    closeSkillPreview: { value: provider.closeSkillPreview, enumerable: true },
    placeholders: { value: provider.placeholders, enumerable: true },
    audio: { value: provider.audio, enumerable: true },
    anim: { value: provider.anim, enumerable: true },
  });

  (window as unknown as { __yokai?: YokaiDebugApi }).__yokai = api;
  console.log(
    '[YokaiField] debug=1: window.__yokai sẵn sàng ' +
      '(status, chapter, room, roomTotal, killAll, spawn, stress, fps, godMode, enemies, bulletCount, ' +
      'skillChoices, pickSkill, grantSkill, stats, boss, setBossHp, startChapter, ' +
      'screen, save, setGold, uiText, skillPreview, closeSkillPreview, placeholders, audio, anim).',
  );
  return true;
}

/** Bật API khi URL có `?debug=1` (acceptance tự động của milestone). */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

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
  | 'room-clear'
  | 'skill-pick'
  | 'lost'
  | 'won'
  | 'error';

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
  });

  (window as unknown as { __yokai?: YokaiDebugApi }).__yokai = api;
  console.log(
    '[YokaiField] debug=1: window.__yokai sẵn sàng ' +
      '(status, chapter, room, roomTotal, killAll, spawn, stress, fps, godMode, enemies, bulletCount, ' +
      'skillChoices, pickSkill, grantSkill, stats, boss, setBossHp, startChapter).',
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

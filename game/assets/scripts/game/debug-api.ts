/**
 * `window.__yokai` — an API that only exists when the URL has `?debug=1`.
 *
 * The object is built here, not in `bootstrap.ts`: headless acceptance needs a stable
 * surface, while bootstrap only supplies data through `DebugProvider`. That way M5 hooks
 * do not keep growing the run-flow file.
 */
import type { DerivedStats } from '../core/skills/derived-stats';
import type { DoorReward } from '../core/run/doors';
import type { SpecialKind } from '../core/run/special-rooms';
import { keyLog } from './keyboard-move';

export type DebugStatus =
  | 'loading'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'room-clear'
  | 'skill-pick'
  | 'special'
  | 'dying'
  | 'lost'
  | 'won'
  | 'error';

/** Screen id for `screen()` — the visible UI, not the run status. */
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

/** A visible Label + its canvas rect so acceptance can check "no text is clipped". */
export interface DebugUiText {
  readonly text: string;
  /** Rect in canvas pixels (bottom-left origin), covering the rendered text. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly insideCanvas: boolean;
  /** Label node name (`effect`, `name`, `detail`, `label`, …). */
  readonly node: string;
  /** Name of the nearest parent node with a UITransform (button/card/…), `null` if none. */
  readonly parent: string | null;
  /** Whether the text rect fits fully inside its parent's (catches text overflowing a card/button). */
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

/** Audio state so headless acceptance can check without listening. */
export interface DebugAudioSnapshot {
  readonly unlocked: boolean;
  readonly volume: number;
  readonly music: string | null;
  readonly lastSfx: readonly string[];
  /** Every SFX event → its resource paths (the bank is the single source in core). */
  readonly bank: Readonly<Record<string, readonly string[]>>;
  /** Resource path chosen for each entry of `lastSfx`, same order and cap. */
  readonly lastClips: readonly string[];
}

/** Weapon VFX state (ticket #3), so the browser proof can read it instead of eyeballing pixels. */
export interface DebugVfxSnapshot {
  readonly effects: 'full' | 'reduced';
  /** Manifest key of the sprite the current loadout shoots. */
  readonly projectileKey: string;
  /** Ghost nodes that are actually visible right now. */
  readonly trailGhostsActive: number;
  readonly auraVisible: boolean;
  /** Round ball the current chapter's enemies fire. */
  readonly enemyProjectileKey: string;
}

/** Currently playing animation of each actor (manifest key). */
export interface DebugAnimationSnapshot {
  readonly player: string | null;
  readonly enemies: Readonly<Record<string, string>>;
  readonly boss: string | null;
}

/** Chapter atmosphere actually built for the current room (#6), read from the live adapters. */
export interface DebugAtmosphereSnapshot {
  readonly chapter: number;
  /** Layer kinds created (already filtered by the Effects mode). */
  readonly layers: readonly string[];
  /** Animals / animated props really created in this room (0 under Effects Reduced). */
  readonly animals: number;
  readonly props: number;
}

/** The living room drawn behind title / chapter select (#8), read from the live adapter. */
export interface DebugMenuBackdropSnapshot {
  readonly chapter: number;
  readonly room: number;
  /** Idle ninja position in world units (bottom-left origin, y up); `null` when not drawn. */
  readonly player: { readonly x: number; readonly y: number } | null;
  readonly layers: readonly string[];
  readonly animals: number;
  readonly props: number;
}

/** Doors of a cleared room (#39), read from the live adapter so the browser proof is scriptable. */
export interface DebugDoorSnapshot {
  /** True while the player walks to a door (the room is cleared). */
  readonly active: boolean;
  /** Rewards offered by the door, index-matched to `doors`. */
  readonly offers: readonly DoorReward[];
  /** Door positions in tile space (y down), same unit as the player position. */
  readonly doors: readonly {
    readonly reward: DoorReward;
    readonly x: number;
    readonly y: number;
  }[];
  /** Reward the current room will pay (from the door taken before it); `null` in room 1. */
  readonly roomReward: DoorReward | null;
}

/** Live heal/shop/chest room (#40), so the browser proof can reach and use it. */
export interface DebugSpecialSnapshot {
  /** Kind of the room the player is in, `null` outside a special room. */
  readonly kind: SpecialKind | null;
  /** Interaction point in tile space (y down), same unit as the player position. */
  readonly x: number | null;
  readonly y: number | null;
  /** The NPC/chest was already used (no second heal/chest reward). */
  readonly used: boolean;
  /** The room is finished and the exit door is open. */
  readonly finished: boolean;
}

/** Data bootstrap supplies to the API; every method is a live closure. */
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
  /** Debug: load a standalone dev room by id (`dev-big`); `false` when unknown/failed. */
  readonly loadRoom: (id: string) => Promise<boolean>;
  /** Current screen (title/chapter-select/playing/...). */
  readonly screen: () => DebugScreenId;
  /** The save in use (an object, not a string). */
  readonly save: () => unknown;
  /** Debug-only: set gold for shop tests; `false` when the value is invalid. */
  readonly setGold: (gold: number) => boolean;
  /** Every visible Label + rect, so tests can assert nothing is clipped. */
  readonly uiText: () => readonly DebugUiText[];
  /** Debug: open a preview of N skills (no grant) to test text fitting. */
  readonly skillPreview: (ids: readonly string[]) => Promise<boolean>;
  readonly closeSkillPreview: () => boolean;
  /** Nodes/animations still using placeholder art or broken keys (empty = clean). */
  readonly placeholders: () => readonly string[];
  /** Audio state: unlocked or not, volume, track, most recent SFX. */
  readonly audio: () => DebugAudioSnapshot;
  /** Playing animation key; pass a node name to get a single actor. */
  readonly anim: (nodeName?: string) => string | DebugAnimationSnapshot | null;
  /** Debug-only: flip Effects Full/Reduced at runtime (persisted like the Settings row). */
  readonly setEffects: (mode: 'full' | 'reduced') => boolean;
  /** Weapon VFX state: effects mode, projectile keys, trail ghosts, aura. */
  readonly vfx: () => DebugVfxSnapshot;
  /** Chapter atmosphere + living decor of the current room (#6). */
  readonly atmosphere: () => DebugAtmosphereSnapshot;
  /** Living room behind title / chapter select (#8); `null` when nothing is drawn. */
  readonly menuBackdrop: () => DebugMenuBackdropSnapshot | null;
  /** Total nodes in the current scene (leak check for the menu backdrop). */
  readonly nodeCount: () => number;
  /** Doors of the cleared room (#39): active offer, rewards and positions. */
  readonly doors: () => DebugDoorSnapshot;
  /** Debug: walk into door `index`; `false` outside the door phase or with a bad index. */
  readonly takeDoor: (index: number) => boolean;
  /** Live heal/shop/chest room (#40); `kind: null` outside one. */
  readonly special: () => DebugSpecialSnapshot;
  /** Debug: teleport onto the special room's NPC/chest and use it; `false` when not in one. */
  readonly useSpecial: () => boolean;
}

export type YokaiDebugApi = Omit<
  DebugProvider,
  'status' | 'chapter' | 'room' | 'roomTotal'
> & {
  /** The last 200 keyboard events (key/code/keyCode/isComposing) — for IME diagnosis. */
  readonly keyLog: typeof keyLog;
  readonly status: DebugStatus;
  readonly chapter: number;
  readonly room: number;
  readonly roomTotal: number;
};

/** Install the API if `?debug=1`; returns `true` when installed. */
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
    loadRoom: { value: provider.loadRoom, enumerable: true },
    screen: { value: provider.screen, enumerable: true },
    save: { value: provider.save, enumerable: true },
    setGold: { value: provider.setGold, enumerable: true },
    uiText: { value: provider.uiText, enumerable: true },
    skillPreview: { value: provider.skillPreview, enumerable: true },
    closeSkillPreview: { value: provider.closeSkillPreview, enumerable: true },
    placeholders: { value: provider.placeholders, enumerable: true },
    audio: { value: provider.audio, enumerable: true },
    anim: { value: provider.anim, enumerable: true },
    setEffects: { value: provider.setEffects, enumerable: true },
    vfx: { value: provider.vfx, enumerable: true },
    atmosphere: { value: provider.atmosphere, enumerable: true },
    menuBackdrop: { value: provider.menuBackdrop, enumerable: true },
    nodeCount: { value: provider.nodeCount, enumerable: true },
    doors: { value: provider.doors, enumerable: true },
    takeDoor: { value: provider.takeDoor, enumerable: true },
    special: { value: provider.special, enumerable: true },
    useSpecial: { value: provider.useSpecial, enumerable: true },
    keyLog: { value: keyLog, enumerable: true },
  });

  (window as unknown as { __yokai?: YokaiDebugApi }).__yokai = api;
  console.log(
    '[YokaiField] debug=1: window.__yokai ready ' +
      '(status, chapter, room, roomTotal, killAll, spawn, stress, fps, godMode, enemies, bulletCount, ' +
      'skillChoices, pickSkill, grantSkill, stats, boss, setBossHp, startChapter, loadRoom, ' +
      'screen, save, setGold, uiText, skillPreview, closeSkillPreview, placeholders, audio, anim, ' +
      'setEffects, vfx, atmosphere, menuBackdrop, nodeCount, doors, takeDoor, special, useSpecial, keyLog).',
  );
  return true;
}

/** Enable the API when the URL has `?debug=1` (automated milestone acceptance). */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

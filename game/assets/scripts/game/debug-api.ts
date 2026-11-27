/**
 * `window.__yokai` — an API that only exists when the URL has `?debug=1`.
 *
 * The object is built here, not in `bootstrap.ts`: headless acceptance needs a stable
 * surface, while bootstrap only supplies data through `DebugProvider`. That way M5 hooks
 * do not keep growing the run-flow file.
 */
import type { DerivedStats } from '../core/skills/derived-stats';
import type { DoorReward } from '../core/run/doors';
import type { DeathCause } from '../core/run/run-summary';
import type { SpecialKind } from '../core/run/special-rooms';
import type { ActiveRunSave } from '../core/save/run-save';
import type { DialogBoxView } from '../core/hub/village-life';
import { keyLog } from './keyboard-move';

export type DebugStatus =
  | 'loading'
  | 'menu'
  | 'hub'
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
  | 'village'
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
  readonly musicVolume?: number;
  readonly sfxVolume?: number;
  readonly musicGain?: number;
  readonly sfxGain?: number;
  readonly ducked?: boolean;
  readonly duckFactor?: number;
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

/** Village Life (#92): live villagers, yard animals and the open DialogBox view model. */
export interface DebugHubLifeSnapshot {
  readonly villagers: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly mode: string;
  }[];
  readonly animals: readonly {
    readonly id: string;
    readonly sprite: string;
    readonly x: number;
    readonly y: number;
    readonly mode: string;
  }[];
  /** `null` when no box is open. */
  readonly dialog: DialogBoxView | null;
  /** Hub player position in tile units (top-left origin), proving the dialog locks movement. */
  readonly player: { readonly x: number; readonly y: number };
}

/** Village Hub session snapshot (#94): live body, quick bar and music cue, read from the adapters. */
export interface DebugHubSnapshot {
  readonly location: string;
  readonly characterId: string;
  /** Weapon attachment on the live walking body (`bow-hand` / `staff-hand` / `sword-back`; `null` for Ninja). */
  readonly attachmentItemId: string | null;
  readonly quickBarVisible: boolean;
  readonly menuOpen: boolean;
  readonly codexOpen: boolean;
  readonly music: { readonly track: string; readonly ducked: boolean };
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

/** Selected/active playable character state and roster availability (M10/M14). */
export interface DebugCharacterSnapshot {
  readonly id: string;
  readonly name: string;
  readonly available: string[];
}

/** Live player attachment child-node state (M10); `null` outside a run. */
export interface DebugPlayerAttachmentSnapshot {
  readonly characterId?: string;
  readonly hasNode: boolean;
  readonly active: boolean;
  readonly visible: boolean;
  readonly hidden: boolean;
  readonly hiddenBySkill?: boolean;
  readonly behind: boolean;
  readonly localX: number;
  readonly localY: number;
  readonly bobPx: number;
  readonly spriteKey: string | null;
  readonly direction: string;
  readonly frame: number;
}

/** Concise M14 attachment state snapshot (`__yokai.attachmentState()`). */
export interface DebugAttachmentStateSnapshot {
  readonly characterId: string;
  readonly hasNode: boolean;
  readonly visible: boolean;
  readonly hiddenBySkill: boolean;
  readonly facing: string;
  readonly behindBody: boolean;
  readonly x: number;
  readonly y: number;
}

/** Active character identity + live 3-layer `DerivedStats` snapshot (`__yokai.characterStats()`). */
export interface DebugCharacterStatsSnapshot extends DerivedStats {
  readonly characterId: string;
  readonly name: string;
  readonly signatureSkillId: string;
  readonly signatureName: string;
  readonly weaponForm: string;
  readonly defaultProjectileKey: string;
  readonly projectileKey: string;
  readonly hearts: number;
}

/** Active XP orb snapshot for `window.__yokai.xp()`. */
export interface DebugXpOrbSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly phase: string;
}

/** Live M12 XP, orb pool, reroll, and XP-door state for `window.__yokai.xp()`. */
export interface DebugXpSnapshot {
  readonly level: number;
  readonly currentXp: number;
  readonly nextLevelXp: number;
  readonly totalXp: number;
  readonly pendingLevelUps: number;
  readonly activeOrbs: number;
  readonly orbs: readonly DebugXpOrbSnapshot[];
  readonly rerollsUsed: number;
  readonly freeRerollsLeft?: number;
  readonly rerollCost: number;
  readonly sharedGold: number;
  readonly isXpDoorRoom: boolean;
}

/** High-level live run & M15 state snapshot for `window.__yokai.state()`. */
export interface DebugStateSnapshot {
  readonly status: DebugStatus;
  readonly screen: DebugScreenId;
  readonly chapter: number;
  readonly room: number;
  readonly roomTotal: number;
  readonly seed: number;
  readonly ascension: number;
  readonly endlessLoop: number;
  readonly freeRerollsLeft: number;
  readonly deathCause: DeathCause | null;
  readonly hasRunSave: boolean;
  readonly canContinueEndless: boolean;
}

/** Live M13 Dash, Signature Active, and Evolution state for `window.__yokai.actions()`. */
export interface DebugActionsSnapshot {
  readonly dashReadyRatio: number;
  readonly dashCooldownSec: number;
  readonly isDashing: boolean;
  readonly dashIframeMs: number;
  readonly dashBuffered: boolean;
  readonly dashesUsed: number;
  readonly activeReadyRatio: number;
  readonly activeCooldownSec: number;
  readonly activeBuffered: boolean;
  readonly activeSkillsUsed: number;
  readonly evolutions: readonly string[];
}

/** M20 class-skill proof: memory entries (marks/momentum), live class projectiles, Wind buff. */
export interface DebugClassSkillSnapshot {
  /** 1-based auto-fire counter (Arrow Rain fires on multiples of 5). */
  readonly shotsFired: number;
  /** Class-hook scratch store: `[key, value]` pairs (mark timestamp, wind momentum). */
  readonly memory: readonly (readonly [string, number])[];
  /** Player bullets currently carrying a `classSkillId` (split / tempest arrows). */
  readonly classBullets: number;
  /** Same count grouped by the spawning skill id (proof for split vs. Sky Tempest volleys). */
  readonly classBulletsById: Readonly<Record<string, number>>;
  /** Active temporary buff (Wind Arrow), `null` when none/expired. */
  readonly buff: {
    readonly fireRateMult: number;
    readonly projectileSpeedMult: number;
    readonly remainingMs: number;
  } | null;
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
  readonly startChapter: (chapter: number, seed?: number, ascension?: number) => Promise<boolean>;
  /** Debug: load a standalone dev room by id (`dev-big`); `false` when unknown/failed. */
  readonly loadRoom: (id: string) => Promise<boolean>;
  /** Current screen (title/chapter-select/playing/...). */
  readonly screen: () => DebugScreenId;
  /** The save in use (an object, not a string). */
  readonly save: () => unknown;
  /** Debug-only: set gold for shop tests; `false` when the value is invalid. */
  readonly setGold: (gold: number) => boolean;
  /** Debug-only: credit a chapter clear (unlock the next chapter + best) and persist it (#45). */
  readonly markChapterCleared: (chapter: number) => boolean;
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
  /** M10/M14: active/selected character and unlocked roster state. */
  readonly character?: () => DebugCharacterSnapshot;
  /** M10/M14: select a playable character by id (unlocks if needed / switches active class). */
  readonly selectCharacter?: (id: string) => boolean;
  /** M14: unlock all 4 playable characters on the save and return unlocked ids. */
  readonly unlockAllCharacters?: () => string[];
  /** M10: live player attachment child-node state; `null` outside a run. */
  readonly playerAttachment?: () => DebugPlayerAttachmentSnapshot | null;
  /** M14: live attachment state `{ characterId, hasNode, visible, hiddenBySkill, facing, behindBody, x, y }`. */
  readonly attachmentState?: () => DebugAttachmentStateSnapshot;
  /** M14: live active character + 3-layer `DerivedStats` snapshot. */
  readonly characterStats?: () => DebugCharacterStatsSnapshot | null;
  /** M10: toggle manual hide on the player's attachment node. */
  readonly setAttachmentHidden?: (hidden: boolean) => boolean;
  /** M10: hide the player's attachment node for a skill id. */
  readonly hideAttachmentForSkill?: (skillId: string) => boolean;
  /** M10: clear a skill hide token on the player's attachment node. */
  readonly showAttachmentForSkill?: (skillId: string) => boolean;
  /** M12: live XP tracker, active orbs, reroll state, and XP door status. */
  readonly xp?: () => DebugXpSnapshot;
  /** M12: grant `amount` XP directly (syncs HUD and opens level-up modal if threshold crossed). */
  readonly grantXp?: (amount: number) => DebugXpSnapshot;
  /** M12: trigger Gold Reroll on the active level-up modal; `false` if unavailable/unaffordable. */
  readonly rerollSkill?: () => boolean;
  /** M12: remaining player invulnerability window in ms (`600` right after level-up resume). */
  readonly playerIframeMs?: () => number;
  /** M13: trigger Dash immediately during gameplay; returns `false` if on cooldown or unavailable. */
  readonly dash?: () => boolean;
  /** M13: trigger Signature Active (*Shadow Barrage*) immediately; returns `false` if cooling down. */
  readonly activeSkill?: () => boolean;
  /** M13: live Dash / Signature Active cooldown & active Evolution snapshot. */
  readonly actions?: () => DebugActionsSnapshot;
  /** M20: class-skill memory, live class projectiles and temporary buff proof. */
  readonly classSkillState?: () => DebugClassSkillSnapshot;
  /** M13: unlock prerequisites and grant an Evolution (`id` optional), returning its id or `null`. */
  readonly triggerEvolution?: (id?: string) => string | null;
  /** M15: full run/M15 state snapshot (`ascension`, `endlessLoop`, `freeRerollsLeft`, `deathCause`, `seed`). */
  readonly state?: () => DebugStateSnapshot;
  /** M15: currently persisted `ActiveRunSave` (`yokai-field.run`) or `null`. */
  readonly runSave?: () => ActiveRunSave | null;
  /** M15: set active/next run Ascension tier (`0..5`) and return clamped tier. */
  readonly setAscension?: (tier: number) => number;
  /** M15: unlock Ascension 5 on all 4 chapters and return the tuple. */
  readonly unlockAllAscensions?: () => number[];
  /** M15: trigger immediate player death with optional `DeathCause` (tests permadeath & summary). */
  readonly triggerDeath?: (cause?: DeathCause) => boolean;
  /** M15: resume the currently saved `ActiveRunSave` if present. */
  readonly continueRun?: () => Promise<boolean>;
  /** M15: continue into the next Endless chapter / loop. */
  readonly continueEndless?: () => Promise<boolean>;
  /** M15: set and persist Music channel volume (`0..1`). */
  readonly setMusicVolume?: (volume: number) => number;
  /** M15: set and persist SFX channel volume (`0..1`). */
  readonly setSfxVolume?: (volume: number) => number;
  /** M15: toggle music ducking directly and return the new ducked state. */
  readonly setMusicDucked?: (ducked: boolean) => boolean;
  /** M21 #91: teleport the village-hub player (browser proof) in tile space; `false` outside the hub. */
  readonly hubTeleport?: (x: number, y: number) => boolean;
  /** M21 #91: dispatch the nearest hub interactable (same path as `[E]` / a click). */
  readonly hubInteract?: () => boolean;
  /** M21 #92: live Village Life snapshot (villagers, animals, open dialog); `null` outside the hub. */
  readonly hubLife?: () => DebugHubLifeSnapshot | null;
  /** M21 #92: advance/close the open DialogBox exactly like `[E]`. */
  readonly hubAdvance?: () => boolean;
  /** M21 #94: live village snapshot (body/attachment, quick bar, codex, music cue); `null` outside. */
  readonly hubSnapshot?: () => DebugHubSnapshot | null;
  /** M21 #94: trigger a quick-access shortcut by id (`play` / `characters` / `settings`). */
  readonly hubQuick?: (item: string) => boolean;
}

/** Alias for `DebugProvider`. */
export type DebugHooks = DebugProvider;

export type YokaiDebugApi = Omit<
  DebugProvider,
  | 'status'
  | 'chapter'
  | 'room'
  | 'roomTotal'
  | 'character'
  | 'selectCharacter'
  | 'unlockAllCharacters'
  | 'playerAttachment'
  | 'attachmentState'
  | 'characterStats'
  | 'setAttachmentHidden'
  | 'hideAttachmentForSkill'
  | 'showAttachmentForSkill'
  | 'xp'
  | 'grantXp'
  | 'rerollSkill'
  | 'playerIframeMs'
  | 'dash'
  | 'activeSkill'
  | 'actions'
  | 'triggerEvolution'
  | 'state'
  | 'runSave'
  | 'setAscension'
  | 'unlockAllAscensions'
  | 'triggerDeath'
  | 'continueRun'
  | 'continueEndless'
  | 'setMusicVolume'
  | 'setSfxVolume'
  | 'setMusicDucked'
> & {
  /** The last 200 keyboard events (key/code/keyCode/isComposing) — for IME diagnosis. */
  readonly keyLog: typeof keyLog;
  readonly status: DebugStatus;
  readonly chapter: number;
  readonly room: number;
  readonly roomTotal: number;
  readonly character: () => DebugCharacterSnapshot;
  readonly selectCharacter: (id: string) => boolean;
  readonly unlockAllCharacters: () => string[];
  readonly playerAttachment: () => DebugPlayerAttachmentSnapshot | null;
  readonly attachmentState: () => DebugAttachmentStateSnapshot;
  readonly characterStats: () => DebugCharacterStatsSnapshot | null;
  readonly setAttachmentHidden: (hidden: boolean) => boolean;
  readonly hideAttachmentForSkill: (skillId: string) => boolean;
  readonly showAttachmentForSkill: (skillId: string) => boolean;
  readonly xp: () => DebugXpSnapshot;
  readonly grantXp: (amount: number) => DebugXpSnapshot;
  readonly rerollSkill: () => boolean;
  readonly playerIframeMs: () => number;
  readonly dash: () => boolean;
  readonly activeSkill: () => boolean;
  readonly actions: () => DebugActionsSnapshot;
  readonly triggerEvolution: (id?: string) => string | null;
  readonly state: () => DebugStateSnapshot;
  readonly runSave: () => ActiveRunSave | null;
  readonly setAscension: (tier: number) => number;
  readonly unlockAllAscensions: () => number[];
  readonly triggerDeath: (cause?: DeathCause) => boolean;
  readonly continueRun: () => Promise<boolean>;
  readonly continueEndless: () => Promise<boolean>;
  readonly setMusicVolume: (volume: number) => number;
  readonly setSfxVolume: (volume: number) => number;
  readonly setMusicDucked: (ducked: boolean) => boolean;
};

const DEFAULT_CHARACTER_SNAPSHOT: DebugCharacterSnapshot = {
  id: 'ninja',
  name: 'Ninja',
  available: ['ninja'],
};

const DEFAULT_ATTACHMENT_STATE: DebugAttachmentStateSnapshot = {
  characterId: 'ninja',
  hasNode: false,
  visible: false,
  hiddenBySkill: false,
  facing: 'down',
  behindBody: false,
  x: 0,
  y: 0,
};

const DEFAULT_XP_SNAPSHOT: DebugXpSnapshot = {
  level: 1,
  currentXp: 0,
  nextLevelXp: 0,
  totalXp: 0,
  pendingLevelUps: 0,
  activeOrbs: 0,
  orbs: [],
  rerollsUsed: 0,
  rerollCost: 0,
  sharedGold: 0,
  isXpDoorRoom: false,
};

const DEFAULT_ACTIONS_SNAPSHOT: DebugActionsSnapshot = {
  dashReadyRatio: 1,
  dashCooldownSec: 0,
  isDashing: false,
  dashIframeMs: 0,
  dashBuffered: false,
  dashesUsed: 0,
  activeReadyRatio: 1,
  activeCooldownSec: 0,
  activeBuffered: false,
  activeSkillsUsed: 0,
  evolutions: [],
};

const DEFAULT_CLASS_SKILL_SNAPSHOT: DebugClassSkillSnapshot = {
  shotsFired: 0,
  memory: [],
  classBullets: 0,
  classBulletsById: {},
  buff: null,
};

/** Install the API if `?debug=1`; returns `true` when installed. */
export function installDebugApi(provider: DebugProvider): boolean {
  if (!isDebugEnabled()) return false;

  const character = provider.character ?? ((): DebugCharacterSnapshot => DEFAULT_CHARACTER_SNAPSHOT);
  const selectCharacter = provider.selectCharacter ?? ((): boolean => false);
  const unlockAllCharacters = provider.unlockAllCharacters ?? ((): string[] => ['ninja']);
  const playerAttachment =
    provider.playerAttachment ?? ((): DebugPlayerAttachmentSnapshot | null => null);
  const attachmentState =
    provider.attachmentState ?? ((): DebugAttachmentStateSnapshot => DEFAULT_ATTACHMENT_STATE);
  const characterStats =
    provider.characterStats ?? ((): DebugCharacterStatsSnapshot | null => null);
  const setAttachmentHidden = provider.setAttachmentHidden ?? ((): boolean => false);
  const hideAttachmentForSkill = provider.hideAttachmentForSkill ?? ((): boolean => false);
  const showAttachmentForSkill = provider.showAttachmentForSkill ?? ((): boolean => false);
  const xp = provider.xp ?? ((): DebugXpSnapshot => DEFAULT_XP_SNAPSHOT);
  const grantXp = provider.grantXp ?? ((): DebugXpSnapshot => DEFAULT_XP_SNAPSHOT);
  const rerollSkill = provider.rerollSkill ?? ((): boolean => false);
  const playerIframeMs = provider.playerIframeMs ?? ((): number => 0);
  const dash = provider.dash ?? ((): boolean => false);
  const activeSkill = provider.activeSkill ?? ((): boolean => false);
  const actions = provider.actions ?? ((): DebugActionsSnapshot => DEFAULT_ACTIONS_SNAPSHOT);
  const classSkillState =
    provider.classSkillState ?? ((): DebugClassSkillSnapshot => DEFAULT_CLASS_SKILL_SNAPSHOT);
  const triggerEvolution = provider.triggerEvolution ?? ((): string | null => null);
  const state =
    provider.state ??
    ((): DebugStateSnapshot => ({
      status: provider.status(),
      screen: provider.screen(),
      chapter: provider.chapter(),
      room: provider.room(),
      roomTotal: provider.roomTotal(),
      seed: 0,
      ascension: 0,
      endlessLoop: 0,
      freeRerollsLeft: 0,
      deathCause: null,
      hasRunSave: false,
      canContinueEndless: false,
    }));
  const runSave = provider.runSave ?? ((): ActiveRunSave | null => null);
  const setAscension = provider.setAscension ?? ((): number => 0);
  const unlockAllAscensions = provider.unlockAllAscensions ?? ((): number[] => [0, 0, 0, 0]);
  const triggerDeath = provider.triggerDeath ?? ((): boolean => false);
  const continueRun = provider.continueRun ?? (async (): Promise<boolean> => false);
  const continueEndless = provider.continueEndless ?? (async (): Promise<boolean> => false);
  const setMusicVolume = provider.setMusicVolume ?? ((): number => 0);
  const setSfxVolume = provider.setSfxVolume ?? ((): number => 0);
  const setMusicDucked = provider.setMusicDucked ?? ((): boolean => false);
  const hubTeleport = provider.hubTeleport ?? ((): boolean => false);
  const hubInteract = provider.hubInteract ?? ((): boolean => false);
  const hubLife =
    provider.hubLife ?? ((): DebugHubLifeSnapshot | null => null);
  const hubAdvance = provider.hubAdvance ?? ((): boolean => false);
  const hubSnapshot = provider.hubSnapshot ?? ((): DebugHubSnapshot | null => null);
  const hubQuick = provider.hubQuick ?? ((): boolean => false);

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
    markChapterCleared: { value: provider.markChapterCleared, enumerable: true },
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
    character: { value: character, enumerable: true },
    selectCharacter: { value: selectCharacter, enumerable: true },
    unlockAllCharacters: { value: unlockAllCharacters, enumerable: true },
    playerAttachment: { value: playerAttachment, enumerable: true },
    attachmentState: { value: attachmentState, enumerable: true },
    characterStats: { value: characterStats, enumerable: true },
    setAttachmentHidden: { value: setAttachmentHidden, enumerable: true },
    hideAttachmentForSkill: { value: hideAttachmentForSkill, enumerable: true },
    showAttachmentForSkill: { value: showAttachmentForSkill, enumerable: true },
    xp: { value: xp, enumerable: true },
    grantXp: { value: grantXp, enumerable: true },
    rerollSkill: { value: rerollSkill, enumerable: true },
    playerIframeMs: { value: playerIframeMs, enumerable: true },
    dash: { value: dash, enumerable: true },
    activeSkill: { value: activeSkill, enumerable: true },
    actions: { value: actions, enumerable: true },
    classSkillState: { value: classSkillState, enumerable: true },
    triggerEvolution: { value: triggerEvolution, enumerable: true },
    state: { value: state, enumerable: true },
    runSave: { value: runSave, enumerable: true },
    setAscension: { value: setAscension, enumerable: true },
    unlockAllAscensions: { value: unlockAllAscensions, enumerable: true },
    triggerDeath: { value: triggerDeath, enumerable: true },
    continueRun: { value: continueRun, enumerable: true },
    continueEndless: { value: continueEndless, enumerable: true },
    setMusicVolume: { value: setMusicVolume, enumerable: true },
    setSfxVolume: { value: setSfxVolume, enumerable: true },
    setMusicDucked: { value: setMusicDucked, enumerable: true },
    hubTeleport: { value: hubTeleport, enumerable: true },
    hubInteract: { value: hubInteract, enumerable: true },
    hubLife: { value: hubLife, enumerable: true },
    hubAdvance: { value: hubAdvance, enumerable: true },
    hubSnapshot: { value: hubSnapshot, enumerable: true },
    hubQuick: { value: hubQuick, enumerable: true },
    keyLog: { value: keyLog, enumerable: true },
  });

  (window as unknown as { __yokai?: YokaiDebugApi }).__yokai = api;
  console.log(
    '[YokaiField] debug=1: window.__yokai ready ' +
      '(status, chapter, room, roomTotal, killAll, spawn, stress, fps, godMode, enemies, bulletCount, ' +
      'skillChoices, pickSkill, grantSkill, stats, boss, setBossHp, startChapter, loadRoom, ' +
      'screen, save, setGold, markChapterCleared, uiText, skillPreview, closeSkillPreview, placeholders, audio, anim, ' +
      'setEffects, vfx, atmosphere, menuBackdrop, nodeCount, doors, takeDoor, special, useSpecial, ' +
      'character, selectCharacter, unlockAllCharacters, playerAttachment, attachmentState, characterStats, setAttachmentHidden, ' +
      'hideAttachmentForSkill, showAttachmentForSkill, xp, grantXp, rerollSkill, playerIframeMs, ' +
      'dash, activeSkill, actions, triggerEvolution, state, runSave, setAscension, unlockAllAscensions, ' +
      'triggerDeath, continueRun, continueEndless, setMusicVolume, setSfxVolume, setMusicDucked, ' +
      'hubTeleport, hubInteract, hubLife, hubAdvance, hubSnapshot, hubQuick, classSkillState, keyLog).',
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

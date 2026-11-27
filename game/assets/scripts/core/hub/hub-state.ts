/**
 * Pure Village Hub & Shop Interior state machine (`village ↔ shop-interior ↔ run`, ADR-028).
 *
 * Pure TS — zero `cc` imports.
 *
 * Owns:
 * - Active hub location (`'village' | 'shop-interior'`), camera mode (`'follow' | 'static'`),
 *   music track & shop-interior ducking flag.
 * - Spawn & return coordinates (central plaza spawn on Enter Village / return from run; shop
 *   front door spawn on exiting Shop Interior so the player never re-triggers the doorway).
 * - Auto-fire strictly disabled (`autoFireEnabled: false`) in both Village & Shop Interior,
 *   while Dash remains enabled (`dashEnabled: true`, GDD M21 §4).
 * - Smooth fade transition state machine (`~200 ms` fade-out + `~200 ms` fade-in) across
 *   `village ↔ shop-interior` and `village → run`.
 * - Immediate live playable character switching at the Dojo (`switchHubCharacter`), resolving
 *   live sprite & weapon attachment loadout without reloading the scene.
 */
import type { Direction } from '../art/manifest';
import {
  getCharacter,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
  type CharacterSelectionSource,
  type CharacterUnlockSource,
} from '../characters/roster';
import type { Vec2 } from '../math/vec2';
import { VILLAGE_MUSIC_PATH, type HubLocation, type HubMapData } from './hub-tmx';

/** Default half-fade duration in milliseconds (`~200 ms` per GDD M21 §2). */
export const DEFAULT_HUB_FADE_MS = 200;

/** Canonical fallback spawn coordinates when no parsed `HubMapData` override is supplied. */
export const DEFAULT_HUB_SPAWNS = {
  villageSquare: { at: { x: 18, y: 13.5 }, facing: 'down' as Direction },
  villageFromShop: { at: { x: 7, y: 12.8 }, facing: 'down' as Direction },
  shopInteriorEntry: { at: { x: 8, y: 9.2 }, facing: 'up' as Direction },
} as const;

export type HubCameraMode = 'follow' | 'static';
export type HubEntryOrigin = 'title' | 'run-victory' | 'run-defeat' | 'shop-interior';
export type HubTransitionPhase = 'idle' | 'fading-out' | 'fading-in';

export type HubTransitionTarget =
  | { readonly kind: 'village'; readonly from: HubEntryOrigin }
  | { readonly kind: 'shop-interior' }
  | { readonly kind: 'run'; readonly chapter: number; readonly ascensionLevel?: number };

export interface RunLaunchPayload {
  readonly chapter: number;
  readonly ascensionLevel: number;
  readonly characterId: CharacterId;
}

export interface HubTransitionState {
  readonly phase: HubTransitionPhase;
  /** Screen fade overlay opacity in `[0, 1]` (`0` = clear world, `1` = full black fade). */
  readonly fadeAlpha: number;
  readonly halfDurationMs: number;
  readonly target: HubTransitionTarget | null;
}

export interface HubSpawnConfig {
  readonly villageSquare?: { readonly at: Vec2; readonly facing: Direction };
  readonly villageFromShop?: { readonly at: Vec2; readonly facing: Direction };
  readonly shopInteriorEntry?: { readonly at: Vec2; readonly facing: Direction };
}

export interface HubState {
  readonly location: HubLocation;
  readonly playerPos: Vec2;
  readonly playerFacing: Direction;
  readonly characterId: CharacterId;
  readonly character: CharacterDef;
  /** Strictly `false` in both `village` and `shop-interior` (GDD M21 §4, ADR-028). */
  readonly autoFireEnabled: false;
  /** Dash stays enabled in the Village Hub for playful traversal; disabled inside cozy Shop Interior. */
  readonly dashEnabled: boolean;
  readonly cameraMode: HubCameraMode;
  readonly musicTrack: string;
  /** Soft music ducking while inside the Shop Interior (GDD M21 §4). */
  readonly musicDucked: boolean;
  readonly lastRunOutcome: 'victory' | 'defeat' | null;
  readonly transition: HubTransitionState;
  /** Populated when a `village → run` fade-out completes, ready for scene handoff. */
  readonly pendingRunLaunch: RunLaunchPayload | null;
}

export interface CreateHubStateOptions {
  readonly save?: CharacterSelectionSource;
  readonly entryOrigin?: HubEntryOrigin;
  readonly spawns?: HubSpawnConfig;
  /** Start with a fade-in from black (e.g. entering Village from Title or returning from a run). */
  readonly fadeInOnEnter?: boolean;
  readonly fadeDurationMs?: number;
  /**
   * Hub location to build the session in. Defaults to `'village'`; `'shop-interior'` rebuilds the
   * shop after a Meta Shop panel closes (#93) so the player returns to the counter, not the plaza.
   */
  readonly startLocation?: HubLocation;
}

/** Build `HubSpawnConfig` directly from parsed `village-hub.tmx` and `shop-interior.tmx` data. */
export function spawnsFromHubMaps(
  villageMap: HubMapData,
  shopMap: HubMapData,
): HubSpawnConfig {
  const fromShop = villageMap.entryPoints['shop-interior'];
  return {
    villageSquare: {
      at: { ...villageMap.playerStart },
      facing: villageMap.playerStartFacing,
    },
    villageFromShop:
      fromShop !== undefined
        ? { at: { ...fromShop.at }, facing: fromShop.facing }
        : DEFAULT_HUB_SPAWNS.villageFromShop,
    shopInteriorEntry: {
      at: { ...shopMap.playerStart },
      facing: shopMap.playerStartFacing,
    },
  };
}

function resolveVillageSpawn(
  origin: HubEntryOrigin,
  spawns?: HubSpawnConfig,
): { readonly at: Vec2; readonly facing: Direction } {
  if (origin === 'shop-interior') {
    const point = spawns?.villageFromShop ?? DEFAULT_HUB_SPAWNS.villageFromShop;
    return { at: { ...point.at }, facing: point.facing };
  }
  const square = spawns?.villageSquare ?? DEFAULT_HUB_SPAWNS.villageSquare;
  return { at: { ...square.at }, facing: square.facing };
}

function resolveShopSpawn(spawns?: HubSpawnConfig): {
  readonly at: Vec2;
  readonly facing: Direction;
} {
  const entry = spawns?.shopInteriorEntry ?? DEFAULT_HUB_SPAWNS.shopInteriorEntry;
  return { at: { ...entry.at }, facing: entry.facing };
}

function sanitizeFadeMs(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return DEFAULT_HUB_FADE_MS;
  return ms;
}

/**
 * Create a fresh Village Hub state (used on "Enter Village" from Title or returning after a Run).
 */
export function createHubState(options: CreateHubStateOptions = {}): HubState {
  const character = resolveSelectedCharacter(options.save);
  const origin = options.entryOrigin ?? 'title';
  const spawn = resolveVillageSpawn(origin, options.spawns);
  const halfDurationMs = sanitizeFadeMs(options.fadeDurationMs);
  const fadeIn = options.fadeInOnEnter === true;
  const lastRunOutcome =
    origin === 'run-victory' ? 'victory' : origin === 'run-defeat' ? 'defeat' : null;

  const state: HubState = {
    location: 'village',
    playerPos: spawn.at,
    playerFacing: spawn.facing,
    characterId: character.id,
    character,
    autoFireEnabled: false,
    dashEnabled: true,
    cameraMode: 'follow',
    musicTrack: VILLAGE_MUSIC_PATH,
    musicDucked: false,
    lastRunOutcome,
    transition: {
      phase: fadeIn ? 'fading-in' : 'idle',
      fadeAlpha: fadeIn ? 1 : 0,
      halfDurationMs,
      target: null,
    },
    pendingRunLaunch: null,
  };

  if (options.startLocation !== 'shop-interior') return state;

  const shopSpawn = resolveShopSpawn(options.spawns);
  return {
    ...state,
    location: 'shop-interior',
    playerPos: shopSpawn.at,
    playerFacing: shopSpawn.facing,
    dashEnabled: false,
    cameraMode: 'static',
    musicDucked: true,
  };
}

/** True while a scene fade is active or a run launch handoff is pending. */
export function isHubTransitioning(state: HubState): boolean {
  return state.transition.phase !== 'idle' || state.pendingRunLaunch !== null;
}

/** Player movement & `[E]` interaction are enabled only while no fade/run handoff is active. */
export function canControlPlayerInHub(state: HubState): boolean {
  return state.transition.phase === 'idle' && state.pendingRunLaunch === null;
}

/** Update the player's live position and facing inside the active hub map. */
export function updateHubPlayerPose(
  state: HubState,
  position: Vec2,
  facing: Direction = state.playerFacing,
): HubState {
  return {
    ...state,
    playerPos: { x: position.x, y: position.y },
    playerFacing: facing,
  };
}

export interface SwitchCharacterResult {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly state: HubState;
}

/**
 * Switch the active character at the Dojo Master (`Võ Đường`).
 * Refuses locked or unknown characters cleanly; when valid, updates `characterId` and `character`
 * (including weapon attachment loadout) live at the exact current village position!
 */
export function switchHubCharacter(
  state: HubState,
  nextId: CharacterId | string,
  save: CharacterUnlockSource = {},
): SwitchCharacterResult {
  const def = getCharacter(nextId);
  if (def === undefined || !isCharacterUnlocked(def.id, save)) {
    return { ok: false, changed: false, state };
  }
  if (def.id === state.characterId) {
    return { ok: true, changed: false, state };
  }
  return {
    ok: true,
    changed: true,
    state: {
      ...state,
      characterId: def.id,
      character: def,
    },
  };
}

/**
 * Begin a smooth fade-out transition (`village ↔ shop-interior` or `village → run`).
 * Ignores duplicate requests if a transition is already underway.
 */
export function startHubTransition(
  state: HubState,
  target: HubTransitionTarget,
  fadeDurationMs?: number,
): HubState {
  if (state.transition.phase !== 'idle' || state.pendingRunLaunch !== null) {
    return state;
  }
  if (target.kind === 'run') {
    if (!Number.isInteger(target.chapter) || target.chapter < 1) {
      throw new Error(`startHubTransition: invalid run chapter ${target.chapter}`);
    }
  }

  return {
    ...state,
    transition: {
      phase: 'fading-out',
      fadeAlpha: state.transition.fadeAlpha,
      halfDurationMs: sanitizeFadeMs(fadeDurationMs ?? state.transition.halfDurationMs),
      target,
    },
  };
}

export interface StepHubTransitionResult {
  readonly state: HubState;
  /** True on the frame the fade-out reaches black and switches map or triggers run launch. */
  readonly switchedLocation: boolean;
  readonly destinationReached: HubTransitionTarget | null;
}

/**
 * Advance the hub fade state machine by `dtMs` milliseconds.
 */
export function stepHubTransition(
  state: HubState,
  dtMs: number,
  spawns?: HubSpawnConfig,
): StepHubTransitionResult {
  const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const { transition } = state;

  if (transition.phase === 'idle' || safeDt === 0) {
    return { state, switchedLocation: false, destinationReached: null };
  }

  const halfMs = sanitizeFadeMs(transition.halfDurationMs);

  if (transition.phase === 'fading-out') {
    const remainingToBlackMs = (1 - transition.fadeAlpha) * halfMs;
    if (safeDt < remainingToBlackMs - 1e-9) {
      const nextAlpha = Math.min(1, transition.fadeAlpha + safeDt / halfMs);
      return {
        state: {
          ...state,
          transition: { ...transition, fadeAlpha: nextAlpha },
        },
        switchedLocation: false,
        destinationReached: null,
      };
    }

    // Reached full black (`fadeAlpha = 1`) — execute scene/location switch!
    const target = transition.target;
    const leftoverMs = Math.max(0, safeDt - remainingToBlackMs);

    if (target === null) {
      return {
        state: {
          ...state,
          transition: { ...transition, phase: 'idle', fadeAlpha: 0, target: null },
        },
        switchedLocation: false,
        destinationReached: null,
      };
    }

    if (target.kind === 'run') {
      const ascensionLevel =
        target.ascensionLevel !== undefined &&
        Number.isInteger(target.ascensionLevel) &&
        target.ascensionLevel >= 0
          ? target.ascensionLevel
          : 0;
      return {
        state: {
          ...state,
          transition: {
            phase: 'idle',
            fadeAlpha: 1,
            halfDurationMs: halfMs,
            target: null,
          },
          pendingRunLaunch: {
            chapter: target.chapter,
            ascensionLevel,
            characterId: state.characterId,
          },
        },
        switchedLocation: true,
        destinationReached: target,
      };
    }

    const nextBase = applyHubLocationSwitch(state, target, halfMs, spawns);
    if (leftoverMs <= 0) {
      return {
        state: nextBase,
        switchedLocation: true,
        destinationReached: target,
      };
    }

    const fadedIn = stepHubTransition(nextBase, leftoverMs, spawns);
    return {
      state: fadedIn.state,
      switchedLocation: true,
      destinationReached: target,
    };
  }

  // `phase === 'fading-in'`
  const nextAlpha = Math.max(0, transition.fadeAlpha - safeDt / halfMs);
  const done = nextAlpha <= 1e-9;
  return {
    state: {
      ...state,
      transition: {
        phase: done ? 'idle' : 'fading-in',
        fadeAlpha: done ? 0 : nextAlpha,
        halfDurationMs: halfMs,
        target: null,
      },
    },
    switchedLocation: false,
    destinationReached: null,
  };
}

function applyHubLocationSwitch(
  state: HubState,
  target: Exclude<HubTransitionTarget, { readonly kind: 'run' }>,
  halfDurationMs: number,
  spawns?: HubSpawnConfig,
): HubState {
  if (target.kind === 'shop-interior') {
    const shopSpawn = resolveShopSpawn(spawns);
    return {
      ...state,
      location: 'shop-interior',
      playerPos: shopSpawn.at,
      playerFacing: shopSpawn.facing,
      autoFireEnabled: false,
      dashEnabled: false,
      cameraMode: 'static',
      musicTrack: VILLAGE_MUSIC_PATH,
      musicDucked: true,
      transition: {
        phase: 'fading-in',
        fadeAlpha: 1,
        halfDurationMs,
        target: null,
      },
    };
  }

  const villageSpawn = resolveVillageSpawn(target.from, spawns);
  const lastRunOutcome =
    target.from === 'run-victory'
      ? 'victory'
      : target.from === 'run-defeat'
        ? 'defeat'
        : state.lastRunOutcome;

  return {
    ...state,
    location: 'village',
    playerPos: villageSpawn.at,
    playerFacing: villageSpawn.facing,
    autoFireEnabled: false,
    dashEnabled: true,
    cameraMode: 'follow',
    musicTrack: VILLAGE_MUSIC_PATH,
    musicDucked: false,
    lastRunOutcome,
    pendingRunLaunch: null,
    transition: {
      phase: 'fading-in',
      fadeAlpha: 1,
      halfDurationMs,
      target: null,
    },
  };
}

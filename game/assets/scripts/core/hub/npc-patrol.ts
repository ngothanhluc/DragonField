/**
 * Deterministic waypoint patrol, pause/look-around, and player-proximity yield AI
 * for the Village Hub's wandering villagers (GDD M21 §2, ADR-028).
 *
 * Pure TS — zero `cc` imports, zero `Math.random()`.
 */
import type { Direction } from '../art/manifest';
import { directionFromVector } from '../art/runtime';
import type { LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { moveWithCollision } from '../movement/collision';
import {
  resolveNpcAnimKey,
  type HubMapData,
  type HubNpcId,
  type HubVillagerId,
  type HubWaypoint,
} from './hub-tmx';

/** Gentle strolling pace in tiles/s (player base walk speed is ~5 tiles/s). */
export const DEFAULT_PATROL_SPEED_TILES_PER_SEC = 1.35;

/** Proximity radius (tiles) at which a villager yields and faces the approaching player. */
export const DEFAULT_YIELD_RADIUS_TILES = 1.85;

/** Hysteresis exit radius (tiles) so standing near the boundary never flickers walk ↔ yield. */
export const DEFAULT_YIELD_EXIT_RADIUS_TILES = 2.2;

/** Interval between subtle head-turns while a villager pauses at a waypoint (ms). */
export const DEFAULT_LOOK_AROUND_INTERVAL_MS = 650;

/** Collision circle radius (tiles) used when sliding patrolling villagers against obstacles. */
export const NPC_BODY_RADIUS_TILES = 0.32;

/** Room edge margin (tiles) for patrolling villagers. */
export const NPC_EDGE_MARGIN_TILES = 0.5;

const ARRIVAL_EPSILON_TILES = 0.04;

/** Deterministic clockwise glance order during waypoint pauses. */
const CLOCKWISE_DIRS: readonly Direction[] = ['down', 'left', 'up', 'right'];

export type NpcPatrolMode = 'patrol' | 'pause' | 'yield';

export interface NpcPatrolTuning {
  readonly speedTilesPerSec: number;
  readonly yieldRadiusTiles: number;
  readonly yieldExitRadiusTiles: number;
  readonly lookAroundIntervalMs: number;
}

export const DEFAULT_NPC_PATROL_TUNING: NpcPatrolTuning = {
  speedTilesPerSec: DEFAULT_PATROL_SPEED_TILES_PER_SEC,
  yieldRadiusTiles: DEFAULT_YIELD_RADIUS_TILES,
  yieldExitRadiusTiles: DEFAULT_YIELD_EXIT_RADIUS_TILES,
  lookAroundIntervalMs: DEFAULT_LOOK_AROUND_INTERVAL_MS,
};

export interface NpcPatrolState {
  readonly id: HubVillagerId;
  readonly position: Vec2;
  readonly facing: Direction;
  /** Direction prior to yielding or glancing, restored cleanly when resuming. */
  readonly baseFacing: Direction;
  readonly mode: NpcPatrolMode;
  /** Mode to resume once the player steps outside the yield radius (`'patrol'` or `'pause'`). */
  readonly resumeMode: 'patrol' | 'pause';
  /** Index of the current target waypoint in `waypoints`. */
  readonly targetIndex: number;
  readonly waypoints: readonly HubWaypoint[];
  /** Remaining dwell time at the current waypoint in ms. */
  readonly pauseRemainingMs: number;
  /** Elapsed dwell time used for deterministic look-around glances. */
  readonly lookElapsedMs: number;
  /** Animation clip kind (`'walk'` only when actively moving). */
  readonly animMode: 'walk' | 'stand';
  /** Manifest key to pass to `SpriteAnimator.play(animKey, facing, fallbackAnimKey)`. */
  readonly animKey: string;
  readonly fallbackAnimKey: string;
}

export interface StepNpcPatrolContext {
  readonly dtMs: number;
  readonly playerPos: Vec2 | null;
  /** Optional NPC currently engaged in active dialog (stays yielded & facing the player). */
  readonly talkingNpcId?: HubNpcId | null;
  readonly collisionLevel?: LevelData;
  readonly tuning?: Partial<NpcPatrolTuning>;
}

function withResolvedAnim(
  base: Omit<NpcPatrolState, 'animMode' | 'animKey' | 'fallbackAnimKey'>,
  moving: boolean,
): NpcPatrolState {
  const animMode: 'walk' | 'stand' = moving ? 'walk' : 'stand';
  const resolved = resolveNpcAnimKey(base.id, animMode, base.facing);
  return {
    ...base,
    animMode,
    animKey: resolved.key,
    fallbackAnimKey: resolved.fallback,
  };
}

function glanceDirection(baseFacing: Direction, stepCount: number): Direction {
  const startIdx = CLOCKWISE_DIRS.indexOf(baseFacing);
  const idx = startIdx >= 0 ? startIdx : 0;
  // Sequence: 0 -> base, 1 -> +1 (90°), 2 -> base, 3 -> +3 (-90°)
  const offsets = [0, 1, 0, 3] as const;
  const offset = offsets[stepCount % offsets.length] ?? 0;
  return CLOCKWISE_DIRS[(idx + offset) % CLOCKWISE_DIRS.length] ?? baseFacing;
}

function faceToward(from: Vec2, to: Vec2, fallback: Direction): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return fallback;
  // Note: Tiled space has +y pointing DOWN (`directionFromVector` treats +y as `'up'` in world space).
  // Flip `dy` so +y in tile space maps to `'down'` and -y maps to `'up'`!
  return directionFromVector({ x: dx, y: -dy }, fallback);
}

/**
 * Create the initial patrol state for one wandering villager.
 */
export function createNpcPatrolState(
  id: HubVillagerId,
  startAt: Vec2,
  initialFacing: Direction,
  waypoints: readonly HubWaypoint[],
): NpcPatrolState {
  if (waypoints.length < 2) {
    throw new Error(`createNpcPatrolState(${id}): requires at least 2 waypoints, got ${waypoints.length}`);
  }
  // Pick the next waypoint after `0` if starting at waypoint 0, else aim at waypoint 0.
  const startsAtZero = distance(startAt, waypoints[0]!.at) <= ARRIVAL_EPSILON_TILES;
  const targetIndex = startsAtZero ? 1 % waypoints.length : 0;
  const facing = faceToward(startAt, waypoints[targetIndex]!.at, initialFacing);

  return withResolvedAnim(
    {
      id,
      position: { x: startAt.x, y: startAt.y },
      facing,
      baseFacing: facing,
      mode: 'patrol',
      resumeMode: 'patrol',
      targetIndex,
      waypoints,
      pauseRemainingMs: 0,
      lookElapsedMs: 0,
    },
    true,
  );
}

/**
 * Build initial patrol states for every wandering villager declared in `village-hub.tmx`.
 */
export function createVillagePatrolRoster(map: HubMapData): readonly NpcPatrolState[] {
  const states: NpcPatrolState[] = [];
  for (const npc of map.npcs) {
    if (npc.role !== 'villager') continue;
    const waypoints = map.patrolRoutes[npc.id];
    if (waypoints === undefined || waypoints.length < 2) continue;
    states.push(createNpcPatrolState(npc.id as HubVillagerId, npc.at, npc.facing, waypoints));
  }
  return states;
}

/**
 * Advance one villager's patrol/pause/yield AI deterministically by `context.dtMs`.
 */
export function stepNpcPatrol(
  state: NpcPatrolState,
  context: StepNpcPatrolContext,
): NpcPatrolState {
  const dtMs = Number.isFinite(context.dtMs) && context.dtMs > 0 ? context.dtMs : 0;
  const tuning: NpcPatrolTuning = {
    ...DEFAULT_NPC_PATROL_TUNING,
    ...context.tuning,
  };

  const player = context.playerPos;
  const isTalking = context.talkingNpcId === state.id;
  const threshold =
    state.mode === 'yield'
      ? Math.max(tuning.yieldRadiusTiles, tuning.yieldExitRadiusTiles)
      : tuning.yieldRadiusTiles;
  const shouldYield =
    isTalking || (player !== null && distance(state.position, player) <= threshold);

  if (shouldYield) {
    const facing =
      player !== null ? faceToward(state.position, player, state.facing) : state.facing;
    const resumeMode = state.mode === 'yield' ? state.resumeMode : state.mode;
    return withResolvedAnim(
      {
        ...state,
        facing,
        mode: 'yield',
        resumeMode,
      },
      false,
    );
  }

  // Exiting yield: restore the prior `patrol` or `pause` mode cleanly.
  const activeMode: 'patrol' | 'pause' = state.mode === 'yield' ? state.resumeMode : state.mode;

  if (dtMs === 0) {
    const restoredFacing =
      state.mode === 'yield'
        ? activeMode === 'pause'
          ? glanceDirection(
              state.baseFacing,
              Math.floor(state.lookElapsedMs / Math.max(1, tuning.lookAroundIntervalMs)),
            )
          : state.baseFacing
        : state.facing;
    return withResolvedAnim(
      {
        ...state,
        facing: restoredFacing,
        mode: activeMode,
      },
      activeMode === 'patrol',
    );
  }

  if (activeMode === 'pause') {
    const remaining = state.pauseRemainingMs - dtMs;
    if (remaining > 0) {
      const lookElapsedMs = state.lookElapsedMs + dtMs;
      const stepIdx = Math.floor(lookElapsedMs / Math.max(1, tuning.lookAroundIntervalMs));
      const facing = glanceDirection(state.baseFacing, stepIdx);
      return withResolvedAnim(
        {
          ...state,
          facing,
          mode: 'pause',
          resumeMode: 'pause',
          pauseRemainingMs: remaining,
          lookElapsedMs,
        },
        false,
      );
    }

    // Pause finished → advance to the next waypoint in the loop!
    const nextIndex = (state.targetIndex + 1) % state.waypoints.length;
    const nextTarget = state.waypoints[nextIndex]!;
    const nextFacing = faceToward(state.position, nextTarget.at, state.baseFacing);
    const leftoverMs = Math.max(0, -remaining);

    const resumed = withResolvedAnim(
      {
        ...state,
        facing: nextFacing,
        baseFacing: nextFacing,
        mode: 'patrol',
        resumeMode: 'patrol',
        targetIndex: nextIndex,
        pauseRemainingMs: 0,
        lookElapsedMs: 0,
      },
      true,
    );
    return leftoverMs > 0 ? stepNpcPatrol(resumed, { ...context, dtMs: leftoverMs }) : resumed;
  }

  // `activeMode === 'patrol'`
  const waypoint = state.waypoints[state.targetIndex]!;
  const dx = waypoint.at.x - state.position.x;
  const dy = waypoint.at.y - state.position.y;
  const distToTarget = Math.hypot(dx, dy);
  const maxStep = tuning.speedTilesPerSec * (dtMs / 1000);

  if (distToTarget <= ARRIVAL_EPSILON_TILES || maxStep >= distToTarget) {
    const finalPos =
      context.collisionLevel !== undefined
        ? moveWithCollision(
            state.position,
            { x: dx, y: dy },
            NPC_BODY_RADIUS_TILES,
            context.collisionLevel,
            NPC_EDGE_MARGIN_TILES,
          )
        : { x: waypoint.at.x, y: waypoint.at.y };

    const pauseMs = Math.max(0, waypoint.pauseMs);
    if (pauseMs === 0) {
      const nextIndex = (state.targetIndex + 1) % state.waypoints.length;
      const nextFacing = faceToward(finalPos, state.waypoints[nextIndex]!.at, state.facing);
      return withResolvedAnim(
        {
          ...state,
          position: finalPos,
          facing: nextFacing,
          baseFacing: nextFacing,
          mode: 'patrol',
          resumeMode: 'patrol',
          targetIndex: nextIndex,
          pauseRemainingMs: 0,
          lookElapsedMs: 0,
        },
        true,
      );
    }

    const arrivalFacing = distToTarget > 1e-6 ? faceToward(state.position, waypoint.at, state.baseFacing) : state.baseFacing;
    return withResolvedAnim(
      {
        ...state,
        position: finalPos,
        facing: arrivalFacing,
        baseFacing: arrivalFacing,
        mode: 'pause',
        resumeMode: 'pause',
        pauseRemainingMs: pauseMs,
        lookElapsedMs: 0,
      },
      false,
    );
  }

  const ratio = maxStep / distToTarget;
  const delta = { x: dx * ratio, y: dy * ratio };
  const nextPos =
    context.collisionLevel !== undefined
      ? moveWithCollision(
          state.position,
          delta,
          NPC_BODY_RADIUS_TILES,
          context.collisionLevel,
          NPC_EDGE_MARGIN_TILES,
        )
      : { x: state.position.x + delta.x, y: state.position.y + delta.y };

  const movedDist = distance(state.position, nextPos);
  const nextFacing = faceToward(state.position, waypoint.at, state.baseFacing);
  return withResolvedAnim(
    {
      ...state,
      position: nextPos,
      facing: nextFacing,
      baseFacing: nextFacing,
      mode: 'patrol',
      resumeMode: 'patrol',
      pauseRemainingMs: 0,
      lookElapsedMs: 0,
    },
    movedDist > 1e-5,
  );
}

/**
 * Step all wandering villagers in a deterministic batch.
 */
export function stepAllVillagers(
  roster: readonly NpcPatrolState[],
  context: StepNpcPatrolContext,
): readonly NpcPatrolState[] {
  return roster.map((npc) => stepNpcPatrol(npc, context));
}

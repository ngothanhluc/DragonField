/**
 * Boss pattern state machine (GDD §5).
 *
 * Contract: `stepBoss({ state, nowMs, deltaMs, player, rng })` is a **pure function**
 * — no clock reads, no `Math.random`, no touching Cocos nodes. Same state +
 * same input sequence + same seed gives **exactly the same** event stream. `SeededRng` is
 * passed in from outside and is never created in this file.
 *
 * Determinism: same state + same input sequence (`nowMs`, `deltaMs`, `player`) +
 * same seed gives **exactly the same** event stream. `SeededRng` is passed in from
 * outside and is never created in this file — and it **is consumed**, so re-running
 * a segment requires a new instance from the same seed.
 *
 * Time: `state.step` is the step index in the current phase's script,
 * `state.stepStartedMs` is when that step began. The caller only calls once per frame;
 * everything else (advance step, loop, change phase) is `stepBoss`'s job.
 *
 * Phase only ever **advances, never regresses**: healing does not pull the boss back to an earlier
 * phase, because each threshold emits `phase-change` exactly once (state.phase is the memory of that).
 * việc đó).
 *
 * Position: `state.position` is the **source of truth** — `stepBoss` integrates movement
 * by `deltaMs` itself. The `move` event is only an *intent* for the adapter (where to go,
 * how fast) so it can play walk/charge animations; the adapter may also follow
 * `state.position` each frame instead of interpolating events.
 *
 * Telegraph: **every** damage-dealing step (volley, spiral, trail, charge) sits
 * immediately after a step with `telegraph`, duration `TELEGRAPH_MS.boss` (800 ms).
 *
 * Tile-unit coordinates, top-left origin, y pointing down (same system as `LevelData`). Angles
 * are **radians**, 0 = +x, `Math.PI / 2` = +y (down).
 */
import { TELEGRAPH_MS } from '../combat/telegraph';
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import {
  BOSSES,
  BOSS_FEET_OFFSET_TILES,
  animationFor,
  healthFraction,
  oppositeFacing,
  phaseFor,
  type BossAnimKind,
  type BossId,
  type BossPhase,
  type Facing,
} from './boss-defs';

// ---------------------------------------------------------------------------
// State and events
// ---------------------------------------------------------------------------

/**
 * The whole boss state. **Flat data only** — no classes, no functions —
 * because save/teleport will snapshot this object as-is.
 */
export interface BossState {
  id: BossId;
  position: Vec2;
  health: number;
  phase: BossPhase;
  /** Current step in the `phase` script. */
  step: number;
  stepStartedMs: number;
  facing: Facing;
  /** Non-`null` only during a charge step; `move` also reads from here. */
  chargeDirection: Vec2 | null;
}

/**
 * Minimal description of one bullet for the adapter: it looks up the pool itself and assigns ttl/owner.
 *
 * - `toward !== null`: flight direction = `normalize(toward - from)` plus
 *   `angleOffset` radian.
 * - `toward === null`: `angleOffset` is the **absolute angle** (radians).
 */
export interface BulletVerb {
  from: Vec2;
  toward: Vec2 | null;
  angleOffset: number;
  speed: number;
  damage: number;
  radiusTiles: number;
}

export type BossEvent =
  | { kind: 'play-animation'; animation: string }
  | { kind: 'shoot'; bullets: BulletVerb[] }
  | { kind: 'move'; to: Vec2; speedTilesPerSecond: number }
  | { kind: 'telegraph'; durationMs: number; at: Vec2 }
  | { kind: 'summon'; role: EnemyRole; count: number }
  | { kind: 'phase-change'; phase: BossPhase };

export interface StepBossArgs {
  readonly state: BossState;
  readonly nowMs: number;
  readonly deltaMs: number;
  readonly player: Vec2;
  /** The only randomness source for movement/summon placement. */
  readonly rng: SeededRng;
}

/** Initial state of a freshly spawned boss; `stepStartedMs = 0`. */
export function initialBossState(id: BossId, position: Vec2): BossState {
  return {
    id,
    // A `.tmx` spawn may be against the wall; pull it in so the sprite is not cut on the first frame.
    position: clampToRoom(position, bossRoomBounds(id)),
    health: BOSSES[id].maxHealth,
    phase: 1,
    step: 0,
    stepStartedMs: 0,
    facing: 'right',
    chargeDirection: null,
  };
}

/** A dead boss: no actions, no shots, no further phase changes. */
export function isBossDefeated(state: BossState): boolean {
  return state.health <= 0;
}

// ---------------------------------------------------------------------------
// Pattern data
// ---------------------------------------------------------------------------

/** Keep 1 tile off the wall: the boss never enters a wall or stands half outside the room. */
export const BOSS_EDGE_MARGIN_TILES = 1;

/** The "instant teleport" speed used in the `move` event — the adapter treats it as a snap. */
export const TELEPORT_SNAP_SPEED_TILES_PER_SECOND = 64;

/** A teleport must land at least this far from the player, otherwise it is pointless. */
export const TELEPORT_MIN_DISTANCE_FROM_PLAYER_TILES = 6;

/** Attempts to pick a teleport point before taking the farthest attempt from the player. */
const TELEPORT_ATTEMPTS = 8;

/** Spacing between two bullets in a Samurai slash wave, tiles. */
const LINE_BULLET_SPACING_TILES = 0.6;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

/** Area where the boss hitbox centre may stand, room coordinates (tiles, y pointing down). */
export interface RoomBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Standing area of a boss: keeps at least `BOSS_EDGE_MARGIN_TILES`, and wide enough for
 * the **whole sprite** (`spriteExtentTiles`, measured from the feet) to stay inside the room. Reserving
 * by hitbox only would cut half of a 96 px boss charging against the wall.
 */
export function bossRoomBounds(id: BossId): RoomBounds {
  const extent = BOSSES[id].spriteExtentTiles;
  return {
    minX: Math.max(BOSS_EDGE_MARGIN_TILES, extent.left),
    maxX: ROOM_COLS - Math.max(BOSS_EDGE_MARGIN_TILES, extent.right),
    minY: Math.max(BOSS_EDGE_MARGIN_TILES, extent.up - BOSS_FEET_OFFSET_TILES),
    maxY: ROOM_ROWS - Math.max(BOSS_EDGE_MARGIN_TILES, BOSS_FEET_OFFSET_TILES),
  };
}

/** How the boss moves during a step. */
export type BossMotion =
  | { readonly kind: 'chase'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'swim'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'charge'; readonly speedTilesPerSecond: number }
  /** Move along y to the player's row (Samurai builds speed sideways). */
  | { readonly kind: 'line-up'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'teleport' };

/**
 * One bullet batch. `fan`/`spread` auto-aim at the player (they differ in opening);
 * `ring` spreads evenly over 360°; `line` is a slash wave flying along `facing`.
 */
export type VolleyShape = 'fan' | 'spread' | 'ring' | 'line';

export interface VolleySpec {
  readonly shape: VolleyShape;
  readonly count: number;
  /** Total opening angle of `fan`/`spread`, radians. Ignored for `ring`/`line`. */
  readonly spreadRadians: number;
  /** Absolute angle of the first bullet in `ring`, radians. Ignored by the other shapes. */
  readonly baseAngleRadians: number;
  /**
   * Whether the ring rotates so the first bullet points straight at the player.
   *
   * An 8-bullet ring is still an 8-bullet ring; this flag just guarantees **one** bullet
   * travels the exact line to the player, so standing still gets hit. Without it, a ring fired from
   * a random teleport spot can miss a player standing in a corner — and "the pattern
   * forces movement" would only be true on paper.
   */
  readonly ringAimsAtPlayer?: boolean;
  readonly speedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

/**
 * Fire trail the Samurai leaves while charging (phase 3).
 *
 * The fire blooms **along the whole charge lane** the moment the boss launches (one `shoot` event with
 * many bullets placed in advance), then drifts slowly with the charge direction. That keeps state
 * flat (no drip counter) yet still reads: the boss charges at 9 tiles/s while the fire
 * drifts at 1.2 tiles/s, so it falls behind almost immediately.
 */
export interface TrailSpec {
  readonly spacingTiles: number;
  /** The trail drifts slowly along the charge direction instead of standing still (bullets need speed > 0). */
  readonly driftSpeedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

/** Squid spiral: fires one bullet every `intervalMs`, rotating the angle evenly. */
export interface SpiralSpec {
  readonly intervalMs: number;
  readonly angleStepRadians: number;
  readonly speedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

export type BossAction =
  | { readonly kind: 'face'; readonly direction: 'player' | 'opposite' }
  | { readonly kind: 'animation'; readonly animation: BossAnimKind }
  | { readonly kind: 'telegraph' }
  | { readonly kind: 'move'; readonly motion: BossMotion }
  | { readonly kind: 'volley'; readonly volley: VolleySpec }
  | { readonly kind: 'spiral'; readonly spiral: SpiralSpec }
  | { readonly kind: 'trail'; readonly trail: TrailSpec }
  | { readonly kind: 'summon'; readonly role: EnemyRole; readonly count: number };

export interface BossStep {
  readonly durationMs: number;
  readonly actions: readonly BossAction[];
}

export interface BossPhaseScript {
  readonly steps: readonly BossStep[];
  /** Step at which the loop restarts after the first run. Defaults to 0. */
  readonly loopFrom?: number;
}

export type BossScripts = Readonly<Record<BossId, Readonly<Record<BossPhase, BossPhaseScript>>>>;

/**
 * Does this step deal damage? (`volley`, `spiral`, `trail`, and a charge `move`
 * because the boss body hurts while charging.) Tests use this to enforce
 * that every such step sits behind a telegraph step.
 */
export function isDamagingStep(step: BossStep): boolean {
  return step.actions.some(
    (action) =>
      action.kind === 'volley' ||
      action.kind === 'spiral' ||
      action.kind === 'trail' ||
      (action.kind === 'move' && action.motion.kind === 'charge'),
  );
}

// --- Prebuilt volleys ------------------------------------------------------

const TENGU_FAN: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'fan',
    count: 5,
    spreadRadians: 60 * DEG,
    baseAngleRadians: 0,
    speedTilesPerSecond: 6,
    damage: 1,
    radiusTiles: 0.25,
  },
};

const TENGU_RING: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'ring',
    count: 8,
    spreadRadians: 0,
    baseAngleRadians: -HALF_PI,
    ringAimsAtPlayer: true,
    speedTilesPerSecond: 5,
    damage: 1,
    radiusTiles: 0.25,
  },
};

const SQUID_SPREAD: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'spread',
    count: 5,
    spreadRadians: 110 * DEG,
    baseAngleRadians: 0,
    speedTilesPerSecond: 4.5,
    damage: 1,
    radiusTiles: 0.3,
  },
};

const SAMURAI_SLASH: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'line',
    count: 3,
    spreadRadians: 0,
    baseAngleRadians: 0,
    speedTilesPerSecond: 7,
    damage: 2,
    radiusTiles: 0.3,
  },
};

const SAMURAI_FIRE_TRAIL: BossAction = {
  kind: 'trail',
  trail: {
    spacingTiles: 1.5,
    driftSpeedTilesPerSecond: 1.2,
    damage: 1,
    radiusTiles: 0.35,
  },
};

/** Phase 2 spiral: slow, readable rhythm. */
const SQUID_SPIRAL_SLOW: BossAction = {
  kind: 'spiral',
  spiral: {
    intervalMs: 140,
    angleStepRadians: 24 * DEG,
    speedTilesPerSecond: 4,
    damage: 1,
    radiusTiles: 0.3,
  },
};

/** Phase 3 spiral: faster (GDD §5 "spins faster"). */
const SQUID_SPIRAL_FAST: BossAction = {
  kind: 'spiral',
  spiral: {
    intervalMs: 110,
    angleStepRadians: 30 * DEG,
    speedTilesPerSecond: 4.5,
    damage: 1,
    radiusTiles: 0.3,
  },
};

const TELEGRAPH_ACTION: BossAction = { kind: 'telegraph' };

const TENGU_WALK_CHASE: BossAction = {
  kind: 'move',
  motion: { kind: 'chase', speedTilesPerSecond: 2.2 },
};

const SQUID_SWIM: BossAction = {
  kind: 'move',
  motion: { kind: 'swim', speedTilesPerSecond: 2.6 },
};

/** Squid phase 3 "speed up": swims faster. */
const SQUID_SWIM_FAST: BossAction = {
  kind: 'move',
  motion: { kind: 'swim', speedTilesPerSecond: 3.2 },
};

const SAMURAI_CHARGE: BossAction = {
  kind: 'move',
  motion: { kind: 'charge', speedTilesPerSecond: 9 },
};

/**
 * Line up with the player's row before charging sideways (GDD §5: an L/R charge is an
 * attack tell). If the boss always charged in its old row, a player standing in another
 * row would never be threatened; lining up makes the charge meaningful while keeping the
 * horizontal direction and L/R animation.
 */
const SAMURAI_LINE_UP: BossAction = {
  kind: 'move',
  motion: { kind: 'line-up', speedTilesPerSecond: 8 },
};

/** Long enough to line up from the boss row to the player row in an 18-tile arena. */
const SAMURAI_LINE_UP_MS = 1600;

const TELEPORT: BossAction = {
  kind: 'move',
  motion: { kind: 'teleport' },
};

function anim(animation: BossAnimKind): BossAction {
  return { kind: 'animation', animation };
}

function face(direction: 'player' | 'opposite'): BossAction {
  return { kind: 'face', direction };
}

// --- Scripts of the 3 bosses -----------------------------------------------

/**
 * Patterns per GDD §5. Read by column: a step that starts with a telegraph has the real attack
 * in the next step — the player gets exactly 800 ms to dodge.
 */
export const BOSS_SCRIPTS: BossScripts = {
  // -------------------------------------------------------------------------
  // Ch1 — TenguBlue: walk-chase + 5-bullet fan → adds Trans + 8-bullet ring →
  // enrage: teleport ×3, each followed by a 5-bullet fan.
  // -------------------------------------------------------------------------
  tengu: {
    1: {
      steps: [
        { durationMs: 600, actions: [anim('idle')] },
        { durationMs: 1400, actions: [TENGU_WALK_CHASE, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 650, actions: [TENGU_FAN] },
        { durationMs: 450, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: 350, actions: [anim('idle')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 700, actions: [TENGU_RING] },
        { durationMs: 1200, actions: [TENGU_WALK_CHASE, anim('walk')] },
      ],
    },
    3: {
      steps: [
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 250, actions: [anim('idle')] },
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 250, actions: [anim('idle')] },
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 700, actions: [anim('idle')] },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Ch2 — SquidGreen: swim sideways + 5-bullet spread Shoot → AttackLoop spiral →
  // summon 2 casters then spin faster.
  // -------------------------------------------------------------------------
  squid: {
    1: {
      steps: [
        { durationMs: 1500, actions: [SQUID_SWIM, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [anim('shoot'), SQUID_SPREAD] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 2400, actions: [anim('loop'), SQUID_SPIRAL_SLOW] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
    3: {
      // Step 0 (summon) runs only once on phase entry; the loop starts at 1.
      loopFrom: 1,
      steps: [
        {
          durationMs: 500,
          actions: [{ kind: 'summon', role: 'caster', count: 2 }, anim('idle')],
        },
        { durationMs: 1300, actions: [SQUID_SWIM_FAST, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 2600, actions: [anim('loop'), SQUID_SPIRAL_FAST] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Ch3 — GiantBlueSamurai: horizontal charge + straight slash wave → double charge changing
  // direction → charge leaving a fire trail + double slash.
  // -------------------------------------------------------------------------
  samurai: {
    1: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [SAMURAI_SLASH] },
        { durationMs: 700, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('opposite'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [face('player'), TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [SAMURAI_SLASH] },
        { durationMs: 600, actions: [anim('idle')] },
      ],
    },
    3: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge'), SAMURAI_FIRE_TRAIL] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 450, actions: [SAMURAI_SLASH] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 450, actions: [SAMURAI_SLASH] },
        { durationMs: 600, actions: [anim('idle')] },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export function stepBoss(args: StepBossArgs): { state: BossState; events: BossEvent[] } {
  const { nowMs, deltaMs, player } = args;

  if (!Number.isFinite(nowMs)) {
    throw new Error(`stepBoss needs a finite nowMs, got ${nowMs}`);
  }
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error(`stepBoss needs a finite deltaMs >= 0, got ${deltaMs}`);
  }

  // Copy: never mutate the caller's state.
  const state: BossState = {
    ...args.state,
    position: { x: args.state.position.x, y: args.state.position.y },
    chargeDirection:
      args.state.chargeDirection === null
        ? null
        : { x: args.state.chargeDirection.x, y: args.state.chargeDirection.y },
  };
  const events: BossEvent[] = [];

  if (isBossDefeated(state)) return { state, events };

  // --- Phase change: each crossed threshold emits exactly one event ---------
  const targetPhase = phaseFor(state.id, healthFraction(state.id, state.health));
  if (targetPhase > state.phase) {
    for (let next = state.phase + 1; next <= targetPhase; next += 1) {
      const phase: BossPhase = next === 2 ? 2 : 3;
      state.phase = phase;
      events.push({ kind: 'phase-change', phase });
    }
    state.step = 0;
    state.stepStartedMs = nowMs;
    state.chargeDirection = null;
  }

  const script = BOSS_SCRIPTS[state.id][state.phase];
  const windowStart = nowMs - deltaMs;
  const context: StepContext = { state, player, rng: args.rng, events };

  // A step starting **inside** this window must run its opening action immediately.
  // A step starting exactly at `nowMs` is left to the next frame (avoids emitting twice at a frame boundary).
  if (state.stepStartedMs >= windowStart && state.stepStartedMs < nowMs) {
    enterStep(context, stepAt(script, state.step));
  }

  let cursor = Math.max(windowStart, state.stepStartedMs);
  while (cursor < nowMs) {
    const step = stepAt(script, state.step);
    const stepEnd = state.stepStartedMs + step.durationMs;
    const chunkEnd = Math.min(nowMs, stepEnd);

    advanceMotion(context, step, cursor, chunkEnd);
    emitSpiralTicks(context, step, state.stepStartedMs, cursor, chunkEnd);
    cursor = chunkEnd;

    // Step boundary lands exactly at the window end: let the next frame open the new step, avoiding
    // emitting the opening action twice on either side of a frame boundary.
    if (stepEnd >= nowMs) break;

    nextStep(state, script);
    state.stepStartedMs = stepEnd;
    enterStep(context, stepAt(script, state.step));
  }

  return { state, events };
}

// ---------------------------------------------------------------------------
// Internal: run a step
// ---------------------------------------------------------------------------

interface StepContext {
  readonly state: BossState;
  readonly player: Vec2;
  readonly rng: SeededRng;
  readonly events: BossEvent[];
}

/** Movement settled for one step; `target` is the destination the `move` event reports. */
interface MotionPlan {
  readonly motion: BossMotion;
  readonly target: Vec2;
  readonly speedTilesPerSecond: number;
}

function stepAt(script: BossPhaseScript, index: number): BossStep {
  const steps = script.steps;
  const length = steps.length;
  if (length === 0) {
    throw new Error('Boss script must have at least one step');
  }

  const wrapped = ((index % length) + length) % length;
  const step = steps[wrapped];
  if (step === undefined) {
    throw new Error(`Boss script is missing step ${wrapped}/${length}`);
  }
  // A 0 ms step would make time stand still — block it at the data level.
  if (!(step.durationMs > 0)) {
    throw new Error(`Step ${wrapped} of the boss script must have durationMs > 0`);
  }
  return step;
}

function nextStep(state: BossState, script: BossPhaseScript): void {
  const next = state.step + 1;
  state.step = next >= script.steps.length ? (script.loopFrom ?? 0) : next;
}

/** Run the opening action of a step that just started. */
function enterStep(context: StepContext, step: BossStep): void {
  const { state, player, events } = context;
  let plan = planMotion(state, step, player);

  // Teleport is the only step that needs RNG, and only draws **once** on step entry.
  if (plan !== null && plan.motion.kind === 'teleport') {
    const target = pickTeleportTarget(context.rng, state.position, player, bossRoomBounds(state.id));
    state.position = { x: target.x, y: target.y };
    plan = { ...plan, target };
  }

  for (const action of step.actions) {
    switch (action.kind) {
      case 'face':
        state.facing =
          action.direction === 'player'
            ? player.x < state.position.x
              ? 'left'
              : 'right'
            : oppositeFacing(state.facing);
        break;

      case 'animation':
        events.push({
          kind: 'play-animation',
          animation: animationFor(state.id, action.animation, state.facing),
        });
        break;

      case 'telegraph':
        events.push({
          kind: 'telegraph',
          durationMs: TELEGRAPH_MS.boss,
          at: { x: state.position.x, y: state.position.y },
        });
        break;

      case 'move':
        if (plan === null) throw new Error('A step has move but no movement plan could be built');
        events.push({
          kind: 'move',
          to: { x: plan.target.x, y: plan.target.y },
          speedTilesPerSecond: plan.speedTilesPerSecond,
        });
        break;

      case 'volley':
        events.push({ kind: 'shoot', bullets: buildVolley(action.volley, state, player) });
        break;

      case 'trail':
        events.push({ kind: 'shoot', bullets: buildTrail(action.trail, state, plan, step) });
        break;

      case 'summon':
        events.push({ kind: 'summon', role: action.role, count: action.count });
        break;

      case 'spiral':
        // Emitted gradually at the `emitSpiralTicks` cadence, not as one blob here.
        break;
    }
  }
}

/**
 * Movement plan for the step — **pure**, no RNG. `teleport` returns the
 * current position as a temporary target; `enterStep` replaces it with the RNG-chosen point.
 */
function planMotion(state: BossState, step: BossStep, player: Vec2): MotionPlan | null {
  const bounds = bossRoomBounds(state.id);
  const move = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'move' }> => action.kind === 'move',
  );
  if (move === undefined) {
    state.chargeDirection = null;
    return null;
  }

  const motion = move.motion;
  switch (motion.kind) {
    case 'chase':
      state.chargeDirection = null;
      return {
        motion,
        target: clampToRoom(player, bounds),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'swim': {
      state.chargeDirection = null;
      return {
        motion,
        target: travelTarget(state, motion.speedTilesPerSecond, step.durationMs),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };
    }

    case 'charge':
      state.chargeDirection = directionForFacing(state.facing);
      return {
        motion,
        target: travelTarget(state, motion.speedTilesPerSecond, step.durationMs),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'line-up':
      state.chargeDirection = null;
      return {
        motion,
        target: {
          x: state.position.x,
          y: clamp(player.y, bounds.minY, bounds.maxY),
        },
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'teleport':
      state.chargeDirection = null;
      return {
        motion,
        target: { x: state.position.x, y: state.position.y },
        speedTilesPerSecond: TELEPORT_SNAP_SPEED_TILES_PER_SECOND,
      };
  }
}

/** Integrate movement over `[fromMs, toMs)` of the current step. */
function advanceMotion(
  context: StepContext,
  step: BossStep,
  fromMs: number,
  toMs: number,
): void {
  if (toMs <= fromMs) return;

  const move = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'move' }> => action.kind === 'move',
  );
  if (move === undefined) return;

  const { state, player, events } = context;
  const { minX, maxX, minY, maxY } = bossRoomBounds(state.id);
  const dt = (toMs - fromMs) / 1000;
  const motion = move.motion;

  switch (motion.kind) {
    case 'teleport':
      // Already snapped on step entry.
      break;

    case 'chase': {
      const bounds = { minX, maxX, minY, maxY };
      const target = clampToRoom(player, bounds);
      const dir = directionBetween(state.position, target);
      const travel = Math.min(motion.speedTilesPerSecond * dt, distance(state.position, target));
      state.position = clampToRoom(
        {
          x: state.position.x + dir.x * travel,
          y: state.position.y + dir.y * travel,
        },
        bounds,
      );
      break;
    }

    case 'swim': {
      const sign = state.facing === 'right' ? 1 : -1;
      const nextX = state.position.x + sign * motion.speedTilesPerSecond * dt;
      state.position = { x: clamp(nextX, minX, maxX), y: state.position.y };

      const hitEdge = nextX <= minX || nextX >= maxX;
      if (hitEdge) {
        state.facing = oppositeFacing(state.facing);
        // Direction change mid-step: report the new target to the adapter, otherwise it keeps moving into the wall.
        events.push({
          kind: 'move',
          to: { x: state.facing === 'right' ? maxX : minX, y: state.position.y },
          speedTilesPerSecond: motion.speedTilesPerSecond,
        });
      }
      break;
    }

    case 'charge': {
      const direction = state.chargeDirection ?? directionForFacing(state.facing);
      const nextX = state.position.x + direction.x * motion.speedTilesPerSecond * dt;
      state.position = { x: clamp(nextX, minX, maxX), y: state.position.y };
      break;
    }

    case 'line-up': {
      const targetY = clamp(player.y, minY, maxY);
      const dy = targetY - state.position.y;
      const travel = motion.speedTilesPerSecond * dt;
      const nextY =
        Math.abs(dy) <= travel ? targetY : state.position.y + Math.sign(dy) * travel;
      state.position = { x: state.position.x, y: clamp(nextY, minY, maxY) };
      break;
    }
  }
}

/**
 * Emit spiral bullets falling inside `[fromMs, toMs)` of the step.
 *
 * Ticks are counted by **elapsed time**, not by a counter in state — that keeps
 * state flat and a long frame (dropped frame) does not lose the rhythm.
 */
function emitSpiralTicks(
  context: StepContext,
  step: BossStep,
  stepStartedMs: number,
  fromMs: number,
  toMs: number,
): void {
  const spiral = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'spiral' }> => action.kind === 'spiral',
  );
  if (spiral === undefined || toMs <= fromMs) return;
  if (!(spiral.spiral.intervalMs > 0)) {
    throw new Error(`spiral.intervalMs must be > 0, got ${spiral.spiral.intervalMs}`);
  }

  const { state, player, events } = context;
  const interval = spiral.spiral.intervalMs;
  const fromElapsed = fromMs - stepStartedMs;
  const toElapsed = toMs - stepStartedMs;
  const firstTick = Math.max(0, Math.ceil(fromElapsed / interval));

  for (let tick = firstTick; tick * interval < toElapsed; tick += 1) {
    const base = angleBetween(state.position, player);
    events.push({
      kind: 'shoot',
      bullets: [
        {
          from: { x: state.position.x, y: state.position.y },
          toward: null,
          angleOffset: base + tick * spiral.spiral.angleStepRadians,
          speed: spiral.spiral.speedTilesPerSecond,
          damage: spiral.spiral.damage,
          radiusTiles: spiral.spiral.radiusTiles,
        },
      ],
    });
  }
}

/**
 * Actual velocity of a `BulletVerb` — the angle convention lives here so game and sim
 * never `atan2` differently. With `toward !== null` it flies there then adds
 * `angleOffset`; otherwise `angleOffset` is the absolute angle.
 */
export function bulletVelocity(verb: BulletVerb): Vec2 {
  const baseAngle =
    verb.toward === null
      ? 0
      : Math.atan2(verb.toward.y - verb.from.y, verb.toward.x - verb.from.x);
  const angle = baseAngle + verb.angleOffset;
  return {
    x: Math.cos(angle) * verb.speed,
    y: Math.sin(angle) * verb.speed,
  };
}

// ---------------------------------------------------------------------------
// Internal: build bullets
// ---------------------------------------------------------------------------

function buildVolley(spec: VolleySpec, state: BossState, player: Vec2): BulletVerb[] {
  const from = state.position;
  const bullets: BulletVerb[] = [];

  switch (spec.shape) {
    case 'fan':
    case 'spread': {
      const aim = aimPoint(from, player, spec.baseAngleRadians);
      const stepRadians = spec.count > 1 ? spec.spreadRadians / (spec.count - 1) : 0;
      for (let index = 0; index < spec.count; index += 1) {
        bullets.push({
          from: copy(from),
          toward: aim,
          angleOffset: (index - (spec.count - 1) / 2) * stepRadians,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }

    case 'ring': {
      const startAngle =
        spec.ringAimsAtPlayer === true
          ? angleBetween(from, player)
          : spec.baseAngleRadians;
      for (let index = 0; index < spec.count; index += 1) {
        bullets.push({
          from: copy(from),
          toward: null,
          angleOffset: startAngle + (index * TWO_PI) / spec.count,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }

    case 'line': {
      // Slash wave: bullets line up **perpendicular** to the flight direction, so the
      // whole row sweeps the arena like one cut instead of a spread cluster.
      const angle = state.facing === 'right' ? 0 : Math.PI;
      const perpendicular = { x: -Math.sin(angle), y: Math.cos(angle) };
      for (let index = 0; index < spec.count; index += 1) {
        const offset = (index - (spec.count - 1) / 2) * LINE_BULLET_SPACING_TILES;
        bullets.push({
          from: { x: from.x + perpendicular.x * offset, y: from.y + perpendicular.y * offset },
          toward: null,
          angleOffset: angle,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }
  }

  return bullets;
}

/** Fire trail laid along the charge segment travelled so far (not all the way to the wall). */
function buildTrail(
  spec: TrailSpec,
  state: BossState,
  plan: MotionPlan | null,
  step: BossStep,
): BulletVerb[] {
  if (plan === null || plan.motion.kind !== 'charge') {
    throw new Error('trail needs the current step to be a charge');
  }

  const direction = state.chargeDirection ?? directionForFacing(state.facing);
  const angle = Math.atan2(direction.y, direction.x);
  const travelled = Math.min(
    distance(state.position, plan.target),
    (plan.motion.speedTilesPerSecond * step.durationMs) / 1000,
  );
  const count = Math.max(1, Math.floor(travelled / spec.spacingTiles));

  const bullets: BulletVerb[] = [];
  for (let index = 1; index <= count; index += 1) {
    const along = (travelled * index) / count;
    bullets.push({
      from: { x: state.position.x + direction.x * along, y: state.position.y + direction.y * along },
      toward: null,
      angleOffset: angle,
      speed: spec.driftSpeedTilesPerSecond,
      damage: spec.damage,
      radiusTiles: spec.radiusTiles,
    });
  }
  return bullets;
}

// ---------------------------------------------------------------------------
// Internal: geometry
// ---------------------------------------------------------------------------

function copy(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampToRoom(point: Vec2, bounds: RoomBounds): Vec2 {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

/** Flight direction for `facing`; the Samurai only charges sideways (GDD §5). */
function directionForFacing(facing: Facing): Vec2 {
  return facing === 'right' ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

/**
 * **Real** destination of a swim/charge step: it stops exactly where `durationMs` of travel
 * ends, not at the wall. That keeps the `move` event and
 * `state.position` consistent — interpolating the event is right, and reading state
 * each frame is right too.
 */
function travelTarget(state: BossState, speedTilesPerSecond: number, durationMs: number): Vec2 {
  const sign = state.facing === 'right' ? 1 : -1;
  const travel = (speedTilesPerSecond * durationMs) / 1000;
  const bounds = bossRoomBounds(state.id);
  return {
    x: clamp(state.position.x + sign * travel, bounds.minX, bounds.maxX),
    y: state.position.y,
  };
}

function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Aim point: the player, or a point 1 tile along `fallbackAngle` when the player
 * stands exactly on the boss (no defined direction).
 */
function aimPoint(from: Vec2, player: Vec2, fallbackAngle: number): Vec2 {
  if (distance(from, player) > 0) return copy(player);
  return { x: from.x + Math.cos(fallbackAngle), y: from.y + Math.sin(fallbackAngle) };
}

function directionBetween(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * Random teleport point inside the room, preferring far from the player.
 *
 * Always spends exactly `TELEPORT_ATTEMPTS` draws (2 numbers each) so the RNG stream does
 * not depend on which attempt succeeded — otherwise determinism still holds
 * but RNG rhythm jumps with player position.
 */
function pickTeleportTarget(
  rng: SeededRng,
  from: Vec2,
  player: Vec2,
  bounds: RoomBounds,
): Vec2 {
  const { minX, maxX, minY, maxY } = bounds;
  let best = clampToRoom({ x: maxX, y: from.y }, bounds);
  let bestGap = -1;

  for (let attempt = 0; attempt < TELEPORT_ATTEMPTS; attempt += 1) {
    const candidate: Vec2 = {
      x: minX + rng.next() * (maxX - minX),
      y: minY + rng.next() * (maxY - minY),
    };
    const gap = distance(candidate, player);
    if (gap >= TELEPORT_MIN_DISTANCE_FROM_PLAYER_TILES) return candidate;
    if (gap > bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }

  return best;
}

/**
 * Test-only "competent player" policy used by the run-simulation balance tests.
 *
 * It is **not** game AI and nothing in `assets/` imports it: it only reads `PolicyWorld` and
 * returns this frame's WASD keys, so the balance numbers come from the real `core/` rules.
 *
 * Sign convention: the **sim** applies `normalizeMoveInput` directly in tile space (y points
 * down), so `up` moves toward `-y`? No — see `move-intent.ts`: `up` = `+y`, i.e. tile-down. The
 * game adapter flips the sign once (`player-controller`), the sim does not, so a policy must map
 * a tile-space direction `(dx, dy)` to keys as `up: dy > 0, down: dy < 0` (the same rule as
 * `core/sim/boss-run.ts:moveInputToward`). Evaluating a path in the *opposite* direction than the
 * keys produce makes the player stand still against a wall, so this file keeps directions in tile
 * space only and derives the keys with `inputFor`.
 */
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';
import type { InputPolicy, PolicyWorld } from '../../assets/scripts/core/sim/run-simulation';

const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });

interface Direction {
  /** Tile-space x of the step (y grows downward, like `LevelData`). */
  readonly x: number;
  /** Tile-space y of the step: +1 = down the room, -1 = up the room. */
  readonly y: number;
}

/** WASD keys that walk `direction` in the sim's tile-space convention (`up` = +y). */
function inputFor(direction: Direction) {
  return {
    up: direction.y > 0,
    down: direction.y < 0,
    left: direction.x < 0,
    right: direction.x > 0,
  };
}

/**
 * Dodge policy: scores the 8 directions over the next 1.2 s of walking and picks the cheapest.
 * A direction is good when it keeps the nearest enemy at about `DODGE_ENGAGE_TILES` (close enough
 * for the auto-aim to fire, far enough that contact damage cannot land) and steps off the enemy
 * bullets' paths.
 *
 * Why it is not "run away from the nearest enemy": since #38 a room is larger than one screen and
 * the player is faster than every role, so a pure flee policy outruns the room forever (a sniper
 * walks at < 1 tile/s and the run times out) — that is not how a player clears a room. A player
 * dodges **while staying in the fight**, and the score below rewards exactly that.
 */
const DODGE_DIRECTIONS: readonly Direction[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
];

const DODGE_HORIZON_SECONDS = 1.2;
const DODGE_SAMPLES = 12;
/** Distance to the nearest enemy the policy aims for: inside the auto-aim range (8), outside contact. */
const DODGE_ENGAGE_TILES = 6.8;
/** A hurt player keeps more distance: still inside the auto-aim range (8), out of contact. */
const DODGE_ENGAGE_HURT_TILES = 7.8;
const DODGE_HURT_HEARTS = 65;
const DODGE_TOO_CLOSE_TILES = 3.2;
const DODGE_BULLET_CLEAR_TILES = 2.0;
const MIN_X = 0.5;
const MIN_Y = 0.5;
/**
 * The policy only evaluates its 1.2 s path inside the room. A pool room (#38) is 2×2 screens
 * since #66, so the clamp follows the largest room instead of one 32×18 screen.
 */
const MAX_X = ROOM_COLS * 2 - 0.5;
const MAX_Y = ROOM_ROWS * 2 - 0.5;
/**
 * A wall this close is a trap: melee enemies pin the player there and its 1.2 s path has no room
 * left to sidestep. A competent player keeps the fight away from the room edge (#66, with the
 * 24-alive cap the back rows of a 64×36 room are crowded).
 */
const DODGE_WALL_CLEAR_TILES = 4;

export function makeDodgePolicy(): InputPolicy {
  let lastIndex = 0;
  let lastPosition: { x: number; y: number } | null = null;
  // A player who walks into a prop sees it and tries another way; the policy has no room model,
  // so it detects "I pressed a key and did not move" instead and vetoes that direction briefly.
  // Without this it stays pinned against a prop while an elite tank body-checks it (#66).
  let blockedIndex = -1;
  let blockedUntilMs = 0;

  return (world: PolicyWorld) => {
    if (lastPosition !== null) {
      const moved = Math.hypot(
        world.player.x - lastPosition.x,
        world.player.y - lastPosition.y,
      );
      if (lastIndex !== -1 && moved < 0.02) {
        blockedIndex = lastIndex;
        blockedUntilMs = world.nowMs + 600;
      }
    }
    lastPosition = { x: world.player.x, y: world.player.y };
    const alive = world.enemies.filter(
      (enemy) => enemy.health > 0 && enemy.action.kind !== 'dead',
    );
    if (alive.length === 0) return standStill(world);

    const enemyShots = world.bullets.filter((bullet) => bullet.owner === 'enemy');
    const speed = DEFAULT_COMBAT.moveSpeedTilesPerSecond;
    // A player on the last hearts plays for space instead of standing in the fight.
    const engageTiles =
      world.hearts <= DODGE_HURT_HEARTS ? DODGE_ENGAGE_HURT_TILES : DODGE_ENGAGE_TILES;
    const tooCloseTiles =
      world.hearts <= DODGE_HURT_HEARTS ? DODGE_TOO_CLOSE_TILES + 2 : DODGE_TOO_CLOSE_TILES;

    let bestIndex = lastIndex;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let index = 0; index < DODGE_DIRECTIONS.length; index += 1) {
      const direction = DODGE_DIRECTIONS[index];
      if (direction === undefined) continue;

      let cost = 0;

      for (let sample = 1; sample <= DODGE_SAMPLES; sample += 1) {
        const seconds = (sample / DODGE_SAMPLES) * DODGE_HORIZON_SECONDS;
        const rawX = world.player.x + direction.x * speed * seconds;
        const rawY = world.player.y + direction.y * speed * seconds;
        const x = Math.min(Math.max(rawX, MIN_X), MAX_X);
        const y = Math.min(Math.max(rawY, MIN_Y), MAX_Y);

        let enemyGap = Number.POSITIVE_INFINITY;
        for (const enemy of alive) {
          // Predict charging dashes so the policy sidesteps tank/dasher charge lines.
          const action = enemy.action;
          const moving =
            action.kind === 'charge'
              ? {
                  x: enemy.position.x + action.direction.x * action.speedTilesPerSecond * seconds,
                  y: enemy.position.y + action.direction.y * action.speedTilesPerSecond * seconds,
                }
              : enemy.position;
          enemyGap = Math.min(enemyGap, Math.hypot(x - moving.x, y - moving.y));
        }
        let bulletGap = Number.POSITIVE_INFINITY;
        for (const bullet of enemyShots) {
          const bx = bullet.position.x + bullet.velocity.x * seconds;
          const by = bullet.position.y + bullet.velocity.y * seconds;
          bulletGap = Math.min(bulletGap, Math.hypot(x - bx, y - by));
        }

        if (bulletGap < DODGE_BULLET_CLEAR_TILES) {
          cost += (DODGE_BULLET_CLEAR_TILES - bulletGap) * 7.5;
        }
        if (enemyGap < tooCloseTiles) {
          cost += (tooCloseTiles - enemyGap) * 6.5;
        }

        // Pull to the fighting distance: walk in when far (no clamp — a far enemy must still pull
        // the player in), back off when stacked on one.
        cost += Math.abs(enemyGap - engageTiles) * 0.25;
        // Do not walk into the room edge: it removes the escape path and melee enemies pin the
        // player there.
        const wallGap = Math.min(x - MIN_X, MAX_X - x, y - MIN_Y, MAX_Y - y);
        if (wallGap < DODGE_WALL_CLEAR_TILES) {
          cost += (DODGE_WALL_CLEAR_TILES - wallGap) * 0.8;
        }
        // Blocked by a wall means a shorter actual path — treat it as worse.
        cost += Math.hypot(x - rawX, y - rawY) * 2;
      }

      // Hysteresis: keep the current direction unless another is clearly better. While committed
      // (a real player holds a dodge for a moment) the bar to switch is much higher.
      if (index === lastIndex) cost -= 0.3;
      // A direction that just pushed the player into a prop is avoided for a moment.
      if (index === blockedIndex && world.nowMs < blockedUntilMs) cost += 100;
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    lastIndex = bestIndex;
    const chosen = DODGE_DIRECTIONS[bestIndex];
    if (chosen === undefined) return standStill(world);

    return inputFor(chosen);
  };
}

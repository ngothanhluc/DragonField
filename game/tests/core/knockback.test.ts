import { describe, expect, it } from 'vitest';
import {
  startKnockback,
  stepKnockback,
  type KnockbackState,
} from '../../assets/scripts/core/combat/knockback';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  obstacleAt,
  parseLevelData,
  type LevelData,
  type Obstacle,
} from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

const PLAYER_MARGIN = 0.5;
const STEP_MS = 16;

function makeLevel(obstacles: Obstacle[] = []): LevelData {
  return parseLevelData({
    id: 'knockback-room',
    chapter: 1,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 9 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 2, y: 2 }, elite: false }] }],
    obstacles,
    doors: [],
  });
}

function config(distanceTiles: number, durationMs: number) {
  return { distanceTiles, durationMs };
}

/** Run the push frame by frame at 16 ms; return the final position + final state. */
function runToEnd(
  position: Vec2,
  state: KnockbackState,
  level: LevelData,
  marginTiles = 0,
): { position: Vec2; state: KnockbackState | null; frames: number } {
  let current = position;
  let active: KnockbackState | null = state;
  let frames = 0;

  while (active !== null) {
    const result = stepKnockback(current, active, STEP_MS, level, marginTiles);
    current = result.position;
    active = result.state;
    frames += 1;
    if (frames > 1000) throw new Error('knockback never finishes');
  }

  return { position: current, state: active, frames };
}

describe('knockback — direction and magnitude', () => {
  it('pushes away from the source along a unit vector', () => {
    const state = startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(1.5, 180));

    expect(state).not.toBeNull();
    expect(state?.direction.x).toBeCloseTo(1);
    expect(state?.direction.y).toBeCloseTo(0);
  });

  it('a diagonal direction is normalised, never longer than 1', () => {
    const state = startKnockback({ x: 10, y: 10 }, { x: 7, y: 6 }, config(1.5, 180));
    const direction = state?.direction;

    expect(direction).toBeDefined();
    expect(Math.hypot(direction?.x ?? NaN, direction?.y ?? NaN)).toBeCloseTo(1);
  });

  it('travels exactly the distance in exactly the time (no hardcoded numbers)', () => {
    const level = makeLevel();
    const state = startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(1.5, 180));
    expect(state).not.toBeNull();
    if (state === null) return;

    const result = runToEnd({ x: 10, y: 10 }, state, level);

    expect(result.position.x - 10).toBeCloseTo(1.5);
    expect(result.position.y).toBeCloseTo(10);
    // 180 ms / 16 ms → 12 frames (the last frame is only 4 ms).
    expect(result.frames).toBe(12);
  });

  it('stops after the duration even when the frame is longer than the remaining time', () => {
    const level = makeLevel();
    const state = startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(1.5, 180));
    expect(state).not.toBeNull();
    if (state === null) return;

    const result = stepKnockback({ x: 10, y: 10 }, state, 5000, level);

    expect(result.state).toBeNull();
    expect(result.position.x - 10).toBeCloseTo(1.5);
  });

  it('a source coincident with the actor produces no NaN', () => {
    const state = startKnockback({ x: 10, y: 10 }, { x: 10, y: 10 }, config(1.5, 180));

    expect(state).toBeNull();
  });

  it('a distance/duration <= 0 config is ignored', () => {
    expect(startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(0, 180))).toBeNull();
    expect(startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(1.5, 0))).toBeNull();
  });
});

describe('knockback — collision and room bounds', () => {
  it('is blocked by an obstacle and never ends inside one', () => {
    const level = makeLevel([{ kind: 'pillar', x: 11, y: 9, width: 1, height: 2 }]);
    const state = startKnockback({ x: 10, y: 10 }, { x: 8, y: 10 }, config(1.5, 180));
    expect(state).not.toBeNull();
    if (state === null) return;

    const result = runToEnd({ x: 10, y: 10 }, state, level);

    expect(obstacleAt(level, result.position)).toBeNull();
    expect(result.position.x).toBeLessThan(11);
    expect(result.position.x).toBeGreaterThan(10);
    expect(result.state).toBeNull();
  });

  it('does not push outside the room even when the source is against the wall', () => {
    const level = makeLevel();
    const state = startKnockback({ x: 31.2, y: 10 }, { x: 30, y: 10 }, config(1.5, 180));
    expect(state).not.toBeNull();
    if (state === null) return;

    const result = runToEnd({ x: 31.2, y: 10 }, state, level, PLAYER_MARGIN);

    expect(result.position.x).toBeCloseTo(32 - PLAYER_MARGIN);
    expect(result.position.y).toBeCloseTo(10);
    expect(result.state).toBeNull();
  });

  it('stops at the top/bottom edge of the room', () => {
    const level = makeLevel();
    const state = startKnockback({ x: 10, y: 17.7 }, { x: 10, y: 16 }, config(1.5, 180));
    expect(state).not.toBeNull();
    if (state === null) return;

    const result = runToEnd({ x: 10, y: 17.7 }, state, level, PLAYER_MARGIN);

    expect(result.position.y).toBeCloseTo(18 - PLAYER_MARGIN);
    expect(result.position.x).toBeCloseTo(10);
  });
});

describe('knockback — tuning from config/tuning.json', () => {
  it('DEFAULT_COMBAT has a positive, valid knockback', () => {
    expect(DEFAULT_COMBAT.playerKnockbackDistanceTiles).toBeGreaterThan(0);
    expect(DEFAULT_COMBAT.playerKnockbackDurationMs).toBeGreaterThan(0);
    expect(DEFAULT_COMBAT.enemyKnockbackDistanceTiles).toBeGreaterThan(0);
    expect(DEFAULT_COMBAT.enemyKnockbackDurationMs).toBeGreaterThan(0);
    expect(DEFAULT_COMBAT.enemyKnockbackDistanceTiles).toBeLessThan(
      DEFAULT_COMBAT.playerKnockbackDistanceTiles,
    );
  });
});

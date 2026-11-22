import { describe, expect, it } from 'vitest';
import {
  closestPointDistanceSquared,
  segmentHitsCircle,
} from '../../assets/scripts/core/combat/hitbox';
import {
  ELITE_POUNCE_DURATION_MS,
  ELITE_POUNCE_SPEED_TILES_PER_SECOND,
  TANK_CHARGE_DURATION_MS,
  TANK_CHARGE_SPEED_TILES_PER_SECOND,
  decideAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import { parseLevelData } from '../../assets/scripts/core/level/level-data';

const level = parseLevelData({
  id: 'charge-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: 16,
  playerStart: { x: 10, y: 11 },
  waves: [{ enemies: [{ role: 'tank', at: { x: 10, y: 14 }, elite: false }] }],
  obstacles: [],
  doors: [],
});

const PLAYER_RADIUS = 0.25;
const ENEMY_RADIUS = 0.4;

function tankAt(y: number): EnemyState {
  return {
    id: 'tank',
    role: 'tank',
    elite: false,
    position: { x: 10, y },
    health: 10,
    maxHealth: 10,
    action: { kind: 'idle' },
    actionStartedMs: 0,
  };
}

describe('segmentHitsCircle — charge hitbox', () => {
  it('hits when the charge path crosses the player, misses when the player steps aside', () => {
    const reach = TANK_CHARGE_SPEED_TILES_PER_SECOND * (TANK_CHARGE_DURATION_MS / 1000);
    // The #66 dash is shorter, so put the player halfway down the real path instead of a row that
    // the old 3-tile dash reached. The invariant — a crossing path hits, a step aside misses — is
    // unchanged.
    const playerY = 14 - reach / 2;
    const from = { x: 10, y: 14 };
    const to = { x: 10, y: 14 - reach };

    expect(reach).toBeGreaterThan(PLAYER_RADIUS + ENEMY_RADIUS);
    expect(segmentHitsCircle(from, to, { x: 10, y: playerY }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(segmentHitsCircle(from, to, { x: 12, y: playerY }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
  });

  it('closed boundary: touching at exactly one point still counts as a hit', () => {
    const reach = PLAYER_RADIUS + ENEMY_RADIUS;
    const from = { x: 0, y: 0 };
    const to = { x: 4, y: 0 };

    expect(segmentHitsCircle(from, to, { x: 2, y: reach }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(
      segmentHitsCircle(from, to, { x: 2, y: reach + 1e-9 }, PLAYER_RADIUS, ENEMY_RADIUS),
    ).toBe(false);
  });

  it('a zero-length segment reduces to comparing two circles at one point', () => {
    const point = { x: 4, y: 4 };
    expect(segmentHitsCircle(point, point, { x: 4.5, y: 4 }, 0.25, 0.25)).toBe(true);
    expect(segmentHitsCircle(point, point, { x: 5, y: 4 }, 0.25, 0.25)).toBe(false);
  });

  it('distance to the segment is 0 when the point lies on it, not the endpoint distance', () => {
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 })).toBe(0);
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 })).toBe(4);
    // Outside the segment: closest to the endpoint, not the infinite line.
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 0 })).toBe(4);
  });

  it('a real tank charge: frame-by-frame at 16 ms catches a player on the path', () => {
    const frameMs = 16;
    const seconds = frameMs / 1000;
    const step = TANK_CHARGE_SPEED_TILES_PER_SECOND * seconds;
    // Stand the player inside the real dash reach (see the test above).
    const reach = TANK_CHARGE_SPEED_TILES_PER_SECOND * (TANK_CHARGE_DURATION_MS / 1000);

    const state = tankAt(14);
    // Standing already inside the telegraph so the first frame returns charge from core.
    state.action = { kind: 'telegraph', sinceMs: 0 };
    state.actionStartedMs = 0;
    const player = { x: 10, y: 14 - reach / 2 };

    let y = state.position.y;
    let hit = false;
    for (let nowMs = 700; nowMs < 700 + TANK_CHARGE_DURATION_MS; nowMs += frameMs) {
      state.position = { x: 10, y };
      const action = decideAction({ state, player, nowMs, level });
      if (action.kind !== 'charge') break;

      const from = { x: 10, y };
      state.action = action;
      state.actionStartedMs = nowMs;
      y = y + action.direction.y * step;
      if (segmentHitsCircle(from, { x: 10, y }, player, PLAYER_RADIUS, ENEMY_RADIUS)) hit = true;
    }

    expect(hit).toBe(true);
  });

  it('an elite chaser charges slower than the tank but its path is still longer than the player radius', () => {
    const distance =
      ELITE_POUNCE_SPEED_TILES_PER_SECOND * (ELITE_POUNCE_DURATION_MS / 1000);
    expect(distance).toBeGreaterThan(PLAYER_RADIUS + ENEMY_RADIUS);
  });
});

/**
 * Pure helpers behind #42 that the acceptance file does not pin down: the sniper shot plan
 * (one fast aimed bullet) and the line-telegraph endpoints.
 */
import { describe, expect, it } from 'vitest';
import {
  ENEMY_BULLET_SPEED_TILES_PER_SECOND,
  sniperShotPlan,
} from '../../assets/scripts/core/combat/enemy-fire';
import { telegraphLine } from '../../assets/scripts/core/enemies/telegraph-line';
import { parseLevelData, type LevelData, type Obstacle } from '../../assets/scripts/core/level/level-data';

function room(obstacles: Obstacle[] = []): LevelData {
  return parseLevelData({
    id: 'line-42',
    chapter: 1,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 4, y: 9 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 28, y: 9 }, elite: false }] }],
    obstacles,
    doors: [],
  });
}

describe('sniperShotPlan', () => {
  it('is exactly one straight bullet, faster than the caster bullet', () => {
    const plan = sniperShotPlan();
    expect(plan.angles).toEqual([0]);
    expect(plan.speedTilesPerSecond).toBeGreaterThanOrEqual(
      ENEMY_BULLET_SPEED_TILES_PER_SECOND * 2.5,
    );
  });
});

describe('telegraphLine', () => {
  it('runs sniper → player when the path is clear', () => {
    const line = telegraphLine(room(), { x: 20, y: 9 }, { x: 4, y: 9 });
    expect(line.from).toEqual({ x: 20, y: 9 });
    expect(line.to).toEqual({ x: 4, y: 9 });
  });

  it('stops at the first wall between sniper and player', () => {
    const wall: Obstacle = { kind: 'wall', x: 12, y: 2, width: 1, height: 14 };
    const line = telegraphLine(room([wall]), { x: 20, y: 9 }, { x: 4, y: 9 });

    expect(line.to.x).toBeGreaterThanOrEqual(12);
    expect(line.to.x).toBeLessThan(13);
    expect(line.to.y).toBeCloseTo(9, 5);
  });

  it('does not stop on a pit: bullets fly over it', () => {
    const pit: Obstacle = { kind: 'pit', x: 12, y: 2, width: 1, height: 14 };
    const line = telegraphLine(room([pit]), { x: 20, y: 9 }, { x: 4, y: 9 });
    expect(line.to).toEqual({ x: 4, y: 9 });
  });
});

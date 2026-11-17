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

describe('segmentHitsCircle — hitbox của cú lao', () => {
  it('trúng khi đường lao đi qua player, trượt khi player bước ngang', () => {
    const from = { x: 10, y: 14 };
    const to = { x: 10, y: 14 - TANK_CHARGE_SPEED_TILES_PER_SECOND * (TANK_CHARGE_DURATION_MS / 1000) };

    expect(segmentHitsCircle(from, to, { x: 10, y: 11 }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(segmentHitsCircle(from, to, { x: 12, y: 11 }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
  });

  it('biên đóng: chạm đúng một điểm vẫn tính là trúng', () => {
    const reach = PLAYER_RADIUS + ENEMY_RADIUS;
    const from = { x: 0, y: 0 };
    const to = { x: 4, y: 0 };

    expect(segmentHitsCircle(from, to, { x: 2, y: reach }, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(
      segmentHitsCircle(from, to, { x: 2, y: reach + 1e-9 }, PLAYER_RADIUS, ENEMY_RADIUS),
    ).toBe(false);
  });

  it('đoạn dài 0 quy về so hai hình tròn tại một điểm', () => {
    const point = { x: 4, y: 4 };
    expect(segmentHitsCircle(point, point, { x: 4.5, y: 4 }, 0.25, 0.25)).toBe(true);
    expect(segmentHitsCircle(point, point, { x: 5, y: 4 }, 0.25, 0.25)).toBe(false);
  });

  it('khoảng cách tới đoạn là 0 khi điểm nằm trên đoạn, không phải tới đầu mút', () => {
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 })).toBe(0);
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 })).toBe(4);
    // Ngoài đoạn: gần đầu mút, không phải đường thẳng vô hạn.
    expect(closestPointDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 0 })).toBe(4);
  });

  it('cú lao thật của tank: quét từng frame 16 ms bắt được player trên đường', () => {
    const frameMs = 16;
    const seconds = frameMs / 1000;
    const step = TANK_CHARGE_SPEED_TILES_PER_SECOND * seconds;

    const state = tankAt(14);
    // Đứng sẵn trong telegraph để frame đầu tiên core trả charge.
    state.action = { kind: 'telegraph', sinceMs: 0 };
    state.actionStartedMs = 0;
    const player = { x: 10, y: 11 };

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

  it('elite chaser lao chậm hơn tank nhưng đường đi vẫn dài hơn bán kính player', () => {
    const distance =
      ELITE_POUNCE_SPEED_TILES_PER_SECOND * (ELITE_POUNCE_DURATION_MS / 1000);
    expect(distance).toBeGreaterThan(PLAYER_RADIUS + ENEMY_RADIUS);
  });
});

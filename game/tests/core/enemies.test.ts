import { describe, expect, it } from 'vitest';
import { BulletPool, firstHit, hitsCircle } from '../../assets/scripts/core/combat/bullets';
import {
  TELEGRAPH_MS,
  isTelegraphComplete,
  telegraphProgress,
} from '../../assets/scripts/core/combat/telegraph';
import {
  CASTER_MAX_RANGE_TILES,
  TANK_CHARGE_DURATION_MS,
  attackReleased,
  contactDamageFor,
  decideAction,
  maxHealthFor,
  speedFor,
  type EnemyAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  isWaveCleared,
  nextWaveIndex,
  spawnWave,
} from '../../assets/scripts/core/enemies/waves';
import {
  parseLevelData,
  type EnemyRole,
  type LevelData,
  type Obstacle,
} from '../../assets/scripts/core/level/level-data';
import { distance } from '../../assets/scripts/core/math/vec2';

/**
 * Phòng thử 32×18 có 3 wave: [chaser ×2], [caster elite], [tank].
 * Dựng qua `parseLevelData` để test dùng đúng hợp đồng dữ liệu thật, không
 * phải một `LevelData` tự chế có thể lệch schema.
 */
function makeLevel(obstacles: readonly Obstacle[] = []): LevelData {
  return parseLevelData({
    id: 'test-room',
    chapter: 1,
    room: 3,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 16 },
    waves: [
      {
        enemies: [
          { role: 'chaser', at: { x: 3, y: 3 }, elite: false },
          { role: 'chaser', at: { x: 28, y: 3 }, elite: false },
        ],
      },
      { enemies: [{ role: 'caster', at: { x: 29, y: 2 }, elite: true }] },
      { enemies: [{ role: 'tank', at: { x: 16, y: 2 }, elite: false }] },
    ],
    obstacles: [...obstacles],
    doors: [],
  });
}

const level = makeLevel();

interface EnemyOptions {
  readonly role: EnemyRole;
  readonly x: number;
  readonly y: number;
  readonly elite?: boolean;
  readonly health?: number;
  readonly action?: EnemyAction;
  readonly actionStartedMs?: number;
}

function enemy(options: EnemyOptions): EnemyState {
  const elite = options.elite ?? false;
  const maxHealth = maxHealthFor(options.role, elite);
  return {
    id: `test-${options.role}`,
    role: options.role,
    elite,
    position: { x: options.x, y: options.y },
    health: options.health ?? maxHealth,
    maxHealth,
    action: options.action ?? { kind: 'idle' },
    actionStartedMs: options.actionStartedMs ?? 0,
  };
}

describe('enemy behaviours — chaser', () => {
  it('đi về phía player nên khoảng cách giảm', () => {
    const state = enemy({ role: 'chaser', x: 2, y: 5 });
    const player = { x: 20, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    expect(distance(action.target, player)).toBeLessThan(distance(state.position, player));
    expect(speedFor('chaser', false)).toBeGreaterThan(0);
  });

  it('đứng yên khi đã chạm player', () => {
    const action = decideAction({
      state: enemy({ role: 'chaser', x: 10, y: 5 }),
      player: { x: 10.2, y: 5 },
      nowMs: 0,
      level,
    });

    expect(action).toEqual({ kind: 'idle' });
  });
});

describe('enemy behaviours — caster', () => {
  it('lùi khi player gần hơn 4 tile', () => {
    const state = enemy({ role: 'caster', x: 6, y: 5 });
    const player = { x: 5, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    const before = distance(state.position, player);
    const after = distance(action.target, player);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(CASTER_MAX_RANGE_TILES);
  });

  it('tiến khi player xa hơn 6 tile', () => {
    const state = enemy({ role: 'caster', x: 25, y: 5 });
    const player = { x: 5, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    expect(distance(action.target, player)).toBeLessThan(distance(state.position, player));
    expect(distance(action.target, player)).toBeCloseTo(CASTER_MAX_RANGE_TILES);
  });

  it('telegraph rồi mới bắn, và đòn đã vào telegraph thì chạy hết', () => {
    const player = { x: 5, y: 5 };
    const start = 1200;
    const state = enemy({ role: 'caster', x: 10, y: 5 });

    // 5 tile: trong khoảng 4–6, cooldown đã hết.
    const telegraph = decideAction({ state, player, nowMs: start, level });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: start });

    const telegraphing: EnemyState = { ...state, action: telegraph, actionStartedMs: start };

    const justBefore = decideAction({
      state: telegraphing,
      player,
      nowMs: start + TELEGRAPH_MS.caster - 1,
      level,
    });
    expect(justBefore).toEqual({ kind: 'telegraph', sinceMs: start });

    // Player lùi ra thật xa: telegraph vẫn phải chạy nốt.
    const playerFled = { x: 30, y: 5 };
    const fired = decideAction({
      state: telegraphing,
      player: playerFled,
      nowMs: start + TELEGRAPH_MS.caster,
      level,
    });
    expect(fired).toEqual({ kind: 'idle' });
    expect(attackReleased(telegraph, fired)).toBe('shot');
  });

  it('không bắn lại ngay sau phát trước — chờ cooldown', () => {
    const player = { x: 5, y: 5 };
    const state = enemy({ role: 'caster', x: 10, y: 5, actionStartedMs: 1000 });

    expect(decideAction({ state, player, nowMs: 1500, level })).toEqual({ kind: 'idle' });
    expect(decideAction({ state, player, nowMs: 2200, level }).kind).toBe('telegraph');
  });

  it('chỉ đứng yên tại chỗ khi điểm giữ khoảng cách rơi vào vật cản', () => {
    const blockedLevel = makeLevel([{ kind: 'pillar', x: 18, y: 2, width: 2, height: 2 }]);
    const state = enemy({ role: 'caster', x: 15, y: 3 });
    const player = { x: 13, y: 3 };

    // Player sát bên (2 tile < 4) nên caster lùi; điểm lùi cách player 6 tile
    // rơi đúng vào cột ở x = 18..20.
    const action = decideAction({
      state,
      player,
      nowMs: 0,
      level: blockedLevel,
    });

    expect(action).toEqual({ kind: 'walk', target: { x: state.position.x, y: state.position.y } });
  });
});

describe('enemy behaviours — tank', () => {
  it('đi bộ khi player ngoài tầm lao', () => {
    const state = enemy({ role: 'tank', x: 2, y: 16 });
    const action = decideAction({ state, player: { x: 2, y: 2 }, nowMs: 0, level });

    expect(action.kind).toBe('walk');
  });

  it('telegraph 700 ms rồi lao thẳng, hết thời gian lao thì nghỉ', () => {
    const player = { x: 10, y: 9 };
    const state = enemy({ role: 'tank', x: 10, y: 14 });
    const start = 900;

    expect(decideAction({ state, player, nowMs: start - 1, level })).toEqual({ kind: 'idle' });

    const telegraph = decideAction({ state, player, nowMs: start, level });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: start });

    const telegraphing: EnemyState = { ...state, action: telegraph, actionStartedMs: start };
    expect(
      decideAction({ state: telegraphing, player, nowMs: start + TELEGRAPH_MS.tank - 1, level }),
    ).toEqual(telegraph);

    const charge = decideAction({
      state: telegraphing,
      player,
      nowMs: start + TELEGRAPH_MS.tank,
      level,
    });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;

    expect(charge.direction).toEqual({ x: 0, y: -1 });
    expect(charge.untilMs).toBe(start + TELEGRAPH_MS.tank + TANK_CHARGE_DURATION_MS);
    expect(attackReleased(telegraph, charge)).toBe('charge');

    // Player né sang ngang: hướng lao đã chốt, không bám theo.
    const charging: EnemyState = { ...telegraphing, action: charge };
    expect(
      decideAction({
        state: charging,
        player: { x: 25, y: 9 },
        nowMs: charge.untilMs - 1,
        level,
      }),
    ).toEqual(charge);

    expect(decideAction({ state: charging, player, nowMs: charge.untilMs, level })).toEqual({
      kind: 'idle',
    });
  });
});

describe('enemy behaviours — hợp đồng thuần', () => {
  it('cùng input ở cùng nowMs cho cùng action, không sửa state', () => {
    const state = enemy({ role: 'caster', x: 10, y: 5 });
    const before = JSON.stringify(state);

    const first = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level });
    const second = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level });

    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('dead là cuối, không hồi sinh', () => {
    const dead = decideAction({
      state: enemy({ role: 'chaser', x: 2, y: 2, action: { kind: 'dead' }, health: 3 }),
      player: { x: 20, y: 2 },
      nowMs: 10_000,
      level,
    });
    expect(dead).toEqual({ kind: 'dead' });

    const killed = decideAction({
      state: enemy({ role: 'tank', x: 2, y: 2, health: 0 }),
      player: { x: 20, y: 2 },
      nowMs: 10_000,
      level,
    });
    expect(killed).toEqual({ kind: 'dead' });
  });

  it('elite chỉ đổi máu và sát thương, không đổi tốc độ', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      expect(speedFor(role, true)).toBe(speedFor(role, false));
      expect(contactDamageFor(role, true)).toBeGreaterThan(contactDamageFor(role, false));
      expect(maxHealthFor(role, true)).toBeGreaterThan(maxHealthFor(role, false));
    }
  });
});

describe('telegraph', () => {
  it('progress 0 ở đầu, 1 ở cuối, kẹp ngoài cửa sổ', () => {
    expect(telegraphProgress(1000, 1000, 'caster')).toBe(0);
    expect(telegraphProgress(1000, 1250, 'caster')).toBe(0.5);
    expect(telegraphProgress(1000, 1500, 'caster')).toBe(1);
    expect(telegraphProgress(1000, 9000, 'caster')).toBe(1);
    expect(telegraphProgress(1000, 0, 'caster')).toBe(0);
  });

  it('isTelegraphComplete đúng biên của từng loại', () => {
    expect(isTelegraphComplete(1000, 1000 + TELEGRAPH_MS.caster - 1, 'caster')).toBe(false);
    expect(isTelegraphComplete(1000, 1000 + TELEGRAPH_MS.caster, 'caster')).toBe(true);
    expect(isTelegraphComplete(0, TELEGRAPH_MS.tank, 'tank')).toBe(true);
    expect(isTelegraphComplete(0, TELEGRAPH_MS.boss, 'boss')).toBe(true);
    expect(TELEGRAPH_MS.boss).toBe(800);
  });
});

describe('BulletPool', () => {
  const base = {
    radiusTiles: 0.1,
    damage: 1,
    owner: 'player' as const,
    ttlMs: 1000,
  };

  it('bay đúng velocity × delta', () => {
    const pool = new BulletPool(4);
    pool.spawn({ ...base, position: { x: 1, y: 1 }, velocity: { x: 6, y: -3 } });

    pool.update(500);

    const [bullet] = pool.snapshot();
    expect(bullet?.position).toEqual({ x: 4, y: -0.5 });
    expect(bullet?.ttlMs).toBe(500);
  });

  it('thu hồi đạn hết ttl', () => {
    const pool = new BulletPool(4);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 }, ttlMs: 100 });

    pool.update(60);
    expect(pool.active()).toHaveLength(1);

    pool.update(40);
    expect(pool.active()).toHaveLength(0);
  });

  it('đầy capacity thì thu hồi viên cũ nhất, không phình mảng', () => {
    const pool = new BulletPool(3);

    for (let damage = 1; damage <= 5; damage += 1) {
      pool.spawn({ ...base, position: { x: damage, y: 0 }, velocity: { x: 0, y: 0 }, damage });
    }

    expect(pool.active()).toHaveLength(3);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([3, 4, 5]);
    expect(pool.snapshot().map((bullet) => bullet.id)).toEqual([3, 4, 5]);
  });

  it('snapshot là bản sao, update sau đó không làm nó đổi', () => {
    const pool = new BulletPool(2);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 4, y: 0 }, ttlMs: 2000 });

    const snapshot = pool.snapshot();
    pool.update(1000);

    expect(snapshot[0]?.position).toEqual({ x: 0, y: 0 });
    expect(pool.snapshot()[0]?.position).toEqual({ x: 4, y: 0 });
  });

  it('clear thu hồi toàn bộ', () => {
    const pool = new BulletPool(2);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });

    pool.clear();

    expect(pool.active()).toHaveLength(0);
    expect(pool.size).toBe(0);
  });
});

describe('hitsCircle', () => {
  it('chạm đúng một điểm vẫn tính là trúng, hơn một chút là trượt', () => {
    const a = { position: { x: 0, y: 0 }, radiusTiles: 0.5 };

    expect(hitsCircle(a, { position: { x: 1, y: 0 }, radiusTiles: 0.5 })).toBe(true);
    expect(hitsCircle(a, { position: { x: 1.0001, y: 0 }, radiusTiles: 0.5 })).toBe(false);
    expect(hitsCircle(a, { position: { x: 0.6, y: 0.6 }, radiusTiles: 0.25 })).toBe(false);
  });
});

describe('firstHit', () => {
  const withObstacles = makeLevel([
    { kind: 'pillar', x: 10, y: 4, width: 2, height: 2 },
    { kind: 'pillar', x: 15, y: 4, width: 2, height: 2 },
  ]);

  it('dừng ở vật cản đầu tiên trên đường đạn', () => {
    const hit = firstHit({ from: { x: 5, y: 5 }, to: { x: 20, y: 5 } }, withObstacles);
    expect(hit).not.toBeNull();
    if (hit === null) return;

    expect(hit.obstacle.x).toBe(10);
    expect(hit.point.x).toBeGreaterThanOrEqual(10);
    expect(hit.point.x).toBeLessThan(10 + 0.25);
    expect(hit.progress).toBeCloseTo((hit.point.x - 5) / 15);
  });

  it('trả về null khi đường đi không chạm gì', () => {
    expect(firstHit({ from: { x: 5, y: 2 }, to: { x: 20, y: 2 } }, withObstacles)).toBeNull();
  });

  it('trúng ngay tại điểm xuất phát thì progress là 0', () => {
    const hit = firstHit({ from: { x: 10.5, y: 5 }, to: { x: 20, y: 5 } }, withObstacles);
    expect(hit?.progress).toBe(0);
  });
});

describe('waves', () => {
  it('id tất định và duy nhất, spawn lại cho cùng kết quả', () => {
    const all = [0, 1, 2].flatMap((index) => spawnWave(level, index));
    const ids = all.map((state) => state.id);

    expect(ids).toEqual(['r3-w0-e0', 'r3-w0-e1', 'r3-w1-e0', 'r3-w2-e0']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(spawnWave(level, 0)).toEqual(spawnWave(level, 0));
  });

  it('elite có nhiều máu hơn bản thường', () => {
    const [normal] = spawnWave(level, 0);
    const [elite] = spawnWave(level, 1);

    expect(normal?.elite).toBe(false);
    expect(elite?.elite).toBe(true);
    expect(elite?.maxHealth).toBeGreaterThan(normal?.maxHealth ?? 0);
    expect(elite?.health).toBe(elite?.maxHealth);
  });

  it('waveIndex ngoài phạm vi thì ném lỗi', () => {
    expect(() => spawnWave(level, 3)).toThrow();
  });

  it('wave chỉ sạch khi mọi enemy đã chết', () => {
    const states = spawnWave(level, 0);
    expect(isWaveCleared(states)).toBe(false);

    const [first, second] = states;
    if (first === undefined || second === undefined) throw new Error('wave 0 phải có 2 enemy');

    expect(isWaveCleared([{ ...first, health: 0 }, second])).toBe(false);
    expect(
      isWaveCleared([
        { ...first, health: 0 },
        { ...second, action: { kind: 'dead' } },
      ]),
    ).toBe(true);
    expect(isWaveCleared([])).toBe(true);
  });

  it('nextWaveIndex trả null ở wave cuối', () => {
    expect(nextWaveIndex(0, level)).toBe(1);
    expect(nextWaveIndex(1, level)).toBe(2);
    expect(nextWaveIndex(2, level)).toBeNull();
    expect(() => nextWaveIndex(-1, level)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  ATTACK_COOLDOWN_MS,
  CASTER_MAX_RANGE_TILES,
  CASTER_MIN_RANGE_TILES,
  CHASER_CONTACT_RANGE_TILES,
  TANK_CHARGE_DURATION_MS,
  TANK_CHARGE_RANGE_TILES,
  contactDamageFor,
  decideAction,
  maxHealthFor,
  speedFor,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  COMBAT_TUNING,
  ENEMY_TUNING,
  TUNING,
  TUNING_SOURCE,
  parseTuning,
  type EnemiesTuning,
} from '../../assets/scripts/core/enemies/tuning';
import { isTelegraphElapsed } from '../../assets/scripts/core/combat/telegraph';
import { parseLevelData, type EnemyRole } from '../../assets/scripts/core/level/level-data';

/**
 * `game/config/tuning.json` là nguồn duy nhất của số liệu balance (AGENTS rule 3).
 * Generated module `enemies/tuning.generated.ts` là bản in của nó; `tuning-sync.test.ts`
 * khoá hai bên khớp nhau, còn bộ test này khoá hai chiều:
 *
 * 1. JSON → code: mọi hàm của `behaviours` trả đúng số trong JSON.
 * 2. Đổi JSON → đổi hành vi: bơm một bản copy đã sửa vào `decideAction` và
 *    thấy hành vi khác đi. Nếu ai hardcode lại số trong code, test 2 đỏ.
 */

/** Bản copy sâu của JSON gốc để mutate mà không đụng object đã export. */
function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

function rolesOf(raw: Record<string, unknown>): Record<string, unknown> {
  const enemies = raw.enemies as Record<string, unknown>;
  return enemies.roles as Record<string, unknown>;
}

function roleOf(raw: Record<string, unknown>, role: EnemyRole): Record<string, unknown> {
  return rolesOf(raw)[role] as Record<string, unknown>;
}

/** Đọc một field số từ JSON thô, để test không phải cast cả object. */
function numberAt(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number') throw new Error(`config/tuning.json: ${field} phải là số`);
  return value;
}

/** Bộ tune thay thế: parse từ bản copy đã sửa, đúng đường đi của game. */
function tuningWith(mutate: (raw: Record<string, unknown>) => void): EnemiesTuning {
  const raw = cloneSource();
  mutate(raw);
  return parseTuning(raw).enemies;
}

const level = parseLevelData({
  id: 'tuning-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: 16,
  playerStart: { x: 16, y: 16 },
  waves: [{ enemies: [{ role: 'chaser', at: { x: 2, y: 2 }, elite: false }] }],
  obstacles: [],
  doors: [],
});

function enemyState(
  role: EnemyRole,
  position: { x: number; y: number },
  tuning: EnemiesTuning,
): EnemyState {
  const maxHealth = maxHealthFor(role, false, tuning);
  return {
    id: `tuning-${role}`,
    role,
    elite: false,
    position,
    health: maxHealth,
    maxHealth,
    action: { kind: 'idle' },
    actionStartedMs: 0,
  };
}

describe('tuning — config/tuning.json là nguồn duy nhất', () => {
  it('parse lại JSON gốc cho đúng object đang dùng', () => {
    expect(parseTuning(TUNING_SOURCE)).toEqual(TUNING);
  });

  it('DEFAULT_COMBAT là chính object combat của config, không phải bản chép', () => {
    expect(DEFAULT_COMBAT).toBe(COMBAT_TUNING);
    expect(DEFAULT_COMBAT.fireRatePerSecond).toBe(
      (cloneSource().combat as { fireRatePerSecond: number }).fireRatePerSecond,
    );
  });

  it('thiếu field thì ném lỗi chỉ đúng đường dẫn, không im lặng dùng 0', () => {
    const raw = cloneSource();
    delete roleOf(raw, 'caster').health;

    expect(() => parseTuning(raw)).toThrowError(/enemies\.roles\.caster\.health.*thiếu field/);
  });

  it('field sai kiểu hoặc giá trị âm cũng bị bắt', () => {
    const wrongType = cloneSource();
    roleOf(wrongType, 'chaser').speedTilesPerSecond = 'nhanh';
    expect(() => parseTuning(wrongType)).toThrowError(/phải là số hữu hạn/);

    const negative = cloneSource();
    (negative.combat as Record<string, unknown>).damage = -1;
    expect(() => parseTuning(negative)).toThrowError(/không được âm/);

    const zeroRate = cloneSource();
    (zeroRate.combat as Record<string, unknown>).fireRatePerSecond = 0;
    expect(() => parseTuning(zeroRate)).toThrowError(/phải > 0/);
  });

  it('dải khoảng cách ngược bị bắt', () => {
    const raw = cloneSource();
    roleOf(raw, 'caster').preferredRangeMinTiles = 9;
    expect(() => parseTuning(raw)).toThrowError(/preferredRangeMaxTiles.*phải >=/);
  });

  it('mọi số behaviours dùng đều khớp JSON', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      const raw = roleOf(cloneSource(), role);
      const tuning = ENEMY_TUNING.roles[role];

      // `parse` không được đổi số nào của JSON.
      expect(tuning).toEqual(raw);

      expect(maxHealthFor(role, false)).toBe(numberAt(raw, 'health'));
      expect(maxHealthFor(role, true)).toBe(
        numberAt(raw, 'health') * ENEMY_TUNING.eliteHealthMultiplier,
      );
      expect(speedFor(role, false)).toBe(numberAt(raw, 'speedTilesPerSecond'));
      expect(contactDamageFor(role, false)).toBe(numberAt(raw, 'contactDamage'));
      expect(contactDamageFor(role, true)).toBe(
        numberAt(raw, 'contactDamage') * ENEMY_TUNING.eliteDamageMultiplier,
      );
      expect(ATTACK_COOLDOWN_MS[role]).toBe(numberAt(raw, 'attackCooldownMs'));
    }

    const chaser = ENEMY_TUNING.roles.chaser;
    const caster = ENEMY_TUNING.roles.caster;
    const tank = ENEMY_TUNING.roles.tank;

    expect(CHASER_CONTACT_RANGE_TILES).toBe(chaser.preferredRangeMaxTiles);
    expect(CASTER_MIN_RANGE_TILES).toBe(caster.preferredRangeMinTiles);
    expect(CASTER_MAX_RANGE_TILES).toBe(caster.preferredRangeMaxTiles);
    expect(TANK_CHARGE_RANGE_TILES).toBe(tank.preferredRangeMaxTiles);
    expect(TANK_CHARGE_DURATION_MS).toBe(tank.chargeDurationMs);
  });
});

describe('tuning — đổi JSON thì hành vi đổi (không hardcode)', () => {
  it('máu và tốc độ enemy lấy từ bộ tune được bơm vào', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'chaser').health = 99;
      roleOf(raw, 'chaser').speedTilesPerSecond = 0.5;
    });

    expect(maxHealthFor('chaser', false, tuning)).toBe(99);
    expect(speedFor('chaser', false, tuning)).toBe(0.5);
    // Bộ mặc định không đổi: không có state ẩn nào bị ghi.
    expect(maxHealthFor('chaser', false)).toBe(ENEMY_TUNING.roles.chaser.health);
  });

  it('sát thương chạm và hệ số elite lấy từ bộ tune', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'tank').contactDamage = 3;
      (raw.enemies as Record<string, unknown>).eliteDamageMultiplier = 4;
    });

    expect(contactDamageFor('tank', false, tuning)).toBe(3);
    expect(contactDamageFor('tank', true, tuning)).toBe(12);
  });

  it('caster giữ đúng dải khoảng cách trong bộ tune', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'caster').preferredRangeMinTiles = 2;
      roleOf(raw, 'caster').preferredRangeMaxTiles = 3;
    });

    const state = enemyState('caster', { x: 10, y: 5 }, tuning);
    const action = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level, tuning });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;
    expect(action.target.x - 5).toBeCloseTo(3);
  });

  it('caster dùng cooldown và telegraph trong bộ tune', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'caster').attackCooldownMs = 100;
      roleOf(raw, 'caster').telegraphMs = 2000;
    });

    const state = { ...enemyState('caster', { x: 10, y: 5 }, tuning), actionStartedMs: 1000 };
    const atCooldown = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 1050, level, tuning });
    expect(atCooldown).toEqual({ kind: 'idle' });

    const ready = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 1200, level, tuning });
    expect(ready).toEqual({ kind: 'telegraph', sinceMs: 1200 });

    const telegraphing = { ...state, action: ready, actionStartedMs: 1200 };
    expect(
      decideAction({ state: telegraphing, player: { x: 5, y: 5 }, nowMs: 3000, level, tuning }),
    ).toEqual({ kind: 'telegraph', sinceMs: 1200 });
    expect(
      decideAction({ state: telegraphing, player: { x: 5, y: 5 }, nowMs: 3200, level, tuning }),
    ).toEqual({ kind: 'idle' });
  });

  it('tank dùng tầm ra đòn và thời gian lao trong bộ tune', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'tank').preferredRangeMaxTiles = 2;
      roleOf(raw, 'tank').attackCooldownMs = 0;
      roleOf(raw, 'tank').telegraphMs = 100;
      roleOf(raw, 'tank').chargeDurationMs = 250;
    });

    const far = enemyState('tank', { x: 10, y: 14 }, tuning);
    // Cách player 10 tile > 2 → đi bộ, không ra đòn.
    expect(decideAction({ state: far, player: { x: 10, y: 4 }, nowMs: 1000, level, tuning })).toMatchObject(
      { kind: 'walk' },
    );

    const near = enemyState('tank', { x: 10, y: 6 }, tuning);
    const telegraph = decideAction({ state: near, player: { x: 10, y: 4 }, nowMs: 1000, level, tuning });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: 1000 });

    const ready = { ...near, action: telegraph, actionStartedMs: 1000 };
    const charge = decideAction({ state: ready, player: { x: 10, y: 4 }, nowMs: 1100, level, tuning });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;
    expect(charge.untilMs).toBe(1100 + 250);
  });

  it('chaser đứng lại ở khoảng cách chạm trong bộ tune', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'chaser').preferredRangeMinTiles = 3;
      roleOf(raw, 'chaser').preferredRangeMaxTiles = 3;
    });

    const state = enemyState('chaser', { x: 10, y: 5 }, tuning);
    const action = decideAction({ state, player: { x: 7.5, y: 5 }, nowMs: 0, level, tuning });

    expect(action).toEqual({ kind: 'idle' });
  });

  it('telegraph của behaviours so bằng duration trong bộ tune', () => {
    // `isTelegraphElapsed` là hàm thuần nhận duration, nên cùng một số với JSON.
    expect(isTelegraphElapsed(0, ENEMY_TUNING.roles.caster.telegraphMs - 1, ENEMY_TUNING.roles.caster.telegraphMs)).toBe(false);
    expect(isTelegraphElapsed(0, ENEMY_TUNING.roles.caster.telegraphMs, ENEMY_TUNING.roles.caster.telegraphMs)).toBe(true);
  });
});

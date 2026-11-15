import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';
import {
  BOSS_RUN_STEP_MS,
  holdPosition,
  simulateBossRun,
  type BossRunEvent,
  type BossRunResult,
} from '../../assets/scripts/core/sim/boss-run';

type SummonEvent = Extract<BossRunEvent, { kind: 'boss-summon' }>;

function eventsOf<K extends BossRunEvent['kind']>(
  result: BossRunResult,
  kind: K,
): Extract<BossRunEvent, { kind: K }>[] {
  return result.events.filter(
    (event): event is Extract<BossRunEvent, { kind: K }> => event.kind === kind,
  );
}

describe('boss run — god mode thắng Tengu', () => {
  const maxDurationMs = 180_000;
  const result = simulateBossRun({
    bossId: 'tengu',
    seed: 7,
    godMode: true,
    playerDamagePerShot: 1,
    maxDurationMs,
  });

  it('thắng trong thời gian cho phép, boss về 0 máu, player không mất tim', () => {
    expect(result.outcome).toBe('won');
    expect(result.bossHealth).toBe(0);
    expect(result.playerHearts).toBe(DEFAULT_COMBAT.playerMaxHearts);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(maxDurationMs);
  });

  it('đi qua đủ 3 phase, mỗi ngưỡng đúng một lần', () => {
    expect(result.phaseChanges).toEqual([2, 3]);
    expect(eventsOf(result, 'boss-phase').map((event) => event.phase)).toEqual([2, 3]);
  });

  it('mọi loại BossEvent đều vào log (shoot/move/telegraph/animation)', () => {
    expect(eventsOf(result, 'boss-shoot').length).toBeGreaterThan(0);
    expect(eventsOf(result, 'boss-move').length).toBeGreaterThan(0);
    expect(eventsOf(result, 'boss-telegraph').length).toBeGreaterThan(0);
    expect(eventsOf(result, 'boss-animation').length).toBeGreaterThan(0);

    // Animation ghi đúng key manifest, không phải tên ý đồ.
    for (const event of eventsOf(result, 'boss-animation')) {
      expect(BOSSES.tengu.animations).toContain(event.animation);
    }
  });

  it('đạn player trừ máu boss đúng từng viên, máu không tăng lại', () => {
    const hits = eventsOf(result, 'boss-hit');

    expect(hits).toHaveLength(BOSSES.tengu.maxHealth);
    expect(hits[hits.length - 1]?.health).toBe(0);

    for (let index = 1; index < hits.length; index += 1) {
      const previous = hits[index - 1];
      const current = hits[index];
      if (previous === undefined || current === undefined) continue;
      expect(current.health).toBe(previous.health - 1);
      expect(current.nowMs).toBeGreaterThanOrEqual(previous.nowMs);
    }

    // Boss chỉ chết một lần, kết thúc run ngay.
    expect(eventsOf(result, 'boss-defeated')).toHaveLength(1);
  });
});

describe('boss run — player zero DPS', () => {
  const maxDurationMs = 15_000;
  const result = simulateBossRun({
    bossId: 'tengu',
    seed: 3,
    playerDamagePerShot: 0,
    policy: holdPosition,
    maxDurationMs,
  });

  it('hết giờ với boss còn đầy máu', () => {
    expect(result.outcome).toBe('timeout');
    expect(result.bossHealth).toBe(BOSSES.tengu.maxHealth);
    expect(result.phaseChanges).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(maxDurationMs);
    expect(result.durationMs).toBeLessThan(maxDurationMs + BOSS_RUN_STEP_MS);
  });

  it('vẫn ăn ít nhất một đòn từ đạn thật của boss', () => {
    const hits = eventsOf(result, 'player-hit');

    expect(eventsOf(result, 'boss-shoot').length).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(result.playerHearts).toBeLessThan(DEFAULT_COMBAT.playerMaxHearts);

    for (const hit of hits) {
      expect(hit.source).toBe('projectile');
      expect(hit.hearts).toBeGreaterThanOrEqual(0);
    }

    // Không có sát thương nào lên boss vì đạn damage 0.
    expect(eventsOf(result, 'boss-hit')).toHaveLength(0);
  });
});

describe('boss run — determinism', () => {
  const options = {
    bossId: 'squid',
    seed: 4242,
    godMode: true,
    playerDamagePerShot: 2,
    maxDurationMs: 120_000,
  } as const;

  it('cùng seed → cùng outcome, cùng số event, cùng nội dung event', () => {
    const first = simulateBossRun(options);
    const second = simulateBossRun(options);

    expect(second.outcome).toBe(first.outcome);
    expect(second.durationMs).toBe(first.durationMs);
    expect(second.bossHealth).toBe(first.bossHealth);
    expect(second.playerHearts).toBe(first.playerHearts);
    expect(second.phaseChanges).toEqual(first.phaseChanges);
    expect(second.events.length).toBe(first.events.length);
    expect(second.events).toEqual(first.events);
  });

  it('chạy lại từ seed khác vẫn giữ nguyên luật chơi (không phụ thuộc thứ tự gọi)', () => {
    const other = simulateBossRun({ ...options, seed: 99 });

    expect(other.outcome).toBe('won');
    expect(other.phaseChanges).toEqual([2, 3]);
    expect(other.bossHealth).toBe(0);
    expect(other.events.length).toBeGreaterThan(0);
  });
});

describe('boss run — summon của Squid', () => {
  const result = simulateBossRun({
    bossId: 'squid',
    seed: 11,
    godMode: true,
    playerDamagePerShot: 2,
    maxDurationMs: 120_000,
  });
  const summons = eventsOf(result, 'boss-summon');

  it('đi qua phase 3 và có gọi quái', () => {
    expect(result.phaseChanges).toEqual([2, 3]);
    expect(summons.length).toBeGreaterThan(0);
  });

  it('quái chỉ xuất hiện từ phase 2 trở đi', () => {
    for (const summon of summons) {
      expect(summon.phase).toBeGreaterThanOrEqual(2);
    }

    // Không có event summon nào trước phase-change đầu tiên.
    const firstPhaseIndex = result.events.findIndex((event) => event.kind === 'boss-phase');
    const firstSummonIndex = result.events.findIndex((event) => event.kind === 'boss-summon');
    expect(firstPhaseIndex).toBeGreaterThanOrEqual(0);
    expect(firstSummonIndex).toBeGreaterThan(firstPhaseIndex);
  });

  it('quái nằm trong phòng và có id tất định', () => {
    for (const summon of summons) {
      expect(summon.at.x).toBeGreaterThanOrEqual(0);
      expect(summon.at.x).toBeLessThanOrEqual(ROOM_COLS);
      expect(summon.at.y).toBeGreaterThanOrEqual(0);
      expect(summon.at.y).toBeLessThanOrEqual(ROOM_ROWS);
      expect(summon.enemyId).toMatch(/^boss-squid-caster-\d+-\d+$/);
    }

    const ids = summons.map((summon) => summon.enemyId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gọi đúng 2 caster mỗi lần, như GDD §5', () => {
    const byMoment = new Map<number, SummonEvent[]>();
    for (const summon of summons) {
      const group = byMoment.get(summon.nowMs);
      if (group === undefined) byMoment.set(summon.nowMs, [summon]);
      else group.push(summon);
    }

    expect(byMoment.size).toBe(1);
    for (const group of byMoment.values()) {
      expect(group).toHaveLength(2);
      expect(group.every((summon) => summon.role === 'caster')).toBe(true);
    }
  });
});

describe('boss hitbox', () => {
  it('có bán kính cho cả 3 boss và nằm trong biên hợp lý của arena', () => {
    for (const id of BOSS_IDS) {
      const radius = BOSSES[id].hitboxRadiusTiles;
      expect(radius).toBeGreaterThan(0);
      // Nửa bề rộng phòng là 16 tile; hitbox boss không thể lớn hơn thế.
      expect(radius).toBeLessThan(ROOM_COLS / 2);
      expect(radius).toBeLessThan(ROOM_ROWS / 2);
    }
  });

  it('hitbox là proxy nhỏ hơn nửa frame sprite lớn nhất (không trúng không khí)', () => {
    // Frame boss lớn nhất: 82 px Tengu, 76 px Squid, 96 px Samurai (GDD §5).
    const framePx = { tengu: 82, squid: 76, samurai: 96 };

    for (const id of BOSS_IDS) {
      expect(BOSSES[id].hitboxRadiusTiles).toBeLessThan(framePx[id] / 2 / 16);
    }
  });
});

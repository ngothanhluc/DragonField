import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOSSES,
  BOSS_FEET_OFFSET_TILES,
  BOSS_IDS,
  animationFor,
  bossForSpriteName,
  healthFraction,
  phaseFor,
  type BossId,
  type BossPhase,
} from '../../assets/scripts/core/boss/boss-defs';
import {
  BOSS_SCRIPTS,
  bossRoomBounds,
  initialBossState,
  isBossDefeated,
  isDamagingStep,
  stepBoss,
  type BossEvent,
  type BossState,
  type BossStep,
  type BulletVerb,
  type VolleySpec,
} from '../../assets/scripts/core/boss/patterns';
import {
  SUMMON_MIN_SEPARATION_TILES,
  summonedEnemies,
} from '../../assets/scripts/core/boss/summon';
import { TELEGRAPH_MS } from '../../assets/scripts/core/combat/telegraph';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';
import { distance, type Vec2 } from '../../assets/scripts/core/math/vec2';
import { SeededRng } from '../../assets/scripts/core/rng';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json');

/** Boss đứng giữa sân; player đi vòng để pattern phải bám chứ không đứng yên. */
const BOSS_START: Vec2 = { x: 16, y: 9 };

function playerAt(nowMs: number): Vec2 {
  return { x: BOSS_START.x + Math.cos(nowMs / 700) * 6, y: BOSS_START.y + Math.sin(nowMs / 900) * 4 };
}

interface SimOptions {
  readonly seconds: number;
  readonly seed?: number;
  readonly healthFraction?: number;
  readonly deltaMs?: number;
  readonly staticPlayer?: boolean;
}

interface SimResult {
  readonly events: BossEvent[];
  readonly state: BossState;
}

/**
 * Chạy boss từ đầu trong `seconds` giây, bước đều `deltaMs`. State được luồn
 * qua từng frame đúng như adapter sẽ làm, nên test không tự dựng lại state.
 */
function simulate(id: BossId, options: SimOptions): SimResult {
  const deltaMs = options.deltaMs ?? 40;
  const totalMs = Math.round(options.seconds * 1000);
  const fraction = options.healthFraction ?? 1;
  const rng = new SeededRng(options.seed ?? 101);

  let state: BossState = {
    ...initialBossState(id, BOSS_START),
    health: BOSSES[id].maxHealth * fraction,
    phase: phaseFor(id, fraction),
  };

  const events: BossEvent[] = [];
  for (let nowMs = deltaMs; nowMs <= totalMs; nowMs += deltaMs) {
    const player = options.staticPlayer === true ? BOSS_START : playerAt(nowMs);
    const result = stepBoss({ state, nowMs, deltaMs, player, rng });
    state = result.state;
    events.push(...result.events);
  }

  return { events, state };
}

type ShootEvent = Extract<BossEvent, { kind: 'shoot' }>;
type TelegraphedEvent = Extract<BossEvent, { kind: 'telegraph' }>;
type PhaseChangeEvent = Extract<BossEvent, { kind: 'phase-change' }>;

function shootEvents(events: readonly BossEvent[]): ShootEvent[] {
  return events.filter((event): event is ShootEvent => event.kind === 'shoot');
}

function telegraphEvents(events: readonly BossEvent[]): TelegraphedEvent[] {
  return events.filter((event): event is TelegraphedEvent => event.kind === 'telegraph');
}

function phaseChangeEvents(events: readonly BossEvent[]): PhaseChangeEvent[] {
  return events.filter((event): event is PhaseChangeEvent => event.kind === 'phase-change');
}

function bulletsOf(events: readonly BossEvent[]): BulletVerb[] {
  return shootEvents(events).flatMap((event) => event.bullets);
}

/** Tổng thời lượng một vòng đầy đủ (lần chạy đầu) của phase. */
function scriptDurationMs(id: BossId, phase: BossPhase): number {
  return BOSS_SCRIPTS[id][phase].steps.reduce((sum, step) => sum + step.durationMs, 0);
}

function volleySpecs(id: BossId, phase: BossPhase): VolleySpec[] {
  return BOSS_SCRIPTS[id][phase].steps.flatMap((step) =>
    step.actions.flatMap((action) => (action.kind === 'volley' ? [action.volley] : [])),
  );
}

function actionKinds(step: BossStep): string[] {
  return step.actions.map((action) => action.kind);
}

/** Đạn khớp "dấu vân tay" của một `VolleySpec` (số viên + tốc độ + sát thương + bán kính). */
function matchesSpec(bullets: readonly BulletVerb[], spec: VolleySpec): boolean {
  return (
    bullets.length === spec.count &&
    bullets.every(
      (bullet) =>
        bullet.speed === spec.speedTilesPerSecond &&
        bullet.damage === spec.damage &&
        bullet.radiusTiles === spec.radiusTiles,
    )
  );
}

describe('boss defs', () => {
  it('máu đúng GDD 60 / 80 / 100 và đủ 3 chapter', () => {
    expect(BOSS_IDS.map((id) => BOSSES[id].maxHealth)).toEqual([60, 80, 100]);
    expect(BOSS_IDS.map((id) => BOSSES[id].chapter)).toEqual([1, 2, 3]);
    expect(BOSSES.tengu.spriteName).toBe('TenguBlue');
    expect(BOSSES.squid.spriteName).toBe('SquidGreen');
    expect(BOSSES.samurai.spriteName).toBe('GiantBlueSamurai');
  });

  it('animation khai báo đều có thật trong manifest', () => {
    const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (typeof raw !== 'object' || raw === null || !('sprites' in raw)) {
      throw new Error('animations.json không có trường sprites');
    }
    const sprites = (raw as { sprites: Record<string, unknown> }).sprites;

    for (const id of BOSS_IDS) {
      expect(BOSSES[id].animations.length).toBeGreaterThan(0);
      for (const key of BOSSES[id].animations) {
        expect(sprites[key], `${id} thiếu ${key} trong manifest`).toBeDefined();
      }
    }
  });

  it('samurai đổi animation theo hướng, hai boss kia thì không', () => {
    expect(animationFor('samurai', 'attack', 'left')).toBe('samurai.attack.left');
    expect(animationFor('samurai', 'attack', 'right')).toBe('samurai.attack.right');
    expect(animationFor('samurai', 'charge', 'left')).toBe('samurai.charge.left');
    expect(animationFor('tengu', 'attack', 'left')).toBe(animationFor('tengu', 'attack', 'right'));
    expect(animationFor('tengu', 'teleport', 'right')).toBe('tengu.trans');
    expect(animationFor('squid', 'loop', 'left')).toBe('squid.attack-loop');
    // Boss không có animation đó thì lùi về attack, không trả key rác.
    expect(animationFor('tengu', 'loop', 'left')).toBe('tengu.attack');
  });

  it('tra boss theo tên sprite trong TMX', () => {
    expect(bossForSpriteName('TenguBlue')?.id).toBe('tengu');
    expect(bossForSpriteName('GiantBlueSamurai')?.id).toBe('samurai');
    expect(bossForSpriteName('Dragon')).toBeUndefined();
  });
});

describe('phaseFor', () => {
  it('biên 100 / 66 / 33 / 0', () => {
    expect(phaseFor('tengu', 1)).toBe(1);
    expect(phaseFor('tengu', 0.66)).toBe(2);
    expect(phaseFor('tengu', 0.33)).toBe(3);
    expect(phaseFor('tengu', 0)).toBe(3);
  });

  it('ngưỡng tính về phase sau, giống nhau cho cả ba boss', () => {
    for (const id of BOSS_IDS) {
      expect(phaseFor(id, 1)).toBe(1);
      expect(phaseFor(id, 0.99)).toBe(1);
      expect(phaseFor(id, 0.67)).toBe(1);
      expect(phaseFor(id, 2 / 3)).toBe(2);
      expect(phaseFor(id, 0.5)).toBe(2);
      expect(phaseFor(id, 0.34)).toBe(2);
      expect(phaseFor(id, 1 / 3)).toBe(3);
      expect(phaseFor(id, 0)).toBe(3);
    }
  });

  it('healthFraction kẹp trong [0, 1]', () => {
    expect(healthFraction('tengu', 60)).toBe(1);
    expect(healthFraction('tengu', 30)).toBe(0.5);
    expect(healthFraction('tengu', 0)).toBe(0);
    expect(healthFraction('tengu', 999)).toBe(1);
    expect(healthFraction('tengu', -5)).toBe(0);
  });
});

describe('boss phase change', () => {
  it('mỗi boss đi qua đủ 3 phase, mỗi ngưỡng phát phase-change đúng một lần', () => {
    for (const id of BOSS_IDS) {
      const def = BOSSES[id];
      const rng = new SeededRng(99);
      let state = initialBossState(id, BOSS_START);
      const events: BossEvent[] = [];
      let nowMs = 0;

      for (const fraction of [1, 0.9, 0.66, 0.5, 0.33, 0.2, 0]) {
        nowMs += 40;
        state = { ...state, health: def.maxHealth * fraction };
        const result = stepBoss({ state, nowMs, deltaMs: 40, player: BOSS_START, rng });
        state = result.state;
        events.push(...result.events);
        expect(state.phase, `${id} ở ${fraction} máu`).toBe(phaseFor(id, fraction));
      }

      // Chạy thêm 2 giây: không được phát lại phase-change nào.
      for (let frame = 0; frame < 50; frame += 1) {
        nowMs += 40;
        const result = stepBoss({ state, nowMs, deltaMs: 40, player: BOSS_START, rng });
        state = result.state;
        events.push(...result.events);
      }

      expect(phaseChangeEvents(events).map((event) => event.phase)).toEqual([2, 3]);
    }
  });

  it('máu tụt một nhịp qua hai ngưỡng thì phát hai event, không phát lại', () => {
    const id: BossId = 'squid';
    const rng = new SeededRng(7);
    const events: BossEvent[] = [];
    let state = initialBossState(id, BOSS_START);

    const jump = stepBoss({ state, nowMs: 40, deltaMs: 40, player: BOSS_START, rng });
    state = { ...jump.state, health: 1 };
    events.push(...jump.events);

    const after = stepBoss({ state, nowMs: 80, deltaMs: 40, player: BOSS_START, rng });
    events.push(...after.events);
    expect(phaseChangeEvents(events).map((event) => event.phase)).toEqual([2, 3]);

    const again = stepBoss({ state: after.state, nowMs: 120, deltaMs: 40, player: BOSS_START, rng });
    expect(phaseChangeEvents(again.events)).toHaveLength(0);
  });

  it('boss chết thì đứng im, không bắn thêm', () => {
    const dead: BossState = { ...initialBossState('tengu', BOSS_START), health: 0, phase: 3 };
    const result = stepBoss({
      state: dead,
      nowMs: 5000,
      deltaMs: 40,
      player: BOSS_START,
      rng: new SeededRng(3),
    });

    expect(result.events).toEqual([]);
    expect(isBossDefeated(result.state)).toBe(true);
    expect(result.state.position).toEqual(dead.position);
  });
});

describe('telegraph', () => {
  it('mọi bước gây sát thương đều đứng ngay sau một bước telegraph (dữ liệu pattern)', () => {
    for (const id of BOSS_IDS) {
      for (const phase of [1, 2, 3] as const) {
        const script = BOSS_SCRIPTS[id][phase];
        const steps = script.steps;
        const loopFrom = script.loopFrom ?? 0;

        steps.forEach((step, index) => {
          if (!isDamagingStep(step)) return;

          const previousIndex = index === loopFrom ? steps.length - 1 : Math.max(0, index - 1);
          const previous = steps[previousIndex];
          expect(previous, `${id} p${phase} bước ${index} không có bước trước`).toBeDefined();
          expect(
            previous?.actions.some((action) => action.kind === 'telegraph'),
            `${id} p${phase} bước ${index} (${actionKinds(step).join('+')}) thiếu telegraph`,
          ).toBe(true);
        });
      }
    }
  });

  it('trong 30 s chạy thật, không phát đạn nào trước telegraph 800 ms', () => {
    for (const id of BOSS_IDS) {
      for (const fraction of [1, 0.6, 0.2]) {
        const { events } = simulate(id, { seconds: 30, healthFraction: fraction });

        let telegraphs = 0;
        let shoots = 0;
        for (const event of events) {
          if (event.kind === 'telegraph') {
            expect(event.durationMs).toBe(TELEGRAPH_MS.boss);
            expect(Number.isFinite(event.at.x)).toBe(true);
            expect(Number.isFinite(event.at.y)).toBe(true);
            telegraphs += 1;
          }
          if (event.kind === 'shoot') {
            expect(telegraphs, `${id} bắn trước telegraph`).toBeGreaterThan(0);
            shoots += 1;
          }
        }

        expect(telegraphs).toBeGreaterThan(0);
        expect(shoots).toBeGreaterThan(0);
      }
    }
  });

  it('telegraph phát kèm animation báo đòn, rồi đòn thật ở bước kế', () => {
    const { events } = simulate('tengu', { seconds: 12, healthFraction: 1 });
    const telegraph = telegraphEvents(events)[0];
    expect(telegraph).toBeDefined();

    // Bước telegraph phát: [telegraph, play-animation attack]; đòn thật ở bước kế.
    const index = events.indexOf(telegraph as TelegraphedEvent);
    expect(events[index + 1]?.kind).toBe('play-animation');

    const nextShootIndex = events.findIndex(
      (event, at) => at > index && event.kind === 'shoot',
    );
    expect(nextShootIndex).toBeGreaterThan(index);
  });
});

describe('determinism', () => {
  it('cùng seed + cùng input → chuỗi event và state y hệt', () => {
    for (const id of BOSS_IDS) {
      const first = simulate(id, { seconds: 20, seed: 4242, healthFraction: 0.5 });
      const second = simulate(id, { seconds: 20, seed: 4242, healthFraction: 0.5 });

      expect(first.events).toEqual(second.events);
      expect(first.state).toEqual(second.state);
    }
  });

  it('seed khác → dịch chuyển khác', () => {
    const first = simulate('tengu', { seconds: 8, seed: 1, healthFraction: 0.5 });
    const second = simulate('tengu', { seconds: 8, seed: 2, healthFraction: 0.5 });
    expect(first.events).not.toEqual(second.events);
  });

  it('state chỉ là dữ liệu phẳng: JSON round-trip không mất gì', () => {
    const { state } = simulate('samurai', { seconds: 6, healthFraction: 0.2 });
    const roundTrip: unknown = JSON.parse(JSON.stringify(state));
    expect(roundTrip).toEqual(state);

    for (const value of Object.values(state)) {
      expect(typeof value).not.toBe('function');
    }
  });

  it('không sửa state của caller', () => {
    const state: BossState = { ...initialBossState('tengu', BOSS_START), phase: 2, health: 40 };
    const before = JSON.stringify(state);

    stepBoss({ state, nowMs: 500, deltaMs: 40, player: playerAt(500), rng: new SeededRng(9) });

    expect(JSON.stringify(state)).toBe(before);
  });

  it('một frame dài (mất frame) vẫn chạy hết các bước, không kẹt vòng lặp', () => {
    const state: BossState = { ...initialBossState('tengu', BOSS_START), health: 10, phase: 3 };
    const result = stepBoss({
      state,
      nowMs: 12_000,
      deltaMs: 12_000,
      player: BOSS_START,
      rng: new SeededRng(3),
    });

    // 6100 ms/vòng ⇒ 12 s phải đi qua gần hai vòng, tức là có ít nhất 4 chùm 5 viên.
    const fans = shootEvents(result.events).filter((event) => event.bullets.length === 5);
    expect(fans.length).toBeGreaterThanOrEqual(4);
    expect(Number.isFinite(result.state.position.x)).toBe(true);
  });
});

describe('bullet verbs', () => {
  it('mọi viên đạn đều hợp lệ và nằm trong phòng', () => {
    for (const id of BOSS_IDS) {
      for (const fraction of [1, 0.6, 0.2]) {
        const bullets = bulletsOf(simulate(id, { seconds: 25, healthFraction: fraction }).events);
        expect(bullets.length, `${id} không bắn viên nào`).toBeGreaterThan(0);

        for (const bullet of bullets) {
          expect(bullet.speed).toBeGreaterThan(0);
          expect(bullet.damage).toBeGreaterThan(0);
          expect(bullet.radiusTiles).toBeGreaterThan(0);
          expect(Number.isFinite(bullet.angleOffset)).toBe(true);
          expect(bullet.from.x).toBeGreaterThanOrEqual(0);
          expect(bullet.from.x).toBeLessThanOrEqual(ROOM_COLS);
          expect(bullet.from.y).toBeGreaterThanOrEqual(0);
          expect(bullet.from.y).toBeLessThanOrEqual(ROOM_ROWS);

          // Hoặc có điểm nhắm thật, hoặc có góc tuyệt đối — không được mơ hồ cả hai.
          if (bullet.toward !== null) {
            expect(distance(bullet.from, bullet.toward)).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('chùm fan/spread nhắm player và đối xứng quanh hướng nhắm', () => {
    const { events } = simulate('tengu', {
      seconds: scriptDurationMs('tengu', 1) / 1000,
      healthFraction: 1,
    });
    const [fan] = shootEvents(events);
    expect(fan).toBeDefined();

    const bullets = fan?.bullets ?? [];
    expect(bullets).toHaveLength(5);
    const offsets = bullets.map((bullet) => bullet.angleOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    const sum = offsets.reduce((total, offset) => total + offset, 0);
    expect(sum).toBeCloseTo(0);
    const targets = bullets.map((bullet) => bullet.toward);
    for (const target of targets) {
      expect(target).not.toBeNull();
      expect(Number.isFinite(target?.x)).toBe(true);
      expect(Number.isFinite(target?.y)).toBe(true);
      expect(target).toEqual(targets[0]);
    }
  });

  it('count đạn khớp GDD: 5 / 8 / 3 đợt chùm 5 / 5 toả / xoắn', () => {
    // Ch1 phase 1: một chùm 5 viên mỗi vòng.
    const tengu1 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 1) / 1000, healthFraction: 1 }).events,
    );
    expect(tengu1.map((event) => event.bullets.length)).toEqual([5]);

    // Ch1 phase 2: một vòng 8 viên mỗi vòng.
    const tengu2 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 2) / 1000, healthFraction: 0.6 }).events,
    );
    expect(tengu2.map((event) => event.bullets.length)).toEqual([8]);

    // Ch1 phase 3: dịch chuyển ×3, chùm 5 viên ×3 đợt.
    const tengu3 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 3) / 1000, healthFraction: 0.2 }).events,
    );
    expect(tengu3.map((event) => event.bullets.length)).toEqual([5, 5, 5]);

    // Ch2 phase 1: một loạt 5 viên toả mỗi vòng.
    const squid1 = shootEvents(
      simulate('squid', { seconds: scriptDurationMs('squid', 1) / 1000, healthFraction: 1 }).events,
    );
    expect(squid1.map((event) => event.bullets.length)).toEqual([5]);

    // Ch3 phase 1: một sóng slash 3 viên.
    const samurai1 = shootEvents(
      simulate('samurai', { seconds: scriptDurationMs('samurai', 1) / 1000, healthFraction: 1 })
        .events,
    );
    expect(samurai1.map((event) => event.bullets.length)).toEqual([3]);
  });

  it('xoắn ốc phát đúng nhịp và quay đều góc', () => {
    const spiralAction = BOSS_SCRIPTS.squid[2].steps
      .flatMap((step) => step.actions)
      .find((action) => action.kind === 'spiral');
    expect(spiralAction).toBeDefined();
    if (spiralAction === undefined || spiralAction.kind !== 'spiral') return;

    const spiralStep = BOSS_SCRIPTS.squid[2].steps.find((step) =>
      step.actions.some((action) => action.kind === 'spiral'),
    );
    expect(spiralStep).toBeDefined();

    const seconds = scriptDurationMs('squid', 2) / 1000;
    const { events } = simulate('squid', {
      seconds,
      healthFraction: 0.6,
      staticPlayer: true,
    });

    const shots = shootEvents(events);
    const expected = Math.ceil(
      (spiralStep?.durationMs ?? 0) / spiralAction.spiral.intervalMs,
    );
    expect(shots).toHaveLength(expected);
    for (const shot of shots) expect(shot.bullets).toHaveLength(1);

    const angles = shots.map((shot) => shot.bullets[0]?.angleOffset ?? Number.NaN);
    for (let index = 1; index < angles.length; index += 1) {
      const previous = angles[index - 1] ?? 0;
      const current = angles[index] ?? 0;
      expect(current - previous).toBeCloseTo(spiralAction.spiral.angleStepRadians);
    }
  });

  it('mọi volley khai báo trong script đều xuất hiện đúng số viên khi chạy', () => {
    for (const id of BOSS_IDS) {
      for (const phase of [1, 2, 3] as const) {
        const fraction = phase === 1 ? 1 : phase === 2 ? 0.6 : 0.2;
        const { events } = simulate(id, {
          seconds: scriptDurationMs(id, phase) / 1000,
          healthFraction: fraction,
        });
        const shots = shootEvents(events);

        for (const spec of volleySpecs(id, phase)) {
          expect(
            shots.some((shot) => matchesSpec(shot.bullets, spec)),
            `${id} p${phase} thiếu volley ${spec.shape} ${spec.count} viên`,
          ).toBe(true);
        }
      }
    }
  });

  it('slash của samurai bay theo hướng facing, không toả 360°', () => {
    const { events } = simulate('samurai', {
      seconds: scriptDurationMs('samurai', 1) / 1000,
      healthFraction: 1,
    });
    const [slash] = shootEvents(events);
    expect(slash).toBeDefined();

    for (const bullet of slash?.bullets ?? []) {
      expect(bullet.toward).toBeNull();
      const angle = bullet.angleOffset;
      expect(angle === 0 || Math.abs(angle) === Math.PI).toBe(true);
    }
  });

  it('phase 3 của samurai: vệt lửa + đúng 2 sóng slash', () => {
    const { events } = simulate('samurai', {
      seconds: scriptDurationMs('samurai', 3) / 1000,
      healthFraction: 0.2,
    });
    const shots = shootEvents(events);
    expect(shots).toHaveLength(3);

    const trail = shots[0];
    expect(trail?.bullets.length).toBeGreaterThanOrEqual(3);
    const trailSpeeds = new Set(trail?.bullets.map((bullet) => bullet.speed));
    expect(trailSpeeds.size).toBe(1);

    for (const slash of shots.slice(1)) {
      expect(slash.bullets).toHaveLength(3);
    }
  });
});

describe('summon', () => {
  const summoner: BossState = {
    ...initialBossState('squid', BOSS_START),
    health: 20,
    phase: 3,
  };

  it('id duy nhất và đúng tiền tố boss-<id>-', () => {
    const list = summonedEnemies(summoner, 'caster', 2, new SeededRng(5));
    expect(list).toHaveLength(2);

    const ids = list.map((enemy) => enemy.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('boss-squid-')).toBe(true);
  });

  it('trong phòng và không đè lên boss', () => {
    for (const seed of [1, 2, 3, 17, 99]) {
      const list = summonedEnemies(summoner, 'caster', 2, new SeededRng(seed));
      for (const enemy of list) {
        expect(enemy.position.x).toBeGreaterThanOrEqual(0);
        expect(enemy.position.x).toBeLessThanOrEqual(ROOM_COLS);
        expect(enemy.position.y).toBeGreaterThanOrEqual(0);
        expect(enemy.position.y).toBeLessThanOrEqual(ROOM_ROWS);
        expect(distance(enemy.position, summoner.position)).toBeGreaterThanOrEqual(
          SUMMON_MIN_SEPARATION_TILES,
        );
      }
    }
  });

  it('boss đứng sát góc vẫn gọi ra quái không đè lên mình', () => {
    for (const corner of [
      { x: 1, y: 1 },
      { x: ROOM_COLS - 1, y: ROOM_ROWS - 1 },
      { x: ROOM_COLS - 1, y: 1 },
    ]) {
      const cornered: BossState = { ...summoner, position: corner };
      const list = summonedEnemies(cornered, 'caster', 2, new SeededRng(11));
      for (const enemy of list) {
        expect(enemy.position.x).toBeGreaterThanOrEqual(0);
        expect(enemy.position.x).toBeLessThanOrEqual(ROOM_COLS);
        expect(enemy.position.y).toBeGreaterThanOrEqual(0);
        expect(enemy.position.y).toBeLessThanOrEqual(ROOM_ROWS);
        expect(distance(enemy.position, corner)).toBeGreaterThanOrEqual(
          SUMMON_MIN_SEPARATION_TILES,
        );
      }
    }
  });

  it('cùng seed → cùng danh sách, khác seed → vị trí khác', () => {
    const first = summonedEnemies(summoner, 'caster', 2, new SeededRng(42));
    const second = summonedEnemies(summoner, 'caster', 2, new SeededRng(42));
    expect(first).toEqual(second);

    const variants = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        JSON.stringify(summonedEnemies(summoner, 'caster', 2, new SeededRng(seed))),
      ),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it('squid phase 3 gọi đúng 2 caster một lần mỗi lần vào phase', () => {
    const { events } = simulate('squid', {
      seconds: scriptDurationMs('squid', 3) / 1000,
      healthFraction: 0.2,
    });
    const summons = events.filter((event) => event.kind === 'summon');
    expect(summons).toHaveLength(1);
    expect(summons[0]).toEqual({ kind: 'summon', role: 'caster', count: 2 });
  });
});

describe('boss không tràn sprite ra ngoài phòng', () => {
  /** Player bám từng góc/mép để kéo boss (chase/line-up/charge) ra sát tường. */
  const EDGE_PLAYERS: readonly Vec2[] = [
    { x: 0.5, y: 0.5 },
    { x: ROOM_COLS - 0.5, y: 0.5 },
    { x: 0.5, y: ROOM_ROWS - 0.5 },
    { x: ROOM_COLS - 0.5, y: ROOM_ROWS - 0.5 },
    { x: 16, y: 0.5 },
    { x: 0.5, y: 9 },
  ];

  it('mọi vị trí qua cả 3 phase giữ trọn sprite (theo spriteExtentTiles) trong 32×18', () => {
    for (const id of BOSS_IDS) {
      const extent = BOSSES[id].spriteExtentTiles;
      for (const fraction of [1, 0.5, 0.2]) {
        for (const [index, player] of EDGE_PLAYERS.entries()) {
          const rng = new SeededRng(7 + index);
          let state: BossState = {
            ...initialBossState(id, { x: 1, y: 1 }),
            health: BOSSES[id].maxHealth * fraction,
            phase: phaseFor(id, fraction),
          };
          for (let nowMs = 40; nowMs <= 20_000; nowMs += 40) {
            state = stepBoss({ state, nowMs, deltaMs: 40, player, rng }).state;
            const { x, y } = state.position;
            const feetY = y + BOSS_FEET_OFFSET_TILES;
            const where = `${id} phase ${state.phase} player (${player.x},${player.y}) t=${nowMs}`;
            expect(x - extent.left, where).toBeGreaterThanOrEqual(0);
            expect(x + extent.right, where).toBeLessThanOrEqual(ROOM_COLS);
            expect(feetY - extent.up, where).toBeGreaterThanOrEqual(0);
            expect(feetY, where).toBeLessThanOrEqual(ROOM_ROWS);
          }
        }
      }
    }
  });

  it('spawn sát góc bị kéo vào vùng đứng hợp lệ', () => {
    for (const id of BOSS_IDS) {
      const bounds = bossRoomBounds(id);
      expect(initialBossState(id, { x: 0, y: 0 }).position).toEqual({ x: bounds.minX, y: bounds.minY });
    }
  });
});

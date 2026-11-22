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

/** Boss stands mid-arena; the player circles so patterns must track instead of standing still. */
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
 * Run the boss from the start for `seconds` seconds, stepping at a steady `deltaMs`. State is threaded
 * through each frame exactly as the adapter would, so the test never rebuilds state itself.
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

/** Total duration of one full loop (first run) of the phase. */
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

/** Bullets matching the "fingerprint" of a `VolleySpec` (count + speed + damage + radius). */
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
  it('health exactly as GDD 60 / 80 / 100 from all 3 chapters, 60 / 80 for the ch1/ch2 pool', () => {
    expect(BOSS_IDS.map((id) => BOSSES[id].maxHealth)).toEqual([60, 80, 100, 60, 80]);
    expect(BOSS_IDS.map((id) => BOSSES[id].chapter)).toEqual([1, 2, 3, 1, 2]);
    expect(BOSSES.tengu.spriteName).toBe('TenguBlue');
    expect(BOSSES.squid.spriteName).toBe('SquidGreen');
    expect(BOSSES.samurai.spriteName).toBe('GiantBlueSamurai');
    expect(BOSSES.frog.spriteName).toBe('GiantFrog');
    expect(BOSSES.slime.spriteName).toBe('GiantSlime');
  });

  it('every declared animation really exists in the manifest', () => {
    const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (typeof raw !== 'object' || raw === null || !('sprites' in raw)) {
      throw new Error('animations.json has no sprites field');
    }
    const sprites = (raw as { sprites: Record<string, unknown> }).sprites;

    for (const id of BOSS_IDS) {
      expect(BOSSES[id].animations.length).toBeGreaterThan(0);
      for (const key of BOSSES[id].animations) {
        expect(sprites[key], `${id} is missing ${key} in the manifest`).toBeDefined();
      }
    }
  });

  it('samurai switches animation by facing, the other two do not', () => {
    expect(animationFor('samurai', 'attack', 'left')).toBe('samurai.attack.left');
    expect(animationFor('samurai', 'attack', 'right')).toBe('samurai.attack.right');
    expect(animationFor('samurai', 'charge', 'left')).toBe('samurai.charge.left');
    expect(animationFor('tengu', 'attack', 'left')).toBe(animationFor('tengu', 'attack', 'right'));
    expect(animationFor('tengu', 'teleport', 'right')).toBe('tengu.trans');
    expect(animationFor('squid', 'loop', 'left')).toBe('squid.attack-loop');
    // A boss without that animation falls back to attack, never a garbage key.
    expect(animationFor('tengu', 'loop', 'left')).toBe('tengu.attack');
  });

  it('looks up a boss by the sprite name in the TMX', () => {
    expect(bossForSpriteName('TenguBlue')?.id).toBe('tengu');
    expect(bossForSpriteName('GiantBlueSamurai')?.id).toBe('samurai');
    expect(bossForSpriteName('Dragon')).toBeUndefined();
  });
});

describe('phaseFor', () => {
  it('boundaries 100 / 66 / 33 / 0', () => {
    expect(phaseFor('tengu', 1)).toBe(1);
    expect(phaseFor('tengu', 0.66)).toBe(2);
    expect(phaseFor('tengu', 0.33)).toBe(3);
    expect(phaseFor('tengu', 0)).toBe(3);
  });

  it('thresholds count as the later phase, the same for all three bosses', () => {
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

  it('healthFraction clamps into [0, 1]', () => {
    expect(healthFraction('tengu', 60)).toBe(1);
    expect(healthFraction('tengu', 30)).toBe(0.5);
    expect(healthFraction('tengu', 0)).toBe(0);
    expect(healthFraction('tengu', 999)).toBe(1);
    expect(healthFraction('tengu', -5)).toBe(0);
  });
});

describe('boss phase change', () => {
  it('each boss goes through all 3 phases, each threshold emits phase-change exactly once', () => {
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
        expect(state.phase, `${id} at ${fraction} health`).toBe(phaseFor(id, fraction));
      }

      // Run 2 more seconds: no phase-change may be emitted again.
      for (let frame = 0; frame < 50; frame += 1) {
        nowMs += 40;
        const result = stepBoss({ state, nowMs, deltaMs: 40, player: BOSS_START, rng });
        state = result.state;
        events.push(...result.events);
      }

      expect(phaseChangeEvents(events).map((event) => event.phase)).toEqual([2, 3]);
    }
  });

  it('health dropping through two thresholds in one beat emits two events, never repeats', () => {
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

  it('a dead boss stands still and fires nothing more', () => {
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
  it('every damage step sits right behind a telegraph step (pattern data)', () => {
    for (const id of BOSS_IDS) {
      for (const phase of [1, 2, 3] as const) {
        const script = BOSS_SCRIPTS[id][phase];
        const steps = script.steps;
        const loopFrom = script.loopFrom ?? 0;

        steps.forEach((step, index) => {
          if (!isDamagingStep(step)) return;

          const previousIndex = index === loopFrom ? steps.length - 1 : Math.max(0, index - 1);
          const previous = steps[previousIndex];
          expect(previous, `${id} p${phase} step ${index} has no previous step`).toBeDefined();
          expect(
            previous?.actions.some((action) => action.kind === 'telegraph'),
            `${id} p${phase} step ${index} (${actionKinds(step).join('+')}) is missing a telegraph`,
          ).toBe(true);
        });
      }
    }
  });

  it('in 30 s of real running, nothing is fired before the 800 ms telegraph', () => {
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
            expect(telegraphs, `${id} fired before its telegraph`).toBeGreaterThan(0);
            shoots += 1;
          }
        }

        expect(telegraphs).toBeGreaterThan(0);
        expect(shoots).toBeGreaterThan(0);
      }
    }
  });

  it('a telegraph emits the tell animation, then the real attack lands in the next step', () => {
    const { events } = simulate('tengu', { seconds: 12, healthFraction: 1 });
    const telegraph = telegraphEvents(events)[0];
    expect(telegraph).toBeDefined();

    // The telegraph step emits: [telegraph, play-animation attack]; the real attack is in the next step.
    const index = events.indexOf(telegraph as TelegraphedEvent);
    expect(events[index + 1]?.kind).toBe('play-animation');

    const nextShootIndex = events.findIndex(
      (event, at) => at > index && event.kind === 'shoot',
    );
    expect(nextShootIndex).toBeGreaterThan(index);
  });
});

describe('determinism', () => {
  it('same seed + same input → identical event stream and state', () => {
    for (const id of BOSS_IDS) {
      const first = simulate(id, { seconds: 20, seed: 4242, healthFraction: 0.5 });
      const second = simulate(id, { seconds: 20, seed: 4242, healthFraction: 0.5 });

      expect(first.events).toEqual(second.events);
      expect(first.state).toEqual(second.state);
    }
  });

  it('a different seed → different teleports', () => {
    const first = simulate('tengu', { seconds: 8, seed: 1, healthFraction: 0.5 });
    const second = simulate('tengu', { seconds: 8, seed: 2, healthFraction: 0.5 });
    expect(first.events).not.toEqual(second.events);
  });

  it('state is flat data only: a JSON round-trip loses nothing', () => {
    const { state } = simulate('samurai', { seconds: 6, healthFraction: 0.2 });
    const roundTrip: unknown = JSON.parse(JSON.stringify(state));
    expect(roundTrip).toEqual(state);

    for (const value of Object.values(state)) {
      expect(typeof value).not.toBe('function');
    }
  });

  it('does not mutate the caller state', () => {
    const state: BossState = { ...initialBossState('tengu', BOSS_START), phase: 2, health: 40 };
    const before = JSON.stringify(state);

    stepBoss({ state, nowMs: 500, deltaMs: 40, player: playerAt(500), rng: new SeededRng(9) });

    expect(JSON.stringify(state)).toBe(before);
  });

  it('a long frame (dropped frame) still runs every step, without getting stuck in the loop', () => {
    const state: BossState = { ...initialBossState('tengu', BOSS_START), health: 10, phase: 3 };
    const result = stepBoss({
      state,
      nowMs: 12_000,
      deltaMs: 12_000,
      player: BOSS_START,
      rng: new SeededRng(3),
    });

    // 6100 ms/loop ⇒ 12 s must cross almost two loops, i.e. at least 4 five-bullet fans.
    const fans = shootEvents(result.events).filter((event) => event.bullets.length === 5);
    expect(fans.length).toBeGreaterThanOrEqual(4);
    expect(Number.isFinite(result.state.position.x)).toBe(true);
  });
});

describe('bullet verbs', () => {
  it('every bullet is valid and inside the room', () => {
    for (const id of BOSS_IDS) {
      for (const fraction of [1, 0.6, 0.2]) {
        const bullets = bulletsOf(simulate(id, { seconds: 25, healthFraction: fraction }).events);
        expect(bullets.length, `${id} fired no bullets`).toBeGreaterThan(0);

        for (const bullet of bullets) {
          expect(bullet.speed).toBeGreaterThan(0);
          expect(bullet.damage).toBeGreaterThan(0);
          expect(bullet.radiusTiles).toBeGreaterThan(0);
          expect(Number.isFinite(bullet.angleOffset)).toBe(true);
          expect(bullet.from.x).toBeGreaterThanOrEqual(0);
          expect(bullet.from.x).toBeLessThanOrEqual(ROOM_COLS);
          expect(bullet.from.y).toBeGreaterThanOrEqual(0);
          expect(bullet.from.y).toBeLessThanOrEqual(ROOM_ROWS);

          // Either it has a real aim point, or an absolute angle — never both ambiguously.
          if (bullet.toward !== null) {
            expect(distance(bullet.from, bullet.toward)).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('fan/spread volleys aim at the player and are symmetric around the aim direction', () => {
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

  it('bullet counts match the GDD: 5 / 8 / 3 fans of 5 / 5 spread / spiral', () => {
    // Ch1 phase 1: one 5-bullet fan per loop.
    const tengu1 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 1) / 1000, healthFraction: 1 }).events,
    );
    expect(tengu1.map((event) => event.bullets.length)).toEqual([5]);

    // Ch1 phase 2: one 8-bullet ring per loop.
    const tengu2 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 2) / 1000, healthFraction: 0.6 }).events,
    );
    expect(tengu2.map((event) => event.bullets.length)).toEqual([8]);

    // Ch1 phase 3: teleport ×3, 5-bullet fans ×3.
    const tengu3 = shootEvents(
      simulate('tengu', { seconds: scriptDurationMs('tengu', 3) / 1000, healthFraction: 0.2 }).events,
    );
    expect(tengu3.map((event) => event.bullets.length)).toEqual([5, 5, 5]);

    // Ch2 phase 1: one 5-bullet spread per loop.
    const squid1 = shootEvents(
      simulate('squid', { seconds: scriptDurationMs('squid', 1) / 1000, healthFraction: 1 }).events,
    );
    expect(squid1.map((event) => event.bullets.length)).toEqual([5]);

    // Ch3 phase 1: one 3-bullet slash wave.
    const samurai1 = shootEvents(
      simulate('samurai', { seconds: scriptDurationMs('samurai', 1) / 1000, healthFraction: 1 })
        .events,
    );
    expect(samurai1.map((event) => event.bullets.length)).toEqual([3]);
  });

  it('the spiral fires at the right cadence and rotates the angle evenly', () => {
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

  it('every volley declared in the script appears with the right bullet count at runtime', () => {
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
            `${id} p${phase} is missing volley ${spec.shape} ${spec.count} bullets`,
          ).toBe(true);
        }
      }
    }
  });

  it('the samurai slash flies along the facing direction, not a 360° spread', () => {
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

  it('samurai phase 3: fire trail + exactly 2 slash waves', () => {
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

  it('ids are unique and carry the boss-<id>- prefix', () => {
    const list = summonedEnemies(summoner, 'caster', 2, new SeededRng(5));
    expect(list).toHaveLength(2);

    const ids = list.map((enemy) => enemy.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('boss-squid-')).toBe(true);
  });

  it('inside the room and not on top of the boss', () => {
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

  it('a boss in the corner still summons enemies that do not overlap it', () => {
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

  it('same seed → same list, different seed → different positions', () => {
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

  it('squid phase 3 summons exactly 2 casters once per phase entry', () => {
    const { events } = simulate('squid', {
      seconds: scriptDurationMs('squid', 3) / 1000,
      healthFraction: 0.2,
    });
    const summons = events.filter((event) => event.kind === 'summon');
    expect(summons).toHaveLength(1);
    expect(summons[0]).toEqual({ kind: 'summon', role: 'caster', count: 2 });
  });
});

describe('the boss sprite never spills outside the room', () => {
  /** The player hugs every corner/edge to drag the boss (chase/line-up/charge) against the wall. */
  const EDGE_PLAYERS: readonly Vec2[] = [
    { x: 0.5, y: 0.5 },
    { x: ROOM_COLS - 0.5, y: 0.5 },
    { x: 0.5, y: ROOM_ROWS - 0.5 },
    { x: ROOM_COLS - 0.5, y: ROOM_ROWS - 0.5 },
    { x: 16, y: 0.5 },
    { x: 0.5, y: 9 },
  ];

  it('every position across all 3 phases keeps the whole sprite (per spriteExtentTiles) inside 32×18', () => {
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

  it('a spawn near the corner is pulled into the valid standing area', () => {
    for (const id of BOSS_IDS) {
      const bounds = bossRoomBounds(id);
      expect(initialBossState(id, { x: 0, y: 0 }).position).toEqual({ x: bounds.minX, y: bounds.minY });
    }
  });
});

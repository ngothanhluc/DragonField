/**
 * M13-T3 unit tests:
 * - Tier-2 enemy AI: predictive lead shots & multi-shot bursts (`computePredictiveAim`, `casterShotPlan`, `casterVolleyAngles`)
 * - Flanking chasers (`flankSideFor`, `computeFlankTarget`, `decideAction`)
 * - Bomber role: fuse telegraph, radial AoE blast, elite wider + double-pulse shockwave
 * - Buffer role: haste aura onto nearby allies, solo defensive orb (3-orb elite spread), `EnemyBuffTracker`
 * - WaveScheduler M13 role mixing without breaking chapter totals or authored role preservation
 * - Boss Dash-pressuring wide sweep / zone patterns in Phase 2 & Phase 3
 * - M13 `config/tuning.json` schema (`dash`, `activeSkill`, `enemies.ai`, `bomber`, `buffer`, `xp.roles`)
 * - Staged `player.dash` & 8 M13 monster sheets + elite variants + unique `.meta` UUIDs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest, type AnimationManifest } from '../../assets/scripts/core/art/manifest';
import { BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { BOSS_SCRIPTS } from '../../assets/scripts/core/boss/patterns';
import {
  bufferShotPlan,
  casterShotPlan,
  computePredictiveAim,
  predictiveLeadFactorFor,
} from '../../assets/scripts/core/combat/enemy-fire';
import { TELEGRAPH_MS } from '../../assets/scripts/core/combat/telegraph';
import {
  attackReleasedForRole,
  decideAction,
  maxHealthFor,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  bomberBlastSpec,
  isInsideBomberBlast,
  scheduleFollowUpBlast,
  stepPendingBlasts,
} from '../../assets/scripts/core/enemies/bomber';
import { EnemyBuffTracker, resolveBufferPulse } from '../../assets/scripts/core/enemies/buffer';
import { casterVolleyAngles, eliteVolleyAngles } from '../../assets/scripts/core/enemies/elite';
import { computeFlankTarget, flankSideFor } from '../../assets/scripts/core/enemies/navigation';
import {
  ACTIVE_SKILL_TUNING,
  DASH_TUNING,
  ENEMY_AI_TUNING,
  ENEMY_TUNING,
  TUNING_SOURCE,
  XP_TUNING,
  parseTuning,
} from '../../assets/scripts/core/enemies/tuning';
import {
  WaveScheduler,
  roomEnemyTotal,
  specialRoleMixForRoom,
} from '../../assets/scripts/core/enemies/wave-scheduler';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  ENEMY_ROLES,
  parseLevelData,
  type EnemyRole,
  type LevelData,
  type Obstacle,
} from '../../assets/scripts/core/level/level-data';
import { distance, type Vec2 } from '../../assets/scripts/core/math/vec2';
import { xpForKill } from '../../assets/scripts/core/xp/xp-curve';
import { readPng } from '../../scripts/lib/png';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');
const MANIFEST_PATH = join(ASSETS, 'resources', 'data', 'animations.json');

function makeRoom(obstacles: readonly Obstacle[] = [], chapter = 1): LevelData {
  return parseLevelData({
    id: `m13-room-ch${chapter}`,
    chapter,
    room: 5,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 9 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 4, y: 9 }, elite: false }] }],
    obstacles: [...obstacles],
    doors: [],
  });
}

function makeEnemy(
  role: EnemyRole,
  position: Vec2,
  options: Partial<EnemyState> = {},
): EnemyState {
  const elite = options.elite ?? false;
  const maxHealth = maxHealthFor(role, elite);
  return {
    id: options.id ?? `m13-${role}`,
    role,
    elite,
    position,
    health: options.health ?? maxHealth,
    maxHealth,
    action: options.action ?? { kind: 'idle' },
    actionStartedMs: options.actionStartedMs ?? 0,
  };
}

describe('M13 tuning schema (dash, activeSkill, enemies.ai, bomber, buffer, xp)', () => {
  it('exposes validated dash, activeSkill, and enemies.ai blocks matching config/tuning.json', () => {
    expect(DASH_TUNING).toEqual({
      bufferMs: 150,
      cooldownMs: 1800,
      durationMs: 180,
      speedTilesPerSecond: 14,
      invulnerabilityMs: 220,
    });
    expect(ACTIVE_SKILL_TUNING).toEqual({
      bufferMs: 150,
      cooldownMs: 10000,
      hitCooldownReductionMs: 200,
      killCooldownReductionMs: 650,
      barrageProjectiles: 10,
      barrageDamageMultiplier: 1.5,
    });
    expect(ENEMY_ROLES).toContain('bomber');
    expect(ENEMY_ROLES).toContain('buffer');
    expect(ENEMY_TUNING.roles.bomber.blastRadiusTiles).toBeGreaterThanOrEqual(2);
    expect(ENEMY_TUNING.roles.bomber.telegraphMs).toBeGreaterThanOrEqual(800);
    expect(ENEMY_TUNING.roles.buffer.buffRadiusTiles).toBeGreaterThanOrEqual(5);
    expect(ENEMY_TUNING.roles.buffer.buffSpeedMultiplier).toBeGreaterThan(1.1);
    expect(ENEMY_TUNING.roles.buffer.buffDurationMs).toBeGreaterThanOrEqual(3000);
    expect(XP_TUNING.roles.bomber).toBeGreaterThan(0);
    expect(XP_TUNING.roles.buffer).toBeGreaterThan(0);
    expect(xpForKill('bomber', false)).toBe(XP_TUNING.roles.bomber);
    expect(xpForKill('buffer', true)).toBeGreaterThan(XP_TUNING.roles.buffer);
  });

  it('rejects malformed M13 tuning blocks with explicit error paths', () => {
    const missingDash = structuredClone(TUNING_SOURCE) as Record<string, unknown>;
    delete missingDash.dash;
    expect(() => parseTuning(missingDash)).toThrowError(/dash/);

    const badActive = structuredClone(TUNING_SOURCE) as Record<string, unknown>;
    (badActive.activeSkill as Record<string, unknown>).cooldownMs = 0;
    expect(() => parseTuning(badActive)).toThrowError(/activeSkill\.cooldownMs/);

    const invertedFlank = structuredClone(TUNING_SOURCE) as Record<string, unknown>;
    const ai = (invertedFlank.enemies as { ai: Record<string, unknown> }).ai;
    ai.flankMinDistanceTiles = 12;
    ai.flankMaxDistanceTiles = 4;
    expect(() => parseTuning(invertedFlank)).toThrowError(/enemies\.ai\.flankMaxDistanceTiles/);

    const badEliteBomber = structuredClone(TUNING_SOURCE) as Record<string, unknown>;
    const elite = (badEliteBomber.enemies as { elite: { bomber: Record<string, unknown> } }).elite;
    elite.bomber.blastRadiusMultiplier = 0.5;
    expect(() => parseTuning(badEliteBomber)).toThrowError(/enemies\.elite\.bomber\.blastRadiusMultiplier/);
  });
});

describe('predictive lead aim & caster multi-shot bursts (M13 Tier 2)', () => {
  it('returns exact targetPos when target is stationary or leadFactor is 0', () => {
    const origin = { x: 4, y: 9 };
    const target = { x: 10, y: 9 };
    expect(computePredictiveAim(origin, target, { x: 0, y: 0 }, 4, 0.7)).toEqual(target);
    expect(computePredictiveAim(origin, target, { x: 0, y: 5 }, 4, 0)).toEqual(target);
    expect(computePredictiveAim(origin, target, { x: 0, y: 5 }, 0, 0.7)).toEqual(target);
  });

  it('leads ahead of a moving player along velocity and caps lead distance so dodging/dashing beats it', () => {
    const origin = { x: 4, y: 9 };
    const target = { x: 10, y: 9 };
    const movingDown = { x: 0, y: 5 };

    const aim = computePredictiveAim(origin, target, movingDown, 4, 0.65, 3.2);
    expect(aim.x).toBeCloseTo(target.x, 5);
    expect(aim.y).toBeGreaterThan(target.y);
    expect(distance(aim, target)).toBeLessThanOrEqual(3.2 + 1e-6);

    // Extreme velocity (e.g., player dashing at 14 tiles/s): lead stays strictly capped.
    const dashAim = computePredictiveAim(origin, target, { x: 0, y: 14 }, 4, 1, 2.5);
    expect(distance(dashAim, target)).toBeCloseTo(2.5, 5);
    expect(Number.isFinite(dashAim.x) && Number.isFinite(dashAim.y)).toBe(true);
  });

  it('activates predictive lead and 2-shot bursts for Ch3–Ch4 casters and 3–4 shot fans for elites', () => {
    expect(predictiveLeadFactorFor('caster', false, 1)).toBe(0);
    expect(predictiveLeadFactorFor('caster', false, 2)).toBe(0);
    expect(predictiveLeadFactorFor('caster', false, 3)).toBe(ENEMY_AI_TUNING.predictiveLeadFactor);
    expect(predictiveLeadFactorFor('caster', true, 1)).toBe(ENEMY_AI_TUNING.elitePredictiveLeadFactor);
    expect(predictiveLeadFactorFor('chaser', true, 4)).toBe(0);

    expect(casterVolleyAngles('caster', false, 1)).toEqual([0]);
    expect(casterVolleyAngles('caster', false, 3)).toHaveLength(ENEMY_AI_TUNING.casterBurstShots);
    expect(casterVolleyAngles('caster', true, 1)).toHaveLength(ENEMY_TUNING.elite.caster.volleyShots);
    expect(casterVolleyAngles('caster', true, 4)).toHaveLength(
      ENEMY_AI_TUNING.eliteCasterLateVolleyShots,
    );

    const ch3Plan = casterShotPlan({
      elite: false,
      chapter: 3,
      origin: { x: 4, y: 9 },
      targetPos: { x: 10, y: 9 },
      targetVel: { x: 0, y: 5 },
    });
    expect(ch3Plan.angles).toHaveLength(2);
    expect(ch3Plan.aimTarget.y).toBeGreaterThan(9);
  });
});

describe('flanking chasers (M13 Tier 2)', () => {
  const room = makeRoom();

  it('assigns deterministic per-enemy flank sides (-1 / +1) spanning both directions', () => {
    const sides = new Set<number>();
    for (let index = 0; index < 20; index += 1) {
      const id = `r2-s${index}`;
      const side = flankSideFor(id);
      expect(side === -1 || side === 1).toBe(true);
      expect(flankSideFor(id)).toBe(side);
      sides.add(side);
    }
    expect(sides.size).toBe(2);
  });

  it('offsets approaching chasers laterally at mid-range and collapses straight in at close range', () => {
    const player = { x: 16, y: 9 };
    const midPos = { x: 10, y: 9 }; // distance 6 — squarely inside [2.4, 9.5]

    let leftId = '';
    let rightId = '';
    for (let i = 0; i < 50 && (leftId === '' || rightId === ''); i += 1) {
      const candidate = `chaser-${i}`;
      if (flankSideFor(candidate) === -1 && leftId === '') leftId = candidate;
      if (flankSideFor(candidate) === 1 && rightId === '') rightId = candidate;
    }

    const leftTarget = computeFlankTarget(midPos, player, leftId, room);
    const rightTarget = computeFlankTarget(midPos, player, rightId, room);

    // Opposite lateral offsets around y = 9, both still closing distance to the player.
    expect(leftTarget.y).toBeLessThan(player.y);
    expect(rightTarget.y).toBeGreaterThan(player.y);
    expect(distance(leftTarget, player)).toBeLessThan(distance(midPos, player));
    expect(distance(rightTarget, player)).toBeLessThan(distance(midPos, player));

    // Close range collapses straight onto the player.
    const closeTarget = computeFlankTarget({ x: 14.5, y: 9 }, player, leftId, room);
    expect(closeTarget).toEqual(player);

    // Far range approaches straight.
    const farTarget = computeFlankTarget({ x: 2, y: 9 }, player, leftId, room);
    expect(farTarget).toEqual(player);

    // Wired into decideAction for chasers.
    const chaser = makeEnemy('chaser', midPos, { id: leftId });
    const action = decideAction({ state: chaser, player, nowMs: 1000, level: room });
    expect(action).toEqual({ kind: 'walk', target: leftTarget });
  });

  it('falls back to opposite flank or direct target when primary flank side is blocked', () => {
    const player = { x: 16, y: 9 };
    const midPos = { x: 10, y: 9 };
    let leftId = '';
    for (let i = 0; i < 50; i += 1) {
      if (flankSideFor(`blk-${i}`) === -1) {
        leftId = `blk-${i}`;
        break;
      }
    }

    // Wall covering the upper (negative-y) flank side forces fallback to the lower side.
    const blockedUpper = makeRoom([{ kind: 'wall', x: 11, y: 4, width: 5, height: 4.5 }]);
    const fallbackTarget = computeFlankTarget(midPos, player, leftId, blockedUpper);
    expect(fallbackTarget.y).toBeGreaterThanOrEqual(player.y);

    // Wide river (`pit` >= 4 tiles) between chaser and player bypasses flanking so flow-field bridge routing runs.
    const riverBetween = makeRoom([{ kind: 'pit', x: 12, y: 2, width: 2, height: 14 }]);
    expect(computeFlankTarget(midPos, player, leftId, riverBetween)).toEqual(player);
  });
});

describe('Bomber role — fuse telegraph, radial AoE blast, and elite double pulse', () => {
  const room = makeRoom();

  it('approaches, commits to a 900 ms fuse telegraph, releases blast, and respects cooldown', () => {
    const player = { x: 16, y: 9 };
    const far = makeEnemy('bomber', { x: 8, y: 9 }, { actionStartedMs: -10_000 });
    expect(decideAction({ state: far, player, nowMs: 1000, level: room }).kind).toBe('walk');

    const close = makeEnemy('bomber', { x: 14, y: 9 }, { actionStartedMs: -10_000 });
    const telegraph = decideAction({ state: close, player, nowMs: 1000, level: room });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: 1000 });

    const telegraphing = { ...close, action: telegraph, actionStartedMs: 1000 };
    expect(
      decideAction({
        state: telegraphing,
        player: { x: 24, y: 9 }, // player dashed away: fuse stays committed
        nowMs: 1000 + TELEGRAPH_MS.bomber - 1,
        level: room,
      }),
    ).toEqual(telegraph);

    const released = decideAction({
      state: telegraphing,
      player: { x: 24, y: 9 },
      nowMs: 1000 + TELEGRAPH_MS.bomber,
      level: room,
    });
    expect(released).toEqual({ kind: 'idle' });
    expect(attackReleasedForRole('bomber', telegraph, released)).toBe('blast');

    // Immediately after blast: cooling down.
    const cooling = { ...close, action: released, actionStartedMs: 1000 + TELEGRAPH_MS.bomber };
    expect(
      decideAction({
        state: cooling,
        player,
        nowMs: 1000 + TELEGRAPH_MS.bomber + 100,
        level: room,
      }),
    ).toEqual({ kind: 'idle' });
  });

  it('computes radial AoE blast hit/miss and elite double-pulse shockwave', () => {
    const normal = makeEnemy('bomber', { x: 14, y: 9 }, { elite: false });
    const normalSpec = bomberBlastSpec(normal, 1);
    expect(normalSpec.radiusTiles).toBe(ENEMY_TUNING.roles.bomber.blastRadiusTiles);
    expect(normalSpec.followUpDelayMs).toBeNull();
    expect(scheduleFollowUpBlast(normalSpec, 2000)).toBeNull();

    // Player standing inside radius gets hit; dashing outside clears it cleanly.
    expect(isInsideBomberBlast(normalSpec.center, normalSpec.radiusTiles, { x: 16, y: 9 }, 0.25)).toBe(
      true,
    );
    expect(isInsideBomberBlast(normalSpec.center, normalSpec.radiusTiles, { x: 18, y: 9 }, 0.25)).toBe(
      false,
    );

    const elite = makeEnemy('bomber', { x: 14, y: 9 }, { elite: true });
    const eliteSpec = bomberBlastSpec(elite, 1);
    expect(eliteSpec.radiusTiles).toBeGreaterThan(normalSpec.radiusTiles);
    expect(eliteSpec.damage).toBeGreaterThan(normalSpec.damage);
    expect(eliteSpec.followUpDelayMs).toBe(ENEMY_TUNING.elite.bomber.doublePulseDelayMs);

    const pending = scheduleFollowUpBlast(eliteSpec, 2000);
    expect(pending).not.toBeNull();
    if (pending === null) return;

    const early = stepPendingBlasts([pending], pending.triggerAtMs - 1);
    expect(early.triggered).toHaveLength(0);
    expect(early.remaining).toHaveLength(1);

    const due = stepPendingBlasts([pending], pending.triggerAtMs);
    expect(due.triggered).toHaveLength(1);
    expect(due.triggered[0]?.isFollowUp).toBe(true);
    expect(due.remaining).toHaveLength(0);
  });
});

describe('Buffer role — haste aura, solo defensive orb, and EnemyBuffTracker', () => {
  const room = makeRoom();

  it('maintains mid-range band, telegraphs, and releases buff', () => {
    const player = { x: 16, y: 9 };
    const tooClose = makeEnemy('buffer', { x: 14, y: 9 }, { actionStartedMs: -10_000 });
    expect(decideAction({ state: tooClose, player, nowMs: 1000, level: room }).kind).toBe('walk');

    const inBand = makeEnemy('buffer', { x: 10, y: 9 }, { actionStartedMs: -10_000 });
    const telegraph = decideAction({ state: inBand, player, nowMs: 1000, level: room });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: 1000 });

    const finished = decideAction({
      state: { ...inBand, action: telegraph, actionStartedMs: 1000 },
      player,
      nowMs: 1000 + TELEGRAPH_MS.buffer,
      level: room,
    });
    expect(finished).toEqual({ kind: 'idle' });
    expect(attackReleasedForRole('buffer', telegraph, finished)).toBe('buff');
  });

  it('casts haste aura onto living allies in radius, or falls back to defensive orb(s) when solo', () => {
    const buffer = makeEnemy('buffer', { x: 10, y: 9 }, { id: 'buf-1', elite: false });
    const nearAlly = makeEnemy('chaser', { x: 14, y: 9 }, { id: 'ally-near' });
    const farAlly = makeEnemy('chaser', { x: 25, y: 9 }, { id: 'ally-far' });
    const deadAlly = makeEnemy('chaser', { x: 11, y: 9 }, { id: 'ally-dead', health: 0 });

    const aura = resolveBufferPulse(buffer, [buffer, nearAlly, farAlly, deadAlly], 5000);
    expect(aura.kind).toBe('aura');
    if (aura.kind !== 'aura') return;
    expect(aura.affectedIds).toEqual(['ally-near']);
    expect(aura.speedMultiplier).toBe(ENEMY_TUNING.roles.buffer.buffSpeedMultiplier);
    expect(aura.untilMs).toBe(5000 + (ENEMY_TUNING.roles.buffer.buffDurationMs ?? 0));

    // Solo normal buffer fires 1 slow defensive orb.
    const soloNormal = resolveBufferPulse(buffer, [buffer, farAlly], 5000);
    expect(soloNormal.kind).toBe('defensive-shot');
    if (soloNormal.kind !== 'defensive-shot') return;
    expect(soloNormal.angles).toEqual([0]);
    expect(soloNormal.speedTilesPerSecond).toBe(bufferShotPlan(false).speedTilesPerSecond);

    // Elite buffer buffs wider radius and fires a 3-orb spread when solo.
    const eliteBuffer = makeEnemy('buffer', { x: 10, y: 9 }, { id: 'buf-e', elite: true });
    const midAlly = makeEnemy('chaser', { x: 17.5, y: 9 }, { id: 'ally-mid' }); // 7.5 tiles (>6, <=8.1)
    const eliteAura = resolveBufferPulse(eliteBuffer, [eliteBuffer, midAlly], 5000);
    expect(eliteAura.kind).toBe('aura');
    if (eliteAura.kind === 'aura') {
      expect(eliteAura.affectedIds).toEqual(['ally-mid']);
      expect(eliteAura.speedMultiplier).toBeGreaterThan(aura.speedMultiplier);
    }

    const soloElite = resolveBufferPulse(eliteBuffer, [eliteBuffer], 5000);
    expect(soloElite.kind).toBe('defensive-shot');
    if (soloElite.kind === 'defensive-shot') {
      expect(soloElite.angles).toHaveLength(3);
    }
    expect(eliteVolleyAngles('buffer', true)).toHaveLength(3);
  });

  it('EnemyBuffTracker refreshes without unbounded stacking and expires cleanly', () => {
    const tracker = new EnemyBuffTracker();
    tracker.applyHaste(['a'], 1.3, 4000);
    expect(tracker.speedMultiplierFor('a', 1000)).toBe(1.3);
    expect(tracker.isBuffed('a', 3999)).toBe(true);

    // Stronger overlapping elite buff upgrades multiplier and extends expiry.
    tracker.applyHaste(['a'], 1.45, 5500);
    expect(tracker.speedMultiplierFor('a', 4500)).toBe(1.45);

    // Expired at untilMs.
    expect(tracker.speedMultiplierFor('a', 5500)).toBe(1);
    expect(tracker.isBuffed('a', 5500)).toBe(false);
  });
});

describe('WaveScheduler M13 role mixing', () => {
  it('mixes bomber in late Ch1 and bomber + buffer in Ch2–Ch4 without changing chapter totals', () => {
    expect(specialRoleMixForRoom(1, 1)).toEqual({ bomberShare: 0, bufferShare: 0 });
    expect(specialRoleMixForRoom(1, 4).bomberShare).toBeGreaterThan(0);
    expect(specialRoleMixForRoom(2, 1)).toEqual({ bomberShare: 0, bufferShare: 0 });
    expect(specialRoleMixForRoom(2, 2).bomberShare).toBeGreaterThan(0);
    expect(specialRoleMixForRoom(2, 2).bufferShare).toBeGreaterThan(0);
    expect(specialRoleMixForRoom(4, 1)).toEqual({ bomberShare: 0, bufferShare: 0 });
    expect(specialRoleMixForRoom(4, 2).bomberShare).toBeGreaterThan(0);
    expect(specialRoleMixForRoom(4, 2).bufferShare).toBeGreaterThan(0);

    const ch2Room = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, 'chapter-2'))).rooms.find(
      (room) => !room.isBossRoom,
    );
    if (ch2Room === undefined) throw new Error('missing ch2 normal room');

    const scheduler = new WaveScheduler(ch2Room, 13, 3);
    expect(scheduler.total).toBe(roomEnemyTotal(ch2Room, 13));

    const view = { x: 0, y: 0, width: 32, height: 18 };
    const seen = new Set<EnemyRole>();
    let alive = 0;
    for (let nowMs = 0; nowMs < 300_000 && scheduler.spawned < scheduler.total; nowMs += 100) {
      for (const spawn of scheduler.step({ nowMs, player: ch2Room.playerStart, view, alive })) {
        seen.add(spawn.role);
        alive += 1;
      }
      if (nowMs % 400 === 0 && alive > 0) alive -= 1;
    }

    expect(seen.has('bomber')).toBe(true);
    expect(seen.has('buffer')).toBe(true);
  });
});

describe('Boss Dash-pressuring wide sweep & zone patterns (M13)', () => {
  it('every boss has a wide sweep or shockwave zone in both Phase 2 and Phase 3', () => {
    for (const id of BOSS_IDS) {
      for (const phase of [2, 3] as const) {
        const volleys = BOSS_SCRIPTS[id][phase].steps.flatMap((step) =>
          step.actions.flatMap((action) => (action.kind === 'volley' ? [action.volley] : [])),
        );
        const dashPressuring = volleys.filter(
          (volley) => volley.shape === 'sweep' || volley.shape === 'zone',
        );
        expect(dashPressuring.length, `${id} phase ${phase} missing sweep/zone`).toBeGreaterThan(0);

        for (const volley of dashPressuring) {
          if (volley.shape === 'sweep') {
            expect(volley.count, `${id} p${phase} sweep count`).toBeGreaterThanOrEqual(9);
            expect(volley.spreadRadians, `${id} p${phase} sweep spread`).toBeGreaterThanOrEqual(
              (120 * Math.PI) / 180,
            );
          } else {
            expect(volley.count, `${id} p${phase} zone count`).toBeGreaterThanOrEqual(12);
            expect(volley.ringAimsAtPlayer, `${id} p${phase} zone aims at player`).toBe(true);
          }
        }
      }
    }
  });
});

describe('M13 staged art — player.dash and Bomber/Buffer monster sheets + metas', () => {
  const manifest: AnimationManifest = validateManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown,
  );
  const M13_MONSTERS = [
    'flam',
    'mushroom',
    'flam2',
    'mushroom2',
    'spirit',
    'lanterngreen',
    'spirit2',
    'owl2',
  ] as const;

  it('player.dash resolves in all 4 directions with valid 32×32 Dash.png and nearest .meta', () => {
    for (const dir of ['down', 'up', 'left', 'right'] as const) {
      const entry = manifest.sprites[`player.dash.${dir}`];
      expect(entry, `player.dash.${dir}`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.sheet).toBe('resources/art/characters/ninja-green/Dash.png');
      expect([entry.frameWidth, entry.frameHeight]).toEqual([32, 32]);
      expect(entry.frames).toBe(3);
      expect(entry.loop).toBe(false);
      const sheetFile = join(ASSETS, entry.sheet);
      expect(existsSync(sheetFile)).toBe(true);
      expect(existsSync(`${sheetFile}.meta`)).toBe(true);
      const meta = JSON.parse(readFileSync(`${sheetFile}.meta`, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      expect(meta.importer).toBe('image');
      expect(meta.subMetas?.['6c48a']?.userData?.['minfilter']).toBe('nearest');
      expect(meta.subMetas?.['6c48a']?.userData?.['magfilter']).toBe('nearest');
    }
  });

  it('all 8 Bomber/Buffer monsters and their elites exist with nearest-filter .meta and unique UUIDs', () => {
    for (const actor of M13_MONSTERS) {
      for (const prefix of [actor, `${actor}.elite`]) {
        const entry = manifest.sprites[`${prefix}.walk.down`];
        expect(entry, `${prefix}.walk.down`).toBeDefined();
        if (entry === undefined) continue;
        const file = join(ASSETS, entry.sheet);
        expect(existsSync(file), entry.sheet).toBe(true);
        const png = readPng(file);
        expect([png.width, png.height], entry.sheet).toEqual([64, 64]);

        const metaPath = `${file}.meta`;
        expect(existsSync(metaPath), `${entry.sheet}.meta`).toBe(true);
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          importer?: string;
          subMetas?: Record<string, { userData?: Record<string, unknown> }>;
        };
        expect(meta.importer).toBe('image');
        expect(meta.subMetas?.['6c48a']?.userData?.['minfilter']).toBe('nearest');
        expect(meta.subMetas?.['6c48a']?.userData?.['magfilter']).toBe('nearest');
      }
    }

    // Global uniqueness check across every .meta under game/assets/.
    const seen = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.meta')) {
          const parsed = JSON.parse(readFileSync(full, 'utf8')) as { uuid?: string };
          expect(typeof parsed.uuid, relative(ASSETS, full)).toBe('string');
          const uuid = parsed.uuid ?? '';
          const prev = seen.get(uuid);
          expect(prev, `duplicate uuid ${uuid} in ${relative(ASSETS, full)} and ${prev}`).toBeUndefined();
          seen.set(uuid, relative(ASSETS, full));
        }
      }
    };
    walk(ASSETS);
  });
});

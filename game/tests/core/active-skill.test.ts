import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import {
  DEFAULT_ACTIVE_SKILL_CONFIG,
  SHADOW_BARRAGE,
  activeCooldownSeconds,
  activeReadyRatio,
  computeShadowBarrageVolley,
  createActiveSkillState,
  isActiveSkillReady,
  onActiveHit,
  onActiveKill,
  stepActiveSkill,
  tryActivateSkill,
  type ActiveSkillConfig,
} from '../../assets/scripts/core/input/active-skill';

describe('ActiveSkill recharge — base time + hit CDR + kill CDR', () => {
  it('starts ready by default, enters scaled cooldown on cast, and blocks re-trigger while recharging', () => {
    const ready = createActiveSkillState();
    expect(isActiveSkillReady(ready)).toBe(true);
    expect(activeReadyRatio(ready)).toBe(1);
    expect(activeCooldownSeconds(ready)).toBe(0);

    const cast = tryActivateSkill(ready, DEFAULT_ACTIVE_SKILL_CONFIG, 1);
    expect(cast.triggered).toBe(true);
    expect(cast.state.activations).toBe(1);
    expect(cast.state.cooldownTotalMs).toBe(10_000);
    expect(cast.state.cooldownRemainingMs).toBe(10_000);
    expect(isActiveSkillReady(cast.state)).toBe(false);
    expect(activeReadyRatio(cast.state)).toBe(0);
    expect(activeCooldownSeconds(cast.state)).toBe(10);

    // Spamming E while cooling down does not reset progress or increment activations.
    const mid = stepActiveSkill(cast.state, 4000);
    const blocked = tryActivateSkill(mid, DEFAULT_ACTIVE_SKILL_CONFIG, 1);
    expect(blocked.triggered).toBe(false);
    expect(blocked.state).toBe(mid);
    expect(activeReadyRatio(mid)).toBeCloseTo(0.4, 6);
    expect(activeCooldownSeconds(mid)).toBeCloseTo(6, 6);
  });

  it('recharges cleanly in single-boss arenas via time + onActiveHit with zero kills', () => {
    const config: ActiveSkillConfig = {
      cooldownMs: 10_000,
      hitCooldownReductionMs: 200,
      killCooldownReductionMs: 650,
    };
    let state = tryActivateSkill(createActiveSkillState(), config, 1).state;

    // 5 seconds of dodging + 25 shuriken/twin-shot hits on the boss (25 × 200 ms = 5000 ms shaved).
    for (let sec = 0; sec < 5; sec += 1) {
      state = stepActiveSkill(state, 1000);
      state = onActiveHit(state, config, 5);
    }

    expect(isActiveSkillReady(state)).toBe(true);
    expect(state.cooldownRemainingMs).toBe(0);
    expect(activeReadyRatio(state)).toBe(1);
    expect(activeCooldownSeconds(state)).toBe(0);
  });

  it('recharges briskly in wave rooms via time + onActiveHit + onActiveKill and clamps at 0', () => {
    let state = tryActivateSkill(createActiveSkillState(), DEFAULT_ACTIVE_SKILL_CONFIG, 0.8).state;
    // 0.8x cooldownMult (`shadow-conduit`) -> 8000 ms effective cooldown.
    expect(state.cooldownTotalMs).toBe(8000);

    state = stepActiveSkill(state, 2000); // 6000 ms left
    state = onActiveHit(state, DEFAULT_ACTIVE_SKILL_CONFIG, 6); // -1200 ms -> 4800 ms left
    state = onActiveKill(state, DEFAULT_ACTIVE_SKILL_CONFIG, 5); // -3250 ms -> 1550 ms left
    expect(state.cooldownRemainingMs).toBe(1550);
    expect(activeReadyRatio(state)).toBeCloseTo((8000 - 1550) / 8000, 6);

    // Overkill multi-kill never pushes cooldown below 0.
    state = onActiveKill(state, DEFAULT_ACTIVE_SKILL_CONFIG, 10);
    expect(state.cooldownRemainingMs).toBe(0);
    expect(isActiveSkillReady(state)).toBe(true);

    // Extra hits/kills when already ready return the exact state object untouched.
    expect(onActiveHit(state, DEFAULT_ACTIVE_SKILL_CONFIG, 3)).toBe(state);
    expect(onActiveKill(state, DEFAULT_ACTIVE_SKILL_CONFIG, 2)).toBe(state);
  });

  it('freezes on dtMs === 0 and rejects negative or non-finite dtMs', () => {
    const cooling = tryActivateSkill(createActiveSkillState()).state;
    expect(stepActiveSkill(cooling, 0)).toBe(cooling);
    expect(() => stepActiveSkill(cooling, -16)).toThrow();
    expect(() => stepActiveSkill(cooling, Number.NaN)).toThrow();
  });
});

describe('Ninja Signature Active — SHADOW_BARRAGE & computeShadowBarrageVolley', () => {
  it('plans a symmetric 10-blade piercing + homing shadow shuriken fan around aimDir', () => {
    expect(SHADOW_BARRAGE.id).toBe('shadow-barrage');
    expect(SHADOW_BARRAGE.projectileCount).toBe(10);
    expect(SHADOW_BARRAGE.pierceCount).toBeGreaterThanOrEqual(2);
    expect(SHADOW_BARRAGE.homing).toBe(true);

    const origin = { x: 16, y: 9 };
    const aimDir = { x: 0, y: -5 }; // aiming straight up in tile space (-Math.PI / 2)
    const volley = computeShadowBarrageVolley(origin, aimDir, 1, { baseDamage: 2 });

    expect(volley).toHaveLength(10);

    // Symmetric offsets around 0: first + last = 0, second + secondLast = 0, etc.
    for (let i = 0; i < volley.length / 2; i += 1) {
      const left = volley[i]!;
      const right = volley[volley.length - 1 - i]!;
      expect(left.angleOffsetRadians + right.angleOffsetRadians).toBeCloseTo(0, 9);
    }
    expect(volley[volley.length - 1]!.angleOffsetRadians - volley[0]!.angleOffsetRadians).toBeCloseTo(
      SHADOW_BARRAGE.fanArcRadians,
      9,
    );

    // Every blade is pointed player-owned, high-speed, piercing, homing, and scaled by 1.5x damage.
    const pool = new BulletPool();
    for (const blade of volley) {
      expect(blade.owner).toBe('player');
      expect(blade.homing).toBe(true);
      expect(blade.pierceRemaining).toBe(SHADOW_BARRAGE.pierceCount);
      expect(blade.damage).toBeCloseTo(2 * SHADOW_BARRAGE.damageMultiplier, 6);
      expect(Math.hypot(blade.direction.x, blade.direction.y)).toBeCloseTo(1, 6);
      expect(Math.hypot(blade.velocity.x, blade.velocity.y)).toBeCloseTo(
        SHADOW_BARRAGE.speedTilesPerSecond,
        6,
      );

      // Spawns cleanly into BulletPool with zero adapter translation needed.
      const spawned = pool.spawn(blade);
      expect(spawned.homing).toBe(true);
      expect(spawned.pierceRemaining).toBe(SHADOW_BARRAGE.pierceCount);
    }
    expect(pool.size).toBe(10);
  });

  it('scales damage and blade count cleanly with powerMult and falls back safely on zero aimDir', () => {
    const baseVolley = computeShadowBarrageVolley({ x: 4, y: 4 }, { x: 1, y: 0 }, 1, {
      baseDamage: 3,
    });
    const empoweredVolley = computeShadowBarrageVolley({ x: 4, y: 4 }, { x: 1, y: 0 }, 1.5, {
      baseDamage: 3,
    });

    expect(baseVolley).toHaveLength(10);
    expect(empoweredVolley).toHaveLength(12);
    expect(empoweredVolley[0]!.damage).toBeCloseTo(baseVolley[0]!.damage * 1.5, 6);

    // Zero aimDir never produces NaN positions or velocities.
    const fallbackVolley = computeShadowBarrageVolley({ x: 10, y: 10 }, { x: 0, y: 0 }, 1);
    expect(fallbackVolley).toHaveLength(10);
    for (const blade of fallbackVolley) {
      expect(Number.isFinite(blade.position.x)).toBe(true);
      expect(Number.isFinite(blade.position.y)).toBe(true);
      expect(Number.isFinite(blade.velocity.x)).toBe(true);
      expect(Number.isFinite(blade.velocity.y)).toBe(true);
    }
  });
});

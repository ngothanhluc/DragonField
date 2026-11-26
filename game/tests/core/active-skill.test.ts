import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import {
  ARCANE_NOVA,
  DEFAULT_ACTIVE_SKILL_CONFIG,
  PIERCING_VOLLEY,
  SHADOW_BARRAGE,
  SIGNATURE_SKILL_IDS,
  SIGNATURE_SPECS,
  TEN_THOUSAND_SWORDS,
  activeCooldownSeconds,
  activeReadyRatio,
  activeSkillConfigFor,
  computeArcaneNovaSpec,
  computePiercingVolley,
  computeShadowBarrageVolley,
  computeTenThousandSwordsVolley,
  createActiveSkillState,
  getSignatureSpec,
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

  it('exposes all 4 Signature Active specs and per-signature recharge configs', () => {
    expect(SIGNATURE_SKILL_IDS).toEqual([
      'shadow-barrage',
      'piercing-volley',
      'arcane-nova',
      'ten-thousand-swords',
    ]);
    for (const id of SIGNATURE_SKILL_IDS) {
      const spec = getSignatureSpec(id);
      expect(spec).toBe(SIGNATURE_SPECS[id]);
      const cfg = activeSkillConfigFor(id);
      expect(cfg.cooldownMs).toBe(spec.cooldownMs);
      expect(cfg.hitCooldownReductionMs).toBe(spec.hitCooldownReductionMs);
      expect(cfg.killCooldownReductionMs).toBe(spec.killCooldownReductionMs);
    }
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

describe('Archer Signature Active — PIERCING_VOLLEY & computePiercingVolley', () => {
  it('plans a focused 7-arrow high-speed high-pierce fan compatible with BulletPool', () => {
    expect(PIERCING_VOLLEY.id).toBe('piercing-volley');
    expect(PIERCING_VOLLEY.projectileCount).toBe(7);
    expect(PIERCING_VOLLEY.pierceCount).toBeGreaterThanOrEqual(5);
    expect(PIERCING_VOLLEY.speedTilesPerSecond).toBeGreaterThan(SHADOW_BARRAGE.speedTilesPerSecond);
    expect(PIERCING_VOLLEY.fanArcRadians).toBeLessThan(SHADOW_BARRAGE.fanArcRadians);
    expect(PIERCING_VOLLEY.homing).toBe(false);

    const volley = computePiercingVolley({ x: 12, y: 8 }, { x: 1, y: 0 }, 1, { baseDamage: 1.5 });
    expect(volley).toHaveLength(7);

    // Centre arrow aligns exactly with aimDir (index 3 of 7).
    expect(volley[3]!.angleOffsetRadians).toBeCloseTo(0, 9);
    expect(volley[0]!.angleOffsetRadians + volley[6]!.angleOffsetRadians).toBeCloseTo(0, 9);

    const pool = new BulletPool();
    for (const arrow of volley) {
      expect(arrow.owner).toBe('player');
      expect(arrow.homing).toBe(false);
      expect(arrow.pierceRemaining).toBe(PIERCING_VOLLEY.pierceCount);
      expect(arrow.damage).toBeCloseTo(1.5 * PIERCING_VOLLEY.damageMultiplier, 6);
      expect(Math.hypot(arrow.velocity.x, arrow.velocity.y)).toBeCloseTo(
        PIERCING_VOLLEY.speedTilesPerSecond,
        6,
      );
      pool.spawn(arrow);
    }
    expect(pool.size).toBe(7);

    // Empowered cast scales arrow count up to maxProjectileCount (9) and increases damage.
    const empowered = computePiercingVolley({ x: 12, y: 8 }, { x: 1, y: 0 }, 1.5, {
      baseDamage: 1.5,
    });
    expect(empowered).toHaveLength(9);
    expect(empowered[0]!.damage).toBeCloseTo(volley[0]!.damage * 1.5, 6);
  });
});

describe('Mage Signature Active — ARCANE_NOVA & computeArcaneNovaSpec', () => {
  it('plans a radial freezing AoE ring plus evenly spaced 360° outward arcane bolts', () => {
    expect(ARCANE_NOVA.id).toBe('arcane-nova');
    expect(ARCANE_NOVA.radiusTilesNova).toBeGreaterThanOrEqual(4);
    expect(ARCANE_NOVA.slowFactor).toBeGreaterThan(0);
    expect(ARCANE_NOVA.slowFactor).toBeLessThan(1);
    expect(ARCANE_NOVA.slowDurationMs).toBeGreaterThanOrEqual(2000);

    const nova = computeArcaneNovaSpec({ x: 15, y: 10 }, 1, { baseDamage: 2 });
    expect(nova.id).toBe('arcane-nova');
    expect(nova.origin).toEqual({ x: 15, y: 10 });
    expect(nova.radiusTiles).toBeCloseTo(ARCANE_NOVA.radiusTilesNova, 6);
    expect(nova.damage).toBeCloseTo(2 * ARCANE_NOVA.novaDamageMultiplier, 6);
    expect(nova.slowFactor).toBe(ARCANE_NOVA.slowFactor);
    expect(nova.slowDurationMs).toBe(ARCANE_NOVA.slowDurationMs);
    expect(nova.bolts).toHaveLength(ARCANE_NOVA.projectileCount);

    // Outward bolts cover full 360° symmetrically (sum of direction vectors ~= 0).
    let sumX = 0;
    let sumY = 0;
    const pool = new BulletPool();
    for (const bolt of nova.bolts) {
      sumX += bolt.direction.x;
      sumY += bolt.direction.y;
      expect(bolt.owner).toBe('player');
      expect(bolt.damage).toBeCloseTo(2 * ARCANE_NOVA.damageMultiplier, 6);
      pool.spawn(bolt);
    }
    expect(sumX).toBeCloseTo(0, 6);
    expect(sumY).toBeCloseTo(0, 6);
    expect(pool.size).toBe(ARCANE_NOVA.projectileCount);

    // Mage's Arcane Attunement (powerMult 1.25 + aoePowerMult 1.25) scales radius, damage, and bolt count.
    const attuned = computeArcaneNovaSpec({ x: 15, y: 10 }, 1.25, {
      baseDamage: 2,
      aoePowerMult: 1.25,
    });
    expect(attuned.radiusTiles).toBeGreaterThan(nova.radiusTiles);
    expect(attuned.damage).toBeCloseTo(nova.damage * 1.25, 6);
    expect(attuned.bolts.length).toBeGreaterThan(nova.bolts.length);
  });
});

describe('Cultivator Signature Active — TEN_THOUSAND_SWORDS & computeTenThousandSwordsVolley', () => {
  it('plans 14-16 sweeping homing spirit blades and returns hideAttachmentMs: 1200 for sword-back', () => {
    expect(TEN_THOUSAND_SWORDS.id).toBe('ten-thousand-swords');
    expect(TEN_THOUSAND_SWORDS.projectileCount).toBe(14);
    expect(TEN_THOUSAND_SWORDS.maxProjectileCount).toBe(16);
    expect(TEN_THOUSAND_SWORDS.homing).toBe(true);
    expect(TEN_THOUSAND_SWORDS.hideAttachmentMs).toBe(1200);
    expect(TEN_THOUSAND_SWORDS.attachmentSkillId).toBe('ten-thousand-swords');

    const cast = computeTenThousandSwordsVolley({ x: 20, y: 12 }, { x: 0, y: 1 }, 1, {
      baseDamage: 1.25,
    });
    expect(cast.id).toBe('ten-thousand-swords');
    expect(cast.hideAttachmentMs).toBe(1200);
    expect(cast.attachmentSkillId).toBe('ten-thousand-swords');
    expect(cast.projectiles).toHaveLength(14);

    // Wide sweeping symmetric fan around aimDir.
    const first = cast.projectiles[0]!;
    const last = cast.projectiles[cast.projectiles.length - 1]!;
    expect(first.angleOffsetRadians + last.angleOffsetRadians).toBeCloseTo(0, 9);
    expect(last.angleOffsetRadians - first.angleOffsetRadians).toBeCloseTo(
      TEN_THOUSAND_SWORDS.fanArcRadians,
      9,
    );

    const pool = new BulletPool();
    for (const blade of cast.projectiles) {
      expect(blade.owner).toBe('player');
      expect(blade.homing).toBe(true);
      expect(blade.pierceRemaining).toBe(TEN_THOUSAND_SWORDS.pierceCount);
      expect(blade.damage).toBeCloseTo(1.25 * TEN_THOUSAND_SWORDS.damageMultiplier, 6);
      pool.spawn(blade);
    }
    expect(pool.size).toBe(14);

    // Empowered cast scales up to 16 homing blades while preserving hideAttachmentMs.
    const empowered = computeTenThousandSwordsVolley({ x: 20, y: 12 }, { x: 0, y: 1 }, 1.5, {
      baseDamage: 1.25,
    });
    expect(empowered.projectiles).toHaveLength(16);
    expect(empowered.hideAttachmentMs).toBe(1200);
  });
});

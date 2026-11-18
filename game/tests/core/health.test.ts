import { describe, expect, it } from 'vitest';
import { HealthState } from '../../assets/scripts/core/combat/health';

const config = { playerMaxHearts: 6, invulnerabilityMs: 800 };

describe('HealthState', () => {
  it('starts at max health', () => {
    const health = new HealthState(config);

    expect(health.current).toBe(6);
    expect(health.isDead).toBe(false);
  });

  it('subtracts health and turns on the i-frame after a hit', () => {
    const health = new HealthState(config);

    const result = health.tryDamage(1, 0);

    expect(result).toEqual({ applied: true, hearts: 5, dead: false });
    expect(health.isInvulnerable(500)).toBe(true);
  });

  it('blocks the second hit inside the i-frame window', () => {
    const health = new HealthState(config);
    health.tryDamage(1, 0);

    const blocked = health.tryDamage(1, 799);

    expect(blocked.applied).toBe(false);
    expect(health.current).toBe(5);
  });

  it('allows a hit exactly when the i-frame ends', () => {
    const health = new HealthState(config);
    health.tryDamage(1, 0);

    const result = health.tryDamage(1, 800);

    expect(result.applied).toBe(true);
    expect(health.current).toBe(4);
  });

  it('dies at 0 health and takes no further damage', () => {
    const health = new HealthState(config);
    const first = health.tryDamage(4, 0);
    expect(first.dead).toBe(false);

    const second = health.tryDamage(4, 1000);

    expect(second).toEqual({ applied: true, hearts: 0, dead: true });
    expect(health.tryDamage(1, 2000).applied).toBe(false);
  });

  it('heals without exceeding max, and does not heal when dead', () => {
    const health = new HealthState(config);
    health.tryDamage(3, 0);

    expect(health.heal(10)).toBe(6);

    const dead = new HealthState(config);
    dead.tryDamage(6, 0);
    expect(dead.heal(2)).toBe(0);
  });
});

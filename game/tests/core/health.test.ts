import { describe, expect, it } from 'vitest';
import { HealthState } from '../../assets/scripts/core/combat/health';

const config = { playerMaxHearts: 6, invulnerabilityMs: 800 };

describe('HealthState', () => {
  it('bắt đầu với máu tối đa', () => {
    const health = new HealthState(config);

    expect(health.current).toBe(6);
    expect(health.isDead).toBe(false);
  });

  it('trừ máu và bật i-frame sau khi trúng', () => {
    const health = new HealthState(config);

    const result = health.tryDamage(1, 0);

    expect(result).toEqual({ applied: true, hearts: 5, dead: false });
    expect(health.isInvulnerable(500)).toBe(true);
  });

  it('chặn đòn thứ hai trong cửa sổ i-frame', () => {
    const health = new HealthState(config);
    health.tryDamage(1, 0);

    const blocked = health.tryDamage(1, 799);

    expect(blocked.applied).toBe(false);
    expect(health.current).toBe(5);
  });

  it('cho phép trúng đòn đúng lúc i-frame kết thúc', () => {
    const health = new HealthState(config);
    health.tryDamage(1, 0);

    const result = health.tryDamage(1, 800);

    expect(result.applied).toBe(true);
    expect(health.current).toBe(4);
  });

  it('chết khi máu về 0 và không nhận thêm sát thương', () => {
    const health = new HealthState(config);
    const first = health.tryDamage(4, 0);
    expect(first.dead).toBe(false);

    const second = health.tryDamage(4, 1000);

    expect(second).toEqual({ applied: true, hearts: 0, dead: true });
    expect(health.tryDamage(1, 2000).applied).toBe(false);
  });

  it('hồi máu nhưng không vượt quá max, và không hồi khi đã chết', () => {
    const health = new HealthState(config);
    health.tryDamage(3, 0);

    expect(health.heal(10)).toBe(6);

    const dead = new HealthState(config);
    dead.tryDamage(6, 0);
    expect(dead.heal(2)).toBe(0);
  });
});

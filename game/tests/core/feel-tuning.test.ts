import { describe, expect, it } from 'vitest';
import { FEEL_TUNING, TUNING, TUNING_SOURCE, parseTuning } from '../../assets/scripts/core/enemies/tuning';

/**
 * Số liệu juice (ticket #2) cũng phải đi qua `config/tuning.json` như mọi số
 * balance khác (AGENTS rule 3): JSON là nguồn, code không giữ bản chép.
 */
function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

function feelOf(raw: Record<string, unknown>): Record<string, unknown> {
  return raw.feel as Record<string, unknown>;
}

function groupOf(raw: Record<string, unknown>, group: string): Record<string, unknown> {
  return feelOf(raw)[group] as Record<string, unknown>;
}

describe('feel tuning — config/tuning.json là nguồn duy nhất', () => {
  it('FEEL_TUNING khớp đúng block "feel" của JSON', () => {
    expect(FEEL_TUNING).toEqual(feelOf(cloneSource()));
    expect(TUNING.feel).toBe(FEEL_TUNING);
  });

  it('giá trị mặc định nằm trong khoảng dùng được', () => {
    // Rung không bao giờ nhảy quá nửa tile mỗi frame và phải tàn trong vài giây.
    expect(FEEL_TUNING.shake.maxOffsetTiles).toBeGreaterThan(0);
    expect(FEEL_TUNING.shake.maxOffsetTiles).toBeLessThanOrEqual(1);
    expect(FEEL_TUNING.shake.decayPerSecond).toBeGreaterThan(0);
    for (const trauma of [
      FEEL_TUNING.shake.playerHurt,
      FEEL_TUNING.shake.explosion,
      FEEL_TUNING.shake.bossCharge,
    ]) {
      expect(trauma).toBeGreaterThan(0);
      expect(trauma).toBeLessThanOrEqual(1);
    }

    // Squash ≤150 ms theo tiêu chí nghiệm thu.
    expect(FEEL_TUNING.squash.playerHurtMs).toBeLessThanOrEqual(150);
    expect(FEEL_TUNING.squash.enemyHitMs).toBeLessThanOrEqual(150);
    expect(FEEL_TUNING.squash.bossHitMs).toBeLessThanOrEqual(150);

    expect(FEEL_TUNING.coin.coinsPerPickup).toBeGreaterThan(0);
    expect(FEEL_TUNING.coin.poolSize).toBeGreaterThanOrEqual(FEEL_TUNING.coin.coinsPerPickup);
    expect(FEEL_TUNING.damageNumbers.poolSize).toBeGreaterThan(0);
    expect(FEEL_TUNING.damageNumbers.lifetimeMs).toBeGreaterThan(0);
  });

  it('thiếu block feel bị bắt kèm đường dẫn', () => {
    const raw = cloneSource();
    delete raw.feel;
    expect(() => parseTuning(raw)).toThrowError(/feel.*thiếu field/);
  });

  it('trauma ngoài 0..1 và pool size 0 bị từ chối', () => {
    const tooMuch = cloneSource();
    groupOf(tooMuch, 'shake').playerHurt = 2;
    expect(() => parseTuning(tooMuch)).toThrowError(/feel\.shake\.playerHurt/);

    const emptyPool = cloneSource();
    groupOf(emptyPool, 'damageNumbers').poolSize = 0;
    expect(() => parseTuning(emptyPool)).toThrowError(/feel\.damageNumbers\.poolSize.*phải > 0/);

    const noDecay = cloneSource();
    groupOf(noDecay, 'shake').decayPerSecond = 0;
    expect(() => parseTuning(noDecay)).toThrowError(/feel\.shake\.decayPerSecond.*phải > 0/);
  });
});

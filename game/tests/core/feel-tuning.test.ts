import { describe, expect, it } from 'vitest';
import { FEEL_TUNING, TUNING, TUNING_SOURCE, parseTuning } from '../../assets/scripts/core/enemies/tuning';

/**
 * Juice numbers (ticket #2) must also go through `config/tuning.json` like every other
 * balance number (AGENTS rule 3): the JSON is the source, code keeps no copy.
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

describe('feel tuning — config/tuning.json is the single source', () => {
  it('FEEL_TUNING matches the JSON "feel" block exactly', () => {
    expect(FEEL_TUNING).toEqual(feelOf(cloneSource()));
    expect(TUNING.feel).toBe(FEEL_TUNING);
  });

  it('default values stay inside a usable range', () => {
    // Shake never jumps more than half a tile per frame and must die out within a few seconds.
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

    // Squash ≤150 ms per the acceptance criteria.
    expect(FEEL_TUNING.squash.playerHurtMs).toBeLessThanOrEqual(150);
    expect(FEEL_TUNING.squash.enemyHitMs).toBeLessThanOrEqual(150);
    expect(FEEL_TUNING.squash.bossHitMs).toBeLessThanOrEqual(150);

    expect(FEEL_TUNING.coin.coinsPerPickup).toBeGreaterThan(0);
    expect(FEEL_TUNING.coin.poolSize).toBeGreaterThanOrEqual(FEEL_TUNING.coin.coinsPerPickup);
    expect(FEEL_TUNING.damageNumbers.poolSize).toBeGreaterThan(0);
    expect(FEEL_TUNING.damageNumbers.lifetimeMs).toBeGreaterThan(0);
  });

  it('a missing feel block is caught with the path', () => {
    const raw = cloneSource();
    delete raw.feel;
    expect(() => parseTuning(raw)).toThrowError(/feel.*missing field/);
  });

  it('trauma outside 0..1 and a pool size of 0 are rejected', () => {
    const tooMuch = cloneSource();
    groupOf(tooMuch, 'shake').playerHurt = 2;
    expect(() => parseTuning(tooMuch)).toThrowError(/feel\.shake\.playerHurt/);

    const emptyPool = cloneSource();
    groupOf(emptyPool, 'damageNumbers').poolSize = 0;
    expect(() => parseTuning(emptyPool)).toThrowError(/feel\.damageNumbers\.poolSize.*must be > 0/);

    const noDecay = cloneSource();
    groupOf(noDecay, 'shake').decayPerSecond = 0;
    expect(() => parseTuning(noDecay)).toThrowError(/feel\.shake\.decayPerSecond.*must be > 0/);
  });
});

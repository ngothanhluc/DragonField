/**
 * Boss pool per chapter and boss music (M9, ticket #43).
 *
 * A chapter's boss is picked from its pool by the **run seed**, so two runs of the same
 * chapter can meet different bosses while a replay of the same seed stays identical.
 * Chapters 1–4 all have two bosses (#43, #44); chapter 4 has no levels yet (#45).
 *
 * Pure data + pure functions: no time, no RNG instance, no `cc` (the seed is the whole input).
 */
import { BOSSES, BOSS_IDS, type BossId } from './boss-defs';

/** Bosses a chapter can end with, in a stable order. The run seed picks one. */
export const BOSS_POOLS: Readonly<Record<number, readonly BossId[]>> = {
  1: ['tengu', 'frog'],
  2: ['squid', 'slime'],
  3: ['samurai', 'bamboo'],
  4: ['racoon', 'redtengu'],
};

/**
 * Mix a seed into a well-spread 32-bit value (finalizer of the `hash32` family).
 *
 * Without the avalanche step, seeds 1..64 would keep the low bit nearly linear and a pool of 2
 * would produce long runs of the same boss.
 */
function mixSeed(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Pick the chapter's boss from its pool by run seed. Pure and deterministic. */
export function pickBoss(chapter: number, seed: number): BossId {
  if (!Number.isFinite(seed)) {
    throw new Error(`pickBoss needs a finite seed, got ${seed}`);
  }

  const pool = BOSS_POOLS[chapter];
  if (pool === undefined || pool.length === 0) {
    throw new Error(`no boss pool for chapter ${chapter}`);
  }
  if (pool.length === 1) {
    const only = pool[0];
    if (only === undefined) throw new Error(`no boss pool for chapter ${chapter}`);
    return only;
  }

  // Chapter is part of the hash so two chapters with the same seed do not mirror each other.
  const index = mixSeed(Math.trunc(seed) ^ Math.imul(chapter, 0x9e3779b1)) % pool.length;
  const chosen = pool[index];
  if (chosen === undefined) throw new Error(`no boss pool for chapter ${chapter}`);
  return chosen;
}

/** One music resource path per boss — every boss sounds different (ticket #43, #44). */
const BOSS_MUSIC: Readonly<Record<BossId, string>> = {
  tengu: 'audio/music/boss',
  squid: 'audio/music/boss-squid',
  samurai: 'audio/music/boss-samurai',
  frog: 'audio/music/boss-frog',
  slime: 'audio/music/boss-slime',
  bamboo: 'audio/music/boss-bamboo',
  racoon: 'audio/music/boss-racoon',
  redtengu: 'audio/music/boss-redtengu',
};

/** Resource path (no extension, as `resources.load` wants) of the boss's own music track. */
export function bossMusicPath(id: BossId): string {
  return BOSS_MUSIC[id];
}

/** Every boss id that belongs to a pool (preload helpers). */
export function pooledBossIds(): readonly BossId[] {
  return BOSS_IDS.filter((id) => BOSSES[id] !== undefined);
}

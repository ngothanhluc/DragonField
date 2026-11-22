/**
 * Boss pool per chapter and boss music (M9, ticket #43).
 *
 * STUB written with the red acceptance test: one boss per chapter and one shared track.
 * The executor replaces the bodies; the exported names and signatures are the agreed seam.
 */
import { BOSSES, BOSS_IDS, type BossId } from './boss-defs';

/** Bosses a chapter can end with, in a stable order. The run seed picks one. */
export const BOSS_POOLS: Readonly<Record<number, readonly BossId[]>> = {
  1: ['tengu'],
  2: ['squid'],
  3: ['samurai'],
};

/** Pick the chapter's boss from its pool by run seed. Pure and deterministic. */
export function pickBoss(chapter: number, seed: number): BossId {
  void seed;
  const pool = BOSS_POOLS[chapter];
  const first = pool?.[0];
  if (first === undefined) throw new Error(`no boss pool for chapter ${chapter}`);
  return first;
}

/** Resource path (no extension, as `resources.load` wants) of the boss's own music track. */
export function bossMusicPath(id: BossId): string {
  void id;
  return 'audio/music/boss';
}

/** Every boss id that belongs to a pool (preload helpers). */
export function pooledBossIds(): readonly BossId[] {
  return BOSS_IDS.filter((id) => BOSSES[id] !== undefined);
}

/**
 * Splitter death (M9, ticket #42): a splitter splits into smaller `splitling`s that do not split again.
 *
 * STUB written with the red acceptance test: nothing splits. The executor replaces the body; the
 * exported name and signature are the agreed seam.
 */
import type { LevelData } from '../level/level-data';
import type { EnemyState } from './behaviours';

/**
 * Children spawned when `dead` dies, placed around it on free ground (never inside an obstacle).
 * Only a `splitter` splits; everything else (a `splitling` included) returns `[]`. Pure.
 */
export function splitOnDeath(dead: EnemyState, level: LevelData, nowMs: number): EnemyState[] {
  void dead;
  void level;
  void nowMs;
  return [];
}

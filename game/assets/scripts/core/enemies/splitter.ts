/**
 * Splitter death (M9, ticket #42): a splitter splits into smaller `splitling`s that do not split again.
 *
 * The split is **deterministic** (no `Math.random`): children take free nav-grid cell centres
 * around the parent, visited in ring order. Every child is placed on ground a splitling body
 * fits on (the nav grid is built at its radius), so a split next to a pillar can never put a
 * child inside it.
 *
 * Only a `splitter` splits; everything else (a `splitling` included) returns `[]`, which is what
 * stops the recursion: the dead splitling asks, gets nothing.
 */
import { ENEMY_TUNING, type EnemiesTuning } from './tuning';
import type { LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { maxHealthFor, visualScaleFor, type EnemyState } from './behaviours';
import { buildNavGrid } from './navigation';

/** Body radius per unit of role silhouette — the same convention as the sim and `EnemyView`. */
const ENEMY_RADIUS_TILES = 0.4;
/** How far from the parent a child may land, tiles. */
const MAX_SPLIT_OFFSET_TILES = 2.5;

interface SplitSlot {
  readonly at: Vec2;
  readonly gap: number;
  readonly angle: number;
}

/**
 * Children spawned when `dead` dies, placed around it on free ground (never inside an obstacle).
 * Only a `splitter` splits; everything else (a `splitling` included) returns `[]`. Pure.
 */
export function splitOnDeath(
  dead: EnemyState,
  level: LevelData,
  nowMs: number,
  tuning: EnemiesTuning = ENEMY_TUNING,
): EnemyState[] {
  if (dead.role !== 'splitter') return [];

  const count = Math.max(0, Math.floor(tuning.roles.splitter.splitCount ?? 0));
  if (count === 0) return [];

  const health = maxHealthFor('splitling', false, tuning, level.chapter);
  const slots = freeSlotsAround(dead.position, level, tuning);
  const children: EnemyState[] = [];

  for (let index = 0; index < count; index += 1) {
    // Ring order guarantees no two children share a cell; if the parent is boxed in, fall back
    // to its own (free) spot rather than spawning inside a wall.
    const at = slots[index]?.at ?? { x: dead.position.x, y: dead.position.y };
    children.push({
      id: `${dead.id}-split-${index + 1}`,
      role: 'splitling',
      elite: false,
      position: { x: at.x, y: at.y },
      health,
      maxHealth: health,
      action: { kind: 'idle' },
      // Start the splitling's attack cycle at the split, exactly like a fresh spawn.
      actionStartedMs: nowMs,
    });
  }

  return children;
}

/**
 * Free ground around `center`, nearest ring first, each ring swept by angle so the result is
 * stable for a given room. Uses `buildNavGrid` at the splitling's own body radius: a cell the
 * grid calls free is a cell the body fits in, which is stronger than "its centre misses a wall".
 */
function freeSlotsAround(
  center: Vec2,
  level: LevelData,
  tuning: EnemiesTuning,
): SplitSlot[] {
  const radius = ENEMY_RADIUS_TILES * visualScaleFor('splitling', tuning);
  const grid = buildNavGrid(level, radius, tuning.roomEdgeMarginTiles);
  const centerCol = Math.floor(center.x);
  const centerRow = Math.floor(center.y);
  const reach = Math.ceil(MAX_SPLIT_OFFSET_TILES);
  const slots: SplitSlot[] = [];

  for (let row = centerRow - reach; row <= centerRow + reach; row += 1) {
    for (let col = centerCol - reach; col <= centerCol + reach; col += 1) {
      if (col === centerCol && row === centerRow) continue;
      if (grid.isBlocked(col, row)) continue;

      const at = { x: col + 0.5, y: row + 0.5 };
      const gap = distance(center, at);
      if (gap > MAX_SPLIT_OFFSET_TILES) continue;
      slots.push({ at, gap, angle: Math.atan2(at.y - center.y, at.x - center.x) });
    }
  }

  slots.sort((a, b) => (a.gap !== b.gap ? a.gap - b.gap : a.angle - b.angle));
  return slots;
}

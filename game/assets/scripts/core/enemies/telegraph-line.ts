/**
 * Sniper line telegraph (#42), pure and engine-free.
 *
 * The sniper does not use the caster's ring: it aims a **line** at the player so the player can
 * step off it. This helper returns the two endpoints in `LevelData` tile space; the Cocos
 * adapter only converts them to world units and draws between them.
 *
 * The line stops at the first wall/pillar on the path (pits do not stop bullets) so the visual
 * never promises a shot through a wall, even if a frame of lag reaches the renderer after the
 * sniper lost sight.
 */
import { firstHit } from '../combat/bullets';
import type { LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

export interface TelegraphLine {
  /** Sniper centre, tile space. */
  readonly from: Vec2;
  /** Player centre, or the first point where a wall/pillar stops the shot. */
  readonly to: Vec2;
}

/** Endpoints of the line telegraph from `from` (sniper) toward `to` (player). Pure. */
export function telegraphLine(level: LevelData, from: Vec2, to: Vec2): TelegraphLine {
  const start = { x: from.x, y: from.y };
  const hit = firstHit({ from: start, to }, level);
  if (hit === null) return { from: start, to: { x: to.x, y: to.y } };
  return { from: start, to: { x: hit.point.x, y: hit.point.y } };
}

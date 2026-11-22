/**
 * Ticket #35 acceptance: a prop catalogue per chapter (houses, trees, rocks … from the pack), props
 * placed in every room, and every solid prop's collider is an obstacle — what looks solid is solid.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import { PROP_CATALOGUE, propDef, type PropDef } from '../../assets/scripts/core/level/props';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../assets');
const TILE = 16;

interface PlacedProp {
  readonly key: string;
  /** Top-left of the sprite, tile units. */
  readonly x: number;
  readonly y: number;
}

function propsOf(level: LevelData): readonly PlacedProp[] {
  return (level as unknown as { props?: readonly PlacedProp[] }).props ?? [];
}

function rooms(chapter: number): readonly LevelData[] {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`))).rooms;
}

function gapToRect(point: Vec2, rect: Obstacle): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

function colliderObstacle(placed: PlacedProp, def: PropDef): Obstacle | null {
  if (def.collider === null) return null;
  return {
    kind: 'prop' as Obstacle['kind'],
    x: placed.x + def.collider.x / TILE,
    y: placed.y + def.collider.y / TILE,
    width: def.collider.width / TILE,
    height: def.collider.height / TILE,
  };
}

describe('prop catalogue', () => {
  for (const chapter of [1, 2, 3]) {
    const defs = PROP_CATALOGUE[chapter] ?? [];

    it(`chapter ${chapter}: at least 8 solid and 6 walk-over kinds, with houses and trees`, () => {
      expect(defs.filter((def) => def.solid).length).toBeGreaterThanOrEqual(8);
      expect(defs.filter((def) => !def.solid).length).toBeGreaterThanOrEqual(6);
      expect(defs.some((def) => def.kind === 'house')).toBe(true);
      expect(defs.filter((def) => def.kind === 'tree').length).toBeGreaterThanOrEqual(2);
      expect(new Set(defs.map((def) => def.key)).size).toBe(defs.length);
    });

    it(`chapter ${chapter}: every collider lies inside its sprite, at the bottom; trees block only at the trunk`, () => {
      expect(defs.length).toBeGreaterThan(0);
      for (const def of defs) {
        expect(existsSync(join(ASSETS, def.sheet)), def.sheet).toBe(true);
        if (!def.solid) {
          expect(def.collider, def.key).toBeNull();
          continue;
        }
        const collider = def.collider;
        expect(collider, def.key).not.toBeNull();
        if (collider === null) continue;
        expect(collider.x).toBeGreaterThanOrEqual(0);
        expect(collider.y).toBeGreaterThanOrEqual(0);
        expect(collider.x + collider.width).toBeLessThanOrEqual(def.rect.width);
        expect(collider.y + collider.height).toBeLessThanOrEqual(def.rect.height);
        // The blocking part touches the bottom of the sprite (within 4 px): it is the base.
        expect(def.rect.height - (collider.y + collider.height), def.key).toBeLessThanOrEqual(4);
        if (def.kind === 'tree') {
          // A trunk: at most ~1 tile wide and 1 tile tall, and much smaller than the canopy.
          expect(collider.width, def.key).toBeLessThanOrEqual(TILE + 4);
          expect(collider.height, def.key).toBeLessThanOrEqual(TILE);
          expect(collider.width * collider.height).toBeLessThan((def.rect.width * def.rect.height) / 3);
        }
      }
    });
  }
});

describe('rooms on disk', () => {
  for (const chapter of [1, 2, 3]) {
    it(`chapter ${chapter}: every room places catalogue props, and solid props are exactly the prop obstacles`, () => {
      const problems: string[] = [];
      for (const level of rooms(chapter)) {
        const placed = propsOf(level);
        if (!level.isBossRoom && placed.length < 6) problems.push(`${level.id}: only ${placed.length} props`);
        const expected: Obstacle[] = [];
        for (const prop of placed) {
          const def = propDef(chapter, prop.key);
          if (def === undefined) {
            problems.push(`${level.id}: unknown prop ${prop.key}`);
            continue;
          }
          const obstacle = colliderObstacle(prop, def);
          if (obstacle !== null) expected.push(obstacle);
        }
        const actual = level.obstacles.filter((obstacle) => (obstacle.kind as string) === 'prop');
        const key = (o: Obstacle): string => [o.x, o.y, o.width, o.height].map((n) => n.toFixed(4)).join(',');
        const want = expected.map(key).sort();
        const got = actual.map(key).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          problems.push(`${level.id}: prop obstacles ${got.length} != solid props ${want.length}`);
        }
        // Props never sit on the player start, a spawn or a door.
        const blockers = [...expected, ...level.obstacles.filter((o) => (o.kind as string) !== 'prop')];
        const points: { name: string; at: Vec2; radius: number }[] = [
          { name: 'playerStart', at: level.playerStart, radius: 0.5 },
          ...level.doors.map((door) => ({ name: 'door', at: door.at, radius: 0.5 })),
          ...level.waves.flatMap((wave) => wave.enemies.map((enemy) => ({ name: `spawn ${enemy.role}`, at: enemy.at, radius: 0.5 }))),
        ];
        for (const point of points) {
          for (const block of expected) {
            if (gapToRect(point.at, block) < point.radius) problems.push(`${level.id}: prop on ${point.name}`);
          }
        }
        // Still traversable: playerStart reaches every door through free tiles.
        for (const door of level.doors) {
          if (!reachable(level, blockers, level.playerStart, door.at)) problems.push(`${level.id}: door ${JSON.stringify(door.at)} unreachable`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

/** 4-way BFS over tiles whose centre is at least 0.3 tiles from every blocker. */
function reachable(level: LevelData, blockers: readonly Obstacle[], from: Vec2, to: Vec2): boolean {
  const { cols, rows } = level.size;
  const free = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && blockers.every((b) => gapToRect({ x: c + 0.5, y: r + 0.5 }, b) >= 0.3);
  const start = [Math.floor(from.x), Math.floor(from.y)] as const;
  const goal = `${Math.min(cols - 1, Math.floor(to.x))},${Math.min(rows - 1, Math.floor(to.y))}`;
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: (readonly [number, number])[] = [start];
  while (queue.length > 0) {
    const [c, r] = queue.shift() as readonly [number, number];
    if (`${c},${r}` === goal) return true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = `${c + dc},${r + dr}`;
      if (seen.has(n)) continue;
      // The door tile itself may sit on the room edge; accept it as the goal even if near a wall.
      if (n !== goal && !free(c + dc, r + dr)) continue;
      seen.add(n);
      queue.push([c + dc, r + dr]);
    }
  }
  return false;
}

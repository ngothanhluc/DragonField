/**
 * M11 Ticket T2 acceptance (ADR-020): Chapter 2 real impassable rivers, grass shorelines,
 * wooden bridges, staggered water ripples, aligned waterfall splash foam, pit-vs-bullet physics,
 * and 0-stuck enemy navigation across every Ch2 normal room.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstHit } from '../../assets/scripts/core/combat/bullets';
import { ROOM_EDGE_MARGIN_TILES } from '../../assets/scripts/core/enemies/behaviours';
import {
  buildFlowField,
  buildNavGrid,
  hasLineOfSight,
  walkTowards,
} from '../../assets/scripts/core/enemies/navigation';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import {
  parseWaterLayout,
  planRiverRipples,
  planWaterfallTiles,
  waterAreasFor,
} from '../../assets/scripts/core/level/water-layout';
import { childrenNamed, elementText, firstChild, parseXml } from '../../assets/scripts/core/level/xml';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { circleOverlapsObstacle, moveWithCollision } from '../../assets/scripts/core/movement/collision';
import { simulateRun, type InputPolicy } from '../../sim/run-simulation';
import { CH2_MIN_BRIDGES } from '../../scripts/lib/ch2-river';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const NORMAL_ROOMS = 16;
const COLS = 64;
const ROWS = 36;
const MIN_BRIDGE_WIDTH = 3;

const WATER_MANIFEST = join(LEVELS_ROOT, '..', 'water-layout.json');
const waterLayout = parseWaterLayout(JSON.parse(readFileSync(WATER_MANIFEST, 'utf8')) as unknown);

interface Ch2RoomFile {
  readonly room: number;
  readonly level: LevelData;
  readonly waterLayer: readonly number[];
  readonly bridgeLayer: readonly number[];
  readonly waterFirstGid: number;
}

function readCh2Room(room: number): Ch2RoomFile {
  const path = join(LEVELS_ROOT, 'chapter-2', `room-${room}.tmx`);
  const xml = readFileSync(path, 'utf8');
  const level = parseTmxLevel(xml, { source: `chapter-2/room-${room}.tmx` });
  const map = parseXml(xml);
  const layers = new Map<string, number[]>();
  for (const layer of childrenNamed(map, 'layer')) {
    const data = firstChild(layer, 'data');
    if (data === null) continue;
    const values = elementText(data)
      .split(',')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0)
      .map(Number);
    layers.set(layer.attributes['name'] ?? '', values);
  }
  let waterFirstGid = 0;
  for (const tileset of childrenNamed(map, 'tileset')) {
    if (tileset.attributes['source'] === 'water.tsx') {
      waterFirstGid = Number(tileset.attributes['firstgid']);
    }
  }
  return {
    room,
    level,
    waterLayer: layers.get('water') ?? [],
    bridgeLayer: layers.get('bridge') ?? [],
    waterFirstGid,
  };
}

const ch2Rooms: readonly Ch2RoomFile[] = Array.from({ length: NORMAL_ROOMS }, (_, i) =>
  readCh2Room(i + 1),
);

interface BridgeSpan {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

/** Extract connected bridge components from the `bridge` TMX layer. */
function bridgeSpans(bridgeLayer: readonly number[]): BridgeSpan[] {
  const seen = new Uint8Array(COLS * ROWS);
  const spans: BridgeSpan[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const idx = y * COLS + x;
      if ((bridgeLayer[idx] ?? 0) === 0 || seen[idx] === 1) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const queue: Array<readonly [number, number]> = [[x, y]];
      seen[idx] = 1;
      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nIdx = ny * COLS + nx;
          if ((bridgeLayer[nIdx] ?? 0) === 0 || seen[nIdx] === 1) continue;
          seen[nIdx] = 1;
          queue.push([nx, ny]);
        }
      }
      spans.push({
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      });
    }
  }
  return spans.sort((a, b) => a.minX - b.minX);
}

function pointInsideRect(rect: Obstacle, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

describe('Chapter 2 rivers, shorelines & bridges (ADR-020)', () => {
  it('every Ch2 normal room has grass-banked water tiles, pit obstacles, and >= 2 wide bridges (>= 3 tiles)', () => {
    const problems: string[] = [];
    for (const file of ch2Rooms) {
      const id = file.level.id;
      if (file.waterFirstGid <= 0) {
        problems.push(`${id}: missing water.tsx tileset`);
        continue;
      }
      if (file.waterLayer.length !== COLS * ROWS) problems.push(`${id}: missing water layer`);
      if (file.bridgeLayer.length !== COLS * ROWS) problems.push(`${id}: missing bridge layer`);

      const pits = file.level.obstacles.filter((o) => o.kind === 'pit');
      if (pits.length === 0) problems.push(`${id}: no river pit obstacles`);

      // Must contain grass shoreline bank edge tiles (TilesetWater rows 6/8 edges), not bare flat water.
      const bankLocals = new Set([169, 170, 171, 197, 199, 202, 203, 225, 226, 227, 230, 231]);
      let bankTileCount = 0;
      for (const gid of file.waterLayer) {
        if (gid === 0) continue;
        const local = gid - file.waterFirstGid + 1;
        if (bankLocals.has(local)) bankTileCount += 1;
      }
      if (bankTileCount < 40) problems.push(`${id}: only ${bankTileCount} shoreline bank tiles`);

      // At least 2 bridges, each >= 3 tiles wide, and ZERO pit obstacles overlapping bridge cells.
      const bridges = bridgeSpans(file.bridgeLayer);
      if (bridges.length < CH2_MIN_BRIDGES) {
        problems.push(`${id}: only ${bridges.length} bridges (need >= ${CH2_MIN_BRIDGES})`);
      }
      for (const bridge of bridges) {
        if (bridge.width < MIN_BRIDGE_WIDTH) {
          problems.push(`${id}: bridge at x=${bridge.minX} is only ${bridge.width} tiles wide`);
        }
        for (let y = bridge.minY; y <= bridge.maxY; y += 1) {
          for (let x = bridge.minX; x <= bridge.maxX; x += 1) {
            if (pits.some((pit) => pointInsideRect(pit, x + 0.5, y + 0.5))) {
              problems.push(`${id}: pit obstacle overlaps bridge tile (${x},${y})`);
            }
          }
        }
      }

      // Water areas in water-layout.json must not cover bridge decks, and waterfalls align with pools.
      const areas = waterAreasFor(waterLayout, 2, file.room);
      for (const area of areas) {
        if (area.kind === 'river') {
          for (let y = area.y; y < area.y + area.height; y += 1) {
            for (let x = area.x; x < area.x + area.width; x += 1) {
              if ((file.bridgeLayer[y * COLS + x] ?? 0) !== 0) {
                problems.push(`${id}: water-layout river area overlaps bridge tile (${x},${y})`);
              }
            }
          }
        } else if (area.kind === 'waterfall') {
          // Bottom splash row must sit directly on a river water tile (aligned with plunge pool).
          const splashY = area.y + area.height - 1;
          for (let x = area.x; x < area.x + area.width; x += 1) {
            if ((file.waterLayer[splashY * COLS + x] ?? 0) === 0) {
              problems.push(`${id}: waterfall splash at (${x},${splashY}) is not aligned with pool water`);
            }
          }
        }
      }
    }
    expect(problems.slice(0, 12)).toEqual([]);
  });

  it('every Ch2 room: no spawn in pit, spawn -> every door & spawn -> playerStart walkable for tanks (0.75)', () => {
    const problems: string[] = [];
    for (const file of ch2Rooms) {
      const { level } = file;
      const pits = level.obstacles.filter((o) => o.kind === 'pit');
      const playerGrid = buildNavGrid(level, 0.25, ROOM_EDGE_MARGIN_TILES);
      const tankGrid = buildNavGrid(level, 0.75, ROOM_EDGE_MARGIN_TILES);

      const startCol = Math.floor(level.playerStart.x);
      const startRow = Math.floor(level.playerStart.y);
      for (const door of level.doors) {
        const playerField = buildFlowField(playerGrid, door.at);
        if (!Number.isFinite(playerField.distanceAt(startCol, startRow))) {
          problems.push(`${level.id}: door ${JSON.stringify(door.at)} unreachable for player`);
        }
      }

      const toPlayer = buildFlowField(tankGrid, level.playerStart);
      for (const wave of level.waves) {
        for (const enemy of wave.enemies) {
          if (pits.some((pit) => circleOverlapsObstacle(enemy.at, 0.75, pit))) {
            problems.push(`${level.id}: spawn ${enemy.role} at (${enemy.at.x},${enemy.at.y}) overlaps river pit`);
          }
          if (!Number.isFinite(toPlayer.distanceAt(Math.floor(enemy.at.x), Math.floor(enemy.at.y)))) {
            problems.push(`${level.id}: spawn ${enemy.role} at (${enemy.at.x},${enemy.at.y}) cannot reach player`);
          }
        }
      }
    }
    expect(problems.slice(0, 12)).toEqual([]);
  });

  it('bullets fly across Ch2 river pits while walkers are blocked by water and cross bridges smoothly', () => {
    const file = ch2Rooms[0]!;
    const { level, bridgeLayer } = file;
    const pits = level.obstacles.filter((o) => o.kind === 'pit');
    expect(pits.length).toBeGreaterThan(0);

    // Pick a wide horizontal river pit segment and fire straight across it north -> south.
    const pit = pits.reduce((widest, cur) => (cur.width > widest.width ? cur : widest), pits[0]!);
    const midX = pit.x + pit.width / 2;
    const northOfPit: Vec2 = { x: midX, y: Math.max(2.5, pit.y - 1) };
    const southOfPit: Vec2 = { x: midX, y: Math.min(ROWS - 2.5, pit.y + pit.height + 1) };
    const pitOnlyLevel: LevelData = { ...level, obstacles: pits };

    // Bullets & line-of-sight pass right across the water pit.
    expect(firstHit({ from: northOfPit, to: southOfPit }, pitOnlyLevel)).toBeNull();
    expect(hasLineOfSight(pitOnlyLevel, northOfPit, southOfPit)).toBe(true);

    // Walking straight south into the pit is blocked before entering water.
    let walker = { ...northOfPit };
    for (let step = 0; step < 60; step += 1) {
      walker = moveWithCollision(walker, { x: 0, y: 0.15 }, 0.25, pitOnlyLevel, ROOM_EDGE_MARGIN_TILES);
    }
    expect(walker.y).toBeLessThanOrEqual(pit.y - 0.25 + 1e-6);

    // Walking straight across a wooden bridge reaches the far bank smoothly.
    const bridge = bridgeSpans(bridgeLayer)[0]!;
    const bridgeMidX = bridge.minX + bridge.width / 2;
    let crosser: Vec2 = { x: bridgeMidX, y: bridge.minY - 0.5 };
    const farY = bridge.maxY + 1.5;
    for (let step = 0; step < 80 && crosser.y < farY; step += 1) {
      crosser = moveWithCollision(crosser, { x: 0, y: 0.15 }, 0.7, pitOnlyLevel, ROOM_EDGE_MARGIN_TILES);
    }
    expect(crosser.y).toBeGreaterThanOrEqual(farY - 0.1);

    // Flow-field steering guides a north-bank enemy across the bridge to a south-bank player.
    const navGrid = buildNavGrid(level, 0.7, ROOM_EDGE_MARGIN_TILES);
    const field = buildFlowField(navGrid, level.playerStart);
    let enemyPos: Vec2 = { x: bridgeMidX + 4, y: Math.max(2.5, bridge.minY - 1.5) };
    if (navGrid.isBlocked(Math.floor(enemyPos.x), Math.floor(enemyPos.y))) {
      enemyPos = { x: bridgeMidX, y: Math.max(2.5, bridge.minY - 1.5) };
    }
    for (let step = 0; step < 600; step += 1) {
      if (Math.hypot(enemyPos.x - level.playerStart.x, enemyPos.y - level.playerStart.y) < 1) break;
      enemyPos = walkTowards({
        position: enemyPos,
        target: level.playerStart,
        field,
        maxDistanceTiles: 0.1,
        radiusTiles: 0.7,
        level,
        marginTiles: ROOM_EDGE_MARGIN_TILES,
      });
    }
    expect(Math.hypot(enemyPos.x - level.playerStart.x, enemyPos.y - level.playerStart.y)).toBeLessThan(1.5);
  });

  it('headless Ch2 runs across multiple seeds have 0 stuck enemies', () => {
    const chapter = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, 'chapter-2')));
    const stuck: string[] = [];

    for (const seed of [1, 7, 42]) {
      const windows = new Map<string, { since: number; from: Vec2 }>();
      const policy: InputPolicy = (world) => {
        for (const enemy of world.enemies) {
          const crowded =
            Math.hypot(enemy.position.x - world.player.x, enemy.position.y - world.player.y) <= 3;
          if (enemy.health <= 0 || enemy.action.kind !== 'walk' || crowded) {
            windows.delete(enemy.id);
            continue;
          }
          const win = windows.get(enemy.id);
          if (win === undefined) {
            windows.set(enemy.id, { since: world.nowMs, from: { ...enemy.position } });
            continue;
          }
          if (world.nowMs - win.since >= 2000) {
            const moved = Math.hypot(enemy.position.x - win.from.x, enemy.position.y - win.from.y);
            if (moved < 0.5) {
              stuck.push(`seed ${seed} room ${world.room} ${enemy.id} at ${JSON.stringify(enemy.position)}`);
            }
            windows.set(enemy.id, { since: world.nowMs, from: { ...enemy.position } });
          }
        }
        return { up: false, down: false, left: false, right: false };
      };
      simulateRun({ seed, level: chapter, policy, godMode: true, maxDurationMs: 120_000 });
    }
    expect(stuck.slice(0, 5)).toEqual([]);
  });
});

describe('staggered water ripples & waterfall layout (core/level/water-layout)', () => {
  it('planRiverRipples breaks up uniform grid repetition while staying strictly inside area bounds', () => {
    const area = { kind: 'river' as const, x: 4, y: 8, width: 16, height: 2 };
    const ripples = planRiverRipples(area);
    const totalCells = area.width * area.height;

    // Sparse organic density (not every grid cell stamped).
    expect(ripples.length).toBeGreaterThan(0);
    expect(ripples.length).toBeLessThan(totalCells);

    // Deterministic across calls.
    expect(planRiverRipples(area)).toEqual(ripples);

    // Varied phases and speeds (no uniform grid lockstep).
    const distinctPhases = new Set(ripples.map((r) => r.phase.toFixed(3)));
    const distinctFps = new Set(ripples.map((r) => r.fps.toFixed(3)));
    expect(distinctPhases.size).toBeGreaterThan(4);
    expect(distinctFps.size).toBeGreaterThan(4);

    // Every jittered ripple stays strictly inside `[area.x, area.x + area.width] × [area.y, area.y + area.height]`.
    for (const r of ripples) {
      const left = r.tileX + r.offsetX;
      const right = left + 1;
      const top = r.tileY + r.offsetY;
      const bottom = top + 1;
      expect(left).toBeGreaterThanOrEqual(area.x - 1e-9);
      expect(right).toBeLessThanOrEqual(area.x + area.width + 1e-9);
      expect(top).toBeGreaterThanOrEqual(area.y - 1e-9);
      expect(bottom).toBeLessThanOrEqual(area.y + area.height + 1e-9);
    }
  });

  it('planWaterfallTiles places top lip, mid cascade, and bottom splash foam with staggered phases', () => {
    const area = { kind: 'waterfall' as const, x: 20, y: 0, width: 2, height: 8 };
    const tiles = planWaterfallTiles(area);
    expect(tiles).toHaveLength(16);

    const tops = tiles.filter((t) => t.part === 'top');
    const mids = tiles.filter((t) => t.part === 'mid');
    const bottoms = tiles.filter((t) => t.part === 'bottom');
    expect(tops).toHaveLength(2);
    expect(tops.every((t) => t.tileY === 0)).toBe(true);
    expect(mids).toHaveLength(12);
    expect(bottoms).toHaveLength(2);
    expect(bottoms.every((t) => t.tileY === 7)).toBe(true);

    // Left and right waterfall columns have staggered phases (not identical lockstep).
    expect(bottoms[0]!.phase).not.toBeCloseTo(bottoms[1]!.phase, 3);
  });
});

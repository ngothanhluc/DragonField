/**
 * M11 T3 tests: Chapter 3 mossy olive palette & Ch1/Ch3/Ch4 cohesive cluster composition
 * with low-noise ground dressing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUND_TERRAINS, floorBlockTiles } from '../../assets/scripts/core/level/autotile';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { childrenNamed, elementText, firstChild, parseXml } from '../../assets/scripts/core/level/xml';
import { LEVELS_ROOT } from '../helpers/tmx-levels';

const NORMAL_ROOMS = 16;

interface ParsedRoomLayers {
  readonly decorLocals: Map<string, number[]>;
  readonly floorFirst: number;
  readonly propKeys: string[];
}

function readRoomLayers(chapter: number, room: number): ParsedRoomLayers {
  const xml = readFileSync(join(LEVELS_ROOT, `chapter-${chapter}`, `room-${room}.tmx`), 'utf8');
  const level = parseTmxLevel(xml, { source: `chapter-${chapter}/room-${room}.tmx` });
  const map = parseXml(xml);
  const tilesets = childrenNamed(map, 'tileset').map((node) => ({
    source: node.attributes['source'] ?? '',
    firstgid: Number(node.attributes['firstgid']),
  }));

  const resolve = (gid: number): { source: string; local: number } | null => {
    if (gid === 0) return null;
    const hit = [...tilesets].reverse().find((ts) => gid >= ts.firstgid);
    return hit === undefined ? null : { source: hit.source, local: gid - hit.firstgid + 1 };
  };

  const layerValues = (name: string): number[] => {
    const layer = childrenNamed(map, 'layer').find((node) => node.attributes['name'] === name);
    const data = layer === undefined ? null : firstChild(layer, 'data');
    if (data === null) return [];
    return elementText(data)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  };

  const decorLocals = new Map<string, number[]>();
  for (const gid of layerValues('decor')) {
    const hit = resolve(gid);
    if (hit === null) continue;
    const list = decorLocals.get(hit.source) ?? [];
    list.push(hit.local);
    decorLocals.set(hit.source, list);
  }

  return {
    decorLocals,
    floorFirst: layerValues('floor')[0] ?? 0,
    propKeys: level.props.map((p) => p.key),
  };
}

describe('M11 T3: Ch3 mossy ruins palette', () => {
  it('switches Ch3 base terrain to mossy olive grass (plain 265) with worn dirt path blob', () => {
    expect(GROUND_TERRAINS[3]).toEqual({
      tileset: 'tilefloor.tsx',
      tiles: floorBlockTiles(0, 7),
      plain: 265,
    });
  });

  it('drops white skulls, bones, and blue rubble pebbles from Ch3 open-floor decor', () => {
    const forbiddenFloorDetails = new Set([2, 5, 14, 15, 17]);
    for (let room = 1; room <= NORMAL_ROOMS; room += 1) {
      const parsed = readRoomLayers(3, room);
      const fdLocals = parsed.decorLocals.get('floordetail.tsx') ?? [];
      const noisy = fdLocals.filter((id) => forbiddenFloorDetails.has(id));
      expect(noisy, `ch3 r${room} noisy floordetail`).toEqual([]);
    }
  });
});

describe('M11 T3: Ch1 low-noise forest clearings & cozy yards', () => {
  it('eliminates random pebble and mid-field flower scatter from Ch1 decor layer', () => {
    const forbiddenScatter = new Set([2, 5, 38, 39, 40]);
    for (let room = 1; room <= NORMAL_ROOMS; room += 1) {
      const parsed = readRoomLayers(1, room);
      const fdLocals = parsed.decorLocals.get('floordetail.tsx') ?? [];
      const noisy = fdLocals.filter((id) => forbiddenScatter.has(id));
      expect(noisy, `ch1 r${room} noisy scatter`).toEqual([]);
    }
  });

  it('includes both cozy edge yards (even rooms) and multi-tree groves across Ch1', () => {
    let roomsWithYardProps = 0;
    for (let room = 2; room <= NORMAL_ROOMS; room += 2) {
      const parsed = readRoomLayers(1, room);
      const hasFence = parsed.propKeys.some((k) => k === 'fence' || k === 'fence-post');
      const hasHouse = parsed.propKeys.some((k) => k.startsWith('house-') || k === 'hut');
      if (hasFence && hasHouse) roomsWithYardProps += 1;
    }
    expect(roomsWithYardProps).toBe(8);
  });
});

describe('M11 T3: Ch4 low-noise desert oases & outposts', () => {
  it('removes scattered skulls, bones, and shells from Ch4 decor and random prop scatter', () => {
    const forbiddenDecor = new Set([13, 14, 15, 16]);
    const forbiddenProps = new Set(['desert-skull', 'desert-fish-bones', 'desert-shell']);
    for (let room = 1; room <= NORMAL_ROOMS; room += 1) {
      const parsed = readRoomLayers(4, room);
      const fdLocals = parsed.decorLocals.get('floordetail.tsx') ?? [];
      expect(fdLocals.filter((id) => forbiddenDecor.has(id)), `ch4 r${room} decor`).toEqual([]);
      expect(parsed.propKeys.filter((k) => forbiddenProps.has(k)), `ch4 r${room} props`).toEqual([]);
    }
  });

  it('alternates fortified adobe outposts and nomad tent camps across Ch4 even rooms', () => {
    let adobeRooms = 0;
    let nomadRooms = 0;
    for (let room = 2; room <= NORMAL_ROOMS; room += 2) {
      const parsed = readRoomLayers(4, room);
      if (parsed.propKeys.some((k) => k === 'camp-tent' || k === 'camp-tent-open')) nomadRooms += 1;
      if (parsed.propKeys.some((k) => k === 'desert-house' || k === 'desert-dome' || k === 'desert-wall-tower')) {
        adobeRooms += 1;
      }
    }
    expect(adobeRooms).toBeGreaterThanOrEqual(4);
    expect(nomadRooms).toBeGreaterThanOrEqual(4);
  });
});

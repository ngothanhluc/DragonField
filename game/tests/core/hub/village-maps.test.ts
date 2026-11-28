/**
 * M21 Village Hub (`36×24`), Shop Interior (`16×12`), staged pack assets, and manifest-merge tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, resolve as resolveAnim, validateManifest } from '../../../assets/scripts/core/art/manifest';
import {
  DIALOG_BLIP_SFX_PATHS,
  HUB_VILLAGER_IDS,
  VILLAGE_MUSIC_PATH,
  buildHubInteractables,
  createVillagePatrolRoster,
  findNearestInteractable,
  findStepTrigger,
  parseHubTmx,
  resolveNpcAnimKey,
  stepAllVillagers,
  type HubMapData,
} from '../../../assets/scripts/core/hub';
import { propCollider, propDef } from '../../../assets/scripts/core/level/props';
import { splitTmxLayers } from '../../../assets/scripts/core/level/tmx-chunks';
import { childrenNamed, firstChild, parseXml } from '../../../assets/scripts/core/level/xml';
import type { Vec2 } from '../../../assets/scripts/core/math/vec2';
import { circleOverlapsObstacle, moveWithCollision } from '../../../assets/scripts/core/movement/collision';
import {
  M21_NPC_IDS,
  buildM21SpriteEntries,
  m21ManifestKeys,
  mergeM21ManifestEntries,
} from '../../helpers/village-npc-manifest';
import { bottomPadding, readPng } from '../../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '../../..');
const ASSETS = join(PROJECT, 'assets');
const RES = join(ASSETS, 'resources');
const VILLAGE_LEVELS = join(RES, 'data/levels/village');
const MANIFEST_PATH = join(RES, 'data/animations.json');

const villageXml = readFileSync(join(VILLAGE_LEVELS, 'village-hub.tmx'), 'utf8');
const shopXml = readFileSync(join(VILLAGE_LEVELS, 'shop-interior.tmx'), 'utf8');
const manifest = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);

/** 0.5-tile BFS reachability for a circular player body (`radius = 0.35` tiles). */
function bfsReachable(map: HubMapData, start: Vec2, radiusTiles = 0.35): ReadonlySet<string> {
  const step = 0.5;
  const cols = Math.round(map.size.cols / step);
  const rows = Math.round(map.size.rows / step);

  const free = (gx: number, gy: number): boolean => {
    if (gx <= 0 || gy <= 0 || gx >= cols || gy >= rows) return false;
    const pt = { x: gx * step, y: gy * step };
    return map.obstacles.every((o) => !circleOverlapsObstacle(pt, radiusTiles, o));
  };

  const sx = Math.round(start.x / step);
  const sy = Math.round(start.y / step);
  expect(free(sx, sy), `${map.id} start (${start.x}, ${start.y}) is free`).toBe(true);

  const visited = new Set<string>([`${sx},${sy}`]);
  const queue: Array<[number, number]> = [[sx, sy]];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !free(nx, ny)) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

function minReachableDistance(visited: ReadonlySet<string>, target: Vec2): number {
  const step = 0.5;
  let best = Number.POSITIVE_INFINITY;
  for (const key of visited) {
    const [gxStr, gyStr] = key.split(',');
    const d = Math.hypot(Number(gxStr) * step - target.x, Number(gyStr) * step - target.y);
    if (d < best) best = d;
  }
  return best;
}

describe('M21 staged tilesets, NPCs, animals, and village audio', () => {
  it('stages all Village Hub & Shop Interior tilesets with nearest-filtered image .meta files', () => {
    const tilesets = [
      'art/tilesets/TilesetHouse.png',
      'art/tilesets/TilesetNature.png',
      'art/tilesets/TilesetElement.png',
      'art/tilesets/TilesetField.png',
      'art/tilesets/TilesetFloor.png',
      'art/tilesets/TilesetFloorDetail.png',
      'art/tilesets/tileset_camp.png',
      'art/tilesets/tileset_bed.png',
      'art/tilesets/interior/Elements.png',
      'art/tilesets/interior/TilesetInterior.png',
      'art/tilesets/interior/TilesetInteriorFloor.png',
      'art/tilesets/interior/TilesetWallSimple.png',
    ] as const;

    for (const rel of tilesets) {
      const full = join(RES, rel);
      expect(existsSync(full), rel).toBe(true);
      expect(existsSync(`${full}.meta`), `${rel}.meta`).toBe(true);
      const meta = JSON.parse(readFileSync(`${full}.meta`, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      expect(meta.importer).toBe('image');
      expect(meta.subMetas?.['6c48a']?.userData?.['minfilter'], `${rel} minfilter`).toBe('nearest');
      expect(meta.subMetas?.['6c48a']?.userData?.['magfilter'], `${rel} magfilter`).toBe('nearest');
    }
  });

  it('stages 5 villagers + shopkeeper + dojo-master (4-dir walk/stand + Faceset) and bird animal', () => {
    expect(M21_NPC_IDS).toHaveLength(7);
    for (const npcId of M21_NPC_IDS) {
      const faceset = join(RES, `art/npc/${npcId}/Faceset.png`);
      expect(existsSync(faceset), `${npcId} Faceset`).toBe(true);
      expect(existsSync(`${faceset}.meta`), `${npcId} Faceset.meta`).toBe(true);
      const png = readPng(faceset);
      expect([png.width, png.height]).toEqual([38, 38]);

      const look = resolveNpcAnimKey(npcId, 'look');
      expect(resolveAnim(manifest, look.key, look.fallback).frames).toBe(4);

      for (const dir of DIRECTIONS) {
        const walk = resolveNpcAnimKey(npcId, 'walk', dir);
        const stand = resolveNpcAnimKey(npcId, 'stand', dir);
        expect(resolveAnim(manifest, walk.key, walk.fallback).frames).toBe(4);
        expect(resolveAnim(manifest, stand.key, stand.fallback).frames).toBe(1);
      }
    }

    for (const animalKey of ['animal.dog', 'animal.cat', 'animal.chicken', 'animal.bird'] as const) {
      const entry = resolveAnim(manifest, animalKey);
      expect([entry.frameWidth, entry.frameHeight]).toEqual([16, 16]);
      expect(entry.frames).toBe(2);
    }
  });

  it('stages cozy village music and soft dialog voice blip SFX with valid audio-clip metas', () => {
    for (const audioRel of [VILLAGE_MUSIC_PATH, ...DIALOG_BLIP_SFX_PATHS]) {
      const mp3 = join(RES, `${audioRel}.mp3`);
      const metaPath = `${mp3}.meta`;
      expect(existsSync(mp3), `${audioRel}.mp3`).toBe(true);
      expect(existsSync(metaPath), `${audioRel}.mp3.meta`).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        importer?: string;
        userData?: { duration?: number };
      };
      expect(meta.importer).toBe('audio-clip');
      expect(meta.userData?.duration).toBeGreaterThan(0);
    }
  });

  it('manifest-merge helper preserves all non-M21 entries verbatim and appends M21 keys cleanly', () => {
    const footBySheet = new Map<string, number>();
    for (const key of m21ManifestKeys()) {
      const entry = manifest.sprites[key]!;
      footBySheet.set(entry.sheet, bottomPadding(readPng(join(ASSETS, entry.sheet))));
    }
    const m21Sprites = buildM21SpriteEntries(footBySheet);
    const remerged = mergeM21ManifestEntries(manifest, m21Sprites);
    expect(remerged).toEqual(manifest);
  });
});

describe('village-hub.tmx (36×24) & shop-interior.tmx (16×12)', () => {
  it('validates .tmx/.tsx/.meta conventions (same-folder bare source, contiguous firstgid, valid PNGs)', () => {
    for (const fileName of ['village-hub.tmx', 'shop-interior.tmx'] as const) {
      const tmxPath = join(VILLAGE_LEVELS, fileName);
      expect(existsSync(`${tmxPath}.meta`)).toBe(true);
      const tmxMeta = JSON.parse(readFileSync(`${tmxPath}.meta`, 'utf8')) as { importer?: string };
      expect(tmxMeta.importer).toBe('tiled-map');

      const root = parseXml(readFileSync(tmxPath, 'utf8'));
      const tilesets = childrenNamed(root, 'tileset');
      expect(tilesets.length).toBeGreaterThan(0);

      let expectedFirstGid = 1;
      for (const ts of tilesets) {
        const source = ts.attributes['source'] ?? '';
        expect(source).not.toContain('/');
        expect(Number(ts.attributes['firstgid'])).toBe(expectedFirstGid);

        const tsxPath = join(VILLAGE_LEVELS, source);
        expect(existsSync(tsxPath), source).toBe(true);
        expect(existsSync(`${tsxPath}.meta`), `${source}.meta`).toBe(true);
        const tsxMeta = JSON.parse(readFileSync(`${tsxPath}.meta`, 'utf8')) as { importer?: string };
        expect(tsxMeta.importer).toBe('text');

        const tsxRoot = parseXml(readFileSync(tsxPath, 'utf8'));
        const tilecount = Number(tsxRoot.attributes['tilecount']);
        const columns = Number(tsxRoot.attributes['columns']);
        const img = firstChild(tsxRoot, 'image');
        const imgSource = img?.attributes['source'] ?? '';
        const pngPath = resolve(VILLAGE_LEVELS, imgSource);
        expect(existsSync(pngPath), pngPath).toBe(true);
        const png = readPng(pngPath);
        expect([Number(img?.attributes['width']), Number(img?.attributes['height'])]).toEqual([
          png.width,
          png.height,
        ]);
        expect(columns * 16).toBe(png.width);
        expect((png.height / 16) * columns).toBe(tilecount);

        expectedFirstGid += tilecount;
      }
    }
  });

  it('village-hub.tmx parses as 36×24, chunks cleanly for TiledMap, enforces solid-prop collision parity, and reaches all landmarks via BFS', () => {
    const map = parseHubTmx(villageXml, { source: 'village-hub.tmx' });
    expect(map.id).toBe('village');
    expect(map.size).toEqual({ cols: 36, rows: 24 });

    // Chunking for Cocos 2D batcher (`32×18`, `4×18`, `32×6`, `4×6`).
    const chunks = splitTmxLayers(villageXml);
    expect(chunks.map((c) => [c.col, c.row, c.cols, c.rows])).toEqual([
      [0, 0, 32, 18],
      [32, 0, 4, 18],
      [0, 18, 32, 6],
      [32, 18, 4, 6],
    ]);

    // Solid-prop collision parity: every solid PlacedProp contributes its exact `propCollider`.
    const expectedPropObstacles = map.props.flatMap((placed) => {
      const def = propDef(1, placed.key);
      expect(def, placed.key).toBeDefined();
      const col = def ? propCollider(placed, def) : null;
      return col ? [col] : [];
    });
    const actualPropObstacles = map.obstacles.filter((o) => o.kind === 'prop');
    expect(actualPropObstacles).toEqual(expectedPropObstacles);
    expect(actualPropObstacles.length).toBeGreaterThanOrEqual(10);

    // Required triggers, Dojo Master, 5 patrolling villagers, and 4 yard animals.
    const shopEntrance = map.triggers.find((t) => t.id === 'shop-entrance');
    const expeditionGate = map.triggers.find((t) => t.id === 'expedition-gate');
    const dojoMaster = map.npcs.find((n) => n.id === 'dojo-master');
    expect(shopEntrance).toBeDefined();
    expect(expeditionGate).toBeDefined();
    expect(dojoMaster).toBeDefined();
    expect(map.animals.map((a) => a.sprite).sort()).toEqual([
      'animal.bird',
      'animal.cat',
      'animal.chicken',
      'animal.dog',
    ]);

    const villagers = map.npcs.filter((n) => n.role === 'villager');
    expect(villagers.map((v) => v.id)).toEqual([...HUB_VILLAGER_IDS]);

    // Shop return spawn must NOT sit inside `shop-entrance` (prevents doorway ping-pong).
    const shopReturn = map.entryPoints['shop-interior'];
    expect(shopReturn).toBeDefined();
    expect(findStepTrigger(shopReturn!.at, map.triggers)).toBeNull();

    // BFS reachability from playerStart to West Shop doorway, East Dojo Master, North Gate, and every villager!
    const reachable = bfsReachable(map, map.playerStart);
    expect(minReachableDistance(reachable, shopEntrance!.at)).toBeLessThanOrEqual(0.6);
    expect(minReachableDistance(reachable, expeditionGate!.at)).toBeLessThanOrEqual(0.6);
    expect(minReachableDistance(reachable, dojoMaster!.at)).toBeLessThanOrEqual(1.5);
    for (const villager of villagers) {
      expect(minReachableDistance(reachable, villager.at), villager.id).toBeLessThanOrEqual(1.5);
    }

    // Simulate 30 seconds of villager patrolling against `collisionLevel`: zero stuck or overlapping obstacles!
    let roster = createVillagePatrolRoster(map);
    expect(roster).toHaveLength(5);
    for (let step = 0; step < 300; step += 1) {
      roster = stepAllVillagers(roster, {
        dtMs: 100,
        playerPos: null,
        collisionLevel: map.collisionLevel,
      });
      for (const v of roster) {
        for (const obs of map.obstacles) {
          expect(circleOverlapsObstacle(v.position, 0.3, obs), `${v.id} hit ${obs.kind}`).toBe(false);
        }
      }
    }
  });

  it('shop-interior.tmx parses as 16×12, enforces solid counter/shelf colliders, and reaches Shopkeeper prompt & South exit rug via BFS', () => {
    const map = parseHubTmx(shopXml, { source: 'shop-interior.tmx' });
    expect(map.id).toBe('shop-interior');
    expect(map.size).toEqual({ cols: 16, rows: 12 });
    expect(splitTmxLayers(shopXml)).toHaveLength(1);

    const shopkeeper = map.npcs.find((n) => n.id === 'shopkeeper');
    const shopExit = map.triggers.find((t) => t.id === 'shop-exit');
    expect(shopkeeper).toBeDefined();
    expect(shopExit).toBeDefined();

    // Entry `playerStart` is clear of `shop-exit` so entering never immediately exits!
    expect(findStepTrigger(map.playerStart, map.triggers)).toBeNull();

    // Walking straight north from `playerStart` `(8, 9.2)` hits the solid wooden counter before reaching `(8, 4.2)`
    // AND brings the player within `<= 2.0` tiles of the Shopkeeper so `[E] hub.prompt.talk` lights up!
    const walkedToCounter = moveWithCollision(
      map.playerStart,
      { x: 0, y: -6 },
      0.35,
      map.collisionLevel,
      0.5,
    );
    expect(walkedToCounter.y).toBeGreaterThan(4.8);
    const promptAtCounter = findNearestInteractable(walkedToCounter, buildHubInteractables(map));
    expect(promptAtCounter).not.toBeNull();
    expect(promptAtCounter?.id).toBe('shopkeeper');
    expect(promptAtCounter?.promptKey).toBe('hub.prompt.talk');
    expect(promptAtCounter?.action).toEqual({ kind: 'talk-shopkeeper', npcId: 'shopkeeper' });

    // BFS reachability from entry to both Shopkeeper talk zone and South exit rug!
    const reachable = bfsReachable(map, map.playerStart);
    expect(minReachableDistance(reachable, shopkeeper!.at)).toBeLessThanOrEqual(2.0);
    expect(minReachableDistance(reachable, shopExit!.at)).toBeLessThanOrEqual(0.6);
  });

  it('parseHubTmx rejects malformed dimensions, unknown objects, non-zero rotation, and broken waypoint sequences', () => {
    expect(() =>
      parseHubTmx(villageXml.replace('width="36"', 'width="32"'), { source: 'bad-size.tmx' }),
    ).toThrow(/width must be 36/);

    expect(() =>
      parseHubTmx(shopXml.replace('name="npc"', 'name="mysteryThing"'), { source: 'typo.tmx' }),
    ).toThrow(/not in hub convention/);

    expect(() =>
      parseHubTmx(shopXml.replace('name="obstacle"', 'name="obstacle" rotation="45"'), {
        source: 'rot.tmx',
      }),
    ).toThrow(/rotation must be 0/);

    expect(() =>
      parseHubTmx(villageXml.replace('name="order" type="int" value="1"', 'name="order" type="int" value="5"'), {
        source: 'gap-wp.tmx',
      }),
    ).toThrow(/contiguous order/);
  });
});

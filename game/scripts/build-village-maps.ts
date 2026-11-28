/**
 * Author reproducible, validated `.tmx`, `.tsx`, and `.meta` files for M21:
 * - `assets/resources/data/levels/village/village-hub.tmx` (`36×24` tiles, follow camera)
 * - `assets/resources/data/levels/village/shop-interior.tmx` (`16×12` tiles, static camera)
 *
 * Every `.tsx` sits in the same `village/` directory and is referenced by bare filename
 * (`source="field.tsx"`, etc.) per AGENTS.md. Both maps are parsed with `parseHubTmx`, chunk-checked
 * with `splitTmxLayers`, and verified for solid-prop collision parity + BFS traversability before
 * writing to disk. Re-running preserves existing `.meta` UUIDs (100% deterministic).
 *
 * Run: `cd game && bun run scripts/build-village-maps.ts`
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Direction } from '../assets/scripts/core/art/manifest';
import {
  parseHubTmx,
  type HubAnimalSprite,
  type HubMapData,
  type HubNpcId,
  type HubNpcRole,
  type HubPromptKey,
  type HubTriggerId,
  type HubVillagerId,
} from '../assets/scripts/core/hub/hub-tmx';
import {
  floorBlockTiles,
  normalizePatchMask,
  pickBlobTile,
  type PatchMask,
} from './lib/autotile';
import type { ObstacleKind } from '../assets/scripts/core/level/level-data';
import { splitTmxLayers } from '../assets/scripts/core/level/tmx-chunks';
import type { Vec2 } from '../assets/scripts/core/math/vec2';
import { circleOverlapsObstacle } from '../assets/scripts/core/movement/collision';
import { writeMeta } from './lib/audio';
import { RES, projectRelative, writeRoomFile } from './lib/room-file';
import { buildTsx } from './lib/room-layout';

const VILLAGE_DIR = join(RES, 'data', 'levels', 'village');
const TILE = 16;

interface TilesetEntry {
  readonly tsxFile: string;
  readonly name: string;
  readonly imageRelFromVillage: string;
  readonly resPngPath: string;
}

const ALL_VILLAGE_TILESETS: readonly TilesetEntry[] = [
  {
    tsxFile: 'field.tsx',
    name: 'field',
    imageRelFromVillage: '../../../art/tilesets/TilesetField.png',
    resPngPath: join(RES, 'art/tilesets/TilesetField.png'),
  },
  {
    tsxFile: 'nature.tsx',
    name: 'nature',
    imageRelFromVillage: '../../../art/tilesets/TilesetNature.png',
    resPngPath: join(RES, 'art/tilesets/TilesetNature.png'),
  },
  {
    tsxFile: 'element.tsx',
    name: 'element',
    imageRelFromVillage: '../../../art/tilesets/TilesetElement.png',
    resPngPath: join(RES, 'art/tilesets/TilesetElement.png'),
  },
  {
    tsxFile: 'house.tsx',
    name: 'house',
    imageRelFromVillage: '../../../art/tilesets/TilesetHouse.png',
    resPngPath: join(RES, 'art/tilesets/TilesetHouse.png'),
  },
  {
    tsxFile: 'camp.tsx',
    name: 'camp',
    imageRelFromVillage: '../../../art/tilesets/tileset_camp.png',
    resPngPath: join(RES, 'art/tilesets/tileset_camp.png'),
  },
  {
    tsxFile: 'floordetail.tsx',
    name: 'floordetail',
    imageRelFromVillage: '../../../art/tilesets/TilesetFloorDetail.png',
    resPngPath: join(RES, 'art/tilesets/TilesetFloorDetail.png'),
  },
  {
    tsxFile: 'tilefloor.tsx',
    name: 'tilefloor',
    imageRelFromVillage: '../../../art/tilesets/TilesetFloor.png',
    resPngPath: join(RES, 'art/tilesets/TilesetFloor.png'),
  },
  {
    tsxFile: 'interior-floor.tsx',
    name: 'interior-floor',
    imageRelFromVillage: '../../../art/tilesets/interior/TilesetInteriorFloor.png',
    resPngPath: join(RES, 'art/tilesets/interior/TilesetInteriorFloor.png'),
  },
  {
    tsxFile: 'interior-wall.tsx',
    name: 'interior-wall',
    imageRelFromVillage: '../../../art/tilesets/interior/TilesetWallSimple.png',
    resPngPath: join(RES, 'art/tilesets/interior/TilesetWallSimple.png'),
  },
  {
    tsxFile: 'interior.tsx',
    name: 'interior',
    imageRelFromVillage: '../../../art/tilesets/interior/TilesetInterior.png',
    resPngPath: join(RES, 'art/tilesets/interior/TilesetInterior.png'),
  },
  {
    tsxFile: 'interior-elements.tsx',
    name: 'interior-elements',
    imageRelFromVillage: '../../../art/tilesets/interior/Elements.png',
    resPngPath: join(RES, 'art/tilesets/interior/Elements.png'),
  },
  {
    tsxFile: 'bed.tsx',
    name: 'bed',
    imageRelFromVillage: '../../../art/tilesets/tileset_bed.png',
    resPngPath: join(RES, 'art/tilesets/tileset_bed.png'),
  },
];

interface LoadedTileset extends TilesetEntry {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly tilecount: number;
}

function pngDimensions(path: string): { readonly width: number; readonly height: number } {
  if (!existsSync(path)) throw new Error(`missing staged tileset PNG: ${path}`);
  const buf = readFileSync(path);
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function stableUuid(path: string): string {
  const metaPath = `${path}.meta`;
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
      if (typeof parsed.uuid === 'string') return parsed.uuid;
    } catch {
      // Regenerate malformed meta UUID.
    }
  }
  return randomUUID();
}

function loadTilesetSpecs(): Map<string, LoadedTileset> {
  const out = new Map<string, LoadedTileset>();
  for (const entry of ALL_VILLAGE_TILESETS) {
    const { width, height } = pngDimensions(entry.resPngPath);
    if (width % TILE !== 0 || height % TILE !== 0) {
      throw new Error(`${entry.tsxFile}: PNG ${width}×${height} is not a multiple of ${TILE}`);
    }
    const columns = width / TILE;
    const tilecount = columns * (height / TILE);
    out.set(entry.name, { ...entry, width, height, columns, tilecount });
  }
  return out;
}

class TilesetTable {
  private readonly firstGids = new Map<string, number>();
  private readonly specs = new Map<string, LoadedTileset>();
  readonly ordered: Array<{ readonly firstgid: number; readonly spec: LoadedTileset }> = [];

  constructor(names: readonly string[], allSpecs: ReadonlyMap<string, LoadedTileset>) {
    let nextGid = 1;
    for (const name of names) {
      const spec = allSpecs.get(name);
      if (spec === undefined) throw new Error(`unknown tileset "${name}"`);
      this.firstGids.set(name, nextGid);
      this.specs.set(name, spec);
      this.ordered.push({ firstgid: nextGid, spec });
      nextGid += spec.tilecount;
    }
  }

  /** 1-based local tile id → map GID. */
  gid(name: string, localOneBased: number): number {
    const first = this.firstGids.get(name);
    const spec = this.specs.get(name);
    if (first === undefined || spec === undefined) {
      throw new Error(`tileset "${name}" is not mounted in this map`);
    }
    if (localOneBased < 1 || localOneBased > spec.tilecount) {
      throw new Error(
        `tileset "${name}" local tile ${localOneBased} out of range 1..${spec.tilecount}`,
      );
    }
    return first + localOneBased - 1;
  }

  /** Grid `(col, row)` (0-based) → map GID. */
  cell(name: string, col: number, row: number): number {
    const spec = this.specs.get(name);
    if (spec === undefined) throw new Error(`tileset "${name}" is not mounted in this map`);
    return this.gid(name, row * spec.columns + col + 1);
  }
}

class GridLayer {
  readonly cells: number[];

  constructor(
    readonly name: string,
    readonly cols: number,
    readonly rows: number,
    fill = 0,
  ) {
    this.cells = new Array<number>(cols * rows).fill(fill);
  }

  set(x: number, y: number, gid: number): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.cells[y * this.cols + x] = gid;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 0;
    return this.cells[y * this.cols + x] ?? 0;
  }

  fillRect(x0: number, y0: number, w: number, h: number, gid: number): void {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        this.set(x, y, gid);
      }
    }
  }

  stampSheetRect(
    table: TilesetTable,
    tilesetName: string,
    dstX: number,
    dstY: number,
    sheetCol: number,
    sheetRow: number,
    wTiles: number,
    hTiles: number,
  ): void {
    for (let r = 0; r < hTiles; r += 1) {
      for (let c = 0; c < wTiles; c += 1) {
        this.set(dstX + c, dstY + r, table.cell(tilesetName, sheetCol + c, sheetRow + r));
      }
    }
  }

  toXml(id: number): string {
    const rowsCsv: string[] = [];
    for (let y = 0; y < this.rows; y += 1) {
      rowsCsv.push(this.cells.slice(y * this.cols, (y + 1) * this.cols).join(','));
    }
    return [
      ` <layer id="${id}" name="${this.name}" width="${this.cols}" height="${this.rows}">`,
      '  <data encoding="csv">',
      rowsCsv.join(',\n'),
      '  </data>',
      ' </layer>',
    ].join('\n');
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlProp(name: string, value: string | number | boolean, type?: 'int' | 'float' | 'bool'): string {
  const typeAttr = type === undefined ? '' : ` type="${type}"`;
  return `    <property name="${escapeXml(name)}"${typeAttr} value="${escapeXml(String(value))}"/>`;
}

class ObjectBuilder {
  private nextId = 1;
  private readonly items: string[] = [];

  get nextObjectId(): number {
    return this.nextId;
  }

  addPoint(name: string, atTiles: Vec2, propsXml: readonly string[] = []): void {
    const id = this.nextId++;
    const xPx = Math.round(atTiles.x * TILE * 100) / 100;
    const yPx = Math.round(atTiles.y * TILE * 100) / 100;
    const body =
      propsXml.length === 0
        ? '   <point/>'
        : `   <properties>\n${propsXml.join('\n')}\n   </properties>\n   <point/>`;
    this.items.push(`  <object id="${id}" name="${escapeXml(name)}" x="${xPx}" y="${yPx}">\n${body}\n  </object>`);
  }

  addRect(
    name: string,
    xTiles: number,
    yTiles: number,
    wTiles: number,
    hTiles: number,
    propsXml: readonly string[] = [],
  ): void {
    const id = this.nextId++;
    const xPx = Math.round(xTiles * TILE * 100) / 100;
    const yPx = Math.round(yTiles * TILE * 100) / 100;
    const wPx = Math.round(wTiles * TILE * 100) / 100;
    const hPx = Math.round(hTiles * TILE * 100) / 100;
    const body =
      propsXml.length === 0
        ? ''
        : `\n   <properties>\n${propsXml.join('\n')}\n   </properties>\n  `;
    this.items.push(
      `  <object id="${id}" name="${escapeXml(name)}" x="${xPx}" y="${yPx}" width="${wPx}" height="${hPx}">${body}</object>`,
    );
  }

  playerStart(at: Vec2, facing: Direction): void {
    this.addPoint('playerStart', at, [xmlProp('facing', facing)]);
  }

  entryPoint(from: string, at: Vec2, facing: Direction): void {
    this.addPoint('entryPoint', at, [xmlProp('from', from), xmlProp('facing', facing)]);
  }

  obstacle(
    kind: Exclude<ObstacleKind, 'prop'>,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.addRect('obstacle', x, y, w, h, [xmlProp('kind', kind)]);
  }

  prop(key: string, x: number, y: number): void {
    // Tiled rect size matches 1×1 tile placeholder; `parseHubTmx` derives actual sprite & collider from `PROP_CATALOGUE`.
    this.addRect('prop', x, y, 1, 1, [xmlProp('key', key)]);
  }

  triggerRect(
    id: HubTriggerId,
    x: number,
    y: number,
    w: number,
    h: number,
    promptKey: HubPromptKey,
    interactRadius = 2.0,
    autoEnterOnStep = true,
  ): void {
    this.addRect('trigger', x, y, w, h, [
      xmlProp('id', id),
      xmlProp('promptKey', promptKey),
      xmlProp('interactRadius', interactRadius, 'float'),
      xmlProp('autoEnterOnStep', autoEnterOnStep, 'bool'),
    ]);
  }

  npc(
    id: HubNpcId,
    role: HubNpcRole,
    at: Vec2,
    facing: Direction,
    promptKey: HubPromptKey,
    interactRadius = 2.0,
  ): void {
    this.addPoint('npc', at, [
      xmlProp('id', id),
      xmlProp('role', role),
      xmlProp('facing', facing),
      xmlProp('promptKey', promptKey),
      xmlProp('interactRadius', interactRadius, 'float'),
    ]);
  }

  waypoint(npcId: HubVillagerId, order: number, at: Vec2, pauseMs = 1800): void {
    this.addPoint('waypoint', at, [
      xmlProp('npcId', npcId),
      xmlProp('order', order, 'int'),
      xmlProp('pauseMs', pauseMs, 'int'),
    ]);
  }

  animal(id: string, sprite: HubAnimalSprite, at: Vec2): void {
    this.addPoint('animal', at, [xmlProp('id', id), xmlProp('sprite', sprite)]);
  }

  decor(sprite: string, at: Vec2): void {
    this.addPoint('decor', at, [xmlProp('sprite', sprite)]);
  }

  toXml(layerId: number): string {
    return [` <objectgroup id="${layerId}" name="objects">`, ...this.items, ' </objectgroup>'].join(
      '\n',
    );
  }
}

function assembleTmx(
  hubLocation: 'village' | 'shop-interior',
  cols: number,
  rows: number,
  table: TilesetTable,
  layers: readonly GridLayer[],
  objects: ObjectBuilder,
): string {
  const tilesetsXml = table.ordered
    .map(({ firstgid, spec }) => ` <tileset firstgid="${firstgid}" source="${spec.tsxFile}"/>`)
    .join('\n');
  const layersXml = layers.map((layer, index) => layer.toXml(index + 1)).join('\n');
  const objectGroupId = layers.length + 1;
  const nextLayerId = objectGroupId + 1;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.11.0" orientation="orthogonal" renderorder="right-down" ` +
      `width="${cols}" height="${rows}" tilewidth="${TILE}" tileheight="${TILE}" infinite="0" ` +
      `nextlayerid="${nextLayerId}" nextobjectid="${objects.nextObjectId}">`,
    ' <properties>',
    xmlProp('hubLocation', hubLocation),
    ' </properties>',
    tilesetsXml,
    layersXml,
    objects.toXml(objectGroupId),
    '</map>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 1. Build `village-hub.tmx` (36×24)
// ---------------------------------------------------------------------------

function buildVillageHubXml(allSpecs: ReadonlyMap<string, LoadedTileset>): string {
  const COLS = 36;
  const ROWS = 24;
  const table = new TilesetTable(
    ['field', 'nature', 'element', 'house', 'camp', 'floordetail', 'tilefloor'],
    allSpecs,
  );

  const grassBase = table.gid('tilefloor', 276);
  const grassVariants = [276, 277, 278, 279, 280].map((id) => table.gid('tilefloor', id));

  const floor = new GridLayer('floor', COLS, ROWS, grassBase);
  const ground = new GridLayer('ground', COLS, ROWS, 0);
  const path = new GridLayer('path', COLS, ROWS, 0);
  const decor = new GridLayer('decor', COLS, ROWS, 0);
  const borderBack = new GridLayer('border-back', COLS, ROWS, 0);
  const borderMid = new GridLayer('border-mid', COLS, ROWS, 0);
  const borderFront = new GridLayer('border-front', COLS, ROWS, 0);

  // Subtle deterministic grass texture outside paved roads.
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const hash = ((x * 73 + y * 137 + 19) >>> 0) % 17;
      if (hash < 4) {
        floor.set(x, y, grassVariants[(hash + 1) % grassVariants.length]!);
      }
    }
  }

  // Carve boolean patch mask for the Central Square, North Gate Avenue, West Shop Street, & East Dojo Courtyard.
  const roadCells = new Array<boolean>(COLS * ROWS).fill(false);
  const fillRoad = (x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) {
          roadCells[y * COLS + x] = true;
        }
      }
    }
  };

  // Central Stone Square (`x = 13..22, y = 9..16`)
  fillRoad(13, 9, 10, 8);
  // North Expedition Torii Avenue (`x = 16..19, y = 2..9`)
  fillRoad(16, 2, 4, 8);
  // West Shop Street (`x = 6..13, y = 11..14`)
  fillRoad(6, 11, 8, 4);
  // East Dojo Street & Open Courtyard (`x = 22..32, y = 10..15`)
  fillRoad(22, 10, 10, 6);

  const patchMask: PatchMask = normalizePatchMask({ cols: COLS, rows: ROWS, cells: roadCells });
  const roadTerrainTiles = floorBlockTiles(11, 7); // Warm packed village road over `276` grass.

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const blob = pickBlobTile(patchMask, x, y);
      if (blob > 0) {
        // Keep base floor underneath every patch tile strictly `grassBase` (`276`) so fringe matches!
        floor.set(x, y, grassBase);
        ground.set(x, y, table.gid('tilefloor', roadTerrainTiles[blob - 1]!));
      }
    }
  }

  // Stepping stone accents (`path` layer — only on non-patched grass transitions or inside road interior?
  // Note: `floordetail` stepping stones have transparent backgrounds, so they composite cleanly anywhere!).
  const cobbleA = table.gid('floordetail', 17);
  const cobbleB = table.gid('floordetail', 2);
  const stoneSpots: ReadonlyArray<readonly [number, number, number]> = [
    // Central Plaza ring around well & spawn
    [15, 11, cobbleA],
    [20, 13, cobbleA],
    [16, 15, cobbleB],
    [19, 15, cobbleA],
    // North Avenue stepping stones up to Torii Gate
    [17, 7, cobbleA],
    [18, 5, cobbleB],
    [17, 3, cobbleA],
    [18, 2, cobbleA],
    // West Shop doorstep
    [7, 11, cobbleA],
    [7, 12, cobbleB],
    [10, 12, cobbleA],
    // East Dojo approach & courtyard stones
    [24, 12, cobbleA],
    [27, 11, cobbleB],
    [29, 12, cobbleA],
    [30, 14, cobbleB],
  ];
  for (const [sx, sy, sgid] of stoneSpots) {
    path.set(sx, sy, sgid);
  }

  // Decor layer: grass tufts, wildflowers in meadows, Torii archway stonework, Dojo rack & dummy!
  const tuftA = table.gid('floordetail', 33);
  const tuftB = table.gid('floordetail', 35);
  const flowerDecal = table.gid('floordetail', 39);
  for (const [dx, dy, dgid] of [
    [5, 17, tuftA],
    [8, 19, flowerDecal],
    [11, 20, tuftB],
    [25, 18, tuftA],
    [28, 19, flowerDecal],
    [32, 20, tuftB],
    [5, 6, tuftA],
    [11, 5, flowerDecal],
    [23, 5, tuftB],
  ] as const) {
    decor.set(dx, dy, dgid);
  }

  // North Expedition Torii Gate stone pillars (`house` stone tower/pillar tiles at `x=15` and `x=20`, `y=1..2`)
  decor.stampSheetRect(table, 'house', 15, 1, 0, 11, 1, 2);
  decor.stampSheetRect(table, 'house', 20, 1, 2, 11, 1, 2);
  // Dojo Courtyard weapon rack (`x=25, y=8`) & wooden training dummy (`x=31, y=9`)
  decor.stampSheetRect(table, 'camp', 25, 8, 8, 0, 2, 1);
  decor.set(31, 9, table.cell('element', 0, 5));

  // Forest perimeter tree ring (`border-back` & `border-mid` & `border-front`), leaving North Gate `x=15..20, y=0..2` open.
  const inNorthGateMouth = (x: number, y: number): boolean => x >= 15 && x <= 20 && y <= 3;
  for (let x = 0; x < COLS; x += 2) {
    if (!inNorthGateMouth(x, 0) && !inNorthGateMouth(x + 1, 0)) {
      borderBack.stampSheetRect(table, 'nature', x, 0, (x % 4 === 0 ? 0 : 2), 0, 2, 2);
    }
    borderFront.stampSheetRect(table, 'nature', x, ROWS - 2, (x % 4 === 0 ? 2 : 0), 0, 2, 2);
  }
  for (let y = 2; y < ROWS - 2; y += 2) {
    borderMid.stampSheetRect(table, 'nature', 0, y, 0, 0, 2, 2);
    borderMid.stampSheetRect(table, 'nature', COLS - 2, y, 2, 0, 2, 2);
  }

  // Objects: collision, landmarks, triggers, NPCs, patrol routes, animals, animated decor!
  const objects = new ObjectBuilder();

  // Player spawn in the heart of the Central Stone Square, plus return spawn outside West Shop door.
  objects.playerStart({ x: 18, y: 13.5 }, 'down');
  objects.entryPoint('shop-interior', { x: 7, y: 13.2 }, 'down');

  // Perimeter solid `edge` walls + Torii Gate pillars.
  objects.obstacle('edge', 0, 0, 15, 2);
  objects.obstacle('edge', 21, 0, 15, 2);
  objects.obstacle('edge', 15, 0, 6, 0.8);
  objects.obstacle('pillar', 15, 1, 1, 2);
  objects.obstacle('pillar', 20, 1, 1, 2);
  objects.obstacle('edge', 0, 2, 2, 20);
  objects.obstacle('edge', 34, 2, 2, 20);
  objects.obstacle('edge', 0, 22, 36, 2);

  // Central Square landmarks: village well, smoking campfire, and 4 corner lantern/totem posts.
  objects.prop('camp-well', 16.5, 9.8);
  objects.obstacle('pillar', 20.1, 10.4, 0.8, 0.6); // Hearth base under `decor.campfire`
  objects.decor('decor.campfire', { x: 20.5, y: 10.8 });
  objects.prop('totem', 12, 8);
  objects.prop('totem', 23, 8);
  objects.prop('totem', 12, 15);
  objects.prop('totem', 23, 15);

  // West Shop Building (`house-orange` 4×3 tiles at `(5, 8)` → doorway centred at `x = 7, y = 11`).
  objects.prop('house-orange', 5, 8);
  objects.prop('camp-signpost', 9.5, 9.5);
  objects.prop('cart-loaded', 2.8, 9.0);
  objects.prop('crate', 4, 11.2);
  objects.triggerRect('shop-entrance', 6.2, 11.0, 1.6, 1.3, 'hub.prompt.enterShop', 2.0, true);

  // East Dojo Building & Courtyard (`house-red` 4×3 tiles at `(27, 6)`, weapon rack, dummy, Dojo Master).
  objects.prop('house-red', 27, 6);
  objects.obstacle('pillar', 25, 8, 2, 1); // Weapon rack collider
  objects.obstacle('pillar', 31, 9, 1, 1); // Training dummy collider
  objects.prop('fence', 26, 15.5);
  objects.decor('decor.flag-red', { x: 26.5, y: 9.2 });
  objects.decor('decor.flag-black', { x: 31.5, y: 8.2 });
  objects.npc('dojo-master', 'dojo-master', { x: 29, y: 10.8 }, 'down', 'hub.prompt.dojo', 2.0);

  // North Expedition Torii Gate banners & trigger arch (`x = 16.2..19.8, y = 1.4..3.0`).
  objects.decor('decor.flag-blue', { x: 15.5, y: 3.5 });
  objects.decor('decor.flag-green', { x: 20.5, y: 3.5 });
  objects.triggerRect(
    'expedition-gate',
    16.2,
    1.4,
    3.6,
    1.6,
    'hub.prompt.expedition',
    2.0,
    true,
  );

  // Scenic trees & meadow wildflowers away from streets.
  objects.prop('tree-pink', 3, 3);
  objects.prop('tree-green', 8, 3);
  objects.prop('tree-pine', 11, 3);
  objects.prop('tree-pink', 24, 3);
  objects.prop('tree-green', 31, 3);
  objects.prop('tree-round', 3, 17);
  objects.prop('tree-green', 31, 17);
  objects.prop('flower-sun', 8, 6);
  objects.prop('flower-clover', 23, 6);
  objects.prop('flower-yellow', 6, 18);
  objects.prop('flower-red', 9, 20);
  objects.prop('bush-light', 11, 17);
  objects.prop('flower-sun', 25, 19);
  objects.prop('flower-clover', 28, 20);
  objects.prop('bush-green', 24, 17);
  objects.decor('decor.flower', { x: 6.5, y: 19.5 });
  objects.decor('decor.plant', { x: 27.5, y: 19.5 });

  // 4 relocated living animals roaming grassy yards outside the stone plaza.
  objects.animal('village-dog', 'animal.dog', { x: 7.5, y: 18.5 });
  objects.animal('village-chicken', 'animal.chicken', { x: 10.5, y: 19.5 });
  objects.animal('village-cat', 'animal.cat', { x: 26.5, y: 18.5 });
  objects.animal('village-bird', 'animal.bird', { x: 29.5, y: 19.5 });

  // 5 wandering villagers with obstacle-free rectangular patrol loops along stone roads & yards.
  const villagerRoutes: ReadonlyArray<{
    readonly id: HubVillagerId;
    readonly facing: Direction;
    readonly points: readonly Vec2[];
    readonly pauseMs: number;
  }> = [
    {
      id: 'villager-1',
      facing: 'up',
      points: [
        { x: 18.6, y: 8.2 },
        { x: 18.6, y: 4.8 },
        { x: 17.2, y: 4.8 },
        { x: 17.2, y: 8.2 },
      ],
      pauseMs: 1800,
    },
    {
      id: 'villager-2',
      facing: 'right',
      points: [
        { x: 9.2, y: 12.6 },
        { x: 14.5, y: 12.6 },
        { x: 14.5, y: 14.0 },
        { x: 9.2, y: 14.0 },
      ],
      pauseMs: 1600,
    },
    {
      id: 'villager-3',
      facing: 'right',
      points: [
        { x: 21.5, y: 12.2 },
        { x: 26.5, y: 12.2 },
        { x: 26.5, y: 13.8 },
        { x: 21.5, y: 13.8 },
      ],
      pauseMs: 2000,
    },
    {
      id: 'villager-4',
      facing: 'left',
      points: [
        { x: 20.5, y: 15.2 },
        { x: 15.2, y: 15.2 },
        { x: 15.2, y: 16.4 },
        { x: 20.5, y: 16.4 },
      ],
      pauseMs: 1700,
    },
    {
      id: 'villager-5',
      facing: 'down',
      points: [
        { x: 14.5, y: 18.0 },
        { x: 14.5, y: 20.2 },
        { x: 17.5, y: 20.2 },
        { x: 17.5, y: 18.0 },
      ],
      pauseMs: 1900,
    },
  ];

  for (const v of villagerRoutes) {
    objects.npc(v.id, 'villager', v.points[0]!, v.facing, 'hub.prompt.talk', 2.0);
    v.points.forEach((pt, idx) => {
      objects.waypoint(v.id, idx, pt, v.pauseMs);
    });
  }

  return assembleTmx(
    'village',
    COLS,
    ROWS,
    table,
    [floor, ground, path, decor, borderBack, borderMid, borderFront],
    objects,
  );
}

// ---------------------------------------------------------------------------
// 2. Build `shop-interior.tmx` (16×12)
// ---------------------------------------------------------------------------

function buildShopInteriorXml(allSpecs: ReadonlyMap<string, LoadedTileset>): string {
  const COLS = 16;
  const ROWS = 12;
  const table = new TilesetTable(
    [
      'interior-floor',
      'interior-wall',
      'interior',
      'interior-elements',
      'bed',
      'camp',
      'element',
    ],
    allSpecs,
  );

  const darkVoid = table.gid('interior-wall', 51); // `#141b1b` solid dark frame
  const woodPlankA = table.gid('interior-floor', 288);
  const woodPlankB = table.gid('interior-floor', 289);
  const woodPlankC = table.gid('interior-floor', 310);

  const floor = new GridLayer('floor', COLS, ROWS, darkVoid);
  const walls = new GridLayer('walls', COLS, ROWS, 0);
  const rugs = new GridLayer('rugs', COLS, ROWS, 0);
  const furniture = new GridLayer('furniture', COLS, ROWS, 0);
  const decor = new GridLayer('decor', COLS, ROWS, 0);

  // Warm wooden plank floor across `x = 1..14, y = 2..10` + South doorway `x = 7..8, y = 11`.
  for (let y = 2; y <= 10; y += 1) {
    for (let x = 1; x <= 14; x += 1) {
      const plank = (x + y) % 3 === 0 ? woodPlankB : (x * 3 + y) % 5 === 0 ? woodPlankC : woodPlankA;
      floor.set(x, y, plank);
    }
  }
  floor.set(7, 11, woodPlankA);
  floor.set(8, 11, woodPlankB);

  // Timber walls: back panelling (`y = 0..1`), side walls (`x = 0`, `x = 15`), and south walls (`y = 11`).
  const wallTopCap = table.gid('interior-wall', 7);
  const wallPanelUpper = table.gid('interior-wall', 18);
  const wallPanelLower = table.gid('interior-wall', 28);
  const wallSide = table.gid('interior-wall', 47);

  for (let x = 1; x <= 14; x += 1) {
    walls.set(x, 0, wallPanelUpper);
    walls.set(x, 1, wallPanelLower);
  }
  for (let y = 0; y < ROWS; y += 1) {
    walls.set(0, y, wallSide);
    walls.set(15, y, wallSide);
  }
  for (let x = 1; x <= 6; x += 1) walls.set(x, 11, wallTopCap);
  for (let x = 9; x <= 14; x += 1) walls.set(x, 11, wallTopCap);

  // Crimson & gold merchant welcome rug (`x = 6..9, y = 6..8`, `bed` rows 3..5 cols 3..5)
  rugs.set(6, 6, table.cell('bed', 3, 3));
  rugs.set(7, 6, table.cell('bed', 4, 3));
  rugs.set(8, 6, table.cell('bed', 4, 3));
  rugs.set(9, 6, table.cell('bed', 5, 3));
  rugs.set(6, 7, table.cell('bed', 3, 4));
  rugs.set(7, 7, table.cell('bed', 4, 4));
  rugs.set(8, 7, table.cell('bed', 4, 4));
  rugs.set(9, 7, table.cell('bed', 5, 4));
  rugs.set(6, 8, table.cell('bed', 3, 5));
  rugs.set(7, 8, table.cell('bed', 4, 5));
  rugs.set(8, 8, table.cell('bed', 4, 5));
  rugs.set(9, 8, table.cell('bed', 5, 5));

  // South exit rug (`x = 7..8, y = 10..11`)
  rugs.set(7, 10, table.cell('bed', 3, 3));
  rugs.set(8, 10, table.cell('bed', 5, 3));
  rugs.set(7, 11, table.cell('bed', 3, 5));
  rugs.set(8, 11, table.cell('bed', 5, 5));

  // Back wall weapon & potion shelves (`x = 2..4, y = 2` and `x = 11..13, y = 2`)
  furniture.stampSheetRect(table, 'bed', 2, 1, 7, 6, 3, 2);
  furniture.stampSheetRect(table, 'bed', 11, 1, 10, 6, 3, 2);

  // Wooden Shop Counter (`x = 5..10, y = 4`)
  furniture.set(5, 4, table.cell('camp', 8, 4));
  for (let x = 6; x <= 9; x += 1) {
    furniture.set(x, 4, table.cell('bed', 3, 1));
  }
  furniture.set(10, 4, table.cell('camp', 9, 4));

  // Left weapon display rack/crates (`x = 2..3, y = 6..7`) & Right potion display table (`x = 12..13, y = 6..7`)
  furniture.stampSheetRect(table, 'element', 2, 6, 4, 3, 2, 2);
  furniture.stampSheetRect(table, 'camp', 12, 6, 8, 4, 2, 1);
  furniture.set(12, 7, table.cell('element', 7, 0));
  furniture.set(13, 7, table.cell('element', 8, 0));

  // Potion bottles, scrolls, and warm lanterns on counter & shelves (`decor` layer)
  decor.set(6, 4, table.cell('interior-elements', 3, 0));
  decor.set(9, 4, table.cell('interior-elements', 7, 0));
  decor.set(3, 2, table.cell('interior-elements', 3, 1));
  decor.set(12, 2, table.cell('interior-elements', 4, 1));
  decor.set(1, 2, table.cell('interior-elements', 0, 0));
  decor.set(14, 2, table.cell('interior-elements', 1, 0));

  // Objects: solid wall & furniture colliders, Shopkeeper behind counter, entry start, and South exit rug!
  const objects = new ObjectBuilder();

  objects.playerStart({ x: 8, y: 9.2 }, 'up');

  // Solid perimeter walls (with South doorway open at `x = 7..9, y = 11..11.8`).
  objects.obstacle('wall', 0, 0, 16, 2);
  objects.obstacle('wall', 0, 2, 1, 10);
  objects.obstacle('wall', 15, 2, 1, 10);
  objects.obstacle('wall', 1, 11, 6, 1);
  objects.obstacle('wall', 9, 11, 6, 1);
  objects.obstacle('edge', 7, 11.8, 2, 0.2);

  // Solid shop furniture matching every drawn shelf, counter, and display table.
  objects.obstacle('pillar', 2, 2, 3, 1);
  objects.obstacle('pillar', 11, 2, 3, 1);
  objects.obstacle('pillar', 5, 4, 6, 0.85);
  objects.obstacle('pillar', 2, 6, 2, 2);
  objects.obstacle('pillar', 12, 6, 2, 2);

  // Shopkeeper behind counter at `(8.0, 3.45)` (distance from front of counter `(8.0, 5.25)` = `1.8` tiles <= `2.0`).
  objects.npc('shopkeeper', 'shopkeeper', { x: 8, y: 3.45 }, 'down', 'hub.prompt.talk', 2.0);

  // South exit rug trigger (`x = 6.8..9.2, y = 10.5..11.8`).
  objects.triggerRect('shop-exit', 6.8, 10.5, 2.4, 1.3, 'hub.prompt.exitShop', 2.0, true);

  return assembleTmx('shop-interior', COLS, ROWS, table, [floor, walls, rugs, furniture, decor], objects);
}

// ---------------------------------------------------------------------------
// Validation: BFS traversability + zero obstacle overlaps
// ---------------------------------------------------------------------------

function verifyClearOfObstacles(map: HubMapData, point: Vec2, radius: number, label: string): void {
  for (const obs of map.obstacles) {
    if (circleOverlapsObstacle(point, radius, obs)) {
      throw new Error(
        `${map.id}: ${label} at (${point.x}, ${point.y}) overlaps ${obs.kind} obstacle (${obs.x},${obs.y},${obs.width}×${obs.height})`,
      );
    }
  }
}

/** 0.5-tile resolution BFS reachability for a player circle of `radiusTiles`. */
function reachableCells(map: HubMapData, start: Vec2, radiusTiles = 0.35): Set<string> {
  const step = 0.5;
  const gridCols = Math.round(map.size.cols / step);
  const gridRows = Math.round(map.size.rows / step);

  const isFree = (gx: number, gy: number): boolean => {
    if (gx <= 0 || gy <= 0 || gx >= gridCols || gy >= gridRows) return false;
    const pt = { x: gx * step, y: gy * step };
    return map.obstacles.every((obs) => !circleOverlapsObstacle(pt, radiusTiles, obs));
  };

  const sx = Math.round(start.x / step);
  const sy = Math.round(start.y / step);
  if (!isFree(sx, sy)) {
    throw new Error(`${map.id}: BFS start (${start.x}, ${start.y}) is blocked`);
  }

  const visited = new Set<string>();
  const keyOf = (gx: number, gy: number): string => `${gx},${gy}`;
  const queue: Array<[number, number]> = [[sx, sy]];
  visited.add(keyOf(sx, sy));

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
      const k = keyOf(nx, ny);
      if (visited.has(k) || !isFree(nx, ny)) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

function canReachWithin(
  visited: ReadonlySet<string>,
  target: Vec2,
  maxDistanceTiles: number,
): boolean {
  const step = 0.5;
  for (const cell of visited) {
    const [gxStr, gyStr] = cell.split(',');
    const px = Number(gxStr) * step;
    const py = Number(gyStr) * step;
    if (Math.hypot(px - target.x, py - target.y) <= maxDistanceTiles) {
      return true;
    }
  }
  return false;
}

function validateVillageMap(xml: string): HubMapData {
  const map = parseHubTmx(xml, { source: 'village-hub.tmx' });
  const chunks = splitTmxLayers(xml);
  if (chunks.length !== 4) {
    throw new Error(`village-hub.tmx expected 4 screen chunks, got ${chunks.length}`);
  }

  verifyClearOfObstacles(map, map.playerStart, 0.4, 'playerStart');
  for (const ep of Object.values(map.entryPoints)) {
    verifyClearOfObstacles(map, ep.at, 0.4, `entryPoint(${ep.from})`);
  }
  for (const npc of map.npcs) {
    verifyClearOfObstacles(map, npc.at, 0.35, `npc(${npc.id})`);
  }
  for (const animal of map.animals) {
    verifyClearOfObstacles(map, animal.at, 0.35, `animal(${animal.id})`);
  }
  for (const [npcId, route] of Object.entries(map.patrolRoutes)) {
    route.forEach((wp, index) => {
      const next = route[(index + 1) % route.length]!;
      for (let s = 0; s <= 16; s += 1) {
        const t = s / 16;
        const pt = { x: wp.at.x + (next.at.x - wp.at.x) * t, y: wp.at.y + (next.at.y - wp.at.y) * t };
        verifyClearOfObstacles(map, pt, 0.32, `patrol(${npcId} ${index}->${(index + 1) % route.length})`);
      }
    });
  }

  const visited = reachableCells(map, map.playerStart, 0.35);
  const shopDoor = map.triggers.find((t) => t.id === 'shop-entrance');
  const northGate = map.triggers.find((t) => t.id === 'expedition-gate');
  const dojoMaster = map.npcs.find((n) => n.id === 'dojo-master');
  if (!shopDoor || !canReachWithin(visited, shopDoor.at, 0.5)) {
    throw new Error('village-hub.tmx: Shop doorway is not reachable from playerStart');
  }
  if (!northGate || !canReachWithin(visited, northGate.at, 0.5)) {
    throw new Error('village-hub.tmx: Expedition Gate is not reachable from playerStart');
  }
  if (!dojoMaster || !canReachWithin(visited, dojoMaster.at, 1.8)) {
    throw new Error('village-hub.tmx: Dojo Master is not reachable within interaction range');
  }

  return map;
}

function validateShopInteriorMap(xml: string): HubMapData {
  const map = parseHubTmx(xml, { source: 'shop-interior.tmx' });
  const chunks = splitTmxLayers(xml);
  if (chunks.length !== 1) {
    throw new Error(`shop-interior.tmx expected 1 chunk, got ${chunks.length}`);
  }

  verifyClearOfObstacles(map, map.playerStart, 0.35, 'playerStart');
  for (const npc of map.npcs) {
    verifyClearOfObstacles(map, npc.at, 0.3, `npc(${npc.id})`);
  }

  const visited = reachableCells(map, map.playerStart, 0.35);
  const shopkeeper = map.npcs.find((n) => n.id === 'shopkeeper');
  const shopExit = map.triggers.find((t) => t.id === 'shop-exit');
  if (!shopkeeper || !canReachWithin(visited, shopkeeper.at, 1.9)) {
    throw new Error('shop-interior.tmx: Shopkeeper is not reachable within 2.0-tile talk range across counter');
  }
  if (!shopExit || !canReachWithin(visited, shopExit.at, 0.5)) {
    throw new Error('shop-interior.tmx: South exit rug is not reachable from entry');
  }

  return map;
}

function writeTsxFiles(allSpecs: ReadonlyMap<string, LoadedTileset>): void {
  for (const spec of allSpecs.values()) {
    const outPath = join(VILLAGE_DIR, spec.tsxFile);
    const tsxXml = buildTsx({
      name: spec.name,
      image: spec.imageRelFromVillage,
      tileWidth: TILE,
      tileHeight: TILE,
      columns: spec.columns,
      tilecount: spec.tilecount,
      imageWidth: spec.width,
      imageHeight: spec.height,
    });
    writeFileSync(outPath, tsxXml);
    writeMeta(outPath, {
      ver: '1.0.1',
      importer: 'text',
      imported: true,
      uuid: stableUuid(outPath),
      files: ['.json'],
      subMetas: {},
      userData: {},
    });
  }
}

function main(): void {
  const allSpecs = loadTilesetSpecs();
  const villageXml = buildVillageHubXml(allSpecs);
  const shopXml = buildShopInteriorXml(allSpecs);

  const villageMap = validateVillageMap(villageXml);
  const shopMap = validateShopInteriorMap(shopXml);

  const villageOut = join(VILLAGE_DIR, 'village-hub.tmx');
  const shopOut = join(VILLAGE_DIR, 'shop-interior.tmx');

  // `writeRoomFile` ensures directory `.meta`s under `assets/resources/` first.
  writeRoomFile(villageOut, villageXml);
  writeRoomFile(shopOut, shopXml);
  writeTsxFiles(allSpecs);

  console.log(
    `map   ${projectRelative(villageOut)} (${villageMap.size.cols}×${villageMap.size.rows}, ` +
      `${villageMap.obstacles.length} obstacles, ${villageMap.props.length} props, ` +
      `${villageMap.npcs.length} NPCs, ${villageMap.animals.length} animals)`,
  );
  console.log(
    `map   ${projectRelative(shopOut)} (${shopMap.size.cols}×${shopMap.size.rows}, ` +
      `${shopMap.obstacles.length} obstacles, ${shopMap.npcs.length} NPCs, ${shopMap.triggers.length} triggers)`,
  );
}

main();

/**
 * Trang trí 27 phòng bằng tileset có thật trong pack (GDD §8): ch1
 * Nature/Relief/Element/Field, ch2 Water + thác + bờ Nature, ch3
 * VillageAbandoned/House/Towers/Hole.
 *
 * Nguyên tắc chống mâu thuẫn va chạm:
 * - Ô **đi được** (hàng 1..16, cột 1..30) chỉ nhận tile phẳng: cỏ, hoa, đất, sỏi,
 *   mặt nước nông. Không đặt mái nhà/thân cây ở đó.
 * - Hàng/cột sát mép (0/31, 0/17) **không đi được** vì player/enemy clamp ở
 *   `ROOM_EDGE_MARGIN_TILES = 1`, nên được dùng cho props đặc (mái nhà, tháp, mỏm đá)
 *   mà không cần thêm obstacle — không đổi gameplay.
 * - Nước ở ch2 là sông nông (đi qua được), không phải hố; vì vậy nó ở lớp decor,
 *   không phải obstacle.
 *
 * Chạy: `bun run scripts/dress-rooms.ts`. Idempotent: chạy lại cho cùng kết quả.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { WaterArea } from '../assets/scripts/core/level/water-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const LEVELS = join(PROJECT, 'assets', 'resources', 'data', 'levels');
const RES_ART = join(PROJECT, 'assets', 'resources', 'art', 'tilesets');

const COLS = 32;
const ROWS = 18;

interface TilesetDef {
  readonly source: string;
  readonly name: string;
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly count: number;
}

const TS = {
  field: { source: 'field.tsx', name: 'field', image: 'TilesetField.png', width: 80, height: 240, columns: 5, count: 75 },
  nature: { source: 'nature.tsx', name: 'nature', image: 'TilesetNature.png', width: 384, height: 336, columns: 24, count: 504 },
  relief: { source: 'relief.tsx', name: 'relief', image: 'TilesetRelief.png', width: 320, height: 192, columns: 20, count: 240 },
  element: { source: 'element.tsx', name: 'element', image: 'TilesetElement.png', width: 256, height: 240, columns: 16, count: 240 },
  water: { source: 'water.tsx', name: 'water', image: 'TilesetWater.png', width: 448, height: 272, columns: 28, count: 476 },
  ground: { source: 'ground.tsx', name: 'ground', image: 'TilesetDesert.png', width: 320, height: 192, columns: 20, count: 240 },
  village: { source: 'village.tsx', name: 'village', image: 'TilesetVillageAbandoned.png', width: 320, height: 192, columns: 20, count: 240 },
  house: { source: 'house.tsx', name: 'house', image: 'TilesetHouse.png', width: 528, height: 368, columns: 33, count: 759 },
  towers: { source: 'towers.tsx', name: 'towers', image: 'TilesetTowers.png', width: 384, height: 96, columns: 24, count: 144 },
  hole: { source: 'hole.tsx', name: 'hole', image: 'TilesetHole.png', width: 176, height: 80, columns: 11, count: 55 },
} as const satisfies Record<string, TilesetDef>;

const CHAPTER_SETS: Readonly<Record<number, readonly TilesetDef[]>> = {
  1: [TS.field, TS.nature, TS.relief, TS.element],
  2: [TS.field, TS.water, TS.nature],
  3: [TS.ground, TS.village, TS.house, TS.towers, TS.hole],
};

/** firstgid của từng tileset theo thứ tự trong chapter. */
const FIRST_GID: Readonly<Record<string, number>> = (() => {
  const map: Record<string, number> = {};
  for (const set of Object.values(CHAPTER_SETS)) {
    let next = 1;
    for (const entry of set) {
      map[`${set.indexOf(entry)}:${entry.name}`] = next;
      next += entry.count;
    }
  }
  return map;
})();

function firstGid(chapter: number, name: string): number {
  const set = CHAPTER_SETS[chapter] ?? [];
  const index = set.findIndex((entry) => entry.name === name);
  if (index < 0) throw new Error(`chapter ${chapter} không có tileset ${name}`);
  return (FIRST_GID[`${index}:${name}`] ?? 1) + 0;
}

/** gid toàn cục của tile local 1-based trong tileset. */
function gid(chapter: number, name: string, local: number): number {
  return firstGid(chapter, name) + local - 1;
}

/** PRNG nhỏ, seed theo chapter+room để chạy lại ra cùng map. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Reserved {
  readonly cells: Set<string>;
  /** Ô playerStart — nước không được đặt ngay dưới chân player lúc vào phòng. */
  readonly playerStart: string | null;
}


function key(x: number, y: number): string {
  return `${x},${y}`;
}

function reserve(cells: Set<string>, x: number, y: number, radius = 0): void {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) cells.add(key(nx, ny));
    }
  }
}

function parseReserved(xml: string): Reserved {
  const cells = new Set<string>();
  let playerStart: string | null = null;

  for (const match of xml.matchAll(/<object[^>]*name="obstacle"[^>]*>/g)) {
    const tag = match[0];
    const x = Number(/\bx="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const y = Number(/\by="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const width = Number(/\bwidth="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const height = Number(/\bheight="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    for (let ty = y; ty < y + height; ty += 1) {
      for (let tx = x; tx < x + width; tx += 1) cells.add(key(tx, ty));
    }
  }

  for (const match of xml.matchAll(/<object[^>]*name="(playerStart|spawn|door|bossStart)"[^>]*>/g)) {
    const tag = match[0];
    const name = match[1];
    const x = Math.floor(Number(/\bx="(\d+)"/.exec(tag)?.[1] ?? 0) / 16);
    const y = Math.floor(Number(/\by="(\d+)"/.exec(tag)?.[1] ?? 0) / 16);
    if (name === 'playerStart') playerStart = key(x, y);
    reserve(cells, x, y, 1);
  }

  return { cells, playerStart };
}

function setTile(data: number[], x: number, y: number, value: number): void {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  data[y * COLS + x] = value;
}

function canPlace(reserved: Reserved, x: number, y: number): boolean {
  if (x < 1 || x >= COLS - 1 || y < 1 || y >= ROWS - 1) return false;
  return !reserved.cells.has(key(x, y));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const value = items[Math.floor(rng() * items.length)];
  if (value === undefined) throw new Error('pick: mảng rỗng');
  return value;
}

// ---------------------------------------------------------------------------
// Ch1 — cỏ, hoa, sỏi; mỏm đá Relief và barrel Element ở mép không đi được
// ---------------------------------------------------------------------------

function dressChapterOne(chapter: number, room: number, reserved: Reserved, rng: () => number): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const grass = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254];
  const flowers = [265, 266, 267, 268, 269, 270, 271, 272, 277, 278, 301, 302, 337, 338];
  const pebbles = [321, 322, 323, 324, 329, 330, 331, 332];

  for (let cluster = 0; cluster < 10; cluster += 1) {
    const x = 1 + Math.floor(rng() * (COLS - 2));
    const y = 1 + Math.floor(rng() * (ROWS - 2));
    if (!canPlace(reserved, x, y)) continue;
    const size = 1 + Math.floor(rng() * 3);
    for (let step = 0; step < size; step += 1) {
      const tx = x + Math.floor(rng() * 3) - 1;
      const ty = y + Math.floor(rng() * 3) - 1;
      if (!canPlace(reserved, tx, ty)) continue;
      const roll = rng();
      const list = roll < 0.55 ? grass : roll < 0.85 ? flowers : pebbles;
      setTile(data, tx, ty, gid(chapter, 'nature', pick(rng, list)));
    }
  }

  // Hàng 0 để trống: props ở đó bị HUD cắt ngang, đọc thành mảnh vụn. Chỉ giữ
  // cỏ/hoa thấp ở các mép còn lại (không chạm HUD).

  // Mép dưới/trái/phải: cỏ và hoa thấp.
  for (let x = 2; x < COLS - 2; x += 3) {
    setTile(data, x, ROWS - 1, gid(chapter, 'nature', pick(rng, grass)));
  }
  for (let y = 2; y < ROWS - 2; y += 4) {
    setTile(data, 0, y, gid(chapter, 'nature', pick(rng, grass)));
    setTile(data, COLS - 1, y, gid(chapter, 'nature', pick(rng, flowers)));
  }

  void room;
  return data;
}

// ---------------------------------------------------------------------------
// Ch2 — sông nông, thác, bờ cỏ
// ---------------------------------------------------------------------------

/** Khối pond 4×3 hoàn chỉnh trong TilesetWater (có bờ sẵn). */

function dressChapterTwo(
  chapter: number,
  room: number,
  reserved: Reserved,
  rng: () => number,
): { data: number[]; water: WaterArea[] } {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const bankGrass = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254];
  const water: WaterArea[] = [];

  // Sông 2 ô cao (nước động vẽ bằng RoomWater, không phải tile mosaic của Water sheet).
  const riverWidth = 12 + Math.floor(rng() * 7);
  const riverX = 1 + Math.floor(rng() * (COLS - riverWidth - 2));
  const riverY = 6 + Math.floor(rng() * 5);
  const coversPlayer =
    reserved.playerStart !== null &&
    (() => {
      const [px, py] = reserved.playerStart.split(',').map(Number);
      return (
        px! >= riverX - 1 &&
        px! < riverX + riverWidth + 1 &&
        py! >= riverY - 1 &&
        py! < riverY + 3
      );
    })();
  if (!coversPlayer) {
    water.push({ kind: 'river', x: riverX, y: riverY, width: riverWidth, height: 2 });
  }

  // Thác 2 cột chảy từ mép trên xuống đúng hàng sông (nối liền, không lơ lửng).
  if (room % 2 === 1 || room === 9) {
    const fallX = Math.min(
      riverX + 2 + Math.floor(rng() * Math.max(1, riverWidth - 6)),
      COLS - 3,
    );
    if (
      !reserved.cells.has(key(fallX, 1)) &&
      !reserved.cells.has(key(fallX + 1, 1))
    ) {
      water.push({ kind: 'waterfall', x: fallX, y: 0, width: 2, height: Math.max(4, riverY) });
    }
  }

  // Bờ cỏ hai bên sông + hai đầu (chỉ nơi không có spawn/obstacle).
  if (riverY >= 1) {
    for (let dx = 0; dx < riverWidth; dx += 1) {
      for (const by of [riverY - 1, riverY + 2]) {
        if (canPlace(reserved, riverX + dx, by) && rng() < 0.55) {
          setTile(data, riverX + dx, by, gid(chapter, 'nature', pick(rng, bankGrass)));
        }
      }
    }
    for (const bx of [riverX - 1, riverX + riverWidth]) {
      for (const by of [riverY, riverY + 1]) {
        if (canPlace(reserved, bx, by)) {
          setTile(data, bx, by, gid(chapter, 'nature', pick(rng, bankGrass)));
        }
      }
    }
  }

  // Cỏ/hoa dọc mép dưới và hai bên.
  for (let x = 2; x < COLS - 2; x += 2) {
    if (rng() < 0.7) setTile(data, x, ROWS - 1, gid(chapter, 'nature', pick(rng, bankGrass)));
  }
  for (let y = 2; y < ROWS - 2; y += 3) {
    if (rng() < 0.6) setTile(data, 0, y, gid(chapter, 'nature', pick(rng, bankGrass)));
    if (rng() < 0.6) setTile(data, COLS - 1, y, gid(chapter, 'nature', pick(rng, bankGrass)));
  }

  // Cỏ/reeds + hoa ven sông, tránh đè lên vùng nước.
  const inWater = (x: number, y: number): boolean =>
    water.some(
      (area) =>
        x >= area.x - 1 &&
        x < area.x + area.width + 1 &&
        y >= area.y - 1 &&
        y < area.y + area.height + 1,
    );

  for (let cluster = 0; cluster < 14; cluster += 1) {
    const x = 1 + Math.floor(rng() * (COLS - 2));
    const y = 1 + Math.floor(rng() * (ROWS - 2));
    if (!canPlace(reserved, x, y) || inWater(x, y)) continue;
    const size = 1 + Math.floor(rng() * 3);
    for (let step = 0; step < size; step += 1) {
      const tx = x + Math.floor(rng() * 3) - 1;
      const ty = y + Math.floor(rng() * 3) - 1;
      if (!canPlace(reserved, tx, ty) || inWater(tx, ty)) continue;
      setTile(
        data,
        tx,
        ty,
        gid(
          chapter,
          'nature',
          pick(rng, [...bankGrass, 265, 266, 267, 268, 301, 302, 337, 338]),
        ),
      );
    }
  }

  return { data, water };
}

// ---------------------------------------------------------------------------
// Ch3 — đất làng, gạch vụn, mái nhà/tháp ở mép trên
// ---------------------------------------------------------------------------

function dressChapterThree(
  chapter: number,
  room: number,
  reserved: Reserved,
  rng: () => number,
): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  // Nội ô chỉ nhận props **phẳng** của Desert (bụi khô, xương/sỏi): VillageAbandoned
  // toàn mảnh autotile có góc trong suốt, đặt lẻ giữa sân đọc thành giấy rách.
  const props = [189, 237, 238, 239, 240];

  for (let cluster = 0; cluster < 20; cluster += 1) {
    const x = 1 + Math.floor(rng() * (COLS - 2));
    const y = 1 + Math.floor(rng() * (ROWS - 2));
    if (!canPlace(reserved, x, y)) continue;
    setTile(data, x, y, gid(chapter, 'ground', pick(rng, props)));
  }

  // Không đặt props ở hàng 0/17: HUD/letterbox cắt ngang, các mảnh mái/rào
  // nửa vời đọc thành rác. Chỉ giữ props hoàn chỉnh trong sân.

  return data;
}

// ---------------------------------------------------------------------------
// Ghi TMX
// ---------------------------------------------------------------------------

function tilesetXml(chapter: number): string {
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) throw new Error(`chapter ${chapter} chưa có tileset`);
  let next = 1;
  const lines: string[] = [];
  for (const entry of set) {
    lines.push(` <tileset firstgid="${next}" source="${entry.source}"/>`);
    next += entry.count;
  }
  return lines.join('\n');
}

function csv(data: readonly number[]): string {
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    rows.push(data.slice(y * COLS, (y + 1) * COLS).join(','));
  }
  return rows.join(',\n');
}

/** Nền đồng nhất theo chapter: xanh rêu (field) / cát làng (desert). */
const FLOOR_GID: Readonly<Record<number, number>> = { 1: 37, 2: 37, 3: 176 };

function setFloor(xml: string, chapter: number): string {
  const base = FLOOR_GID[chapter];
  if (base === undefined) return xml;
  const floor = new Array<number>(COLS * ROWS).fill(base);
  return xml.replace(
    /(<layer[^>]*name="floor"[\s\S]*?<data encoding="csv">)([\s\S]*?)(<\/data>)/,
    (_match, before: string, _old: string, after: string) =>
      `${before}\n${csv(floor)}\n  ${after}`,
  );
}

function maxLayerId(xml: string): number {
  let max = 0;
  for (const match of xml.matchAll(/<(?:layer|objectgroup)[^>]*\bid="(\d+)"/g)) {
    max = Math.max(max, Number(match[1] ?? 0));
  }
  return max;
}


function ensureTsx(chapterDir: string, def: TilesetDef): void {
  const path = join(chapterDir, def.source);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.11.0" name="${def.name}" tilewidth="16" tileheight="16" tilecount="${def.count}" columns="${def.columns}">\n <image source="../../../art/tilesets/${def.image}" width="${def.width}" height="${def.height}"/>\n</tileset>\n`;
  writeFileSync(path, xml);
  const meta = `${path}.meta`;
  if (!existsSync(meta)) {
    writeFileSync(
      meta,
      `${JSON.stringify(
        {
          ver: '1.0.1',
          importer: 'text',
          imported: true,
          uuid: randomUUID(),
          files: ['.json'],
          subMetas: {},
          userData: {},
        },
        null,
        2,
      )}\n`,
    );
  }
}

function dressFile(path: string, chapter: number, room: number): WaterArea[] {
  const raw = readFileSync(path, 'utf8');
  // Dọn obstacle `kind=solid` từ vòng thử trước (đã bỏ: không đổi collision).
  const original = raw.replace(/ ?<object[^>]*name="obstacle"[\s\S]*?<\/object>\n?/g, (block) =>
    block.includes('value="solid"') ? '' : block,
  );
  const reserved = parseReserved(original);
  const rng = mulberry32(chapter * 100_003 + room * 977);

  const result =
    chapter === 1
      ? { data: dressChapterOne(chapter, room, reserved, rng), water: [] as WaterArea[] }
      : chapter === 2
        ? dressChapterTwo(chapter, room, reserved, rng)
        : { data: dressChapterThree(chapter, room, reserved, rng), water: [] as WaterArea[] };
  const decor = result.data;

  // Bỏ tileset + decor cũ; giữ floor/objectgroup.
  const withoutTilesets = original.replace(/^ <tileset[^\n]*\/>\n?/gm, '');
  const withoutDecor = withoutTilesets.replace(
    / ?<layer[^>]*name="decor"[\s\S]*?<\/layer>\n?/g,
    '',
  );

  const layerId = maxLayerId(withoutDecor) + 1;
  const decorLayer = ` <layer id="${layerId}" name="decor" width="${COLS}" height="${ROWS}">\n  <data encoding="csv">\n${csv(decor)}\n  </data>\n </layer>\n`;
  const tilesets = `${tilesetXml(chapter)}\n`;

  let next = setFloor(withoutDecor, chapter).replace(/<map([^>]*)>/, (_match, attributes: string) =>
    `<map${attributes.replace(/nextlayerid="\d+"/, `nextlayerid="${layerId + 1}"`)}>`,
  );

  // Chèn tilesets ngay sau </properties> (hoặc sau thẻ <map ...> nếu không có).
  if (next.includes('</properties>')) {
    next = next.replace('</properties>\n', `</properties>\n${tilesets}`);
  } else {
    next = next.replace(/<map[^>]*>\n/, (match) => `${match}${tilesets}`);
  }

  // Decor sau tile layer cuối, trước objectgroup.
  const objectIndex = next.indexOf(' <objectgroup');
  if (objectIndex < 0) throw new Error(`${path}: không có objectgroup`);
  next = `${next.slice(0, objectIndex)}${decorLayer}${next.slice(objectIndex)}`;

  writeFileSync(path, next);
  return result.water;
}

const waterRooms: Record<string, Record<string, WaterArea[]>> = {};

for (const chapterName of readdirSync(LEVELS)) {
  if (!chapterName.startsWith('chapter-')) continue;
  const chapter = Number(chapterName.replace('chapter-', ''));
  const dir = join(LEVELS, chapterName);
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) continue;
  for (const def of set) ensureTsx(dir, def);

  const byRoom: Record<string, WaterArea[]> = {};
  for (const file of readdirSync(dir)) {
    const match = /^room-(\d+)\.tmx$/.exec(file);
    if (match === null) continue;
    const room = Number(match[1]);
    const water = dressFile(join(dir, file), chapter, room);
    if (water.length > 0) byRoom[String(room)] = water;
  }
  if (Object.keys(byRoom).length > 0) waterRooms[String(chapter)] = byRoom;
  console.log(`chapter ${chapter}: dressed ${readdirSync(dir).filter((f) => f.endsWith('.tmx')).length} rooms`);
}

const waterPath = join(PROJECT, 'assets', 'resources', 'data', 'water-layout.json');
writeFileSync(waterPath, `${JSON.stringify({ version: 1, rooms: waterRooms }, null, 2)}\n`);
if (!existsSync(`${waterPath}.meta`)) {
  writeFileSync(
    `${waterPath}.meta`,
    `${JSON.stringify(
      {
        ver: '2.0.1',
        importer: 'json',
        imported: true,
        uuid: randomUUID(),
        files: ['.json'],
        subMetas: {},
        userData: {},
      },
      null,
      2,
    )}\n`,
  );
}
console.log(`water-layout.json: ${JSON.stringify(waterRooms)}`);

// art source checks: file phải tồn tại để TiledMap import được.
for (const def of Object.values(TS)) {
  if (!existsSync(join(RES_ART, def.image))) {
    throw new Error(`thiếu tileset ${def.image} trong resources/art/tilesets`);
  }
}

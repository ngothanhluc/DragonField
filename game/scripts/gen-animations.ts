/**
 * Sinh `assets/resources/data/animations.json` từ nguồn sự thật:
 *
 * - Toàn bộ sheet actor/monster/boss đã stage (giữ nguyên entry cũ).
 * - Thêm **idle** cho 9 monster: pack chỉ có một sheet walk 4 hướng, nên idle là
 *   chính sheet đó phát chậm (GDD §12.3: không có frame idle riêng).
 * - Thêm FX có thật trong `FX/`: shuriken, energy-ball, impact, explosion, smoke,
 *   shield, ice, poison. Frame cắt theo grid chia hết pixel của sheet.
 * - `footPx` = số pixel trong suốt từ đáy frame tới pixel đặc thấp nhất, đọc trực
 *   tiếp từ PNG. Nhờ vậy frame khác kích thước (samurai 96×48 ↔ 96×96) vẫn đặt
 *   chân lên cùng một đường, không giật khi đổi anim.
 *
 * Chạy: `bun run scripts/gen-animations.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bottomPadding, readPng } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const MANIFEST = join(PROJECT, 'assets', 'resources', 'data', 'animations.json');

const DIRS = ['down', 'up', 'left', 'right'] as const;

interface RawEntry {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  layout: 'grid' | 'strip';
  directions: string[];
  frames: number;
  fps: number;
  loop: boolean;
  anchor?: 'feet' | 'center';
  footPx?: number;
}

const MONSTERS = [
  'bluebat',
  'spiderred',
  'snake3',
  'eye',
  'greenoctopus',
  'lanternred',
  'bear',
  'trex',
  'cyclope',
] as const;

const FX: Readonly<Record<string, Omit<RawEntry, 'anchor' | 'footPx'>>> = {
  'fx.shuriken': {
    sheet: 'resources/art/fx/shuriken/SpriteSheet.png',
    frameWidth: 46,
    frameHeight: 54,
    layout: 'strip',
    directions: [],
    frames: 15,
    fps: 20,
    loop: true,
  },
  'fx.energy-ball': {
    sheet: 'resources/art/fx/energy-ball/EnergyBall.png',
    frameWidth: 16,
    frameHeight: 16,
    layout: 'strip',
    directions: [],
    frames: 4,
    fps: 12,
    loop: true,
  },
  'fx.impact': {
    sheet: 'resources/art/fx/spark/SpriteSheet.png',
    frameWidth: 45,
    frameHeight: 35,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 20,
    loop: false,
  },
  'fx.explosion': {
    sheet: 'resources/art/fx/explosion/SpriteSheet.png',
    frameWidth: 24,
    frameHeight: 40,
    layout: 'strip',
    directions: [],
    frames: 15,
    fps: 18,
    loop: false,
  },
  'fx.smoke': {
    sheet: 'resources/art/fx/smoke/SpriteSheet.png',
    frameWidth: 32,
    frameHeight: 32,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 10,
    loop: false,
  },
  'fx.shield': {
    sheet: 'resources/art/fx/shield/SpriteSheetBlue.png',
    frameWidth: 24,
    frameHeight: 26,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 12,
    loop: true,
  },
  'fx.ice': {
    sheet: 'resources/art/fx/ice/SpriteSheet.png',
    frameWidth: 40,
    frameHeight: 32,
    layout: 'strip',
    directions: [],
    frames: 8,
    fps: 14,
    loop: false,
  },
  'fx.poison': {
    sheet: 'resources/art/fx/poison/SpriteSheet.png',
    frameWidth: 40,
    frameHeight: 28,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 12,
    loop: false,
  },
};

function readRaw(): { version: number; sprites: Record<string, RawEntry> } {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('manifest phải là object');
  const record = parsed as { version?: unknown; sprites?: unknown };
  if (record.version !== 1) throw new Error('manifest version phải là 1');
  if (typeof record.sprites !== 'object' || record.sprites === null) {
    throw new Error('manifest.sprites phải là object');
  }
  return { version: 1, sprites: record.sprites as Record<string, RawEntry> };
}

function withFoot(entry: RawEntry): RawEntry {
  const path = join(PROJECT, 'assets', entry.sheet);
  const padding = bottomPadding(readPng(path));
  return {
    ...entry,
    anchor: entry.anchor ?? 'feet',
    footPx: entry.anchor === 'center' ? Math.floor(entry.frameHeight / 2) : padding,
  };
}

function idleOf(walk: RawEntry): RawEntry {
  return {
    sheet: walk.sheet,
    frameWidth: walk.frameWidth,
    frameHeight: walk.frameHeight,
    layout: 'grid',
    directions: Array.from(DIRS),
    frames: walk.frames,
    // Cùng frame walk nhưng phát chậm: pack không có sheet idle cho monster.
    fps: 4,
    loop: true,
    anchor: 'feet',
  };
}

const source = readRaw();
const sprites: Record<string, RawEntry> = {};

const playerKeys = Object.keys(source.sprites).filter((key) => key.startsWith('player.'));
for (const key of playerKeys) {
  const entry = source.sprites[key];
  if (entry !== undefined) sprites[key] = withFoot(entry);
}

for (const monster of MONSTERS) {
  const walkKey = `${monster}.walk.down`;
  const walk = source.sprites[walkKey];
  if (walk === undefined) throw new Error(`thiếu ${walkKey} trong manifest cũ`);
  const idle = idleOf(walk);
  for (const direction of DIRS) {
    sprites[`${monster}.idle.${direction}`] = withFoot(idle);
  }
  for (const direction of DIRS) {
    const entry = source.sprites[`${monster}.walk.${direction}`];
    if (entry === undefined) throw new Error(`thiếu ${monster}.walk.${direction}`);
    sprites[`${monster}.walk.${direction}`] = withFoot(entry);
  }
}

for (const [key, entry] of Object.entries(source.sprites)) {
  if (!key.startsWith('player.') && !key.includes('.walk.')) sprites[key] = withFoot(entry);
}

for (const [key, entry] of Object.entries(FX)) {
  sprites[key] = withFoot({ ...entry, anchor: 'center' });
}

writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, sprites }, null, 2)}\n`);
console.log(`animations.json: ${Object.keys(sprites).length} key`);

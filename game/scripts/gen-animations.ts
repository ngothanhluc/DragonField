/**
 * Emit `assets/resources/data/animations.json` from the source of truth:
 *
 * - Every staged actor/monster/boss sheet (keeping existing entries).
 * - Adds **idle** for the 9 monsters: the pack has only one 4-direction walk sheet, so idle is
 *   that same sheet played slowly (GDD §12.3: there are no separate idle frames).
 * - Adds the FX that really exist in `FX/`: shuriken, energy-ball, impact, explosion, smoke,
 *   shield, ice, poison. Frames are sliced on a grid dividing the sheet pixels exactly.
 * - `footPx` = transparent pixels from the frame bottom to the lowest solid pixel, read straight
 *   from the PNG. That way frames of different sizes (samurai 96×48 ↔ 96×96) still put their
 *   feet on the same line, without jitter when the animation changes.
 *
 * Run: `bun run scripts/gen-animations.ts`
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
  // #42 — sniper and splitter monsters (staged by `stage-m9-monsters.ts`).
  'kappagreen',
  'kappared',
  'skullblue',
  'slimegreen',
  'slime2',
  'slime3',
  // M13 — bomber and buffer monsters (staged by `stage-m13-monsters.ts`).
  'flam',
  'mushroom',
  'flam2',
  'mushroom2',
  'spirit',
  'lanterngreen',
  'spirit2',
  'owl2',
  // M18 — dasher and gunner monsters (staged by `stage-m18-monsters.ts`; `spirit` already listed above).
  'owl',
  'reptile',
  'beast',
  'lizard',
  'octopus2',
  'skull',
  'dragon',
] as const;

const FX: Readonly<Record<string, Omit<RawEntry, 'anchor' | 'footPx'>>> = {
  'fx.shuriken': {
    sheet: 'resources/art/fx/shuriken/SpriteSheet.png',
    frameWidth: 69,
    frameHeight: 54,
    layout: 'strip',
    directions: [],
    frames: 10,
    fps: 16,
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
    frameWidth: 27,
    frameHeight: 35,
    layout: 'strip',
    directions: [],
    frames: 10,
    fps: 24,
    loop: false,
  },
  'fx.explosion': {
    sheet: 'resources/art/fx/explosion/SpriteSheet.png',
    frameWidth: 40,
    frameHeight: 40,
    layout: 'strip',
    directions: [],
    frames: 9,
    fps: 14,
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
    frameWidth: 32,
    frameHeight: 32,
    layout: 'strip',
    directions: [],
    frames: 10,
    fps: 16,
    loop: false,
  },
  'fx.poison': {
    sheet: 'resources/art/fx/poison/SpriteSheet.png',
    frameWidth: 30,
    frameHeight: 28,
    layout: 'strip',
    directions: [],
    frames: 8,
    fps: 14,
    loop: false,
  },
};

function readRaw(): { version: number; sprites: Record<string, RawEntry> } {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('manifest must be an object');
  const record = parsed as { version?: unknown; sprites?: unknown };
  if (record.version !== 1) throw new Error('manifest version must be 1');
  if (typeof record.sprites !== 'object' || record.sprites === null) {
    throw new Error('manifest.sprites must be an object');
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
    // Same walk frames played slowly: the pack has no idle sheet for monsters.
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
  if (walk === undefined) throw new Error(`missing ${walkKey} in the old manifest`);
  const idle = idleOf(walk);
  for (const direction of DIRS) {
    sprites[`${monster}.idle.${direction}`] = withFoot(idle);
  }
  for (const direction of DIRS) {
    const entry = source.sprites[`${monster}.walk.${direction}`];
    if (entry === undefined) throw new Error(`missing ${monster}.walk.${direction}`);
    sprites[`${monster}.walk.${direction}`] = withFoot(entry);
  }
}

for (const [key, entry] of Object.entries(source.sprites)) {
  if (key.startsWith('player.') || key.includes('.walk.')) continue;
  // Elite variants are generated PNGs (`gen-elites.ts`) and splitlings come from
  // `gen-splitlings.ts`: keep both, appended at the end below.
  if (key.includes('.elite.') || key.includes('.splitling.')) continue;
  sprites[key] = withFoot(entry);
}

for (const [key, entry] of Object.entries(FX)) {
  sprites[key] = withFoot({ ...entry, anchor: 'center' });
}

// Elite variants (ADR-015) are generated by `gen-elites.ts`, not staged from the pack. They are
// copied verbatim (re-reading `footPx` from the elite PNG) in the same order `gen-elites.ts`
// appends them, so running either script last leaves an identical file.
for (const monster of MONSTERS) {
  for (const clip of ['idle', 'walk'] as const) {
    for (const direction of DIRS) {
      const key = `${monster}.elite.${clip}.${direction}`;
      const entry = source.sprites[key];
      if (entry !== undefined) sprites[key] = withFoot(entry);
    }
  }
}

// Splitling variants (#42) are generated by `gen-splitlings.ts` from the splitter sheets.
const SPLITLING_MONSTERS = ['slimegreen', 'slime2', 'slime3'] as const;
for (const monster of SPLITLING_MONSTERS) {
  for (const clip of ['idle', 'walk'] as const) {
    for (const direction of DIRS) {
      const key = `${monster}.splitling.${clip}.${direction}`;
      const entry = source.sprites[key];
      if (entry !== undefined) sprites[key] = withFoot(entry);
    }
  }
}

writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, sprites }, null, 2)}\n`);
console.log(`animations.json: ${Object.keys(sprites).length} key`);

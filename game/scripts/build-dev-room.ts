/**
 * Build the 128×72 dev room used by the #37 browser proof: `data/levels/dev/room-big.tmx`.
 *
 * Run: `bun run build:dev-room`.
 *
 * The layout lives in `lib/dev-room-layout.ts`; the tileset (`field.tsx`, chapter 1's grass) is
 * written next to the room because a `.tmx` references its `.tsx` by bare file name in the same
 * folder (AGENTS.md). Everything is validated with `parseTmxLevel` before it is written, and the
 * `.meta` files come from the shared room writer — the game never sees a file this script has
 * not parsed.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTmxLevel } from '../assets/scripts/core/level/tmx';
import { devRoomLayout } from './lib/dev-room-layout';
import { ensureDirMeta, writeMeta } from './lib/audio';
import { buildRoomTmx, buildTsx } from './lib/room-layout';
import { projectRelative, RES, writeRoomFile } from './lib/room-file';

const DEV_REL = 'data/levels/dev';
const ROOM_PATH = join(RES, DEV_REL, 'room-big.tmx');
const TSX_PATH = join(RES, DEV_REL, 'field.tsx');

/** Field tileset copied from chapter 1's declaration (80×240 px sheet, 5 columns, 75 tiles). */
const TSX = buildTsx({
  name: 'field',
  image: '../../../art/tilesets/TilesetField.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 5,
  tilecount: 75,
  imageWidth: 80,
  imageHeight: 240,
});

/** Keep an existing `.meta` uuid so a rebuild does not invalidate the asset reference. */
function tsxUuid(): string {
  const metaPath = `${TSX_PATH}.meta`;
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
      if (typeof parsed.uuid === 'string') return parsed.uuid;
    } catch {
      // A malformed meta is replaced with a fresh uuid.
    }
  }
  return randomUUID();
}

function writeTsx(): void {
  ensureDirMeta(DEV_REL);
  writeFileSync(TSX_PATH, TSX);
  writeMeta(TSX_PATH, {
    ver: '1.0.1',
    importer: 'text',
    imported: true,
    uuid: tsxUuid(),
    files: ['.json'],
    subMetas: {},
    userData: {},
  });
}

function main(): void {
  writeTsx();

  const xml = buildRoomTmx(devRoomLayout());
  const level = parseTmxLevel(xml, { source: projectRelative(ROOM_PATH) });
  writeRoomFile(ROOM_PATH, xml);

  console.log(
    `room  ${projectRelative(ROOM_PATH)} (ch${level.chapter} r${level.room}, ` +
      `${level.size.cols}×${level.size.rows}, ${level.waves.length} wave(s), ` +
      `${level.obstacles.length} obstacle(s), ${level.doors.length} door(s))`,
  );
}

main();

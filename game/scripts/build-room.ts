/**
 * Build a room `.tmx` from a text layout (ticket #20).
 *
 * Run: `bun run build:room <layout.json> <out.tmx>`.
 *
 * The layout is 18 rows of 32 characters plus a legend (see `lib/room-layout.ts`). The
 * generated `.tmx` is validated with the same `parseTmxLevel` the game uses **before**
 * anything is written, so a broken layout never reaches the asset DB. A `.tmx.meta` is
 * written next to it (`importer: "tiled-map"`, files `.json` + `.tmx`), keeping an existing
 * uuid so a rebuild does not invalidate editor references.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTmxLevel } from '../assets/scripts/core/level/tmx';
import { ensureDirMeta, writeMeta } from './lib/audio';
import { buildRoomTmx, type RoomLayoutSpec } from './lib/room-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

function stableUuid(path: string): string {
  const metaPath = `${path}.meta`;
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

function tmxMeta(path: string): object {
  return {
    ver: '1.0.2',
    importer: 'tiled-map',
    imported: true,
    uuid: stableUuid(path),
    files: ['.json', '.tmx'],
    subMetas: {},
    userData: {},
  };
}

/** Create every folder between `assets/resources/` and `path`, each with its directory meta. */
function ensureResourceDir(path: string): void {
  const rel = relative(RES, path).split(sep).join('/');
  if (rel === '' || rel.startsWith('..')) return;
  const parts = rel.split('/');
  parts.forEach((_part, index) => ensureDirMeta(parts.slice(0, index + 1).join('/')));
}

function main(): void {
  const [layoutArg, outArg] = process.argv.slice(2);
  if (layoutArg === undefined || outArg === undefined) {
    throw new Error('usage: bun run build:room <layout.json> <out.tmx>');
  }
  const layoutPath = resolve(layoutArg);
  const outPath = resolve(outArg);
  if (!existsSync(layoutPath)) throw new Error(`missing layout: ${layoutPath}`);

  const spec = JSON.parse(readFileSync(layoutPath, 'utf8')) as RoomLayoutSpec;
  const xml = buildRoomTmx(spec);
  // Same parser as the game: a layout that would break a run fails here, not at load time.
  const level = parseTmxLevel(xml, { source: relative(PROJECT, layoutPath).split(sep).join('/') });

  mkdirSync(dirname(outPath), { recursive: true });
  if (inside(outPath, RES)) ensureResourceDir(dirname(outPath));
  writeFileSync(outPath, xml);
  writeMeta(outPath, tmxMeta(outPath));
  console.log(
    `room  ${relative(PROJECT, outPath)} (ch${level.chapter} r${level.room}, ` +
      `${level.waves.length} wave(s), ${level.obstacles.length} obstacle(s), ${level.doors.length} door(s))`,
  );
}

main();

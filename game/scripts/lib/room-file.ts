/**
 * Write a generated room `.tmx` into the asset DB with the `.meta` files Cocos needs.
 *
 * Shared by `scripts/build-room.ts` (text layout → room) and `scripts/build-dev-room.ts`
 * (the 128×72 dev room), so both keep the exact meta convention from AGENTS.md:
 * `.tmx` = `importer: "tiled-map"` with `files: [".json", ".tmx"]`, every parent folder a
 * `directory` meta, and an existing uuid is reused so a rebuild never invalidates the editor.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDirMeta, writeMeta } from './audio';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', '..');
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

/** Create every folder between `assets/resources/` and `path`, each with a directory meta. */
function ensureResourceDir(path: string): void {
  const rel = relative(RES, path).split(sep).join('/');
  if (rel === '' || rel.startsWith('..')) return;
  const parts = rel.split('/');
  parts.forEach((_part, index) => ensureDirMeta(parts.slice(0, index + 1).join('/')));
}

/**
 * Write `xml` to `outPath` (inside the project) and its `.tmx.meta`; folders inside
 * `assets/resources/` get their directory metas first.
 */
export function writeRoomFile(outPath: string, xml: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  if (inside(outPath, RES)) ensureResourceDir(dirname(outPath));
  writeFileSync(outPath, xml);
  writeMeta(outPath, tmxMeta(outPath));
}

/** Project-relative path, for log lines and parser error messages. */
export function projectRelative(path: string): string {
  return relative(PROJECT, path).split(sep).join('/');
}

export { PROJECT, RES };

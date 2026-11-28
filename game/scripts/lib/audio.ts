/**
 * Shared asset-meta writing for the scripts that still stage into `assets/resources/`.
 *
 * - Writes `.meta` files for directories and files the scripts create.
 * - An existing `.meta` keeps its uuid, so running a kept script twice changes nothing
 *   (the editor references assets by uuid).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', '..');
const RES = join(PROJECT, 'assets', 'resources');

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeMeta(path: string, meta: object): void {
  writeFileSync(`${path}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
}

/** Make sure a resources folder exists and has a valid directory `.meta`. */
export function ensureDirMeta(rel: string): void {
  const path = join(RES, rel);
  if (!existsSync(path)) ensureDir(path);
  const meta = `${path}.meta`;
  if (!existsSync(meta)) {
    writeMeta(path, {
      ver: '1.2.0',
      importer: 'directory',
      imported: true,
      uuid: randomUUID(),
      files: [],
      subMetas: {},
      userData: {},
    });
    console.log(`dir  ${rel}`);
  }
}

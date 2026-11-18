/**
 * Shared audio staging: convert pack `.wav`/`.ogg` files to small `.mp3` and write their
 * `.meta` files, so `stage-m6-assets.ts` and `stage-m8-audio.ts` share one implementation.
 *
 * - The pack (`art-source/ninja-adventure/`) is the only source; nothing here is committed source.
 * - An existing `.meta` keeps its uuid, and an existing mp3+meta pair is left alone, so running a
 *   stage script twice changes nothing (the editor references assets by uuid).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', '..');
const PACK = join(PROJECT, '..', 'art-source', 'ninja-adventure');
const RES = join(PROJECT, 'assets', 'resources');

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeMeta(path: string, meta: object): void {
  writeFileSync(`${path}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
}

/** uuid of an existing `.meta`, so a re-run never invalidates editor references. */
function existingUuid(path: string): string | null {
  const meta = `${path}.meta`;
  if (!existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, 'utf8')) as { uuid?: unknown };
    return typeof parsed.uuid === 'string' ? parsed.uuid : null;
  } catch {
    return null;
  }
}

export function audioMeta(
  extension: string,
  durationSeconds: number,
  sampleRate: number,
  uuid: string = randomUUID(),
): object {
  return {
    ver: '1.0.27',
    importer: 'audio-clip',
    imported: true,
    uuid,
    files: ['.json', extension],
    subMetas: {},
    userData: {
      downloadMode: 0,
      duration: Math.round(durationSeconds * 1000) / 1000,
      sampleRate,
    },
  };
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

/** Convert one file from the pack into `assets/resources/<targetRel>` (`.mp3` when needed). */
export function convertAudio(
  sourceRel: string,
  targetRel: string,
  bitrate: string,
  channels: number,
): void {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(target) || existingUuid(target) === null) {
    if (!existsSync(source)) throw new Error(`missing source audio: ${source}`);
    ensureDir(dirname(target));
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      source,
      '-c:a',
      'libmp3lame',
      '-b:a',
      bitrate,
      '-ac',
      String(channels),
      target,
    ]);
  }

  const duration = probeNumber(target, 'format=duration', 0);
  const sampleRate = probeNumber(target, 'stream=sample_rate', 44100);
  writeMeta(target, audioMeta('.mp3', duration, sampleRate, existingUuid(target) ?? undefined));
  console.log(`audio ${targetRel} (${statSync(target).size} B, ${duration.toFixed(2)} s)`);
}

function probeNumber(target: string, entry: string, fallback: number): number {
  const value = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', entry, '-of', 'default=nw=1:nk=1', target])
      .toString()
      .trim(),
  );
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

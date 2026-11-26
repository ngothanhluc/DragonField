/**
 * Stage all 24×24 skill & Legendary Evolution icons for M13 from `art-source/ninja-adventure/Ui/Skill Icon/`.
 *
 * Run: `cd game && bun run scripts/stage-m13-icons.ts`
 *
 * - Resolves `art-source/ninja-adventure` across git worktrees via `--git-common-dir`.
 * - Copies PNGs byte-for-byte (no re-encoding pixel art) and asserts 24×24 dimensions.
 * - Preserves existing `.meta` UUIDs when present; creates nearest-filtered image `.meta` files
 *   with globally unique UUIDs for every newly staged icon.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_ICONS } from '../assets/scripts/core/skills/icons';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const TARGET_DIR = join(ASSETS, 'resources', 'art', 'ui', 'skill-icons');

const ICON_SUBDIRS = ['Spell', 'Items & Weapon', 'Job & Action', 'Meteo'] as const;

function packPath(): string {
  const override = process.env['ART_SOURCE'];
  const candidates = [
    ...(override === undefined ? [] : [join(override, 'ninja-adventure')]),
    join(PROJECT, '..', 'art-source', 'ninja-adventure'),
  ];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: PROJECT,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(dirname(resolve(PROJECT, common)), 'art-source', 'ninja-adventure'));
  } catch {
    // Not a git checkout: candidates above are all we can try.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`cannot find the art pack; tried: ${candidates.join(', ')}`);
  }
  return found;
}

function collectExistingUuids(dir: string, out = new Set<string>()): Set<string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectExistingUuids(full, out);
    } else if (entry.name.endsWith('.meta')) {
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as { uuid?: string };
        if (typeof parsed.uuid === 'string') out.add(parsed.uuid);
      } catch {
        // Ignore malformed unrelated files during collection.
      }
    }
  }
  return out;
}

function nextUniqueUuid(used: Set<string>): string {
  let uuid = randomUUID();
  while (used.has(uuid)) uuid = randomUUID();
  used.add(uuid);
  return uuid;
}

function pngSize(path: string): { readonly width: number; readonly height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function imageMeta(path: string, uuid: string): object {
  const { width, height } = pngSize(path);
  if (width !== 24 || height !== 24) {
    throw new Error(`Expected 24×24 icon at ${path}, got ${width}×${height}`);
  }
  const name = path.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
  const sx = Math.round(width / 2);
  const sy = Math.round(height / 2);
  return {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', '.png'],
    subMetas: {
      '6c48a': {
        importer: 'texture',
        uuid: `${uuid}@6c48a`,
        displayName: name,
        id: '6c48a',
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          imageUuidOrDatabaseUri: uuid,
          isUuid: true,
          visible: false,
          minfilter: 'nearest',
          magfilter: 'nearest',
          mipfilter: 'none',
          anisotropy: 0,
        },
        ver: '1.0.22',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
      f9941: {
        importer: 'sprite-frame',
        uuid: `${uuid}@f9941`,
        displayName: name,
        id: 'f9941',
        name: 'spriteFrame',
        userData: {
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
          vertices: {
            rawPosition: [-sx, -sy, 0, sx, -sy, 0, -sx, sy, 0, sx, sy, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, height, width, height, 0, 0, width, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [-sx, -sy, 0],
            maxPos: [sx, sy, 0],
          },
          isUuid: true,
          imageUuidOrDatabaseUri: `${uuid}@6c48a`,
          atlasUuid: '',
          trimType: 'auto',
        },
        ver: '1.0.12',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      type: 'sprite-frame',
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: true,
      redirect: `${uuid}@6c48a`,
    },
  };
}

function findPackIcon(packRoot: string, fileName: string): string {
  const base = join(packRoot, 'Ui', 'Skill Icon');
  for (const subdir of ICON_SUBDIRS) {
    const candidate = join(base, subdir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing pack icon "${fileName}" in ${ICON_SUBDIRS.join(', ')}`);
}

function main(): void {
  const pack = packPath();
  mkdirSync(TARGET_DIR, { recursive: true });
  const usedUuids = collectExistingUuids(ASSETS);

  const uniqueIcons = Array.from(new Set(Object.values(SKILL_ICONS))).sort();
  let stagedNew = 0;

  for (const icon of uniqueIcons) {
    for (const suffix of ['', 'Disabled'] as const) {
      const fileName = `${icon}${suffix}.png`;
      const source = findPackIcon(pack, fileName);
      const target = join(TARGET_DIR, fileName);
      const metaPath = `${target}.meta`;

      const bytes = readFileSync(source);
      const alreadyExists = existsSync(target) && existsSync(metaPath);
      writeFileSync(target, bytes);

      if (!alreadyExists) {
        const uuid = nextUniqueUuid(usedUuids);
        writeFileSync(metaPath, `${JSON.stringify(imageMeta(target, uuid), null, 2)}\n`);
        stagedNew += 1;
        console.log(`staged ${fileName} (${statSync(target).size} B, uuid=${uuid})`);
      } else {
        const { width, height } = pngSize(target);
        if (width !== 24 || height !== 24) {
          throw new Error(`Expected 24×24 icon at ${target}, got ${width}×${height}`);
        }
      }
    }
  }

  console.log(`Done: ${uniqueIcons.length} unique icon pairs checked, ${stagedNew} new files staged.`);
}

main();

/**
 * Stage the boss-pool content of ticket #43: GiantFrog / GiantSlime art and one music track per boss.
 *
 * Run: `bun run scripts/stage-boss-pool.ts`
 *
 * - PNGs are copied **byte-for-byte** from the pack (pixel art is never re-encoded).
 * - Music is re-encoded to a small `.mp3` (64 kbps stereo), same as `stage-m6-assets.ts`.
 * - No `.meta` files: the editor's next build generates them (rule of ticket #43).
 * - The pack is gitignored: in a worktree it is looked up next to the shared `.git`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');

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
    // Not a git checkout: the candidates above are all we can try.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`cannot find the art pack; tried: ${candidates.join(', ')}`);
  }
  return found;
}

const PACK = packPath();
console.log(`pack ${PACK}`);

/** Boss sheets are one horizontal row, sliced by `assets/resources/data/animations.json`. */
const ART: readonly (readonly [string, string])[] = [
  ['Actor/Boss/GiantFrog/Idle40x40.png', 'art/bosses/giant-frog/Idle40x40.png'],
  ['Actor/Boss/GiantFrog/Jump.png', 'art/bosses/giant-frog/Jump.png'],
  ['Actor/Boss/GiantFrog/Charge.png', 'art/bosses/giant-frog/Charge.png'],
  ['Actor/Boss/GiantFrog/Attack.png', 'art/bosses/giant-frog/Attack.png'],
  ['Actor/Boss/GiantFrog/Hit.png', 'art/bosses/giant-frog/Hit.png'],
  ['Actor/Boss/GiantSlime/Idle.png', 'art/bosses/giant-slime/Idle.png'],
  ['Actor/Boss/GiantSlime/Jump.png', 'art/bosses/giant-slime/Jump.png'],
  ['Actor/Boss/GiantSlime/Hit.png', 'art/bosses/giant-slime/Hit.png'],
];

/** One theme per boss; Tengu keeps `audio/music/boss` ("17 - Fight") staged by `stage-m6-assets.ts`. */
const MUSIC: readonly (readonly [string, string])[] = [
  ['Audio/Musics/28 - Tension.ogg', 'audio/music/boss-squid.mp3'],
  ['Audio/Musics/10 - Dark Castle.ogg', 'audio/music/boss-samurai.mp3'],
  // The pack file name really has two spaces after "34".
  ['Audio/Musics/34  - Fight.ogg', 'audio/music/boss-frog.mp3'],
  ['Audio/Musics/14 - Curse.ogg', 'audio/music/boss-slime.mp3'],
];

for (const [sourceRel, targetRel] of ART) {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
  console.log(`png  ${targetRel} (${statSync(target).size} B)`);
}

for (const [sourceRel, targetRel] of MUSIC) {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (existsSync(target)) {
    console.log(`mp3  ${targetRel} (kept)`);
    continue;
  }
  if (!existsSync(source)) throw new Error(`missing source audio: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    source,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '64k',
    '-ac',
    '2',
    target,
  ]);
  console.log(`mp3  ${targetRel} (${statSync(target).size} B)`);
}

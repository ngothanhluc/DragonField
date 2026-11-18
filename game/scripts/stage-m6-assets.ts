/**
 * Stage the art/audio/font still missing for M6 from `art-source/ninja-adventure/`.
 *
 * Run: `bun run scripts/stage-m6-assets.ts`
 *
 * - PNGs are copied byte-for-byte (no re-encoding pixel art).
 * - Audio: ffmpeg re-encodes (music 64 kbps, SFX 80 kbps mono) to `.mp3` to keep the build small;
 *   the original pack stays the only source, `art-source/` is not committed.
 * - Font: copy `NormalFont.ttf`.
 * - Emits minimal `.meta` files; the editor's first build fills in sub-meta.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SKILL_ICONS } from '../assets/scripts/core/skills/icons';
import { convertAudio, ensureDir, ensureDirMeta, writeMeta } from './lib/audio';
import { fixFontSpacing } from './lib/font-spacing';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const PACK = join(PROJECT, '..', 'art-source', 'ninja-adventure');
const RES = join(PROJECT, 'assets', 'resources');

function pngSize(path: string): { readonly width: number; readonly height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function imageMeta(path: string): object {
  const uuid = randomUUID();
  const { width, height } = pngSize(path);
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

function copyPng(sourceRel: string, targetRel: string): void {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
  ensureDir(dirname(target));
  writeFileSync(target, readFileSync(source));
  writeMeta(target, imageMeta(target));
  console.log(`png  ${targetRel} (${statSync(target).size} B)`);
}

/**
 * The 20 `*Disabled.png` skill icon variants (#5). The normal variants are already staged, and
 * re-copying them would replace their meta UUIDs; this loop adds only the missing files.
 */
function copyDisabledSkillIcons(): void {
  for (const icon of Object.values(SKILL_ICONS)) {
    copyPng(`Ui/Skill Icon/Spell/${icon}Disabled.png`, `art/ui/skill-icons/${icon}Disabled.png`);
  }
}

function copyFont(): void {
  const source = join(PACK, 'Ui', 'Font', 'NormalFont.ttf');
  const target = join(RES, 'art', 'ui', 'fonts', 'NormalFont.ttf');
  ensureDir(dirname(target));
  writeFileSync(target, readFileSync(source));
  writeMeta(target, {
    ver: '1.0.27',
    importer: 'font',
    imported: true,
    uuid: randomUUID(),
    files: ['.json', '.ttf'],
    subMetas: {},
    userData: {},
  });
  fixFontSpacing(target);
  console.log(`font ${target} (${statSync(target).size} B, space 1/3 em)`);
}

// `bun run scripts/stage-m6-assets.ts --skill-icons-disabled` stages only the Disabled icon
// variants: the full run re-encodes audio and rewrites every meta UUID (breaking sprite refs).
if (process.argv.includes('--skill-icons-disabled')) {
  copyDisabledSkillIcons();
  process.exit(0);
}

ensureDirMeta('audio');
ensureDirMeta('audio/music');
ensureDirMeta('audio/sfx');
ensureDirMeta('art/ui/fonts');

// Missing FX
copyPng('FX/Smoke/Smoke/SpriteSheet.png', 'art/fx/smoke/SpriteSheet.png');
copyPng('FX/Magic/Shield/SpriteSheetBlue.png', 'art/fx/shield/SpriteSheetBlue.png');
copyPng('FX/Elemental/Ice/SpriteSheet.png', 'art/fx/ice/SpriteSheet.png');
copyPng('FX/Elemental/Plant/SpriteSheet.png', 'art/fx/poison/SpriteSheet.png');
copyPng('Items/Treasure/Coin2.png', 'art/ui/coin/Coin2.png'); // #2 coin flying to the HUD (4 frames 10×10)

// Music — 5 tracks chosen, one per group
convertAudio('Audio/Musics/38 - Intro.ogg', 'audio/music/title.mp3', '64k', 2);
convertAudio('Audio/Musics/11 - Clearing.ogg', 'audio/music/chapter-1.mp3', '64k', 2);
convertAudio('Audio/Musics/18 - Aquatic.ogg', 'audio/music/chapter-2.mp3', '64k', 2);
convertAudio('Audio/Musics/30 - Ruins.ogg', 'audio/music/chapter-3.mp3', '64k', 2);
convertAudio('Audio/Musics/17 - Fight.ogg', 'audio/music/boss.mp3', '64k', 2);

// SFX
convertAudio('Audio/Sounds/Whoosh & Slash/Launch.wav', 'audio/sfx/shoot.mp3', '80k', 1);
convertAudio('Audio/Sounds/Hit & Impact/Hit2.wav', 'audio/sfx/enemy-hit.mp3', '80k', 1);
convertAudio('Audio/Sounds/Hit & Impact/Impact3.wav', 'audio/sfx/player-hurt.mp3', '80k', 1);
convertAudio('Audio/Sounds/Elemental/Explosion2.wav', 'audio/sfx/enemy-death.mp3', '80k', 1);
convertAudio('Audio/Sounds/Elemental/Explosion5.wav', 'audio/sfx/explosion.mp3', '80k', 1);
convertAudio('Audio/Jingles/LevelUp2.wav', 'audio/sfx/boss-phase.mp3', '80k', 1);
convertAudio('Audio/Sounds/Menu/Accept2.wav', 'audio/sfx/skill-pick.mp3', '80k', 1);
convertAudio('Audio/Sounds/Menu/Move2.wav', 'audio/sfx/ui-move.mp3', '80k', 1);
convertAudio('Audio/Sounds/Menu/Accept3.wav', 'audio/sfx/ui-confirm.mp3', '80k', 1);
convertAudio('Audio/Sounds/Bonus/Coin.wav', 'audio/sfx/gold.mp3', '80k', 1);
convertAudio('Audio/Jingles/Success1.wav', 'audio/sfx/chapter-clear.mp3', '80k', 1);
convertAudio('Audio/Jingles/GameOver.wav', 'audio/sfx/game-over.mp3', '80k', 1);
convertAudio('Audio/Sounds/Magic & Skill/Spirit.wav', 'audio/sfx/shield.mp3', '80k', 1);
convertAudio('Audio/Sounds/Elemental/Water3.wav', 'audio/sfx/freeze.mp3', '80k', 1);
convertAudio('Audio/Sounds/Elemental/Grass2.wav', 'audio/sfx/poison.mp3', '80k', 1);

copyFont();
copyDisabledSkillIcons();

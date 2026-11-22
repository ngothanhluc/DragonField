/**
 * Prepare Gemini reference images: upscale tiny pixel art with nearest-neighbour so the
 * model's vision encoder can actually see the pixels, and write the copies into a
 * scratch directory for upload.
 *
 * Run: `bun run prep:refs --out ../art-source/gemini/refs --min 768 <files...>`
 *
 * Gemini resamples uploads internally; a 10×9 palette sheet or a 64×64 monster strip
 * loses its colour and shape detail long before the model sees it. Nearest-neighbour
 * upscaling keeps hard pixel edges, which bilinear upscaling would blur away.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { upscaleFactor, nearestResize } from './lib/gemini-art';
import { readPng, writePng } from './lib/png';

interface Options {
  readonly out: string;
  readonly min: number;
  readonly files: readonly string[];
}

function parseArgs(argv: readonly string[]): Options {
  let out = 'art-source/gemini/refs';
  let min = 768;
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--out') {
      out = argv[index + 1] ?? out;
      index += 1;
    } else if (arg === '--min') {
      min = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) throw new Error('pass at least one reference image');
  if (!Number.isInteger(min) || min <= 0) throw new Error('--min must be a positive integer');
  return { out, min, files };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });
  for (const file of options.files) {
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`missing reference: ${path}`);
    const image = readPng(path);
    const factor = upscaleFactor(image.width, image.height, options.min);
    // Prefix with the parent folder: pack files are all named SpriteSheet.png / Idle.png.
    const target = join(options.out, `${basename(dirname(path))}-${basename(path)}`);
    if (factor === 1) {
      writeFileSync(target, readFileSync(path));
      console.log(`copy  ${target} (${image.width}×${image.height}, already ≥ ${options.min})`);
      continue;
    }
    const scaled = nearestResize(image, image.width * factor, image.height * factor);
    writePng(target, scaled);
    console.log(
      `refs  ${target} (${image.width}×${image.height} ×${factor} → ${scaled.width}×${scaled.height})`,
    );
  }
}

main();

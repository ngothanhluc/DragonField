/**
 * Read the real `.tmx` files under `assets/resources/data/levels/` for tests.
 *
 * The same parser as the runtime (`core/level/tmx.ts`): the tests cannot pass if a file
 * on disk is broken, and a new file dropped into the folder is picked up automatically.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData, LevelData } from '../../assets/scripts/core/level/level-data';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';

const here = dirname(fileURLToPath(import.meta.url));

/** `game/assets/resources/data/levels`. */
export const LEVELS_ROOT = join(here, '../../assets/resources/data/levels');
/** Chapter 1 folder (9 rooms, M2). */
export const CHAPTER_ONE_DIR = join(LEVELS_ROOT, 'chapter-1');

export interface TmxFile {
  /** Absolute path. */
  readonly path: string;
  /** Path relative to `LEVELS_ROOT`, used in error messages. */
  readonly name: string;
  readonly xml: string;
}

/** Every `.tmx` file under `root` (recursive), sorted by path so tests are deterministic. */
export function findTmxFiles(root: string = LEVELS_ROOT): TmxFile[] {
  const files: TmxFile[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.endsWith('.tmx')) continue;
      files.push({
        path,
        name: relative(LEVELS_ROOT, path),
        xml: readFileSync(path, 'utf8'),
      });
    }
  };

  visit(root);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse every `.tmx` in one chapter folder (not yet sorted by `room`). */
export function loadTmxLevels(directory: string = CHAPTER_ONE_DIR): LevelData[] {
  return findTmxFiles(directory).map((file) =>
    parseTmxLevel(file.xml, { source: file.name }),
  );
}

/** Chapter 1, parsed — replaces the old `chapter-1.json`. */
export function loadChapterOne(): ChapterData {
  return chapterFromLevels(loadTmxLevels(CHAPTER_ONE_DIR));
}

/** Find a room by number; throws when missing (clearer failure than `undefined`). */
export function roomOf(chapter: ChapterData, room: number): LevelData {
  const found = chapter.rooms.find((candidate) => candidate.room === room);
  if (found === undefined) throw new Error(`Chapter ${chapter.chapter} is missing room ${room}`);
  return found;
}

/**
 * Đọc các file `.tmx` thật trong `assets/resources/data/levels/` cho test.
 *
 * Cùng một parser với runtime (`core/level/tmx.ts`): test không thể xanh nếu file
 * trên đĩa hỏng, và file mới thả vào thư mục sẽ tự được test bắt.
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
/** Thư mục chapter 1 (9 phòng M2). */
export const CHAPTER_ONE_DIR = join(LEVELS_ROOT, 'chapter-1');

export interface TmxFile {
  /** Đường dẫn tuyệt đối. */
  readonly path: string;
  /** Đường dẫn tương đối so với `LEVELS_ROOT`, dùng trong message lỗi. */
  readonly name: string;
  readonly xml: string;
}

/** Mọi file `.tmx` dưới `root` (đệ quy), sắp theo đường dẫn để test tất định. */
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

/** Parse mọi `.tmx` trong một thư mục chapter (chưa sắp theo `room`). */
export function loadTmxLevels(directory: string = CHAPTER_ONE_DIR): LevelData[] {
  return findTmxFiles(directory).map((file) =>
    parseTmxLevel(file.xml, { source: file.name }),
  );
}

/** Chapter 1 đã parse — thay cho `chapter-1.json` cũ. */
export function loadChapterOne(): ChapterData {
  return chapterFromLevels(loadTmxLevels(CHAPTER_ONE_DIR));
}

/** Tìm phòng theo số; ném nếu thiếu (test fail rõ hơn `undefined`). */
export function roomOf(chapter: ChapterData, room: number): LevelData {
  const found = chapter.rooms.find((candidate) => candidate.room === room);
  if (found === undefined) throw new Error(`Chapter ${chapter.chapter} thiếu phòng ${room}`);
  return found;
}

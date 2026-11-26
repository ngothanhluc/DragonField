/**
 * Generate the 64×36 room pool of chapters 1–4 (M9, tickets #38 and #45).
 *
 * Run: `bun run gen:rooms` (`scripts/generate-rooms.ts`).
 *
 * Per chapter it writes `room-1.tmx … room-16.tmx` (normal rooms, see `lib/room-pool.ts`),
 * renames the hand-authored boss room to `room-17.tmx` (content untouched, only the `room`
 * property changes so `chapterFromLevels` still sees 1..17 contiguous with the boss last), and
 * removes every other `room-*.tmx` of the chapter. Chapter 2's `water-layout.json` is rewritten
 * for the new rooms (each generated room's river + the boss room's old entry). Chapter 4 (the
 * desert, #45) needs its `desert.tsx` / `camp.tsx` and its boss room on disk before it runs.
 *
 * Every room is validated through `parseTmxLevel` + the core navigation before it is written, so
 * the game never sees a file the acceptance tests would reject. Deterministic: running it twice
 * produces identical files.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WaterArea } from '../assets/scripts/core/level/water-layout';
import { parseTmxLevel } from '../assets/scripts/core/level/tmx';
import { projectRelative, writeRoomFile } from './lib/room-file';
import { BOSS_ROOM, generateChapterRooms, roomTmx, waterLayoutFor, type RoomPlan } from './lib/room-pool';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES_DATA = join(HERE, '..', 'assets', 'resources', 'data');
const LEVELS = join(RES_DATA, 'levels');
const WATER_PATH = join(RES_DATA, 'water-layout.json');

interface ChapterFile {
  readonly path: string;
  readonly room: number;
  readonly isBossRoom: boolean;
  readonly xml: string;
}

function chapterFiles(chapter: number): ChapterFile[] {
  const dir = join(LEVELS, `chapter-${chapter}`);
  return readdirSync(dir)
    .filter((entry) => /^room-\d+\.tmx$/.test(entry))
    .map((entry) => {
      const path = join(dir, entry);
      const xml = readFileSync(path, 'utf8');
      const level = parseTmxLevel(xml, { source: projectRelative(path) });
      return { path, room: level.room, isBossRoom: level.isBossRoom, xml };
    });
}

/**
 * Chapter 2's water areas of the boss room, read before the layout is rewritten. Before #38 the
 * boss was room 9; afterwards it is room 17. `bossRoom` is the boss's room number in the file that
 * is about to be replaced, so the entry survives the rename.
 */
function readBossWater(bossRoom: number): WaterArea[] {
  if (!existsSync(WATER_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(WATER_PATH, 'utf8')) as {
      rooms?: Record<string, Record<string, WaterArea[]>>;
    };
    const byRoom = raw.rooms?.['2'] ?? {};
    // Before #38 the boss was room 9; a re-run finds it under its final number.
    return byRoom[String(bossRoom)] ?? byRoom[String(BOSS_ROOM)] ?? byRoom['9'] ?? [];
  } catch {
    // A malformed layout is replaced wholesale below.
    return [];
  }
}

/** Rename the boss room's `room` property; every other byte stays as authored. */
function renumber(xml: string, room: number): string {
  return xml.replace(
    /(<property name="room" type="int" value=")\d+(")/,
    (_match, before: string, after: string) => `${before}${room}${after}`,
  );
}

function writeBoss(chapter: number, files: readonly ChapterFile[]): void {
  const boss = files.find((file) => file.isBossRoom);
  if (boss === undefined || boss.room === BOSS_ROOM) return;

  const target = join(LEVELS, `chapter-${chapter}`, `room-${BOSS_ROOM}.tmx`);
  const xml = renumber(boss.xml, BOSS_ROOM);
  parseTmxLevel(xml, { source: projectRelative(target) });
  writeRoomFile(target, xml);
  console.log(`  boss ${projectRelative(boss.path)} → ${projectRelative(target)}`);
}

function writeChapter(chapter: number): RoomPlan[] {
  const files = chapterFiles(chapter);
  writeBoss(chapter, files);

  const plans = generateChapterRooms(chapter);
  const dir = join(LEVELS, `chapter-${chapter}`);
  for (const plan of plans) {
    writeRoomFile(join(dir, `room-${plan.room}.tmx`), roomTmx(plan));
  }

  // Drop the hand-dressed rooms (and any stale number) now that the pool is on disk.
  const keep = new Set([
    ...plans.map((plan) => `room-${plan.room}.tmx`),
    `room-${BOSS_ROOM}.tmx`,
  ]);
  for (const entry of readdirSync(dir)) {
    if (!/^room-\d+\.tmx(\.meta)?$/.test(entry)) continue;
    if (keep.has(entry.replace(/\.meta$/, ''))) continue;
    rmSync(join(dir, entry));
  }

  const total = plans.reduce((sum, plan) => sum + roomTmx(plan).length, 0);
  console.log(
    `chapter ${chapter}: ${plans.length} normal rooms (${Math.round(total / 1024)} KiB of .tmx) ` +
      `+ boss room ${BOSS_ROOM}`,
  );
  return plans;
}

function parseChapters(argv: readonly string[]): number[] {
  const flagIndex = argv.findIndex((arg) => arg === '--chapters' || arg === '--chapter');
  if (flagIndex < 0) return [2, 1, 3, 4];
  const raw = argv[flagIndex + 1] ?? '';
  const parsed = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => [1, 2, 3, 4].includes(n));
  if (parsed.length === 0) throw new Error(`invalid --chapters value "${raw}"`);
  return parsed;
}

function main(): void {
  const chapters = parseChapters(process.argv.slice(2));
  const includeTwo = chapters.includes(2);
  // Read chapter 2's boss room + its water before the pool replaces the hand-dressed rooms.
  const chapterTwoBoss = includeTwo ? chapterFiles(2).find((file) => file.isBossRoom) : undefined;
  const bossWater = chapterTwoBoss === undefined ? [] : readBossWater(chapterTwoBoss.room);

  let chapterTwo: RoomPlan[] = [];
  for (const chapter of chapters) {
    const plans = writeChapter(chapter);
    if (chapter === 2) chapterTwo = plans;
  }

  if (includeTwo) {
    const layout = waterLayoutFor(chapterTwo, BOSS_ROOM, bossWater);
    writeFileSync(WATER_PATH, `${JSON.stringify({ version: 1, rooms: { '2': layout } }, null, 2)}\n`);
    console.log(`water-layout.json: ${Object.keys(layout).length} chapter-2 rooms with water`);
  }
}

main();

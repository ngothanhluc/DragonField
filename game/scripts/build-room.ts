/**
 * Build a room `.tmx` from a text layout (ticket #20).
 *
 * Run: `bun run build:room <layout.json> <out.tmx>`.
 *
 * The layout is a grid of characters (a whole multiple of 32×18 tiles) plus a legend (see
 * `lib/room-layout.ts`). The generated `.tmx` is validated with the same `parseTmxLevel` the
 * game uses **before** anything is written, so a broken layout never reaches the asset DB.
 * A `.tmx.meta` is written next to it (`importer: "tiled-map"`, files `.json` + `.tmx`), keeping
 * an existing uuid so a rebuild does not invalidate editor references.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTmxLevel } from '../assets/scripts/core/level/tmx';
import { buildRoomTmx, type RoomLayoutSpec } from './lib/room-layout';
import { projectRelative, writeRoomFile } from './lib/room-file';

function main(): void {
  const [layoutArg, outArg] = process.argv.slice(2);
  if (layoutArg === undefined || outArg === undefined) {
    throw new Error('usage: bun run build:room <layout.json> <out.tmx>');
  }
  const layoutPath = resolve(layoutArg);
  const outPath = resolve(outArg);
  if (!existsSync(layoutPath)) throw new Error(`missing layout: ${layoutPath}`);

  const spec = JSON.parse(readFileSync(layoutPath, 'utf8')) as RoomLayoutSpec;
  const xml = buildRoomTmx(spec);
  // Same parser as the game: a layout that would break a run fails here, not at load time.
  const level = parseTmxLevel(xml, { source: projectRelative(layoutPath) });

  writeRoomFile(outPath, xml);
  console.log(
    `room  ${projectRelative(outPath)} (ch${level.chapter} r${level.room}, ` +
      `${level.size.cols}×${level.size.rows}, ${level.waves.length} wave(s), ` +
      `${level.obstacles.length} obstacle(s), ${level.doors.length} door(s))`,
  );
}

main();

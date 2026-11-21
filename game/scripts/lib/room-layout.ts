/**
 * Rooms from text layouts (ticket #20 stub — implement).
 *
 * A room spec is 18 rows of 32 characters; a legend maps each character to a tile gid and
 * optionally to an object (obstacle, player start, spawn, door). `buildRoomTmx` writes a
 * `.tmx` that `parseTmxLevel` accepts. `buildTsx` writes the tileset file Tiled rooms reference.
 */
import type { EnemyRole, ObstacleKind } from '../../assets/scripts/core/level/level-data';

export interface LegendEntry {
  /** Tile gid written as-is into the floor layer (0 = empty). */
  readonly tile: number;
  readonly obstacle?: ObstacleKind;
  readonly playerStart?: true;
  readonly spawn?: { readonly role: EnemyRole; readonly wave: number; readonly elite?: boolean };
  readonly door?: { readonly toRoom?: number };
}

export interface RoomLayoutSpec {
  readonly chapter: number;
  readonly room: number;
  readonly isBossRoom?: boolean;
  readonly boss?: string;
  readonly tilesets: readonly { readonly source: string; readonly firstgid: number }[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly rows: readonly string[];
}

export interface TsxSpec {
  readonly name: string;
  /** Image path relative to the `.tsx` file. */
  readonly image: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly tilecount: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

export function buildRoomTmx(_spec: RoomLayoutSpec): string {
  return '';
}

export function buildTsx(_spec: TsxSpec): string {
  return '';
}

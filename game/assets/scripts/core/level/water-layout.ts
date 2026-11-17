/**
 * Bố cục nước động theo phòng (ch2): sông + thác.
 *
 * Nước là **trang trí**, không phải va chạm: player/enemy vẫn đi qua (sông nông).
 * Vì vậy dữ liệu này nằm ngoài `LevelData.obstacles`, chỉ dùng để dựng sprite
 * ripple/waterfall. File nguồn: `assets/resources/data/water-layout.json`, do
 * `scripts/dress-rooms.ts` sinh ra cùng lúc với decor layer.
 *
 * Thuần TS: test đọc JSON thật, kiểm toạ độ trong phòng và không đè lên điểm spawn.
 */
import { ROOM_COLS, ROOM_ROWS } from './level-data';

export const WATER_KINDS = ['river', 'waterfall'] as const;
export type WaterKind = (typeof WATER_KINDS)[number];

export interface WaterArea {
  readonly kind: WaterKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WaterLayout {
  readonly version: 1;
  /** `rooms[chapter][room]` */
  readonly rooms: Readonly<Record<string, Readonly<Record<string, readonly WaterArea[]>>>>;
}

const VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArea(value: unknown): value is WaterArea {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  return (
    (kind === 'river' || kind === 'waterfall') &&
    typeof value['x'] === 'number' &&
    typeof value['y'] === 'number' &&
    typeof value['width'] === 'number' &&
    typeof value['height'] === 'number' &&
    Number.isFinite(value['x']) &&
    Number.isFinite(value['y']) &&
    Number.isInteger(value['x']) &&
    Number.isInteger(value['y']) &&
    Number.isInteger(value['width']) &&
    Number.isInteger(value['height']) &&
    value['width'] > 0 &&
    value['height'] > 0 &&
    value['x'] >= 0 &&
    value['y'] >= 0 &&
    value['x'] + value['width'] <= ROOM_COLS &&
    value['y'] + value['height'] <= ROOM_ROWS
  );
}

/** Validate JSON thô; ném lỗi nêu đúng chapter/room/area hỏng. */
export function parseWaterLayout(raw: unknown): WaterLayout {
  if (!isRecord(raw)) throw new Error('water-layout phải là object');
  if (raw['version'] !== VERSION) {
    throw new Error(`water-layout.version phải là ${VERSION}, nhận ${String(raw['version'])}`);
  }
  if (!isRecord(raw['rooms'])) throw new Error('water-layout.rooms phải là object');

  const rooms: Record<string, Record<string, readonly WaterArea[]>> = {};
  for (const [chapter, byRoom] of Object.entries(raw['rooms'])) {
    if (!isRecord(byRoom)) throw new Error(`water-layout.rooms["${chapter}"] phải là object`);
    const parsedRooms: Record<string, readonly WaterArea[]> = {};
    for (const [room, areas] of Object.entries(byRoom)) {
      if (!Array.isArray(areas)) {
        throw new Error(`water-layout chapter ${chapter} room ${room} phải là array`);
      }
      const parsed: WaterArea[] = [];
      for (const [index, area] of areas.entries()) {
        if (!isArea(area)) {
          throw new Error(
            `water-layout chapter ${chapter} room ${room} area[${index}] không hợp lệ ` +
              `(kind river|waterfall, số nguyên, nằm trong ${ROOM_COLS}×${ROOM_ROWS})`,
          );
        }
        parsed.push({ kind: area.kind, x: area.x, y: area.y, width: area.width, height: area.height });
      }
      parsedRooms[room] = parsed;
    }
    rooms[chapter] = parsedRooms;
  }

  return { version: VERSION, rooms };
}

/** Mảng area của một phòng; `[]` khi phòng không có nước. */
export function waterAreasFor(
  layout: WaterLayout,
  chapter: number,
  room: number,
): readonly WaterArea[] {
  return layout.rooms[String(chapter)]?.[String(room)] ?? [];
}

/** Ô (tile) có nằm trong area không — test/công cụ debug. */
export function areaContains(area: WaterArea, x: number, y: number): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

/**
 * Contract details of the atmosphere data that the acceptance test leaves loose (#6):
 * the validation message has to name the chapter and the field (a broken JSON in production
 * must say where to look), and a chapter without decor must still parse.
 *
 * The placement/flee rules themselves are covered by `atmosphere.test.ts`; this file only
 * pins the parse surface.
 */
import { describe, expect, it } from 'vitest';
import {
  chapterAtmosphere,
  parseAtmosphereConfig,
} from '../../assets/scripts/core/atmosphere/atmosphere';
import { placeDecor } from '../../assets/scripts/core/atmosphere/living-decor';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../../assets/scripts/core/level/level-data';
import type { LevelData } from '../../assets/scripts/core/level/level-data';

const ANIMAL = { fleeRadiusTiles: 3, wanderSpeedTilesPerSec: 1, fleeSpeedTilesPerSec: 4 };

function rawChapter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chapter: 2,
    layers: [
      { kind: 'fog', secondary: false, depth: 'over-actors', sprite: 'fx.fog', opacity: 0.3, count: 1 },
    ],
    decor: { animals: [], props: [], animalsPerRoom: 0, propsPerRoom: 0 },
    ...overrides,
  };
}

describe('parseAtmosphereConfig — errors say where to look', () => {
  it('names the chapter and the field of a broken layer', () => {
    const raw = {
      version: 1,
      animal: ANIMAL,
      chapters: {
        '2': rawChapter({
          layers: [
            { kind: 'fog', secondary: false, depth: 'over-actors', sprite: 'fx.fog', opacity: 2, count: 1 },
          ],
        }),
      },
    };
    expect(() => parseAtmosphereConfig(raw)).toThrow(/chapter 2\.layers\[0\]\.opacity/);
  });

  it('rejects an unknown layer kind and lists the valid ones', () => {
    const raw = {
      version: 1,
      animal: ANIMAL,
      chapters: {
        '2': rawChapter({
          layers: [
            { kind: 'lava', secondary: true, depth: 'under-actors', sprite: null, opacity: 0.2, count: 1 },
          ],
        }),
      },
    };
    expect(() => parseAtmosphereConfig(raw)).toThrow(/chapter 2\.layers\[0\]\.kind/);
    expect(() => parseAtmosphereConfig(raw)).toThrow(/raylight/);
  });

  it('rejects a decor key of the wrong family', () => {
    const raw = {
      version: 1,
      animal: ANIMAL,
      chapters: {
        '2': rawChapter({
          decor: { animals: ['fx.fog'], props: [], animalsPerRoom: 1, propsPerRoom: 0 },
        }),
      },
    };
    expect(() => parseAtmosphereConfig(raw)).toThrow(/chapter 2\.decor\.animals\[0\]/);
  });
});

describe('parseAtmosphereConfig — chapters', () => {
  it('keeps a chapter with no decor and looks chapters up by number', () => {
    const config = parseAtmosphereConfig({
      version: 1,
      animal: ANIMAL,
      chapters: { '2': rawChapter() },
    });
    expect(chapterAtmosphere(config, 2)?.decor.animalsPerRoom).toBe(0);
    expect(chapterAtmosphere(config, 3)).toBeNull();
    expect(chapterAtmosphere(config, 2.5)).toBeNull();
  });
});

const EMPTY_ROOM: LevelData = {
  id: 'test-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: ROOM_COLS, rows: ROOM_ROWS },
  tileSizePx: TILE_SIZE_PX,
  playerStart: { x: 16, y: 9 },
  waves: [],
  obstacles: [],
  props: [],
  doors: [],
};

describe('placeDecor — chapter without decor', () => {
  it('places nothing when the chapter asks for no animals and no props', () => {
    const items = placeDecor(
      EMPTY_ROOM,
      { animals: [], props: [], animalsPerRoom: 0, propsPerRoom: 0 },
      7,
    );
    expect(items).toEqual([]);
  });

  it('fails loudly instead of placing fewer items than the chapter asks for', () => {
    expect(() =>
      placeDecor(
        {
          ...EMPTY_ROOM,
          obstacles: [{ kind: 'wall', x: 0, y: 0, width: ROOM_COLS, height: ROOM_ROWS }],
        },
        { animals: ['animal.frog'], props: [], animalsPerRoom: 1, propsPerRoom: 0 },
        1,
      ),
    ).toThrow(/test-room/);
  });
});

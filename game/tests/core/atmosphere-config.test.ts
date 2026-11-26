/**
 * Contract details of the atmosphere schema (`core/atmosphere/atmosphere.ts`, ADR-019):
 * - validation messages name the broken chapter and field,
 * - removed M8 overlay kinds (`raylight`, `fog`, `vignette`, `heat-haze`) and `sprite: null`
 *   fail schema validation cleanly,
 * - all M11 particle layer kinds parse cleanly, and chapters without decor still parse.
 */
import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_LAYER_KINDS,
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
      { kind: 'rain', secondary: false, depth: 'over-actors', sprite: 'fx.rain', opacity: 0.9, count: 20 },
    ],
    decor: { animals: [], props: [], animalsPerRoom: 0, propsPerRoom: 0 },
    ...overrides,
  };
}

describe('parseAtmosphereConfig — errors say where to look and reject removed overlays', () => {
  it('names the chapter and the field of a broken layer', () => {
    const raw = {
      version: 1,
      animal: ANIMAL,
      chapters: {
        '2': rawChapter({
          layers: [
            { kind: 'rain', secondary: false, depth: 'over-actors', sprite: 'fx.rain', opacity: 2, count: 1 },
          ],
        }),
      },
    };
    expect(() => parseAtmosphereConfig(raw)).toThrow(/chapter 2\.layers\[0\]\.opacity/);
  });

  it('rejects removed M8 overlay kinds (raylight, fog, vignette, heat-haze) and lists valid kinds', () => {
    for (const removedKind of ['raylight', 'fog', 'vignette', 'heat-haze', 'lava']) {
      const raw = {
        version: 1,
        animal: ANIMAL,
        chapters: {
          '2': rawChapter({
            layers: [
              {
                kind: removedKind,
                secondary: false,
                depth: 'over-actors',
                sprite: 'fx.rain',
                opacity: 0.3,
                count: 1,
              },
            ],
          }),
        },
      };
      expect(() => parseAtmosphereConfig(raw), removedKind).toThrow(/chapter 2\.layers\[0\]\.kind/);
      expect(() => parseAtmosphereConfig(raw), removedKind).toThrow(/leaves/);
    }
  });

  it('rejects null or empty sprite keys (Graphics-only overlays were removed in M11)', () => {
    for (const badSprite of [null, '']) {
      const raw = {
        version: 1,
        animal: ANIMAL,
        chapters: {
          '2': rawChapter({
            layers: [
              {
                kind: 'rain',
                secondary: false,
                depth: 'over-actors',
                sprite: badSprite,
                opacity: 0.5,
                count: 1,
              },
            ],
          }),
        },
      };
      expect(() => parseAtmosphereConfig(raw)).toThrow(/chapter 2\.layers\[0\]\.sprite/);
    }
  });

  it('accepts every M11 layer kind cleanly', () => {
    const layers = ATMOSPHERE_LAYER_KINDS.map((kind) => ({
      kind,
      secondary: kind === 'cloud-shadows' || kind === 'blossoms' || kind === 'rain-splash' || kind === 'ripples',
      depth: kind === 'cloud-shadows' || kind === 'rain-splash' || kind === 'ripples' ? 'under-actors' : 'over-actors',
      sprite: `fx.${kind}`,
      opacity: 0.9,
      count: 4,
    }));
    const parsed = parseAtmosphereConfig({
      version: 1,
      animal: ANIMAL,
      chapters: { '1': { ...rawChapter(), chapter: 1, layers } },
    });
    expect(chapterAtmosphere(parsed, 1)?.layers.map((layer) => layer.kind)).toEqual([
      ...ATMOSPHERE_LAYER_KINDS,
    ]);
  });

  it('rejects a decor key of the wrong family', () => {
    const raw = {
      version: 1,
      animal: ANIMAL,
      chapters: {
        '2': rawChapter({
          decor: { animals: ['fx.rain'], props: [], animalsPerRoom: 1, propsPerRoom: 0 },
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

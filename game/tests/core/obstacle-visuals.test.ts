import { describe, expect, it } from 'vitest';
import {
  obstacleSheets,
  obstacleVisual,
  type ObstacleVisualKey,
} from '../../assets/scripts/core/level/obstacle-visuals';

const NATURE = 'resources/art/tilesets/TilesetNature.png';
const ELEMENT = 'resources/art/tilesets/TilesetElement.png';
const VILLAGE = 'resources/art/tilesets/TilesetVillageAbandoned.png';
const HOLE = 'resources/art/tilesets/TilesetHole.png';
const DESERT = 'resources/art/tilesets/TilesetDesert.png';
const KEYS: readonly ObstacleVisualKey[] = ['pillar', 'pillarSmall', 'wall', 'pit'];

describe('obstacleVisual', () => {
  it('keeps chapters 1 and 2 on the Nature boulder / Element crate art', () => {
    for (const chapter of [1, 2]) {
      expect(obstacleVisual(chapter, 'pillar')).toEqual({
        sheet: NATURE,
        rect: { x: 240, y: 224, width: 32, height: 32 },
        tile: false,
      });
      expect(obstacleVisual(chapter, 'pillarSmall')).toEqual({
        sheet: ELEMENT,
        rect: { x: 112, y: 0, width: 16, height: 16 },
        tile: true,
      });
      expect(obstacleVisual(chapter, 'wall')).toEqual({
        sheet: NATURE,
        rect: { x: 272, y: 208, width: 16, height: 16 },
        tile: true,
      });
      expect(obstacleVisual(chapter, 'pit')).toEqual({
        sheet: NATURE,
        rect: { x: 240, y: 224, width: 32, height: 32 },
        tile: false,
      });
    }
  });

  it('falls back to chapter 1 for an unknown chapter', () => {
    expect(obstacleVisual(99, 'wall')).toEqual(obstacleVisual(1, 'wall'));
    expect(obstacleSheets(99)).toEqual(obstacleSheets(1));
  });

  it('draws chapter 3 from the village stone and hole sheets only', () => {
    expect(obstacleVisual(3, 'pillar').sheet).toBe(VILLAGE);
    expect(obstacleVisual(3, 'pillarSmall').sheet).toBe(VILLAGE);
    expect(obstacleVisual(3, 'wall').sheet).toBe(VILLAGE);
    expect(obstacleVisual(3, 'pit').sheet).toBe(HOLE);
    expect(obstacleSheets(3)).toEqual([VILLAGE, HOLE]);
  });

  it('uses one 16×16 cell for tiled frames and one cell per tile for frames', () => {
    for (const key of KEYS) {
      const visual = obstacleVisual(3, key);
      if (visual.tile) {
        expect([visual.rect.width, visual.rect.height], key).toEqual([16, 16]);
      }
    }
    expect(obstacleVisual(3, 'pillar')).toMatchObject({ tile: false, rect: { width: 16, height: 32 } });
    expect(obstacleVisual(3, 'pit')).toMatchObject({ tile: false, rect: { width: 32, height: 32 } });
  });

  it('draws chapter 4 desert obstacles with sandstone rocks and the 3×3 oasis pond pit', () => {
    expect(obstacleVisual(4, 'pillar')).toEqual({
      sheet: NATURE,
      rect: { x: 240, y: 160, width: 32, height: 32 },
      tile: false,
    });
    expect(obstacleVisual(4, 'pillarSmall')).toEqual({
      sheet: NATURE,
      rect: { x: 272, y: 208, width: 16, height: 16 },
      tile: true,
    });
    expect(obstacleVisual(4, 'pit')).toEqual({
      sheet: DESERT,
      rect: { x: 272, y: 112, width: 48, height: 48 },
      tile: false,
    });
    expect(obstacleSheets(4)).toEqual([NATURE, DESERT]);
  });
});

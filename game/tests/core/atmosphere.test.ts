/**
 * Acceptance & unit tests for chapter weather & living decor (#6, rebuilt in M11 per ADR-019).
 *
 * Seam: pure `core/atmosphere/*` modules + `assets/resources/data/atmosphere.json` +
 * `assets/resources/data/animations.json` + real `.tmx` rooms of chapters 1–3.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_LAYER_KINDS,
  ATMOSPHERE_LAYER_STYLES,
  COMBAT_PROP_ALPHA,
  COMBAT_WEATHER_OPACITY_MAX,
  COMBAT_WEATHER_OPACITY_MIN,
  PARTICLE_PIXEL_SCALE,
  chapterAtmosphere,
  parseAtmosphereConfig,
  particleDrawSizeTiles,
  particleScaleForEntry,
  visibleAtmosphere,
  type AnimalTuning,
  type AtmosphereConfig,
  type ChapterAtmosphere,
} from '../../assets/scripts/core/atmosphere/atmosphere';
import {
  DECOR_SPAWN_CLEARANCE_TILES,
  createAnimal,
  placeDecor,
  stepAnimal,
  type AnimalState,
} from '../../assets/scripts/core/atmosphere/living-decor';
import { resolve, validateManifest } from '../../assets/scripts/core/art/manifest';
import { TILE_SIZE_PX, type LevelData, type Obstacle } from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { distance } from '../../assets/scripts/core/math/vec2';
import { SeededRng } from '../../assets/scripts/core/rng';
import { DEFAULT_SETTINGS } from '../../assets/scripts/core/save/settings';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'assets', 'resources', 'data');

function loadConfig(): AtmosphereConfig {
  return parseAtmosphereConfig(
    JSON.parse(readFileSync(join(DATA, 'atmosphere.json'), 'utf8')) as unknown,
  );
}

function loadManifest() {
  return validateManifest(
    JSON.parse(readFileSync(join(DATA, 'animations.json'), 'utf8')) as unknown,
  );
}

function chapterOf(config: AtmosphereConfig, chapter: number): ChapterAtmosphere {
  const atmosphere = chapterAtmosphere(config, chapter);
  if (atmosphere === null) throw new Error(`chapter ${chapter} has no atmosphere`);
  return atmosphere;
}

const roomsOf = (chapter: number): LevelData[] =>
  loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`));

/** 1×1 footprint centred on `at` overlaps the obstacle rectangle by a positive area. */
function footprintHits(at: Vec2, obstacle: Obstacle): boolean {
  const eps = 1e-6;
  return (
    at.x + 0.5 > obstacle.x + eps &&
    at.x - 0.5 < obstacle.x + obstacle.width - eps &&
    at.y + 0.5 > obstacle.y + eps &&
    at.y - 0.5 < obstacle.y + obstacle.height - eps
  );
}

function insideRoom(at: Vec2, size: { readonly cols: number; readonly rows: number }): boolean {
  const eps = 1e-6;
  return (
    at.x >= 0.5 - eps &&
    at.x <= size.cols - 0.5 + eps &&
    at.y >= 0.5 - eps &&
    at.y <= size.rows - 0.5 + eps
  );
}

function reservedPoints(level: LevelData): Vec2[] {
  const points: Vec2[] = [level.playerStart];
  for (const wave of level.waves) for (const enemy of wave.enemies) points.push(enemy.at);
  for (const door of level.doors) points.push(door.at);
  if (level.bossStart !== undefined) points.push(level.bossStart);
  return points;
}

describe('ADR-019 — overlays dropped and chapter weather particles configured at 1:1 pixel scale', () => {
  it('removes raylight, fog, vignette, and heat-haze from ATMOSPHERE_LAYER_KINDS', () => {
    for (const removed of ['raylight', 'fog', 'vignette', 'heat-haze']) {
      expect(ATMOSPHERE_LAYER_KINDS).not.toContain(removed);
    }
    expect(ATMOSPHERE_LAYER_KINDS).toEqual(
      expect.arrayContaining([
        'leaves',
        'blossoms',
        'cloud-shadows',
        'rain',
        'rain-splash',
        'ripples',
        'ash',
        'sand',
      ]),
    );
  });

  it('chapters 1–4 each have the M11 weather layers and Ch3 includes smoking campfires', () => {
    const config = loadConfig();
    const kinds = (chapter: number): string[] =>
      chapterOf(config, chapter).layers.map((layer) => layer.kind);

    expect(kinds(1)).toEqual(expect.arrayContaining(['leaves', 'blossoms', 'cloud-shadows']));
    expect(kinds(2)).toEqual(expect.arrayContaining(['rain', 'rain-splash', 'ripples']));
    expect(kinds(3)).toEqual(['ash']);
    expect(chapterOf(config, 3).decor.props).toContain('decor.campfire');
    expect(kinds(4)).toEqual(expect.arrayContaining(['sand', 'cloud-shadows']));
    expect(chapterAtmosphere(config, 99)).toBeNull();
  });

  it('sizes every particle layer strictly at 1:1 pixel scale (1/16 tile per texture px, never crushed)', () => {
    expect(PARTICLE_PIXEL_SCALE).toBe(1 / TILE_SIZE_PX);
    expect(PARTICLE_PIXEL_SCALE).toBe(1 / 16);

    const config = loadConfig();
    const manifest = loadManifest();
    for (const chapter of [1, 2, 3, 4]) {
      for (const layer of chapterOf(config, chapter).layers) {
        const entry = resolve(manifest, layer.sprite);
        expect(particleScaleForEntry(entry), `${chapter}/${layer.kind}`).toBe(1 / 16);
        const draw = particleDrawSizeTiles(entry);
        expect(draw.width, `${chapter}/${layer.kind} width`).toBe(entry.frameWidth / 16);
        expect(draw.height, `${chapter}/${layer.kind} height`).toBe(entry.frameHeight / 16);
        expect(ATMOSPHERE_LAYER_STYLES[layer.kind]).toBeDefined();
      }
    }
    // 12×7 leaves draw at 0.75 × 0.4375 tiles (never crushed to 0.45 max-axis); 8×8 rain draws at 0.5 × 0.5.
    expect(particleDrawSizeTiles(resolve(manifest, 'fx.leaf'))).toEqual({
      width: 12 / 16,
      height: 7 / 16,
    });
    expect(particleDrawSizeTiles(resolve(manifest, 'fx.rain'))).toEqual({
      width: 0.5,
      height: 0.5,
    });
  });

  it('keeps over-actor combat weather particles soft (30–40% opacity, alpha 80–102) and cloud-shadows subtle under-actors (M18 ADR-026)', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3, 4]) {
      for (const layer of chapterOf(config, chapter).layers) {
        expect(layer.opacity, `${chapter}/${layer.kind}`).toBeGreaterThan(0);
        expect(layer.count, `${chapter}/${layer.kind}`).toBeGreaterThanOrEqual(1);
        if (layer.kind === 'cloud-shadows') {
          expect(layer.depth, `${chapter}/cloud-shadows`).toBe('under-actors');
          expect(layer.opacity, `${chapter}/cloud-shadows`).toBeLessThanOrEqual(0.25);
        } else if (layer.depth === 'over-actors') {
          // M18 (ADR-026): 1:1 pixel scale kept, opacity softened to 30–40% (alpha 80–102) & trimmed count.
          expect(layer.opacity, `${chapter}/${layer.kind} combat opacity min`).toBeGreaterThanOrEqual(
            COMBAT_WEATHER_OPACITY_MIN,
          );
          expect(layer.opacity, `${chapter}/${layer.kind} combat opacity max`).toBeLessThanOrEqual(
            COMBAT_WEATHER_OPACITY_MAX,
          );
          const alphaByte = Math.round(layer.opacity * 255);
          expect(alphaByte, `${chapter}/${layer.kind} alpha byte`).toBeGreaterThanOrEqual(76);
          expect(alphaByte, `${chapter}/${layer.kind} alpha byte`).toBeLessThanOrEqual(102);
          expect(layer.count, `${chapter}/${layer.kind} trimmed count`).toBeLessThanOrEqual(20);
        } else {
          expect(layer.depth, `${chapter}/${layer.kind}`).toBe('under-actors');
        }
      }
    }
  });

  it('chapters 1–3 have animals and animated props; every sprite key resolves in animations.json', () => {
    const config = loadConfig();
    const manifest = loadManifest();
    for (const chapter of [1, 2, 3]) {
      const { decor } = chapterOf(config, chapter);
      expect(decor.animals.length, `chapter ${chapter} animals`).toBeGreaterThan(0);
      expect(decor.props.length, `chapter ${chapter} props`).toBeGreaterThan(0);
      expect(decor.animalsPerRoom, `chapter ${chapter}`).toBeGreaterThanOrEqual(1);
      expect(decor.propsPerRoom, `chapter ${chapter}`).toBeGreaterThanOrEqual(1);
      for (const key of decor.animals) expect(key.startsWith('animal.'), key).toBe(true);
      for (const key of decor.props) expect(key.startsWith('decor.'), key).toBe(true);
    }
    for (const chapter of [1, 2, 3, 4]) {
      const { layers, decor } = chapterOf(config, chapter);
      const keys = [...layers.map((layer) => layer.sprite), ...decor.animals, ...decor.props];
      for (const key of keys) {
        expect(manifest.sprites[key], `${key} missing in animations.json`).toBeDefined();
      }
    }
  });

  it('animal tuning is sane: flee radius 2–6 tiles, fleeing is faster than wandering', () => {
    const { animal } = loadConfig();
    expect(animal.fleeRadiusTiles).toBeGreaterThanOrEqual(2);
    expect(animal.fleeRadiusTiles).toBeLessThanOrEqual(6);
    expect(animal.wanderSpeedTilesPerSec).toBeGreaterThan(0);
    expect(animal.fleeSpeedTilesPerSec).toBeGreaterThan(animal.wanderSpeedTilesPerSec);
  });

  it('parse rejects broken data with a message', () => {
    expect(() => parseAtmosphereConfig({ version: 2 })).toThrow();
    expect(() => parseAtmosphereConfig(null)).toThrow();
  });
});

describe('Effects setting — Reduced drops secondary layers, cloud shadows, animals, and props', () => {
  it('Full in combat rooms (default, M18 ADR-026) disables wandering animals and mutes props to 0.65; non-combat hub/menu keeps animals', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3, 4]) {
      const atmosphere = chapterOf(config, chapter);
      const combatVisible = visibleAtmosphere(atmosphere, DEFAULT_SETTINGS.effects);
      expect(DEFAULT_SETTINGS.effects).toBe('full');
      expect(combatVisible.layers).toEqual(atmosphere.layers);
      expect(combatVisible.animals).toBe(false);
      expect(combatVisible.animatedProps).toBe(true);
      expect(combatVisible.propAlpha).toBeCloseTo(COMBAT_PROP_ALPHA, 5);

      const hubVisible = visibleAtmosphere(atmosphere, DEFAULT_SETTINGS.effects, { combat: false });
      expect(hubVisible.animals).toBe(true);
      expect(hubVisible.animatedProps).toBe(true);
      expect(hubVisible.propAlpha).toBe(1);
    }
  });

  it('Reduced drops secondary layers (blossoms, cloud-shadows, rain-splash, ripples) and keeps primary weather', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3, 4]) {
      const atmosphere = chapterOf(config, chapter);
      const visible = visibleAtmosphere(atmosphere, 'reduced');
      expect(visible.layers.some((layer) => layer.secondary), `chapter ${chapter}`).toBe(false);
      expect(visible.layers.some((layer) => layer.kind === 'cloud-shadows'), `chapter ${chapter}`).toBe(
        false,
      );
      expect(visible.layers).toEqual(atmosphere.layers.filter((layer) => !layer.secondary));
      expect(visible.animals).toBe(false);
      expect(visible.animatedProps).toBe(false);
    }
    expect(visibleAtmosphere(chapterOf(config, 1), 'reduced').layers.map((layer) => layer.kind)).toEqual([
      'leaves',
    ]);
    expect(visibleAtmosphere(chapterOf(config, 2), 'reduced').layers.map((layer) => layer.kind)).toEqual([
      'rain',
    ]);
    expect(visibleAtmosphere(chapterOf(config, 3), 'reduced').layers.map((layer) => layer.kind)).toEqual([
      'ash',
    ]);
    expect(visibleAtmosphere(chapterOf(config, 4), 'reduced').layers.map((layer) => layer.kind)).toEqual([
      'sand',
    ]);
  });
});

describe('decor placement — off obstacles and spawns, in every real room of chapters 1–3', () => {
  for (const chapter of [1, 2, 3]) {
    it(`chapter ${chapter}: exact counts, inside the room, no obstacle, ≥ clearance from spawns/doors, no overlap`, () => {
      const spec = chapterOf(loadConfig(), chapter).decor;
      const rooms = roomsOf(chapter);
      expect(rooms.length).toBeGreaterThanOrEqual(9);
      for (const level of rooms) {
        for (const seed of [1, 42, 20261119]) {
          const items = placeDecor(level, spec, seed);
          const where = `${level.id} seed ${seed}`;
          expect(items.filter((item) => item.kind === 'animal'), where).toHaveLength(
            spec.animalsPerRoom,
          );
          expect(items.filter((item) => item.kind === 'prop'), where).toHaveLength(spec.propsPerRoom);
          for (const item of items) {
            const at = `${where} ${item.sprite} @ ${item.at.x},${item.at.y}`;
            expect(insideRoom(item.at, level.size), at).toBe(true);
            const allowed = item.kind === 'animal' ? spec.animals : spec.props;
            expect(allowed, at).toContain(item.sprite);
            for (const obstacle of level.obstacles) {
              expect(footprintHits(item.at, obstacle), at).toBe(false);
            }
            for (const point of reservedPoints(level)) {
              expect(distance(item.at, point), `${at} vs ${point.x},${point.y}`).toBeGreaterThanOrEqual(
                DECOR_SPAWN_CLEARANCE_TILES,
              );
            }
          }
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const a = items[i]!.at;
              const b = items[j]!.at;
              const overlap = Math.abs(a.x - b.x) < 1 - 1e-6 && Math.abs(a.y - b.y) < 1 - 1e-6;
              expect(overlap, `${where} items ${i}/${j} overlap`).toBe(false);
            }
          }
        }
      }
    });
  }

  it('is deterministic per seed', () => {
    const spec = chapterOf(loadConfig(), 1).decor;
    const level = roomsOf(1)[2]!;
    expect(placeDecor(level, spec, 7)).toEqual(placeDecor(level, spec, 7));
  });
});

describe('animals — flee when the player comes within the radius', () => {
  const tuning: AnimalTuning = {
    fleeRadiusTiles: 3,
    wanderSpeedTilesPerSec: 1,
    fleeSpeedTilesPerSec: 4,
  };
  const open: LevelData = { ...roomsOf(1)[0]!, obstacles: [] };
  const step = (
    state: AnimalState,
    player: Vec2 | null,
    level: LevelData = open,
    rng = new SeededRng(3),
  ) => stepAnimal(state, { player, dtMs: 100, level, tuning, rng });

  it('player inside the radius → flee straight away from the player, at flee speed', () => {
    const start = createAnimal({ x: 16, y: 9 });
    const next = step(start, { x: 17.5, y: 9 });
    expect(next.mode).toBe('flee');
    expect(next.at.x).toBeLessThan(16);
    expect(next.at.y).toBeCloseTo(9, 5);
    expect(distance(start.at, next.at)).toBeCloseTo(0.4, 5);
    expect(next.facing).toBe(-1);
  });

  it('player diagonal inside the radius → the distance to the player grows', () => {
    const player = { x: 14, y: 11 };
    const start = createAnimal({ x: 15, y: 10 });
    const next = step(start, player);
    expect(next.mode).toBe('flee');
    expect(distance(next.at, player)).toBeGreaterThan(distance(start.at, player));
  });

  it('player outside the radius (or absent) → never flees', () => {
    let state = createAnimal({ x: 16, y: 9 });
    const rng = new SeededRng(11);
    for (let tick = 0; tick < 200; tick += 1) {
      state = stepAnimal(state, {
        player: { x: 16 + 3 * 2, y: 9 },
        dtMs: 50,
        level: open,
        tuning,
        rng,
      });
      expect(state.mode).not.toBe('flee');
    }
    let alone = createAnimal({ x: 10, y: 5 });
    for (let tick = 0; tick < 200; tick += 1) {
      alone = stepAnimal(alone, { player: null, dtMs: 50, level: open, tuning, rng });
      expect(alone.mode).not.toBe('flee');
    }
  });

  it('stops fleeing once the player is far again', () => {
    let state = step(createAnimal({ x: 16, y: 9 }), { x: 17, y: 9 });
    expect(state.mode).toBe('flee');
    const rng = new SeededRng(5);
    for (let tick = 0; tick < 100; tick += 1) {
      state = stepAnimal(state, { player: { x: 30, y: 1 }, dtMs: 50, level: open, tuning, rng });
    }
    expect(state.mode).not.toBe('flee');
  });

  it(
    'chased or wandering in every real room, the footprint never enters an obstacle or leaves the room',
    () => {
      for (const chapter of [1, 2, 3]) {
        for (const level of roomsOf(chapter)) {
          const spec = chapterOf(loadConfig(), chapter).decor;
          const rng = new SeededRng(level.room * 31 + chapter);
          for (const item of placeDecor(level, spec, 9).filter((entry) => entry.kind === 'animal')) {
            let state = createAnimal(item.at);
            for (let tick = 0; tick < 400; tick += 1) {
              const player =
                tick < 200 ? { x: state.at.x + 1.2, y: state.at.y + 0.8 } : { x: 0.5, y: 0.5 };
              state = stepAnimal(state, { player, dtMs: 50, level, tuning, rng });
              const at = `${level.id} ${item.sprite} tick ${tick} @ ${state.at.x},${state.at.y}`;
              expect(insideRoom(state.at, level.size), at).toBe(true);
              for (const obstacle of level.obstacles) {
                expect(footprintHits(state.at, obstacle), at).toBe(false);
              }
            }
          }
        }
      }
    },
    30_000,
  );
});

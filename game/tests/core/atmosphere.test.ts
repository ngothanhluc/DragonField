/**
 * Acceptance test for ticket #6 (chapter atmosphere + living decor). Written by the orchestrator;
 * the executor does NOT edit this file.
 *
 * Seam: the pure `core/atmosphere/*` modules + `assets/resources/data/atmosphere.json` + the real
 * `.tmx` rooms of chapters 1–3. What is actually drawn (layer order, fps) is proven in the
 * browser, not here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  chapterAtmosphere,
  parseAtmosphereConfig,
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
import { validateManifest } from '../../assets/scripts/core/art/manifest';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { distance } from '../../assets/scripts/core/math/vec2';
import { SeededRng } from '../../assets/scripts/core/rng';
import { DEFAULT_SETTINGS } from '../../assets/scripts/core/save/settings';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'assets', 'resources', 'data');

/** Read lazily so a missing file fails the tests that need it, not the whole module. */
function loadConfig(): AtmosphereConfig {
  return parseAtmosphereConfig(
    JSON.parse(readFileSync(join(DATA, 'atmosphere.json'), 'utf8')) as unknown,
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
    at.x >= 0.5 - eps && at.x <= size.cols - 0.5 + eps && at.y >= 0.5 - eps && at.y <= size.rows - 0.5 + eps
  );
}

function reservedPoints(level: LevelData): Vec2[] {
  const points: Vec2[] = [level.playerStart];
  for (const wave of level.waves) for (const enemy of wave.enemies) points.push(enemy.at);
  for (const door of level.doors) points.push(door.at);
  if (level.bossStart !== undefined) points.push(level.bossStart);
  return points;
}

describe('atmosphere.json — per-chapter config is data', () => {
  it('chapters 1–4 each have the layers the spec names', () => {
    const config = loadConfig();
    const kinds = (chapter: number): string[] => chapterOf(config, chapter).layers.map((layer) => layer.kind);
    expect(kinds(1)).toEqual(expect.arrayContaining(['raylight', 'leaves']));
    expect(kinds(2)).toEqual(expect.arrayContaining(['fog', 'ripples']));
    expect(kinds(3)).toEqual(expect.arrayContaining(['ash', 'vignette']));
    // Chapter 4 (M9 desert) is configured now so M9 only has to add rooms.
    expect(kinds(4)).toEqual(expect.arrayContaining(['sand', 'heat-haze']));
    expect(chapterAtmosphere(config, 99)).toBeNull();
  });

  it('particle layers are secondary; the base light/fog/vignette is not', () => {
    const config = loadConfig();
    const layer = (chapter: number, kind: string) =>
      chapterOf(config, chapter).layers.find((entry) => entry.kind === kind);
    for (const [chapter, kind] of [[1, 'leaves'], [2, 'ripples'], [3, 'ash'], [4, 'sand']] as const) {
      expect(layer(chapter, kind)?.secondary, `${chapter}/${kind}`).toBe(true);
    }
    for (const [chapter, kind] of [[1, 'raylight'], [2, 'fog'], [3, 'vignette']] as const) {
      expect(layer(chapter, kind)?.secondary, `${chapter}/${kind}`).toBe(false);
    }
  });

  it('a layer drawn over actors is low alpha, so it never hides telegraphs or bullets', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3, 4]) {
      for (const layer of chapterOf(config, chapter).layers) {
        expect(layer.opacity, `${chapter}/${layer.kind}`).toBeGreaterThan(0);
        expect(layer.count, `${chapter}/${layer.kind}`).toBeGreaterThanOrEqual(1);
        if (layer.depth === 'over-actors') {
          expect(layer.opacity, `${chapter}/${layer.kind} is over actors`).toBeLessThanOrEqual(0.4);
        }
      }
    }
  });

  it('chapters 1–3 have animals and animated props; every sprite key resolves in animations.json', () => {
    const config = loadConfig();
    const manifest = validateManifest(
      JSON.parse(readFileSync(join(DATA, 'animations.json'), 'utf8')) as unknown,
    );
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
      const keys = [
        ...layers.flatMap((layer) => (layer.sprite === null ? [] : [layer.sprite])),
        ...decor.animals,
        ...decor.props,
      ];
      for (const key of keys) expect(manifest.sprites[key], `${key} missing in animations.json`).toBeDefined();
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

describe('Effects setting — Reduced turns off the secondary layers', () => {
  it('Full (the default) keeps every layer, animals and animated props', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3]) {
      const atmosphere = chapterOf(config, chapter);
      const visible = visibleAtmosphere(atmosphere, DEFAULT_SETTINGS.effects);
      expect(DEFAULT_SETTINGS.effects).toBe('full');
      expect(visible.layers).toEqual(atmosphere.layers);
      expect(visible.animals).toBe(true);
      expect(visible.animatedProps).toBe(true);
    }
  });

  it('Reduced drops secondary particles, animals and animated props but keeps the base layer', () => {
    const config = loadConfig();
    for (const chapter of [1, 2, 3, 4]) {
      const atmosphere = chapterOf(config, chapter);
      const visible = visibleAtmosphere(atmosphere, 'reduced');
      expect(visible.layers.some((layer) => layer.secondary), `chapter ${chapter}`).toBe(false);
      expect(visible.layers).toEqual(atmosphere.layers.filter((layer) => !layer.secondary));
      expect(visible.animals).toBe(false);
      expect(visible.animatedProps).toBe(false);
    }
    expect(visibleAtmosphere(chapterOf(config, 1), 'reduced').layers.map((layer) => layer.kind)).toEqual([
      'raylight',
    ]);
  });
});

describe('decor placement — off obstacles and spawns, in every real room of chapters 1–3', () => {
  for (const chapter of [1, 2, 3]) {
    it(`chapter ${chapter}: exact counts, inside the room, no obstacle, ≥ clearance from spawns/doors, no overlap`, () => {
      const spec = chapterOf(loadConfig(), chapter).decor;
      const rooms = roomsOf(chapter);
      // Every room on disk: the chapter's 16-room pool + its boss (#38).
      expect(rooms.length).toBeGreaterThanOrEqual(9);
      for (const level of rooms) {
        for (const seed of [1, 42, 20261119]) {
          const items = placeDecor(level, spec, seed);
          const where = `${level.id} seed ${seed}`;
          expect(items.filter((item) => item.kind === 'animal'), where).toHaveLength(spec.animalsPerRoom);
          expect(items.filter((item) => item.kind === 'prop'), where).toHaveLength(spec.propsPerRoom);
          for (const item of items) {
            const at = `${where} ${item.sprite} @ ${item.at.x},${item.at.y}`;
            expect(insideRoom(item.at, level.size), at).toBe(true);
            const allowed = item.kind === 'animal' ? spec.animals : spec.props;
            expect(allowed, at).toContain(item.sprite);
            for (const obstacle of level.obstacles) expect(footprintHits(item.at, obstacle), at).toBe(false);
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
  const tuning: AnimalTuning = { fleeRadiusTiles: 3, wanderSpeedTilesPerSec: 1, fleeSpeedTilesPerSec: 4 };
  /** An open room: no obstacles, so only the flee rule moves the animal. */
  const open: LevelData = { ...roomsOf(1)[0]!, obstacles: [] };
  const step = (state: AnimalState, player: Vec2 | null, level: LevelData = open, rng = new SeededRng(3)) =>
    stepAnimal(state, { player, dtMs: 100, level, tuning, rng });

  it('player inside the radius → flee straight away from the player, at flee speed', () => {
    const start = createAnimal({ x: 16, y: 9 });
    const next = step(start, { x: 17.5, y: 9 });
    expect(next.mode).toBe('flee');
    expect(next.at.x).toBeLessThan(16);
    expect(next.at.y).toBeCloseTo(9, 5);
    // 4 tiles/s × 0.1 s = 0.4 tiles.
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
      state = stepAnimal(state, { player: { x: 16 + 3 * 2, y: 9 }, dtMs: 50, level: open, tuning, rng });
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

  // 51 rooms since #38 (16-room pools + bosses); the per-tick obstacle scan needs more than the
  // default 5 s budget.
  it('chased or wandering in every real room, the footprint never enters an obstacle or leaves the room', () => {
    for (const chapter of [1, 2, 3]) {
      for (const level of roomsOf(chapter)) {
        const spec = chapterOf(loadConfig(), chapter).decor;
        const rng = new SeededRng(level.room * 31 + chapter);
        for (const item of placeDecor(level, spec, 9).filter((entry) => entry.kind === 'animal')) {
          let state = createAnimal(item.at);
          for (let tick = 0; tick < 400; tick += 1) {
            // First half: the player walks straight at the animal; second half: player far away.
            const player =
              tick < 200 ? { x: state.at.x + 1.2, y: state.at.y + 0.8 } : { x: 0.5, y: 0.5 };
            state = stepAnimal(state, { player, dtMs: 50, level, tuning, rng });
            const at = `${level.id} ${item.sprite} tick ${tick} @ ${state.at.x},${state.at.y}`;
            expect(insideRoom(state.at, level.size), at).toBe(true);
            for (const obstacle of level.obstacles) expect(footprintHits(state.at, obstacle), at).toBe(false);
          }
        }
      }
    }
  }, 30_000);
});


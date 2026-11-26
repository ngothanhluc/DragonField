import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AnimationManifest, SpriteEntry } from '../../assets/scripts/core/art/manifest';
import { REQUIRED_ACTOR_ANIMATIONS, REQUIRED_KEYS, resolve, validateManifest } from '../../assets/scripts/core/art/manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json');

const DIRS = ['down', 'up', 'left', 'right'] as const;
type Dir = (typeof DIRS)[number];

/** Independent copy of the key rule: tests must not borrow the module's regex. */
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

const MONSTERS = [
  'bluebat',
  'spiderred',
  'snake3',
  'eye',
  'greenoctopus',
  'lanternred',
  'bear',
  'trex',
  'cyclope',
  // #42 — sniper and splitter monsters (staged from the pack).
  'kappagreen',
  'kappared',
  'skullblue',
  'slimegreen',
  'slime2',
  'slime3',
  // M13 — bomber and buffer monsters (staged from the pack).
  'flam',
  'mushroom',
  'flam2',
  'mushroom2',
  'spirit',
  'lanterngreen',
  'spirit2',
  'owl2',
] as const;
const BOSSES = ['tengu', 'squid', 'samurai', 'frog', 'slime', 'bamboo', 'racoon', 'redtengu'] as const;

interface GeneratedActors {
  readonly actors: readonly string[];
  readonly monsters: readonly string[];
  readonly bosses: readonly string[];
  /** Ticket #20 kinds: generated prefix allowlists (`icon`, `ui`, `attachment`, `prop`, `vfx`, `particle`). */
  readonly props?: readonly string[];
  readonly vfx?: readonly string[];
  readonly particles?: readonly string[];
  readonly attachments?: readonly string[];
  readonly icons?: readonly string[];
  readonly ui?: readonly string[];
}
const GENERATED = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'config', 'generated-art.json'), 'utf8'),
) as GeneratedActors;
/** Generated prefixes that are single-row sheets (icons, UI, effects, props). */
const GENERATED_STRIP_PREFIXES: ReadonlySet<string> = new Set([
  ...(GENERATED.props ?? []),
  ...(GENERATED.vfx ?? []),
  ...(GENERATED.particles ?? []),
  'icon',
  'ui',
]);
const MONSTER_ACTORS: ReadonlySet<string> = new Set([...MONSTERS, ...GENERATED.monsters]);
const BOSS_ACTORS: ReadonlySet<string> = new Set([...BOSSES, ...GENERATED.bosses]);

/** The real manifest, validated once per file. If it breaks, every test goes red immediately. */
const manifest: AnimationManifest = validateManifest(readJson());
const entries: [string, SpriteEntry][] = Object.entries(manifest.sprites);

function readJson(): unknown {
  const text: string = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(text) as unknown;
}

describe('animations.json', () => {
  it('validates and has the right version', () => {
    expect(manifest.version).toBe(1);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every key matches <actor>.<animation>[.<direction>]', () => {
    for (const [key] of entries) {
      expect(KEY_PATTERN.test(key), `malformed key: ${key}`).toBe(true);
    }
  });

  it('only uses known actors', () => {
    // `animal.*` / `decor.*` are ticket #6's living decor (M8): decor is art, not combat actors.
    const actors: ReadonlySet<string> = new Set<string>([
      'player',
      ...MONSTERS,
      ...BOSSES,
      ...GENERATED.actors,
      ...GENERATED.monsters,
      ...GENERATED.bosses,
      ...(GENERATED.props ?? []),
      ...(GENERATED.vfx ?? []),
      ...(GENERATED.particles ?? []),
      ...(GENERATED.attachments ?? []),
      ...(GENERATED.icons ?? []),
      ...(GENERATED.ui ?? []),
      'fx',
      'animal',
      'decor',
    ]);
    for (const [key] of entries) {
      expect(actors.has(actorOf(key)), `unknown actor in key ${key}`).toBe(true);
    }
  });

  it('every REQUIRED_KEYS entry resolves', () => {
    for (const key of REQUIRED_KEYS) {
      const entry = resolve(manifest, key);
      expect(entry.frames, `${key} must have frames`).toBeGreaterThan(0);
    }
  });

  it('every role has its minimum animation set', () => {
    for (const [actor, keys] of Object.entries(REQUIRED_ACTOR_ANIMATIONS)) {
      for (const key of keys) {
        expect(() => resolve(manifest, key), `${actor} is missing ${key}`).not.toThrow();
      }
    }

    for (const monster of MONSTERS) {
      for (const dir of DIRS) {
        expect(manifest.sprites[`${monster}.idle.${dir}`], `${monster} idle ${dir}`).toBeDefined();
        expect(manifest.sprites[`${monster}.walk.${dir}`], `${monster} walk ${dir}`).toBeDefined();
      }
    }
  });

  it('a directional key declares the right axis in directions', () => {
    for (const [key, entry] of entries) {
      const direction = directionOf(key);
      if (direction === undefined) {
        expect(entry.directions, `${key} has no direction so directions must be empty`).toEqual([]);
        continue;
      }

      expect(entry.directions, `${key} must contain its own direction`).toContain(direction);

      const actor = actorOf(key);
      if (actor === 'player' || MONSTER_ACTORS.has(actor)) {
        expect(entry.directions, `${key} must be a 4-direction sheet`).toHaveLength(4);
      }
    }
  });

  it('samurai left/right attacks are single-direction sheets', () => {
    for (const key of [
      'samurai.attack.left',
      'samurai.attack.right',
      'samurai.charge.left',
      'samurai.charge.right',
    ]) {
      expect(resolve(manifest, key).directions, key).toHaveLength(1);
    }
  });

  it('frame size is sensible per actor', () => {
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      if (actor === 'player') {
        expect([entry.frameWidth, entry.frameHeight], `${key} must be a 32×32 frame`).toEqual([32, 32]);
      } else if (MONSTER_ACTORS.has(actor)) {
        expect([entry.frameWidth, entry.frameHeight], `${key} must be a 16×16 frame`).toEqual([16, 16]);
      } else if (BOSS_ACTORS.has(actor)) {
        // GiantFrog is authored at 40 px (the smallest boss art in the pack).
        expect(entry.frameWidth, `${key} is a boss frame, must be ≥ 40px`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('walk has at least 4 frames, idle/attack have real frames', () => {
    const walkKeys = entries.filter(([key]) => animationOf(key) === 'walk');

    expect(walkKeys.length, 'must have walk for player, 9 monsters and the bosses that have one').toBeGreaterThanOrEqual(
      1 + MONSTERS.length + BOSSES.length,
    );

    for (const [key, entry] of walkKeys) {
      expect(entry.frames, `${key} needs ≥ 4 frames`).toBeGreaterThanOrEqual(4);
    }

    for (const [key, entry] of entries) {
      const anim = animationOf(key);
      if (anim === 'idle') {
        expect(entry.frames, `${key} needs ≥ 2 frames`).toBeGreaterThanOrEqual(2);
      }
      if (anim === 'attack') {
        expect(entry.frames, `${key} needs ≥ 3 frames`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('each animation lasts a playable duration', () => {
    for (const [key, entry] of entries) {
      const seconds = entry.frames / entry.fps;
      expect(seconds, `${key} is too short`).toBeGreaterThanOrEqual(0.05);
      expect(seconds, `${key} is too long`).toBeLessThanOrEqual(3);
    }
  });

  it('loop in the right places: idle/walk loop, attack plays once', () => {
    for (const [key, entry] of entries) {
      const anim = animationOf(key);
      if (anim === 'idle' || anim === 'walk' || anim === 'attack-loop' || anim === 'charge') {
        expect(entry.loop, `${key} must loop`).toBe(true);
      }
      if (key.startsWith('player.') && (anim === 'attack' || anim === 'hit' || anim === 'roll')) {
        expect(entry.loop, `${key} must not loop`).toBe(false);
      }
    }

    expect(resolve(manifest, 'player.dead').loop).toBe(false);
  });

  it('layout matches sheet kind: player/monster are grid, bosses are strip', () => {
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      if (actor === 'fx') continue;
      // Ticket #20: icons, UI and generated effects/props are single-row sheets.
      if (GENERATED_STRIP_PREFIXES.has(actor)) {
        expect(entry.layout, `${key} must use a strip`).toBe('strip');
        continue;
      }
      const expected = BOSS_ACTORS.has(actor) ? 'strip' : 'grid';
      expect(entry.layout, `${key} must use layout ${expected}`).toBe(expected);
    }
  });

  it('sheet file name matches the animation in the key', () => {
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      // Monster sheets share the generic name SpriteSheet.png and carry no animation name.
      if (MONSTER_ACTORS.has(actor) || actor === 'fx') continue;

      const file = entry.sheet.split('/').pop() ?? '';
      const fileStem = file.toLowerCase().replace(/\.png$/, '').replace(/[^a-z0-9]/g, '');
      expect(
        fileStem.startsWith(animationOf(key).replace(/[^a-z0-9]/g, '')),
        `${key} points at ${file}`,
      ).toBe(true);
    }
  });

  it('boss frame counts match the real files (measured in pixels)', () => {
    const expectedFrames: ReadonlyArray<readonly [string, number]> = [
      ['tengu.idle', 6],
      ['tengu.walk', 10],
      ['tengu.attack', 15],
      ['tengu.hit', 8],
      ['tengu.trans', 11],
      ['squid.idle', 4],
      ['squid.walk', 4],
      ['squid.attack', 6],
      ['squid.attack-loop', 4],
      ['squid.shoot', 5],
      ['squid.hit', 4],
      ['samurai.idle', 6],
      ['samurai.walk', 6],
      ['samurai.attack.left', 4],
      ['samurai.attack.right', 4],
      ['samurai.charge.left', 3],
      ['samurai.charge.right', 3],
      ['samurai.hit', 4],
      // Ticket #43 — pool bosses.
      ['frog.idle', 5],
      ['frog.jump', 6],
      ['frog.charge', 7],
      ['frog.attack', 3],
      ['frog.hit', 3],
      ['slime.idle', 5],
      ['slime.jump', 13],
      ['slime.hit', 5],
      // Ticket #44 — ch3/ch4 pool bosses.
      ['bamboo.idle', 6],
      ['bamboo.walk', 12],
      ['bamboo.attack', 5],
      ['bamboo.charge', 3],
      ['bamboo.hit', 4],
      ['racoon.idle', 6],
      ['racoon.jump', 5],
      ['racoon.attack', 4],
      ['racoon.charge', 2],
      ['redtengu.idle', 6],
      ['redtengu.walk', 10],
      ['redtengu.attack', 15],
      ['redtengu.trans', 11],
      ['redtengu.hit', 8],
    ];

    for (const [key, frames] of expectedFrames) {
      expect(resolve(manifest, key).frames, key).toBe(frames);
    }
  });
});

describe('validateManifest', () => {
  it('accepts the real manifest', () => {
    expect(() => validateManifest(readJson())).not.toThrow();
  });

  it('reports a missing required field', () => {
    const error = captureError(() =>
      validateManifest(manifestWithoutField('player.walk.down', 'fps')),
    );

    expect(error.message).toContain('player.walk.down');
    expect(error.message).toContain('fps');
  });

  it('reports a malformed key', () => {
    const error = captureError(() =>
      validateManifest(renameKey('player.idle.down', 'Player.Idle.Down')),
    );

    expect(error.message).toContain('Player.Idle.Down');
    expect(error.message).toContain('key must look like');
  });

  it('reports a key pointing at a direction the entry does not have', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.down', (entry) => {
          entry['directions'] = ['up', 'left', 'right'];
        }),
      ),
    );

    expect(error.message).toContain('player.idle.down');
    expect(error.message).toContain('"down"');
  });

  it('reports a key without direction whose entry declares one', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('tengu.idle', (entry) => {
          entry['directions'] = ['down'];
        }),
      ),
    );

    expect(error.message).toContain('tengu.idle');
    expect(error.message).toContain('directions must be empty');
  });

  it('reports an unknown, duplicated or wrongly ordered direction', () => {
    const unknown = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.left', (entry) => {
          entry['directions'] = ['down', 'north', 'left'];
        }),
      ),
    );
    expect(unknown.message).toContain('north');

    const duplicated = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.left', (entry) => {
          entry['directions'] = ['down', 'left', 'left'];
        }),
      ),
    );
    expect(duplicated.message).toContain('duplicates');

    const reordered = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.right', (entry) => {
          entry['directions'] = ['left', 'right', 'down', 'up'];
        }),
      ),
    );
    expect(reordered.message).toContain('order');
  });

  it('reports an absolute sheet, an escaping pack path, or a non-png file', () => {
    const absolute = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = '/Users/me/pack/Idle.png';
        }),
      ),
    );
    expect(absolute.message).toContain('relative path');

    const escape = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = '../../secret/Idle.png';
        }),
      ),
    );
    expect(escape.message).toContain('relative path');

    const notPng = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = 'Actor/CharacterAnimated/NinjaGreen/Separate/Idle.jpg';
        }),
      ),
    );
    expect(notPng.message).toContain('.png');
  });

  it('reports wrong types for frame size, fps, loop, layout', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('player.attack.up', (entry) => {
          entry['frameWidth'] = 0;
          entry['frameHeight'] = '32';
          entry['fps'] = '20';
          entry['loop'] = 'yes';
          entry['layout'] = 'atlas';
        }),
      ),
    );

    for (const field of ['frameWidth', 'frameHeight', 'fps', 'loop', 'layout']) {
      expect(error.message, field).toContain(field);
    }
  });

  it('reports a strip layout with more than one direction', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('samurai.attack.left', (entry) => {
          entry['directions'] = ['down', 'left'];
        }),
      ),
    );

    expect(error.message).toContain('strip');
  });

  it('reports a wrong version, a non-object root, and empty sprites', () => {
    expect(() => validateManifest({ version: 2, sprites: readRawSprites() })).toThrowError(
      /version/,
    );
    expect(() => validateManifest(null)).toThrowError(/root/);
    expect(() => validateManifest([])).toThrowError(/root/);
    expect(() => validateManifest({ version: 1, sprites: [] })).toThrowError(/sprites/);
    expect(() => validateManifest({ version: 1, sprites: {} })).toThrowError(/empty/);
  });

  it('lists every problem, not just the first', () => {
    const sprites = readRawSprites();
    const walk = sprites['player.walk.up'];
    const idle = sprites['player.idle.down'];
    if (walk === undefined || idle === undefined) {
      throw new Error('fixture is missing player.walk.up or player.idle.down');
    }

    const error = captureError(() =>
      validateManifest({
        version: 1,
        sprites: {
          ...sprites,
          'player.walk.up': omit(walk, 'fps'),
          'Player.Walk.Up': walk,
          'player.idle': idle,
        },
      }),
    );

    expect(error.message).toContain('sprites["player.walk.up"]');
    expect(error.message).toContain('sprites["Player.Walk.Up"]');
    expect(error.message).toContain('sprites["player.idle"]');

    const problemLines = error.message
      .split('\n')
      .filter((line) => line.trimStart().startsWith('- '));
    expect(problemLines.length).toBeGreaterThanOrEqual(3);
  });
});

describe('resolve', () => {
  it('returns the entry for a key that exists', () => {
    const entry = resolve(manifest, 'player.walk.left');

    expect(entry.sheet).toBe('resources/art/characters/ninja-green/Walk.png');
    expect(entry.frames).toBe(4);
    expect(entry.directions).toEqual(['down', 'up', 'left', 'right']);
  });

  it('prefers the primary key over the fallback', () => {
    const entry = resolve(manifest, 'player.walk.right', 'player.idle.down');

    expect(entry.sheet).toContain('Walk.png');
  });

  it('uses the fallback when the primary key is missing', () => {
    const fallback = resolve(manifest, 'player.walk.down');

    expect(resolve(manifest, 'player.backflip.down', 'player.walk.down')).toBe(fallback);
  });

  it('reports both keys when neither the primary nor the fallback exists', () => {
    const error = captureError(() => resolve(manifest, 'player.backflip.up', 'player.backflip.down'));

    expect(error.message).toContain('player.backflip.up');
    expect(error.message).toContain('player.backflip.down');
  });

  it('reports same-actor key suggestions when there is no fallback', () => {
    const error = captureError(() => resolve(manifest, 'player.backflip.left'));

    expect(error.message).toContain('player.backflip.left');
    expect(error.message).toContain('player.walk.down');
  });

  it('reports an empty key', () => {
    expect(() => resolve(manifest, '')).toThrowError(/empty/);
  });
});

// ---------------------------------------------------------------------------
// Helper: raw JSON manipulation to build broken fixtures
// ---------------------------------------------------------------------------

type RawEntry = Record<string, unknown>;
type RawSprites = Record<string, RawEntry>;

function readRawSprites(): RawSprites {
  const raw: unknown = readJson();
  if (!isRecord(raw)) {
    throw new Error('fixture: animations.json must be an object');
  }
  const sprites = raw['sprites'];
  if (!isRecord(sprites)) {
    throw new Error('fixture: "sprites" must be an object');
  }

  const result: RawSprites = {};
  for (const [key, entry] of Object.entries(sprites)) {
    if (!isRecord(entry)) {
      throw new Error(`fixture: entry "${key}" must be an object`);
    }
    result[key] = { ...entry };
  }
  return result;
}

function manifestWithEntry(key: string, mutate: (entry: RawEntry) => void): unknown {
  const sprites = readRawSprites();
  const entry = sprites[key];
  if (entry === undefined) {
    throw new Error(`fixture: no key ${key}`);
  }
  mutate(entry);
  return { version: 1, sprites };
}

function manifestWithoutField(key: string, field: string): unknown {
  const sprites = readRawSprites();
  const entry = sprites[key];
  if (entry === undefined) {
    throw new Error(`fixture: no key ${key}`);
  }
  sprites[key] = omit(entry, field);
  return { version: 1, sprites };
}

function renameKey(key: string, newKey: string): unknown {
  const sprites = readRawSprites();
  if (sprites[key] === undefined) {
    throw new Error(`fixture: no key ${key}`);
  }

  const renamed: RawSprites = {};
  for (const [candidate, entry] of Object.entries(sprites)) {
    renamed[candidate === key ? newKey : candidate] = entry;
  }
  return { version: 1, sprites: renamed };
}

function omit(entry: RawEntry, field: string): RawEntry {
  const copy: RawEntry = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key !== field) {
      copy[key] = value;
    }
  }
  return copy;
}

function actorOf(key: string): string {
  return key.split('.')[0] ?? '';
}

function animationOf(key: string): string {
  return key.split('.')[1] ?? '';
}

function directionOf(key: string): Dir | undefined {
  const segments = key.split('.');
  const last = segments[segments.length - 1];
  if (last === undefined) return undefined;
  return DIRS.find((dir) => dir === last);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`Expected Error, got ${String(error)}`);
  }
  throw new Error('Expected a throw but nothing was thrown');
}

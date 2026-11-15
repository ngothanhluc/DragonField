import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AnimationManifest, SpriteEntry } from '../../assets/scripts/core/art/manifest';
import { REQUIRED_KEYS, resolve, validateManifest } from '../../assets/scripts/core/art/manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json');

const DIRS = ['down', 'up', 'left', 'right'] as const;
type Dir = (typeof DIRS)[number];

/** Bản sao độc lập của quy tắc đặt key: test không được mượn regex của module. */
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
] as const;
const BOSSES = ['tengu', 'squid', 'samurai'] as const;
const MONSTER_ACTORS: ReadonlySet<string> = new Set(MONSTERS);
const BOSS_ACTORS: ReadonlySet<string> = new Set(BOSSES);

/** Manifest thật, validate một lần cho cả file. Hỏng thì mọi test đỏ ngay. */
const manifest: AnimationManifest = validateManifest(readJson());
const entries: [string, SpriteEntry][] = Object.entries(manifest.sprites);

function readJson(): unknown {
  const text: string = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(text) as unknown;
}

describe('animations.json', () => {
  it('validate được và đúng version', () => {
    expect(manifest.version).toBe(1);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('mọi key đúng định dạng <actor>.<animation>[.<direction>]', () => {
    for (const [key] of entries) {
      expect(KEY_PATTERN.test(key), `key sai định dạng: ${key}`).toBe(true);
    }
  });

  it('chỉ dùng actor đã chốt trong GDD', () => {
    const actors: ReadonlySet<string> = new Set<string>(['player', ...MONSTERS, ...BOSSES]);
    for (const [key] of entries) {
      expect(actors.has(actorOf(key)), `actor lạ trong key ${key}`).toBe(true);
    }
  });

  it('mọi REQUIRED_KEYS đều resolve được', () => {
    for (const key of REQUIRED_KEYS) {
      const entry = resolve(manifest, key);
      expect(entry.frames, `${key} phải có frame`).toBeGreaterThan(0);
    }
  });

  it('REQUIRED_KEYS đúng bộ M1 cần, không trùng', () => {
    const expected = [
      ...['idle', 'walk', 'attack', 'hit', 'roll'].flatMap((anim) =>
        DIRS.map((dir) => `player.${anim}.${dir}`),
      ),
      'player.dead',
      ...MONSTERS.flatMap((actor) => DIRS.map((dir) => `${actor}.walk.${dir}`)),
    ];

    expect([...REQUIRED_KEYS].sort()).toEqual(expected.sort());
  });

  it('key có direction thì directions khai báo đúng trục', () => {
    for (const [key, entry] of entries) {
      const direction = directionOf(key);
      if (direction === undefined) {
        expect(entry.directions, `${key} không hướng nên directions phải rỗng`).toEqual([]);
        continue;
      }

      expect(entry.directions, `${key} phải chứa direction của chính nó`).toContain(direction);

      const actor = actorOf(key);
      if (actor === 'player' || MONSTER_ACTORS.has(actor)) {
        expect(entry.directions, `${key} phải là sheet 4 hướng`).toHaveLength(4);
      }
    }
  });

  it('đòn trái/phải của samurai là sheet một hướng', () => {
    for (const key of [
      'samurai.attack.left',
      'samurai.attack.right',
      'samurai.charge.left',
      'samurai.charge.right',
    ]) {
      expect(resolve(manifest, key).directions, key).toHaveLength(1);
    }
  });

  it('frame size hợp lý theo actor', () => {
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      if (actor === 'player') {
        expect([entry.frameWidth, entry.frameHeight], `${key} phải là frame 32×32`).toEqual([32, 32]);
      } else if (MONSTER_ACTORS.has(actor)) {
        expect([entry.frameWidth, entry.frameHeight], `${key} phải là frame 16×16`).toEqual([16, 16]);
      } else {
        expect(entry.frameWidth, `${key} là frame boss, phải ≥ 60px`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('walk có ít nhất 4 frame, idle/attack có frame thật', () => {
    const walkKeys = entries.filter(([key]) => animationOf(key) === 'walk');

    expect(walkKeys.length, 'phải có walk cho player, 9 monster và 3 boss').toBeGreaterThanOrEqual(
      1 + MONSTERS.length + BOSSES.length,
    );

    for (const [key, entry] of walkKeys) {
      expect(entry.frames, `${key} cần ≥ 4 frame`).toBeGreaterThanOrEqual(4);
    }

    for (const [key, entry] of entries) {
      const anim = animationOf(key);
      if (anim === 'idle') {
        expect(entry.frames, `${key} cần ≥ 2 frame`).toBeGreaterThanOrEqual(2);
      }
      if (anim === 'attack') {
        expect(entry.frames, `${key} cần ≥ 3 frame`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('thời lượng mỗi animation nằm trong khoảng chơi được', () => {
    for (const [key, entry] of entries) {
      const seconds = entry.frames / entry.fps;
      expect(seconds, `${key} quá ngắn`).toBeGreaterThanOrEqual(0.05);
      expect(seconds, `${key} quá dài`).toBeLessThanOrEqual(3);
    }
  });

  it('loop đúng chỗ: idle/walk lặp, attack một lần', () => {
    for (const [key, entry] of entries) {
      const anim = animationOf(key);
      if (anim === 'idle' || anim === 'walk' || anim === 'attack-loop' || anim === 'charge') {
        expect(entry.loop, `${key} phải loop`).toBe(true);
      }
      if (key.startsWith('player.') && (anim === 'attack' || anim === 'hit' || anim === 'roll')) {
        expect(entry.loop, `${key} không được loop`).toBe(false);
      }
    }

    expect(resolve(manifest, 'player.dead').loop).toBe(false);
  });

  it('layout khớp loại sheet: player/monster là grid, boss là strip', () => {
    for (const [key, entry] of entries) {
      const expected = BOSS_ACTORS.has(actorOf(key)) ? 'strip' : 'grid';
      expect(entry.layout, `${key} phải layout ${expected}`).toBe(expected);
    }
  });

  it('tên file sheet khớp animation trong key', () => {
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      // Sheet monster tên chung là SpriteSheet.png, không mang tên animation.
      if (MONSTER_ACTORS.has(actor)) continue;

      const file = entry.sheet.split('/').pop() ?? '';
      const fileStem = file.toLowerCase().replace(/\.png$/, '').replace(/[^a-z0-9]/g, '');
      expect(
        fileStem.startsWith(animationOf(key).replace(/[^a-z0-9]/g, '')),
        `${key} trỏ tới ${file}`,
      ).toBe(true);
    }
  });

  it('số frame boss khớp file thật (đã đo pixel)', () => {
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
    ];

    for (const [key, frames] of expectedFrames) {
      expect(resolve(manifest, key).frames, key).toBe(frames);
    }
  });
});

describe('validateManifest', () => {
  it('chấp nhận manifest thật', () => {
    expect(() => validateManifest(readJson())).not.toThrow();
  });

  it('báo lỗi khi thiếu field bắt buộc', () => {
    const error = captureError(() =>
      validateManifest(manifestWithoutField('player.walk.down', 'fps')),
    );

    expect(error.message).toContain('player.walk.down');
    expect(error.message).toContain('fps');
  });

  it('báo lỗi khi key sai định dạng', () => {
    const error = captureError(() =>
      validateManifest(renameKey('player.idle.down', 'Player.Idle.Down')),
    );

    expect(error.message).toContain('Player.Idle.Down');
    expect(error.message).toContain('key phải dạng');
  });

  it('báo lỗi khi key trỏ direction mà directions không có', () => {
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

  it('báo lỗi khi key không hướng nhưng entry khai báo direction', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('tengu.idle', (entry) => {
          entry['directions'] = ['down'];
        }),
      ),
    );

    expect(error.message).toContain('tengu.idle');
    expect(error.message).toContain('directions phải rỗng');
  });

  it('báo lỗi direction lạ, trùng, hoặc sai thứ tự cột', () => {
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
    expect(duplicated.message).toContain('trùng');

    const reordered = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.right', (entry) => {
          entry['directions'] = ['left', 'right', 'down', 'up'];
        }),
      ),
    );
    expect(reordered.message).toContain('thứ tự');
  });

  it('báo lỗi sheet tuyệt đối, thoát pack, hoặc không phải png', () => {
    const absolute = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = '/Users/me/pack/Idle.png';
        }),
      ),
    );
    expect(absolute.message).toContain('tương đối');

    const escape = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = '../../secret/Idle.png';
        }),
      ),
    );
    expect(escape.message).toContain('tương đối');

    const notPng = captureError(() =>
      validateManifest(
        manifestWithEntry('player.idle.up', (entry) => {
          entry['sheet'] = 'Actor/CharacterAnimated/NinjaGreen/Separate/Idle.jpg';
        }),
      ),
    );
    expect(notPng.message).toContain('.png');
  });

  it('báo lỗi kiểu sai cho frame size, fps, loop, layout', () => {
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

  it('báo lỗi layout strip có nhiều hơn một direction', () => {
    const error = captureError(() =>
      validateManifest(
        manifestWithEntry('samurai.attack.left', (entry) => {
          entry['directions'] = ['down', 'left'];
        }),
      ),
    );

    expect(error.message).toContain('strip');
  });

  it('báo lỗi khi version sai, root không phải object, sprites rỗng', () => {
    expect(() => validateManifest({ version: 2, sprites: readRawSprites() })).toThrowError(
      /version/,
    );
    expect(() => validateManifest(null)).toThrowError(/root/);
    expect(() => validateManifest([])).toThrowError(/root/);
    expect(() => validateManifest({ version: 1, sprites: [] })).toThrowError(/sprites/);
    expect(() => validateManifest({ version: 1, sprites: {} })).toThrowError(/rỗng/);
  });

  it('liệt kê mọi lỗi, không chỉ lỗi đầu tiên', () => {
    const sprites = readRawSprites();
    const walk = sprites['player.walk.up'];
    const idle = sprites['player.idle.down'];
    if (walk === undefined || idle === undefined) {
      throw new Error('fixture thiếu player.walk.up hoặc player.idle.down');
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
  it('trả entry cho key có thật', () => {
    const entry = resolve(manifest, 'player.walk.left');

    expect(entry.sheet).toBe('resources/art/characters/ninja-green/Walk.png');
    expect(entry.frames).toBe(4);
    expect(entry.directions).toEqual(['down', 'up', 'left', 'right']);
  });

  it('ưu tiên key chính hơn fallback', () => {
    const entry = resolve(manifest, 'player.walk.right', 'player.idle.down');

    expect(entry.sheet).toContain('Walk.png');
  });

  it('dùng fallback khi key chính thiếu', () => {
    const fallback = resolve(manifest, 'player.walk.down');

    expect(resolve(manifest, 'player.dash.down', 'player.walk.down')).toBe(fallback);
  });

  it('báo lỗi kèm cả hai key khi key chính lẫn fallback đều thiếu', () => {
    const error = captureError(() => resolve(manifest, 'player.dash.up', 'player.dash.down'));

    expect(error.message).toContain('player.dash.up');
    expect(error.message).toContain('player.dash.down');
  });

  it('báo lỗi kèm gợi ý key cùng actor khi không có fallback', () => {
    const error = captureError(() => resolve(manifest, 'player.dash.left'));

    expect(error.message).toContain('player.dash.left');
    expect(error.message).toContain('player.walk.down');
  });

  it('báo lỗi khi key rỗng', () => {
    expect(() => resolve(manifest, '')).toThrowError(/rỗng/);
  });
});

// ---------------------------------------------------------------------------
// Helper: thao tác trên JSON thô để tạo fixture hỏng
// ---------------------------------------------------------------------------

type RawEntry = Record<string, unknown>;
type RawSprites = Record<string, RawEntry>;

function readRawSprites(): RawSprites {
  const raw: unknown = readJson();
  if (!isRecord(raw)) {
    throw new Error('fixture: animations.json phải là object');
  }
  const sprites = raw['sprites'];
  if (!isRecord(sprites)) {
    throw new Error('fixture: "sprites" phải là object');
  }

  const result: RawSprites = {};
  for (const [key, entry] of Object.entries(sprites)) {
    if (!isRecord(entry)) {
      throw new Error(`fixture: entry "${key}" phải là object`);
    }
    result[key] = { ...entry };
  }
  return result;
}

function manifestWithEntry(key: string, mutate: (entry: RawEntry) => void): unknown {
  const sprites = readRawSprites();
  const entry = sprites[key];
  if (entry === undefined) {
    throw new Error(`fixture: không có key ${key}`);
  }
  mutate(entry);
  return { version: 1, sprites };
}

function manifestWithoutField(key: string, field: string): unknown {
  const sprites = readRawSprites();
  const entry = sprites[key];
  if (entry === undefined) {
    throw new Error(`fixture: không có key ${key}`);
  }
  sprites[key] = omit(entry, field);
  return { version: 1, sprites };
}

function renameKey(key: string, newKey: string): unknown {
  const sprites = readRawSprites();
  if (sprites[key] === undefined) {
    throw new Error(`fixture: không có key ${key}`);
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
    throw new Error(`Mong đợi Error, nhận ${String(error)}`);
  }
  throw new Error('Mong đợi ném lỗi nhưng không ném');
}

/**
 * Animation manifest — the single source of sprite paths.
 *
 * Game code only refers to animations by logical key (`player.idle.down`), never by
 * assembling file paths. The real data lives in `assets/resources/data/animations.json`;
 * this module holds the type, validation and lookup. Pure TS: no `cc` import, testable with vitest.
 *
 * Key: `<actor>.<animation>.<direction>` for directional animations (`player.walk.left`),
 * `<actor>.<animation>` for non-directional ones (`player.dead`, `tengu.trans`).
 *
 * How sheets are sliced (the pack has no atlas JSON, every sheet is cut on a grid):
 * - `layout: "grid"`: **column = direction** in exactly the order of `directions` (the pack uses D/U/L/R),
 *   **row = frame**. Example Idle.png 128×128, frame 32×32, 4 directions = 4 columns × 4 rows.
 *   A single-column sheet (Dead.png 32×64) is also a grid with `directions: []`.
 * - `layout: "strip"`: a single row, frames run left to right (boss sheets).
 *
 * `sheet` is a path relative to `game/assets/` (e.g. `art/characters/ninja-green/Idle.png`),
 * NOT a path inside the original pack: the pack lives in `art-source/` and is gitignored, only the
 * subset actually used is copied into `game/assets/art/`.
 */

/** The 4 directions with real art in the pack. */
export type Direction = 'down' | 'up' | 'left' | 'right';

/** The pack's canonical column order from Ninja Adventure: D / U / L / R. */
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

/** How to read a sheet: see the file header. */
export type SheetLayout = 'grid' | 'strip';

/** One animation sliced out of a sheet. */
export interface SpriteEntry {
  /** Path relative to `game/assets/`. */
  readonly sheet: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly layout: SheetLayout;
  /** Empty when the animation has no direction. */
  readonly directions: readonly Direction[];
  /** Frame count of **one** direction (or the total frame count when there is no direction). */
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  /**
   * How a frame anchors to its node: actors stand on their **feet** (`feet`), explosions are
   * centred (`center`). Defaults to `feet` for older entries that do not declare it.
   */
  readonly anchor: SpriteAnchor;
  /**
   * Number of transparent pixels from the bottom of the frame to the lowest solid pixel (read from the PNG).
   * `SpriteAnimator` uses `footPx / frameHeight` as the vertical anchor, so a 96×48 and a
   * 96×96 frame still put their feet on the same line.
   */
  readonly footPx: number;
}

/** How a sprite anchors to its node. */
export type SpriteAnchor = 'feet' | 'center';


/** Contents of `assets/resources/data/animations.json` after validation. */
export interface AnimationManifest {
  readonly version: number;
  readonly sprites: Readonly<Record<string, SpriteEntry>>;
}

/** Schema version this module understands. */
export const MANIFEST_VERSION = 1;

/**
 * Valid key format: `[a-z0-9-]` segments joined by dots, at least 2 segments.
 * No uppercase, whitespace, underscores or `/`, so a key can never drift into a file path.
 */
export const ANIMATION_KEY_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/**
 * The required M6 keys, grouped by actor. Tests use this table to prove **every
 * role** has its minimum animation set, not just that "the manifest has many keys".
 */
export const REQUIRED_ACTOR_ANIMATIONS: Readonly<Record<string, readonly string[]>> = {
  player: [
    ...DIRECTIONS.map((dir) => `player.idle.${dir}`),
    ...DIRECTIONS.map((dir) => `player.walk.${dir}`),
    ...DIRECTIONS.map((dir) => `player.attack.${dir}`),
    ...DIRECTIONS.map((dir) => `player.hit.${dir}`),
    ...DIRECTIONS.map((dir) => `player.roll.${dir}`),
    'player.dead',
  ],
  bluebat: monsterAnimations('bluebat'),
  spiderred: monsterAnimations('spiderred'),
  snake3: monsterAnimations('snake3'),
  eye: monsterAnimations('eye'),
  greenoctopus: monsterAnimations('greenoctopus'),
  lanternred: monsterAnimations('lanternred'),
  bear: monsterAnimations('bear'),
  trex: monsterAnimations('trex'),
  cyclope: monsterAnimations('cyclope'),
  tengu: ['tengu.idle', 'tengu.walk', 'tengu.attack', 'tengu.hit', 'tengu.trans'],
  squid: [
    'squid.idle',
    'squid.walk',
    'squid.attack',
    'squid.attack-loop',
    'squid.shoot',
    'squid.hit',
  ],
  samurai: [
    'samurai.idle',
    'samurai.walk',
    'samurai.attack.left',
    'samurai.attack.right',
    'samurai.charge.left',
    'samurai.charge.right',
    'samurai.hit',
  ],
  // Ticket #43 — boss pool alternatives.
  frog: ['frog.idle', 'frog.jump', 'frog.charge', 'frog.attack', 'frog.hit'],
  slime: ['slime.idle', 'slime.jump', 'slime.hit'],
  // Ticket #44 — ch3/ch4 pool bosses.
  bamboo: ['bamboo.idle', 'bamboo.walk', 'bamboo.attack', 'bamboo.charge', 'bamboo.hit'],
  racoon: ['racoon.idle', 'racoon.jump', 'racoon.attack', 'racoon.charge'],
  redtengu: ['redtengu.idle', 'redtengu.walk', 'redtengu.attack', 'redtengu.trans', 'redtengu.hit'],
  fx: [
    'fx.shuriken',
    'fx.coin',
    'fx.energy-ball',
    'fx.impact',
    'fx.explosion',
    'fx.smoke',
    'fx.shield',
    'fx.ice',
    'fx.poison',
    // Ticket #3 — weapon VFX: player projectiles by loadout, per-chapter enemy balls,
    // dedicated impacts, aura/boost.
    'fx.big-energy-ball',
    'fx.ice-spike',
    'fx.plant-spike',
    'fx.shuriken-magic',
    'fx.kunai',
    'fx.big-shuriken',
    'fx.big-kunai',
    'fx.bubble',
    'fx.canon-ball',
    'fx.fireball',
    'fx.spark',
    'fx.cut',
    'fx.slash-arc',
    'fx.boost',
    'fx.smoke-circular',
    'fx.aura',
    // Ticket #6 / M11 (ADR-019) — chapter weather particles at 1:1 pixel scale (no full-screen overlays).
    'fx.leaf',
    'fx.leaf-pink',
    'fx.cloud-shadow',
    'fx.rain',
    'fx.rain-splash',
    'fx.ash',
    'fx.sand',
    'fx.ripple',
    // M12 — XP crystal orb tiers (`small` / `medium` / `large`, diamond silhouette per ADR-016).
    'fx.xp-orb-small',
    'fx.xp-orb-medium',
    'fx.xp-orb-large',
  ],
  // Ticket #6 / M11 — living decor: wandering animals and animated flags/flowers/plants/campfires.
  animal: ['animal.frog', 'animal.chicken', 'animal.cat', 'animal.racoon', 'animal.dog'],
  decor: [
    'decor.flower',
    'decor.plant',
    'decor.campfire',
    'decor.flag-green',
    'decor.flag-blue',
    'decor.flag-red',
    'decor.flag-black',
  ],
};

function monsterAnimations(actor: string): readonly string[] {
  return [
    ...DIRECTIONS.map((dir) => `${actor}.idle.${dir}`),
    ...DIRECTIONS.map((dir) => `${actor}.walk.${dir}`),
  ];
}

/** Flat list of every required key — used by the "can be resolved" test. */
export const REQUIRED_KEYS: readonly string[] = Object.values(REQUIRED_ACTOR_ANIMATIONS).flat();

/** One required key. */
export type RequiredKey = string;


/**
 * Validate raw JSON and return a normalised manifest.
 * Throws **one** `Error` listing **every** problem found, not just the first one.
 */
export function validateManifest(raw: unknown): AnimationManifest {
  const problems: string[] = [];

  if (!isRecord(raw)) {
    throw new Error(formatProblems([`root must be an object, got ${describeValue(raw)}`]));
  }

  if (raw['version'] !== MANIFEST_VERSION) {
    problems.push(`version must be ${MANIFEST_VERSION}, got ${describeValue(raw['version'])}`);
  }

  const spritesRaw = raw['sprites'];
  if (!isRecord(spritesRaw)) {
    problems.push(`sprites must be an object map key → entry, got ${describeValue(spritesRaw)}`);
    // Nothing left to walk: throw right away, but still include the version problem if any.
    throw new Error(formatProblems(problems));
  }

  const keys = Object.keys(spritesRaw);
  if (keys.length === 0) {
    problems.push('sprites is empty: at least one animation is required');
  }

  const sprites: Record<string, SpriteEntry> = {};
  for (const key of keys) {
    const entry = validateEntry(key, spritesRaw[key], problems);
    if (entry !== undefined) {
      sprites[key] = entry;
    }
  }

  if (problems.length > 0) {
    throw new Error(formatProblems(problems));
  }

  return { version: MANIFEST_VERSION, sprites };
}

/**
 * Look up one key. The primary key wins; if absent, `fallbackKey` is used (per the
 * "declare a fallback when the pack is missing art" rule in AGENTS.md). If neither exists, throws with suggestions.
 */
export function resolve(
  manifest: AnimationManifest,
  key: string,
  fallbackKey?: string,
): SpriteEntry {
  if (key.length === 0) {
    throw new Error('resolve: empty key.');
  }

  const direct = manifest.sprites[key];
  if (direct !== undefined) {
    return direct;
  }

  if (fallbackKey !== undefined) {
    const fallback = manifest.sprites[fallbackKey];
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(
      `No animation "${key}" nor fallback "${fallbackKey}". ${suggestKeys(manifest, key)}`,
    );
  }

  throw new Error(`No animation "${key}". ${suggestKeys(manifest, key)}`);
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateEntry(
  key: string,
  raw: unknown,
  problems: string[],
): SpriteEntry | undefined {
  const at = `sprites["${key}"]`;

  if (!ANIMATION_KEY_PATTERN.test(key)) {
    problems.push(
      `${at}: key must look like <actor>.<animation>[.<direction>], using only [a-z0-9-] and dots`,
    );
  }

  if (!isRecord(raw)) {
    problems.push(`${at}: entry must be an object, got ${describeValue(raw)}`);
    return undefined;
  }

  const sheet = readSheet(raw, at, problems);
  const layout = readLayout(raw, at, problems);
  const frameWidth = readPositiveInteger(raw, 'frameWidth', at, problems);
  const frameHeight = readPositiveInteger(raw, 'frameHeight', at, problems);
  const frames = readPositiveInteger(raw, 'frames', at, problems);
  const fps = readPositiveNumber(raw, 'fps', at, problems);
  const loop = readBoolean(raw, 'loop', at, problems);
  const directions = readDirections(raw, at, problems);
  const anchor = readAnchor(raw, at, problems);
  const footPx = readFootPx(raw, at, frameHeight, problems);

  if (directions !== undefined) {
    checkKeyMatchesDirections(key, directions, layout, at, problems);
  }

  if (
    sheet === undefined ||
    layout === undefined ||
    frameWidth === undefined ||
    frameHeight === undefined ||
    frames === undefined ||
    fps === undefined ||
    loop === undefined ||
    directions === undefined ||
    anchor === undefined ||
    footPx === undefined
  ) {
    return undefined;
  }

  return { sheet, frameWidth, frameHeight, layout, directions, frames, fps, loop, anchor, footPx };
}

/** Key ends with a direction ⇒ the entry must contain it; key does not ⇒ must be empty. */
function checkKeyMatchesDirections(
  key: string,
  directions: readonly Direction[],
  layout: SheetLayout | undefined,
  at: string,
  problems: string[],
): void {
  const segments = key.split('.');
  const last = segments[segments.length - 1];
  const keyDirection = last !== undefined && isDirection(last) ? last : undefined;

  if (keyDirection !== undefined) {
    if (!directions.includes(keyDirection)) {
      problems.push(
        `${at}: key points at direction "${keyDirection}" but directions = [${directions.join(', ')}]`,
      );
    }
  } else if (directions.length > 0) {
    problems.push(
      `${at}: key has no trailing direction so directions must be empty, got [${directions.join(', ')}]`,
    );
  }

  if (layout === 'strip' && directions.length > 1) {
    problems.push(`${at}: layout "strip" has a single row so directions can hold at most 1 element`);
  }
}

function readSheet(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): string | undefined {
  const value = record['sheet'];
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`${at}.sheet must be a non-empty path, got ${describeValue(value)}`);
    return undefined;
  }
  if (!isAssetRelativePath(value)) {
    problems.push(
      `${at}.sheet must be a relative path inside game/assets/ (relative, ending in .png, no ".."), got "${value}"`,
    );
    return undefined;
  }
  return value;
}

function readLayout(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): SheetLayout | undefined {
  const value = record['layout'];
  if (value === 'grid' || value === 'strip') {
    return value;
  }
  problems.push(`${at}.layout must be "grid" or "strip", got ${describeValue(value)}`);
  return undefined;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  problems.push(`${at}.${field} must be a positive integer, got ${describeValue(value)}`);
  return undefined;
}

function readPositiveNumber(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  problems.push(`${at}.${field} must be a finite number > 0, got ${describeValue(value)}`);
  return undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  field: string,
  at: string,
  problems: string[],
): boolean | undefined {
  const value = record[field];
  if (typeof value === 'boolean') {
    return value;
  }
  problems.push(`${at}.${field} must be a boolean, got ${describeValue(value)}`);
  return undefined;
}

function readDirections(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): Direction[] | undefined {
  const value = record['directions'];
  if (!Array.isArray(value)) {
    problems.push(
      `${at}.directions must be an array (empty when the animation has no direction), got ${describeValue(value)}`,
    );
    return undefined;
  }

  const items: readonly unknown[] = value;
  const parsed: Direction[] = [];
  items.forEach((item: unknown, index: number) => {
    if (!isDirection(item)) {
      problems.push(
        `${at}.directions[${index}] must be one of ${DIRECTIONS.join('/')}, got ${describeValue(item)}`,
      );
      return;
    }
    if (parsed.includes(item)) {
      problems.push(`${at}.directions[${index}] duplicates direction "${item}"`);
      return;
    }
    parsed.push(item);
  });

  if (parsed.length !== items.length) {
    return undefined;
  }

  if (!isCanonicalOrder(parsed)) {
    problems.push(
      `${at}.directions must follow the pack's column order (${DIRECTIONS.join(', ')}), got [${parsed.join(', ')}]`,
    );
    return undefined;
  }

  return parsed;
}

function readAnchor(
  record: Record<string, unknown>,
  at: string,
  problems: string[],
): SpriteAnchor | undefined {
  const value = record['anchor'];
  if (value === undefined) return 'feet';
  if (value === 'feet' || value === 'center') return value;
  problems.push(`${at}.anchor must be "feet" or "center", got ${describeValue(value)}`);
  return undefined;
}

function readFootPx(
  record: Record<string, unknown>,
  at: string,
  frameHeight: number | undefined,
  problems: string[],
): number | undefined {
  const value = record['footPx'];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.push(`${at}.footPx must be an integer >= 0, got ${describeValue(value)}`);
    return undefined;
  }
  if (frameHeight !== undefined && value >= frameHeight) {
    problems.push(
      `${at}.footPx (${value}) must be smaller than frameHeight (${frameHeight}) so the anchor stays inside the frame`,
    );
    return undefined;
  }
  return value;
}

/** Column order inside a sheet is fixed; reversing the array slices the wrong sprite. */
function isCanonicalOrder(directions: readonly Direction[]): boolean {
  let previousIndex = -1;
  for (const direction of directions) {
    const index = DIRECTIONS.indexOf(direction);
    if (index <= previousIndex) {
      return false;
    }
    previousIndex = index;
  }
  return true;
}

function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Path must be relative, use `/`, stay inside the pack, and point at a png file. */
function isAssetRelativePath(value: string): boolean {
  if (!value.endsWith('.png')) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  return !value.split('/').some((segment) => segment === '..' || segment === '');
}

function suggestKeys(manifest: AnimationManifest, key: string): string {
  const allKeys = Object.keys(manifest.sprites);
  const actor = key.split('.')[0];
  const sameActor =
    actor === undefined ? [] : allKeys.filter((candidate) => candidate.startsWith(`${actor}.`));

  if (sameActor.length === 0) {
    return `Manifest has ${allKeys.length} keys, see assets/resources/data/animations.json.`;
  }

  const shown = sameActor.slice(0, 8).join(', ');
  const suffix = sameActor.length > 8 ? ', …' : '';
  return `Actor "${actor}" has: ${shown}${suffix}.`;
}

function formatProblems(problems: readonly string[]): string {
  const header = `animations.json is invalid — ${problems.length} problem(s):`;
  return [header, ...problems.map((problem) => `  - ${problem}`)].join('\n');
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `array(${items.length})`;
  }
  return typeof value;
}

/**
 * Column count of the sheet.
 *
 * `grid` takes columns from `directions`; a single-column sheet (`Dead.png`, `directions: []`) has 1 column.
 * If the loader inferred it from `directions.length`, a dead sheet would give 0 columns and divide by zero.
 */
export function frameColumns(entry: SpriteEntry): number {
  return entry.layout === 'strip' ? entry.frames : Math.max(1, entry.directions.length);
}

/** Row count: strip is always 1, grid has one row per frame. */
export function frameRows(entry: SpriteEntry): number {
  return entry.layout === 'strip' ? 1 : entry.frames;
}

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pixel rect of one frame, top-left origin (image reading order).
 * For `strip`, `direction` is ignored because the sheet has only one row.
 */
export function frameRect(entry: SpriteEntry, direction: Direction, frame: number): FrameRect {
  if (!Number.isInteger(frame) || frame < 0 || frame >= entry.frames) {
    throw new Error(`frame must be an integer in [0, ${entry.frames}), got ${frame}`);
  }

  // Strip runs horizontally; grid runs down rows, across direction columns.
  if (entry.layout === 'strip') {
    return {
      x: frame * entry.frameWidth,
      y: 0,
      width: entry.frameWidth,
      height: entry.frameHeight,
    };
  }

  let column = 0;
  if (entry.directions.length > 0) {
    column = entry.directions.indexOf(direction);
    if (column < 0) {
      throw new Error(
        `direction "${direction}" is not in the sheet (only: ${entry.directions.join(', ')})`,
      );
    }
  }

  return {
    x: column * entry.frameWidth,
    y: frame * entry.frameHeight,
    width: entry.frameWidth,
    height: entry.frameHeight,
  };
}

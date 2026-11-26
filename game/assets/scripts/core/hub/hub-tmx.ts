/**
 * Pure `.tmx` parser and data contract for the M21 Village Hub (`36×24`) and Shop Interior (`16×12`).
 *
 * Pure TS — zero `cc` imports.
 *
 * Reuses `core/level/xml.ts` and `core/level/props.ts` (`propCollider`, `propDef`) so solid props
 * contribute identical `kind: 'prop'` obstacles to `LevelData`, and exposes `collisionLevel`
 * (`LevelData`) so `moveWithCollision`, `FollowCamera`, `CoverView`, `stepAnimal`, and `buildRoom`
 * work on hub maps with zero engine/core forks.
 */
import type { Direction } from '../art/manifest';
import { DIRECTIONS } from '../art/manifest';
import {
  OBSTACLE_KINDS,
  TILE_SIZE_PX,
  type LevelData,
  type Obstacle,
  type ObstacleKind,
  type PlacedProp,
  type RoomSize,
} from '../level/level-data';
import { propCollider, propDef } from '../level/props';
import { childrenNamed, elementText, firstChild, parseXml, type XmlElement } from '../level/xml';
import type { Vec2 } from '../math/vec2';

/** Playable non-combat hub locations in M21. */
export const HUB_LOCATIONS = ['village', 'shop-interior'] as const;
export type HubLocation = (typeof HUB_LOCATIONS)[number];

/** Canonical tile dimensions per hub location (GDD M21 §2–§3, ADR-028). */
export const HUB_MAP_DIMENSIONS: Readonly<Record<HubLocation, RoomSize>> = {
  village: { cols: 36, rows: 24 },
  'shop-interior': { cols: 16, rows: 12 },
};

/** Staged cozy village music resource path (under `assets/resources/`, no extension). */
export const VILLAGE_MUSIC_PATH = 'audio/music/village';

/** Staged soft RPG dialog voice blip SFX resource paths (under `assets/resources/`, no extension). */
export const DIALOG_BLIP_SFX_PATHS = [
  'audio/sfx/dialog-blip',
  'audio/sfx/dialog-blip-2',
  'audio/sfx/dialog-blip-3',
] as const;

/** Localized i18n prompt keys surfaced above nearby hub interactables. */
export const HUB_PROMPT_KEYS = [
  'hub.prompt.talk',
  'hub.prompt.enterShop',
  'hub.prompt.exitShop',
  'hub.prompt.dojo',
  'hub.prompt.expedition',
] as const;
export type HubPromptKey = (typeof HUB_PROMPT_KEYS)[number];

/** Trigger identifiers authored in `village-hub.tmx` and `shop-interior.tmx`. */
export const HUB_TRIGGER_IDS = ['shop-entrance', 'expedition-gate', 'shop-exit'] as const;
export type HubTriggerId = (typeof HUB_TRIGGER_IDS)[number];

/** Non-playable NPC identifiers staged for the Village Hub & Shop Interior. */
export const HUB_NPC_IDS = [
  'villager-1',
  'villager-2',
  'villager-3',
  'villager-4',
  'villager-5',
  'shopkeeper',
  'dojo-master',
] as const;
export type HubNpcId = (typeof HUB_NPC_IDS)[number];

export const HUB_VILLAGER_IDS = [
  'villager-1',
  'villager-2',
  'villager-3',
  'villager-4',
  'villager-5',
] as const;
export type HubVillagerId = (typeof HUB_VILLAGER_IDS)[number];

export type HubNpcRole = 'villager' | 'shopkeeper' | 'dojo-master';

/** Allowed living animal sprite keys in the Village Hub yards. */
export const HUB_ANIMAL_SPRITES = [
  'animal.dog',
  'animal.cat',
  'animal.chicken',
  'animal.bird',
] as const;
export type HubAnimalSprite = (typeof HUB_ANIMAL_SPRITES)[number];

/** Default proximity prompt distance in tiles (GDD M21 §4). */
export const DEFAULT_HUB_INTERACT_RADIUS_TILES = 2.0;

export interface HubTriggerBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HubTriggerZone {
  readonly id: HubTriggerId;
  /** Centre point in tile units (top-left origin, y down). */
  readonly at: Vec2;
  /** Rectangular step-in trigger zone in tile units (`null` when authored as a point only). */
  readonly rect: HubTriggerBounds | null;
  readonly promptKey: HubPromptKey;
  readonly interactRadius: number;
  /** True when walking into `rect` automatically triggers the transition/modal. */
  readonly autoEnterOnStep: boolean;
}

export interface HubNpcPlacement {
  readonly id: HubNpcId;
  readonly role: HubNpcRole;
  readonly at: Vec2;
  readonly facing: Direction;
  readonly promptKey: HubPromptKey;
  readonly interactRadius: number;
}

export interface HubWaypoint {
  readonly npcId: HubVillagerId;
  readonly order: number;
  readonly at: Vec2;
  readonly pauseMs: number;
}

export interface HubAnimalPlacement {
  readonly id: string;
  readonly sprite: HubAnimalSprite;
  readonly at: Vec2;
}

export interface HubDecorPlacement {
  readonly sprite: string;
  readonly at: Vec2;
}

export interface HubEntryPoint {
  readonly from: string;
  readonly at: Vec2;
  readonly facing: Direction;
}

export interface HubTilesetRef {
  readonly firstgid: number;
  readonly source: string;
}

export interface HubMapData {
  readonly id: HubLocation;
  readonly size: RoomSize;
  readonly tileSizePx: typeof TILE_SIZE_PX;
  readonly tilesets: readonly HubTilesetRef[];
  readonly playerStart: Vec2;
  readonly playerStartFacing: Direction;
  readonly entryPoints: Readonly<Record<string, HubEntryPoint>>;
  readonly obstacles: readonly Obstacle[];
  readonly props: readonly PlacedProp[];
  readonly triggers: readonly HubTriggerZone[];
  readonly npcs: readonly HubNpcPlacement[];
  readonly patrolRoutes: Readonly<Record<string, readonly HubWaypoint[]>>;
  readonly animals: readonly HubAnimalPlacement[];
  readonly decor: readonly HubDecorPlacement[];
  /**
   * Drop-in `LevelData` representation carrying the exact `size`, `obstacles` (including solid
   * prop colliders), `props`, and `playerStart` so `moveWithCollision`, `FollowCamera`,
   * `CoverView`, `stepAnimal`, and `buildRoom` consume hub maps directly.
   */
  readonly collisionLevel: LevelData;
}

/** Object names allowed in hub `.tmx` `<objectgroup>`s — any typo throws immediately. */
export const HUB_TMX_OBJECTS = {
  playerStart: 'playerStart',
  entryPoint: 'entryPoint',
  obstacle: 'obstacle',
  prop: 'prop',
  trigger: 'trigger',
  npc: 'npc',
  waypoint: 'waypoint',
  animal: 'animal',
  decor: 'decor',
} as const;

type AuthoredObstacleKind = Exclude<ObstacleKind, 'prop'>;
const AUTHORED_OBSTACLE_KINDS: readonly AuthoredObstacleKind[] = OBSTACLE_KINDS.filter(
  (kind): kind is AuthoredObstacleKind => kind !== 'prop',
);

const DEFAULT_WAYPOINT_PAUSE_MS = 1800;

class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(source: string): void {
    if (this.items.length === 0) return;
    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${source}: invalid hub TMX (${this.items.length} problem(s))\n${details}`);
  }
}

interface TmxProperty {
  readonly name: string;
  readonly raw: string;
  readonly type: string;
  readonly path: string;
}

function isHubLocation(value: string): value is HubLocation {
  return (HUB_LOCATIONS as readonly string[]).includes(value);
}

function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value);
}

function isHubTriggerId(value: string): value is HubTriggerId {
  return (HUB_TRIGGER_IDS as readonly string[]).includes(value);
}

function isHubPromptKey(value: string): value is HubPromptKey {
  return (HUB_PROMPT_KEYS as readonly string[]).includes(value);
}

function isHubNpcId(value: string): value is HubNpcId {
  return (HUB_NPC_IDS as readonly string[]).includes(value);
}

function isHubVillagerId(value: string): value is HubVillagerId {
  return (HUB_VILLAGER_IDS as readonly string[]).includes(value);
}

function isHubAnimalSprite(value: string): value is HubAnimalSprite {
  return (HUB_ANIMAL_SPRITES as readonly string[]).includes(value);
}

function isAuthoredObstacleKind(value: string): value is AuthoredObstacleKind {
  return (AUTHORED_OBSTACLE_KINDS as readonly string[]).includes(value);
}

function pixelsToTiles(px: number): number {
  return px / TILE_SIZE_PX;
}

function requiredAttr(
  el: XmlElement,
  name: string,
  path: string,
  problems: ProblemList,
): string | null {
  const raw = el.attributes[name];
  if (raw === undefined || raw.trim() === '') {
    problems.add(path, `missing attribute "${name}"`);
    return null;
  }
  return raw;
}

function requiredNum(
  el: XmlElement,
  name: string,
  path: string,
  problems: ProblemList,
): number | null {
  const raw = requiredAttr(el, name, path, problems);
  if (raw === null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    problems.add(path, `attribute "${name}" must be finite number, got ${JSON.stringify(raw)}`);
    return null;
  }
  return num;
}

function optionalNum(
  el: XmlElement,
  name: string,
  fallback: number,
  path: string,
  problems: ProblemList,
): number {
  const raw = el.attributes[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    problems.add(path, `attribute "${name}" must be finite number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return num;
}

function readProperties(
  el: XmlElement,
  path: string,
  problems: ProblemList,
): Map<string, TmxProperty> {
  const out = new Map<string, TmxProperty>();
  const container = firstChild(el, 'properties');
  if (container === null) return out;

  container.children.forEach((child, idx) => {
    const pPath = `${path}.properties[${idx}]`;
    if (child.name !== 'property') {
      problems.add(pPath, `only <property> allowed, got <${child.name}>`);
      return;
    }
    const name = requiredAttr(child, 'name', pPath, problems);
    if (name === null) return;
    if (out.has(name)) {
      problems.add(pPath, `duplicate property "${name}"`);
      return;
    }
    out.set(name, {
      name,
      raw: child.attributes['value'] ?? '',
      type: child.attributes['type'] ?? 'string',
      path: `${pPath}(${name})`,
    });
  });
  return out;
}

function readStringProp(
  props: ReadonlyMap<string, TmxProperty>,
  name: string,
  path: string,
  required: boolean,
  problems: ProblemList,
): string | null {
  const prop = props.get(name);
  if (prop === undefined) {
    if (required) problems.add(path, `missing property "${name}"`);
    return null;
  }
  if (prop.type !== 'string') {
    problems.add(prop.path, `must be string, got type=${JSON.stringify(prop.type)}`);
    return null;
  }
  return prop.raw;
}

function readIntProp(
  props: ReadonlyMap<string, TmxProperty>,
  name: string,
  path: string,
  required: boolean,
  problems: ProblemList,
): number | null {
  const prop = props.get(name);
  if (prop === undefined) {
    if (required) problems.add(path, `missing property "${name}"`);
    return null;
  }
  const raw = prop.raw.trim();
  if (prop.type !== 'int' || !/^-?\d+$/.test(raw)) {
    problems.add(prop.path, `must be int, got type=${JSON.stringify(prop.type)} value=${JSON.stringify(prop.raw)}`);
    return null;
  }
  return Number.parseInt(raw, 10);
}

function readFloatProp(
  props: ReadonlyMap<string, TmxProperty>,
  name: string,
  fallback: number,
  problems: ProblemList,
): number {
  const prop = props.get(name);
  if (prop === undefined) return fallback;
  const val = Number(prop.raw);
  if ((prop.type !== 'float' && prop.type !== 'int') || !Number.isFinite(val) || val <= 0) {
    problems.add(prop.path, `must be positive float/int, got type=${JSON.stringify(prop.type)} value=${JSON.stringify(prop.raw)}`);
    return fallback;
  }
  return val;
}

function readBoolProp(
  props: ReadonlyMap<string, TmxProperty>,
  name: string,
  fallback: boolean,
  problems: ProblemList,
): boolean {
  const prop = props.get(name);
  if (prop === undefined) return fallback;
  const raw = prop.raw.trim();
  if (prop.type !== 'bool' || (raw !== 'true' && raw !== 'false')) {
    problems.add(prop.path, `must be bool, got type=${JSON.stringify(prop.type)} value=${JSON.stringify(prop.raw)}`);
    return fallback;
  }
  return raw === 'true';
}

function checkPointInBounds(point: Vec2, size: RoomSize, path: string, problems: ProblemList): void {
  if (point.x < 0 || point.x > size.cols || point.y < 0 || point.y > size.rows) {
    problems.add(
      path,
      `point (${point.x}, ${point.y}) is outside map bounds 0..${size.cols} × 0..${size.rows}`,
    );
  }
}

function checkRectInBounds(
  rect: HubTriggerBounds,
  size: RoomSize,
  path: string,
  problems: ProblemList,
): void {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > size.cols + 1e-9 ||
    rect.y + rect.height > size.rows + 1e-9
  ) {
    problems.add(
      path,
      `rect (x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}) invalid or outside 0..${size.cols} × 0..${size.rows}`,
    );
  }
}

export interface ParseHubTmxOptions {
  readonly source?: string;
}

/**
 * Parse and validate a hub `.tmx` (`village-hub.tmx` or `shop-interior.tmx`) into `HubMapData`.
 */
export function parseHubTmx(xml: string, options: ParseHubTmxOptions = {}): HubMapData {
  const source = options.source ?? 'hub.tmx';
  const problems = new ProblemList();

  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source}: ${message}`);
  }

  if (root.name !== 'map') {
    problems.add('map', `root must be <map>, got <${root.name}>`);
    problems.throwIfAny(source);
  }

  if (root.attributes['orientation'] !== 'orthogonal') {
    problems.add('map', `orientation must be "orthogonal", got ${JSON.stringify(root.attributes['orientation'])}`);
  }

  const width = requiredNum(root, 'width', 'map', problems);
  const height = requiredNum(root, 'height', 'map', problems);
  const tileW = requiredNum(root, 'tilewidth', 'map', problems);
  const tileH = requiredNum(root, 'tileheight', 'map', problems);
  if (tileW !== null && tileW !== TILE_SIZE_PX) {
    problems.add('map', `tilewidth must equal ${TILE_SIZE_PX}, got ${tileW}`);
  }
  if (tileH !== null && tileH !== TILE_SIZE_PX) {
    problems.add('map', `tileheight must equal ${TILE_SIZE_PX}, got ${tileH}`);
  }

  const mapProps = readProperties(root, 'map', problems);
  const rawLocation = readStringProp(mapProps, 'hubLocation', 'map', true, problems);
  let location: HubLocation = 'village';
  if (rawLocation !== null) {
    if (!isHubLocation(rawLocation)) {
      problems.add(
        'map.properties.hubLocation',
        `expected one of ${HUB_LOCATIONS.join(', ')}, got ${JSON.stringify(rawLocation)}`,
      );
    } else {
      location = rawLocation;
      const expected = HUB_MAP_DIMENSIONS[location];
      if (width !== null && width !== expected.cols) {
        problems.add('map', `${location} width must be ${expected.cols}, got ${width}`);
      }
      if (height !== null && height !== expected.rows) {
        problems.add('map', `${location} height must be ${expected.rows}, got ${height}`);
      }
    }
  }

  const cols = width !== null && width > 0 ? width : HUB_MAP_DIMENSIONS[location].cols;
  const rows = height !== null && height > 0 ? height : HUB_MAP_DIMENSIONS[location].rows;
  const size: RoomSize = { cols, rows };

  // Validate `<tileset>` declarations (bare filename per AGENTS.md).
  const tilesetElements = childrenNamed(root, 'tileset');
  if (tilesetElements.length === 0) {
    problems.add('map', 'at least one <tileset> is required');
  }
  const tilesets: HubTilesetRef[] = [];
  tilesetElements.forEach((ts, idx) => {
    const tPath = `tileset[${idx}]`;
    const firstgid = requiredNum(ts, 'firstgid', tPath, problems);
    const tsSource = requiredAttr(ts, 'source', tPath, problems);
    if (tsSource !== null && tsSource.includes('/')) {
      problems.add(tPath, `tileset source must be a bare filename in the same folder, got "${tsSource}"`);
    }
    if (firstgid !== null && tsSource !== null) {
      tilesets.push({ firstgid, source: tsSource });
    }
  });

  // Validate CSV `<layer>`s.
  const layers = childrenNamed(root, 'layer');
  if (layers.length === 0) {
    problems.add('map', 'at least one <layer> is required');
  }
  layers.forEach((layer, idx) => {
    const lName = layer.attributes['name'] ?? `#${idx}`;
    const lPath = `layer[${idx}](${lName})`;
    const lw = requiredNum(layer, 'width', lPath, problems);
    const lh = requiredNum(layer, 'height', lPath, problems);
    if (lw !== null && lw !== cols) problems.add(lPath, `width must equal ${cols}, got ${lw}`);
    if (lh !== null && lh !== rows) problems.add(lPath, `height must equal ${rows}, got ${lh}`);
    const data = firstChild(layer, 'data');
    if (data === null) {
      problems.add(lPath, 'missing <data>');
      return;
    }
    if (data.attributes['encoding'] !== 'csv') {
      problems.add(lPath, `encoding must be "csv", got ${JSON.stringify(data.attributes['encoding'])}`);
      return;
    }
    const cells = elementText(data).split(',');
    if (cells.length !== cols * rows) {
      problems.add(lPath, `CSV has ${cells.length} cells, expected ${cols * rows}`);
      return;
    }
    const bad = cells.find((c) => !/^\d+$/.test(c.trim()));
    if (bad !== undefined) {
      problems.add(lPath, `non-integer CSV cell ${JSON.stringify(bad)}`);
    }
  });

  // Parse `<objectgroup>`s.
  const groups = childrenNamed(root, 'objectgroup');
  if (groups.length === 0) {
    problems.add('map', 'at least one <objectgroup> is required');
  }

  let playerStart: Vec2 | null = null;
  let playerStartFacing: Direction = 'down';
  const entryPoints: Record<string, HubEntryPoint> = {};
  const obstacles: Obstacle[] = [];
  const props: PlacedProp[] = [];
  const triggers: HubTriggerZone[] = [];
  const seenTriggerIds = new Set<string>();
  const npcs: HubNpcPlacement[] = [];
  const seenNpcIds = new Set<string>();
  const rawWaypoints = new Map<HubVillagerId, HubWaypoint[]>();
  const animals: HubAnimalPlacement[] = [];
  const decor: HubDecorPlacement[] = [];

  groups.forEach((group, gIdx) => {
    const gPath = `objectgroup[${gIdx}](${group.attributes['name'] ?? `#${gIdx}`})`;
    group.children.forEach((el, oIdx) => {
      const oPath = `${gPath}.objects[${oIdx}]`;
      if (el.name !== 'object') {
        problems.add(oPath, `only <object> allowed, got <${el.name}>`);
        return;
      }
      const name = requiredAttr(el, 'name', oPath, problems);
      if (name === null) return;
      const rotation = optionalNum(el, 'rotation', 0, oPath, problems);
      if (rotation !== 0) {
        problems.add(oPath, `rotation must be 0, got ${rotation}`);
        return;
      }
      const xPx = requiredNum(el, 'x', oPath, problems);
      const yPx = requiredNum(el, 'y', oPath, problems);
      if (xPx === null || yPx === null) return;
      const oProps = readProperties(el, oPath, problems);

      switch (name) {
        case HUB_TMX_OBJECTS.playerStart: {
          if (playerStart !== null) {
            problems.add(oPath, 'exactly one playerStart is allowed');
            break;
          }
          const pt = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(pt, size, oPath, problems);
          const facingRaw = readStringProp(oProps, 'facing', oPath, false, problems);
          if (facingRaw !== null) {
            if (!isDirection(facingRaw)) {
              problems.add(oPath, `invalid facing ${JSON.stringify(facingRaw)}`);
            } else {
              playerStartFacing = facingRaw;
            }
          }
          playerStart = pt;
          break;
        }

        case HUB_TMX_OBJECTS.entryPoint: {
          const from = readStringProp(oProps, 'from', oPath, true, problems);
          const facingRaw = readStringProp(oProps, 'facing', oPath, false, problems) ?? 'down';
          if (from === null) break;
          if (!isDirection(facingRaw)) {
            problems.add(oPath, `invalid facing ${JSON.stringify(facingRaw)}`);
            break;
          }
          if (entryPoints[from] !== undefined) {
            problems.add(oPath, `duplicate entryPoint from="${from}"`);
            break;
          }
          const pt = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(pt, size, oPath, problems);
          entryPoints[from] = { from, at: pt, facing: facingRaw };
          break;
        }

        case HUB_TMX_OBJECTS.obstacle: {
          const kind = readStringProp(oProps, 'kind', oPath, true, problems);
          const wPx = requiredNum(el, 'width', oPath, problems);
          const hPx = requiredNum(el, 'height', oPath, problems);
          if (kind === null || wPx === null || hPx === null) break;
          if (!isAuthoredObstacleKind(kind)) {
            problems.add(
              oPath,
              `invalid obstacle kind ${JSON.stringify(kind)}; expected ${AUTHORED_OBSTACLE_KINDS.join('|')}`,
            );
            break;
          }
          const rect = {
            kind,
            x: pixelsToTiles(xPx),
            y: pixelsToTiles(yPx),
            width: pixelsToTiles(wPx),
            height: pixelsToTiles(hPx),
          };
          checkRectInBounds(rect, size, oPath, problems);
          obstacles.push(rect);
          break;
        }

        case HUB_TMX_OBJECTS.prop: {
          const key = readStringProp(oProps, 'key', oPath, true, problems);
          if (key === null) break;
          // Village uses Chapter 1's rich lush village/nature/house/camp prop catalogue.
          const def = propDef(1, key);
          if (def === undefined) {
            problems.add(oPath, `unknown prop key ${JSON.stringify(key)} in PROP_CATALOGUE[1]`);
            break;
          }
          const placed: PlacedProp = { key, x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          props.push(placed);
          const collider = propCollider(placed, def);
          if (collider !== null) {
            checkRectInBounds(collider, size, oPath, problems);
            obstacles.push(collider);
          }
          break;
        }

        case HUB_TMX_OBJECTS.trigger: {
          const idRaw = readStringProp(oProps, 'id', oPath, true, problems);
          const promptRaw = readStringProp(oProps, 'promptKey', oPath, true, problems);
          if (idRaw === null || promptRaw === null) break;
          if (!isHubTriggerId(idRaw)) {
            problems.add(oPath, `unknown trigger id ${JSON.stringify(idRaw)}`);
            break;
          }
          if (!isHubPromptKey(promptRaw)) {
            problems.add(oPath, `unknown promptKey ${JSON.stringify(promptRaw)}`);
            break;
          }
          if (seenTriggerIds.has(idRaw)) {
            problems.add(oPath, `duplicate trigger "${idRaw}"`);
            break;
          }
          seenTriggerIds.add(idRaw);

          const hasRect = el.attributes['width'] !== undefined && el.attributes['height'] !== undefined;
          let rect: HubTriggerBounds | null = null;
          let at: Vec2 = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          if (hasRect) {
            const wPx = requiredNum(el, 'width', oPath, problems);
            const hPx = requiredNum(el, 'height', oPath, problems);
            if (wPx !== null && hPx !== null) {
              rect = {
                x: pixelsToTiles(xPx),
                y: pixelsToTiles(yPx),
                width: pixelsToTiles(wPx),
                height: pixelsToTiles(hPx),
              };
              checkRectInBounds(rect, size, oPath, problems);
              at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
          } else {
            checkPointInBounds(at, size, oPath, problems);
          }

          const interactRadius = readFloatProp(
            oProps,
            'interactRadius',
            DEFAULT_HUB_INTERACT_RADIUS_TILES,
            problems,
          );
          const autoEnterOnStep = readBoolProp(oProps, 'autoEnterOnStep', rect !== null, problems);
          triggers.push({
            id: idRaw,
            at,
            rect,
            promptKey: promptRaw,
            interactRadius,
            autoEnterOnStep,
          });
          break;
        }

        case HUB_TMX_OBJECTS.npc: {
          const idRaw = readStringProp(oProps, 'id', oPath, true, problems);
          const roleRaw = readStringProp(oProps, 'role', oPath, true, problems);
          const promptRaw = readStringProp(oProps, 'promptKey', oPath, true, problems);
          const facingRaw = readStringProp(oProps, 'facing', oPath, false, problems) ?? 'down';
          if (idRaw === null || roleRaw === null || promptRaw === null) break;
          if (!isHubNpcId(idRaw)) {
            problems.add(oPath, `unknown npc id ${JSON.stringify(idRaw)}`);
            break;
          }
          if (roleRaw !== 'villager' && roleRaw !== 'shopkeeper' && roleRaw !== 'dojo-master') {
            problems.add(oPath, `invalid npc role ${JSON.stringify(roleRaw)}`);
            break;
          }
          if (!isHubPromptKey(promptRaw)) {
            problems.add(oPath, `invalid npc promptKey ${JSON.stringify(promptRaw)}`);
            break;
          }
          if (!isDirection(facingRaw)) {
            problems.add(oPath, `invalid npc facing ${JSON.stringify(facingRaw)}`);
            break;
          }
          if (seenNpcIds.has(idRaw)) {
            problems.add(oPath, `duplicate npc "${idRaw}"`);
            break;
          }
          seenNpcIds.add(idRaw);

          const at = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(at, size, oPath, problems);
          const interactRadius = readFloatProp(
            oProps,
            'interactRadius',
            DEFAULT_HUB_INTERACT_RADIUS_TILES,
            problems,
          );
          npcs.push({
            id: idRaw,
            role: roleRaw,
            at,
            facing: facingRaw,
            promptKey: promptRaw,
            interactRadius,
          });
          break;
        }

        case HUB_TMX_OBJECTS.waypoint: {
          const npcIdRaw = readStringProp(oProps, 'npcId', oPath, true, problems);
          const order = readIntProp(oProps, 'order', oPath, true, problems);
          const pauseMs = readIntProp(oProps, 'pauseMs', oPath, false, problems) ?? DEFAULT_WAYPOINT_PAUSE_MS;
          if (npcIdRaw === null || order === null) break;
          if (!isHubVillagerId(npcIdRaw)) {
            problems.add(oPath, `invalid waypoint npcId ${JSON.stringify(npcIdRaw)}`);
            break;
          }
          if (order < 0) {
            problems.add(oPath, `waypoint order must be >= 0, got ${order}`);
            break;
          }
          if (pauseMs < 0) {
            problems.add(oPath, `waypoint pauseMs must be >= 0, got ${pauseMs}`);
            break;
          }
          const at = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(at, size, oPath, problems);
          const list = rawWaypoints.get(npcIdRaw) ?? [];
          list.push({ npcId: npcIdRaw, order, at, pauseMs });
          rawWaypoints.set(npcIdRaw, list);
          break;
        }

        case HUB_TMX_OBJECTS.animal: {
          const idRaw = readStringProp(oProps, 'id', oPath, true, problems);
          const spriteRaw = readStringProp(oProps, 'sprite', oPath, true, problems);
          if (idRaw === null || spriteRaw === null) break;
          if (!isHubAnimalSprite(spriteRaw)) {
            problems.add(oPath, `invalid animal sprite ${JSON.stringify(spriteRaw)}`);
            break;
          }
          const at = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(at, size, oPath, problems);
          animals.push({ id: idRaw, sprite: spriteRaw, at });
          break;
        }

        case HUB_TMX_OBJECTS.decor: {
          const spriteRaw = readStringProp(oProps, 'sprite', oPath, true, problems);
          if (spriteRaw === null || spriteRaw.trim() === '') break;
          const at = { x: pixelsToTiles(xPx), y: pixelsToTiles(yPx) };
          checkPointInBounds(at, size, oPath, problems);
          decor.push({ sprite: spriteRaw, at });
          break;
        }

        default:
          problems.add(
            oPath,
            `object name ${JSON.stringify(name)} is not in hub convention (${Object.values(HUB_TMX_OBJECTS).join(', ')})`,
          );
      }
    });
  });

  if (playerStart === null) {
    problems.add('map', 'missing object "playerStart"');
  }

  // Sort and validate contiguous waypoint orders `0..K-1` per villager.
  const patrolRoutes: Record<string, readonly HubWaypoint[]> = {};
  for (const [npcId, list] of rawWaypoints) {
    if (!seenNpcIds.has(npcId)) {
      problems.add('map', `waypoints declared for "${npcId}", which has no matching npc object`);
      continue;
    }
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    sorted.forEach((wp, idx) => {
      if (wp.order !== idx) {
        problems.add('map', `waypoints for "${npcId}" must have contiguous order 0..N-1 (missing ${idx})`);
      }
    });
    if (sorted.length < 2) {
      problems.add('map', `villager "${npcId}" patrol route needs at least 2 waypoints, got ${sorted.length}`);
    }
    patrolRoutes[npcId] = sorted;
  }

  problems.throwIfAny(source);

  const resolvedStart = playerStart ?? { x: 0, y: 0 };
  const collisionLevel: LevelData = {
    id: `hub-${location}`,
    chapter: 1,
    room: 1,
    isBossRoom: false,
    size,
    tileSizePx: TILE_SIZE_PX,
    playerStart: resolvedStart,
    waves: [],
    obstacles: [...obstacles],
    props: [...props],
    doors: [],
  };

  return {
    id: location,
    size,
    tileSizePx: TILE_SIZE_PX,
    tilesets,
    playerStart: resolvedStart,
    playerStartFacing,
    entryPoints,
    obstacles,
    props,
    triggers,
    npcs,
    patrolRoutes,
    animals,
    decor,
    collisionLevel,
  };
}

/**
 * Resolve the staged manifest animation key + safe fallback for a village/shop NPC.
 */
export function resolveNpcAnimKey(
  npcId: HubNpcId,
  mode: 'walk' | 'stand' | 'look',
  direction: Direction = 'down',
): { readonly key: string; readonly fallback: string } {
  const fallback = `npc.${npcId}`;
  if (mode === 'look') {
    return { key: fallback, fallback };
  }
  if (mode === 'walk') {
    return { key: `npc.${npcId}-step.${direction}`, fallback };
  }
  return { key: `npc.${npcId}-stand.${direction}`, fallback };
}

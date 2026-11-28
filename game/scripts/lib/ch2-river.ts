/**
 * Chapter 2 river, waterfall plunge pool, shoreline banks, bridges & `pit` obstacles (M11 T2, ADR-020).
 *
 * Keeps all Chapter 2 water-course generation isolated from `room-pool.ts` so changes to Ch1/Ch3/Ch4
 * never collide with Ch2 river logic.
 *
 * Design:
 * - Natural meandering river spanning edge-to-edge under the east/west forest borders, with optional
 *   north waterfall cascading from row 0 into a wider plunge pool.
 * - Full 13-piece grass-banked `TilesetWater` autotile shoreline matching Ch2's `#adbc3a` meadow floor
 *   (zero box seams), accented with lily pads, submerged pebbles/fish, bank reeds, and waterfall rocks.
 * - >= 2 wide wooden bridges (4 tiles wide, clear of `pit` and `WaterArea`) so the player and 0.75-radius
 *   tanks cross smoothly without deadlocking.
 * - Maximal-rectangle decomposition turns deep-water + waterfall cells (minus bridges) into a compact set
 *   of `kind: "pit"` obstacles (blocks walkers, bullets pass over) and interior open-water `WaterArea`s.
 */
import { normalizePatchMask, pickBlobTile, type PatchMask } from './autotile';
import { planRiverRipples, type WaterArea } from '../../assets/scripts/core/level/water-layout';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RiverBridge {
  /** Left tile column of the bridge (integer). */
  readonly x: number;
  /** Top tile row of the bridge (matches river north bank row at `x`). */
  readonly y: number;
  /** Width in tiles (always >= 3; default 4 so two 0.75-radius tanks never wedge). */
  readonly width: number;
  /** Height in tiles (spans the full river thickness from north bank to south bank). */
  readonly height: number;
}

export interface Ch2RiverLayer {
  readonly name: string;
  readonly tiles: number[];
}

export interface Ch2RiverPlan {
  /** Interior open-water & waterfall rects for `water-layout.json` (excludes banks and bridges). */
  readonly waterAreas: readonly WaterArea[];
  /** Impassable `pit` obstacle rects (covers river + waterfall inside border, excludes bridges). */
  readonly pitObstacles: readonly Rect[];
  /** Wooden bridge crossings (guaranteed >= 2, each width >= 3). */
  readonly bridges: readonly RiverBridge[];
  /** Primary bridge the door-to-door dirt trail crosses through. */
  readonly primaryBridge: RiverBridge;
  /** Extra TMX tile layers (`water` and `bridge`) rendered after `path` and before `decor`. */
  readonly layers: readonly Ch2RiverLayer[];
  /**
   * Shoreline cells (`"x,y"`) reserved from solid props/obstacles/patches/spawns: covers the full
   * river mask, waterfall chute, bridge decks, and 2-tile north/south bridge approach aprons.
   */
  readonly reservedCells: ReadonlySet<string>;
  /** Full water + waterfall cells (`"x,y"`) used to avoid placing ground patches or walk-overs on water. */
  readonly waterCells: ReadonlySet<string>;
  /** Shoreline bank reeds/pebbles and waterfall rocks queued for the `decor` layer (keyed by tile index). */
  readonly bankDecor: readonly { readonly index: number; readonly gid: number }[];
}

export interface PlanCh2RiverArgs {
  readonly rng: () => number;
  readonly cols: number;
  readonly rows: number;
  readonly borderTiles: number;
  readonly playerStart: Vec2;
  readonly doors: readonly Vec2[];
  readonly gid: (tileset: string, local: number) => number;
}

/** Width of every Chapter 2 bridge in tiles (>= 3 required by ADR-020; 4 gives tanks 2 clean lanes). */
export const CH2_BRIDGE_WIDTH = 4;
/** Minimum bridges per normal Chapter 2 room. */
export const CH2_MIN_BRIDGES = 2;

const WATER_COLS = 28;
const waterLocal = (col: number, row: number): number => row * WATER_COLS + col + 1;

/**
 * 13-piece blob autotile table for `TilesetWater.png`'s green grass shoreline block (rows 6..8,
 * cols 0..6). Outer grass corners are RGB `(173, 188, 58)` (`#adbc3a`), matching Ch2's `tilefloor`
 * plain `265` pixel-for-pixel.
 */
const WATER_BLOB_LOCALS: readonly number[] = [
  waterLocal(0, 6), // 1  NW outer corner
  waterLocal(1, 6), // 2  N outer edge
  waterLocal(2, 6), // 3  NE outer corner
  waterLocal(6, 8), // 4  inner corner, outside diagonal NW
  waterLocal(5, 8), // 5  inner corner, outside diagonal NE
  waterLocal(0, 7), // 6  W outer edge
  waterLocal(1, 7), // 7  center deep water (#71ddee)
  waterLocal(2, 7), // 8  E outer edge
  waterLocal(6, 7), // 9  inner corner, outside diagonal SW
  waterLocal(5, 7), // 10 inner corner, outside diagonal SE
  waterLocal(0, 8), // 11 SW outer corner
  waterLocal(1, 8), // 12 S outer edge
  waterLocal(2, 8), // 13 SE outer corner
];

/** Wooden vertical bridge deck tiles (`TilesetWater.png` row 13, cols 0..2: dark left/right rails, open N/S walk). */
const BRIDGE_LEFT = waterLocal(0, 13);
const BRIDGE_MID = waterLocal(1, 13);
const BRIDGE_MID_ALT = waterLocal(5, 13);
const BRIDGE_RIGHT = waterLocal(2, 13);

/** Open-water details from `TilesetWater.png` col 11 (pebbles, shimmer, lily pad, submerged fish). */
const WATER_DETAILS: readonly number[] = [
  waterLocal(11, 1), // submerged pebbles
  waterLocal(11, 2), // gentle shimmer streak
  waterLocal(11, 3), // lily pad
  waterLocal(11, 4), // submerged fish pair
];

/** Nature bank reeds/flowers (`TilesetNature.png` 24 cols, 1-based locals) for shoreline framing. */
const BANK_REEDS: readonly number[] = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254, 265, 266, 267];
/** Gray river stones (`TilesetNature.png` row 9 col 18 = 235; `floordetail.tsx` 17 = gray pebbles). */
const WATERFALL_ROCK_LOCAL = 235; // TilesetNature gray river rock (col 18, row 9: 9*24+18+1)

function int(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Greedy maximal-rectangle decomposition of a boolean grid into non-overlapping axis-aligned rects.
 * Produces far fewer obstacles than 1×1 tiles so rooms stay well under the 16-obstacles/screen cap.
 */
export function decomposeRects(
  cols: number,
  rows: number,
  mask: readonly boolean[],
): Rect[] {
  const covered = new Uint8Array(cols * rows);
  const rects: Rect[] = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (!mask[idx] || covered[idx] === 1) continue;

      let width = 1;
      while (x + width < cols) {
        const next = y * cols + (x + width);
        if (!mask[next] || covered[next] === 1) break;
        width += 1;
      }

      let height = 1;
      while (y + height < rows) {
        let rowFull = true;
        for (let dx = 0; dx < width; dx += 1) {
          const next = (y + height) * cols + (x + dx);
          if (!mask[next] || covered[next] === 1) {
            rowFull = false;
            break;
          }
        }
        if (!rowFull) break;
        height += 1;
      }

      for (let dy = 0; dy < height; dy += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          covered[(y + dy) * cols + (x + dx)] = 1;
        }
      }
      rects.push({ x, y, width, height });
    }
  }

  return rects;
}

/**
 * Plan a complete Chapter 2 river course with shoreline banks, waterfall plunge pool, >= 2 wide
 * bridges, `pit` obstacle rects, and `water-layout.json` areas.
 */
export function planChapterTwoRiver(args: PlanCh2RiverArgs): Ch2RiverPlan {
  const { rng, cols, rows, borderTiles, playerStart, doors, gid } = args;

  const topDoor = doors.find((door) => door.y <= rows / 2);
  const bottomDoor = doors.find((door) => door.y > rows / 2);
  const topDoorX = Math.floor(topDoor?.x ?? cols / 2);
  const bottomDoorX = Math.floor(bottomDoor?.x ?? cols / 2);

  // Choose one of 3 varied natural river courses across the upper valley (y ≈ 5..10):
  // - 0: west-to-center valley river (enters from west forest border x=0, bends to x≈36..40)
  // - 1: center-to-east valley river (springs at x≈24..28, exits into east forest border x=63)
  // - 2: wide central valley river (x≈12..52 with rounded grass-banked spring/basin ends)
  // Keeping each unbroken riverbank segment <= ~10 tiles between wide 4-tile bridges ensures
  // both human players and kiting AI can cross smoothly without ever getting pinned against a bank.
  const archetype = int(rng, 3);
  const startX = archetype === 0 ? 0 : archetype === 1 ? 24 + int(rng, 4) : 12 + int(rng, 4);
  const endX = archetype === 1 ? cols : archetype === 0 ? 36 + int(rng, 4) : 48 + int(rng, 4);
  const riverSpan = endX - startX;

  const minNorth = 5;
  const riverHeight = 4; // 1 north bank + 2 deep water rows + 1 south bank
  const maxSouthExclusive = Math.min(11, Math.floor(playerStart.y) - 6);
  const maxNorth = Math.max(minNorth, maxSouthExclusive - riverHeight);

  // Build 3 organic meandering bands inside [startX, endX) stepping 1–2 tiles for clean 2×2 autotiling.
  const bend1 = startX + Math.round(riverSpan * 0.34) + int(rng, 3) - 1;
  const bend2 = startX + Math.round(riverSpan * 0.67) + int(rng, 3) - 1;
  const span = Math.max(0, maxNorth - minNorth);
  const yMid = minNorth + (span > 0 ? int(rng, span + 1) : 0);
  const deltaLeft = span === 0 ? 0 : rng() < 0.5 ? -1 : 1;
  const deltaRight = span === 0 ? 0 : rng() < 0.5 ? 1 : -1;
  const yLeft = clamp(yMid + deltaLeft * (1 + int(rng, 2)), minNorth, maxNorth);
  const yRight = clamp(yMid + deltaRight * (1 + int(rng, 2)), minNorth, maxNorth);

  // Per-column [top, bottomExclusive]; `-1` means dry land outside the river's horizontal span.
  const colTop = new Int32Array(cols).fill(-1);
  const colBottom = new Int32Array(cols).fill(-1);
  for (let x = startX; x < endX; x += 1) {
    const top = x < bend1 ? yLeft : x < bend2 ? yMid : yRight;
    colTop[x] = top;
    colBottom[x] = top + riverHeight;
  }

  // Place 3 well-spaced 4-tile-wide wooden bridges (or 2 if narrower) so every riverbank span
  // between crossings stays short (~6–10 tiles) and both banks stay effortlessly connected.
  const playableStart = Math.max(startX + 4, borderTiles + 4);
  const playableEnd = Math.min(endX - CH2_BRIDGE_WIDTH - 4, cols - borderTiles - CH2_BRIDGE_WIDTH - 4);
  const placeBridge = (minX: number, maxX: number, preferredX?: number): RiverBridge => {
    const lo = clamp(minX, playableStart, playableEnd);
    const hi = clamp(maxX, lo, playableEnd);
    const x =
      preferredX !== undefined
        ? clamp(preferredX, lo, hi)
        : lo + (hi > lo ? int(rng, hi - lo + 1) : 0);
    const sampleX = clamp(x + 1, startX, endX - 1);
    const y = colTop[sampleX] ?? yMid;
    const h = (colBottom[sampleX] ?? y + riverHeight) - y;
    for (let cx = Math.max(startX, x - 1); cx <= Math.min(endX - 1, x + CH2_BRIDGE_WIDTH); cx += 1) {
      colTop[cx] = y;
      colBottom[cx] = y + h;
    }
    return { x, y, width: CH2_BRIDGE_WIDTH, height: h };
  };

  const axisX = (topDoorX + bottomDoorX) / 2;
  const bridges: RiverBridge[] = [];
  if (playableEnd - playableStart >= 22) {
    const third = Math.floor((playableEnd - playableStart) / 3);
    const b1 = placeBridge(playableStart, playableStart + third - 2);
    const b2 = placeBridge(b1.x + CH2_BRIDGE_WIDTH + 4, playableEnd - third, Math.round(axisX) - 2);
    const b3 = placeBridge(b2.x + CH2_BRIDGE_WIDTH + 4, playableEnd);
    bridges.push(b1, b2, b3);
  } else {
    const mid = Math.floor((playableStart + playableEnd) / 2);
    const b1 = placeBridge(playableStart, Math.max(playableStart, mid - 3));
    const b2 = placeBridge(Math.min(playableEnd, Math.max(mid + 2, b1.x + CH2_BRIDGE_WIDTH + 5)), playableEnd);
    bridges.push(b1, b2);
  }
  bridges.sort((a, b) => a.x - b.x);

  // Optional waterfall (75% of rooms) feeding into a wider plunge pool strictly BETWEEN the
  // leftmost and rightmost bridges so both sides of the waterfall always keep a bridge crossing
  // (guarantees the north-bank trail from `topDoor` to `primaryBridge` never crosses the waterfall).
  let waterfall: { readonly x: number; readonly poolTop: number; readonly height: number } | null = null;
  if (rng() < 0.75 && bridges.length >= 2) {
    const firstBridge = bridges[0]!;
    const lastBridge = bridges[bridges.length - 1]!;
    const minFallX = firstBridge.x + firstBridge.width + 2;
    const maxFallX = lastBridge.x - 4;
    const candidates: number[] = [];
    for (let fx = minFallX; fx <= maxFallX; fx += 1) {
      if (Math.abs(fx + 1 - topDoorX) < 6) continue;
      const clearOfBridges = bridges.every(
        (b) => fx + 2 + 2 <= b.x || fx >= b.x + b.width + 2,
      );
      if (!clearOfBridges) continue;
      const baseTop = colTop[fx] ?? -1;
      if (baseTop < 5) continue;
      candidates.push(fx);
    }
    if (candidates.length > 0) {
      const fx = candidates[int(rng, candidates.length)]!;
      const baseTop = colTop[fx] ?? yMid;
      const poolTop = Math.max(4, baseTop - 1);
      for (let px = fx - 2; px < fx + 4; px += 1) {
        if (px < startX || px >= endX) continue;
        if (bridges.some((b) => px >= b.x - 1 && px <= b.x + b.width)) continue;
        colTop[px] = Math.min(colTop[px] ?? baseTop, poolTop);
      }
      waterfall = { x: fx, poolTop, height: poolTop + 2 };
    }
  }

  // Pick the bridge closest to the door-to-door axis on the SAME side of the waterfall as `topDoorX`,
  // so the north-bank dirt trail from `topDoor` to `primaryBridge` never crosses the waterfall chute.
  const sameSideBridges =
    waterfall === null
      ? bridges
      : bridges.filter((bridge) =>
          topDoorX < waterfall.x
            ? bridge.x + bridge.width <= waterfall.x
            : bridge.x >= waterfall.x + 2,
        );
  const trailCandidates = sameSideBridges.length > 0 ? sameSideBridges : bridges;
  let primaryBridge = trailCandidates[0] ?? bridges[0]!;
  let bestAxisDist = Number.POSITIVE_INFINITY;
  for (const bridge of trailCandidates) {
    const dist = Math.abs(bridge.x + bridge.width / 2 - axisX);
    if (dist < bestAxisDist) {
      bestAxisDist = dist;
      primaryBridge = bridge;
    }
  }

  // Build the boolean river mask and normalize so every cell sits in a full 2×2 block for autotiling.
  const rawWater = new Array<boolean>(cols * rows).fill(false);
  for (let x = startX; x < endX; x += 1) {
    const y0 = colTop[x] ?? -1;
    const y1 = colBottom[x] ?? -1;
    if (y0 < 0 || y1 < 0) continue;
    for (let y = y0; y < y1; y += 1) {
      if (y >= 0 && y < rows) rawWater[y * cols + x] = true;
    }
  }
  const waterMask: PatchMask = normalizePatchMask({ cols, rows, cells: rawWater });

  // Bridge cell lookup (exact deck cells).
  const isBridgeCell = (x: number, y: number): boolean =>
    bridges.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);

  // Paint the `water` TMX layer with 13-piece grass-banked `TilesetWater` autotiles.
  const waterLayer = new Array<number>(cols * rows).fill(0);
  const innerWaterMask = new Array<boolean>(cols * rows).fill(false);
  const pitMask = new Array<boolean>(cols * rows).fill(false);
  const waterCells = new Set<string>();

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const blob = pickBlobTile(waterMask, x, y);
      if (blob === 0) continue;
      const local = WATER_BLOB_LOCALS[blob - 1];
      if (local !== undefined) {
        waterLayer[y * cols + x] = gid('water', local);
      }
      waterCells.add(cellKey(x, y));

      const insidePlayable =
        x >= borderTiles && x < cols - borderTiles && y >= borderTiles && y < rows - borderTiles;
      if (insidePlayable && !isBridgeCell(x, y)) {
        pitMask[y * cols + x] = true;
      }

      // Inner deep-water cells (blob 7 only) get animated `WaterView` ripples — strictly excluding
      // shoreline bank tiles, inner corners, bridge tiles, and the waterfall splash cells.
      const onWaterfallSplash =
        waterfall !== null &&
        x >= waterfall.x &&
        x < waterfall.x + 2 &&
        y <= waterfall.poolTop + 1;
      if (insidePlayable && blob === 7 && !isBridgeCell(x, y) && !onWaterfallSplash) {
        innerWaterMask[y * cols + x] = true;
      }
    }
  }

  // Mark the waterfall chute inside the playable interior as impassable `pit` + waterCells.
  if (waterfall !== null) {
    for (let y = 0; y < waterfall.height; y += 1) {
      for (let x = waterfall.x; x < waterfall.x + 2; x += 1) {
        waterCells.add(cellKey(x, y));
        if (y >= borderTiles && y < rows - borderTiles && !isBridgeCell(x, y)) {
          pitMask[y * cols + x] = true;
        }
      }
    }
  }

  // Decompose interior deep-water cells into `WaterArea` rects and `pitMask` into `pit` obstacles.
  const riverAreaRects = decomposeRects(cols, rows, innerWaterMask);
  const waterAreas: WaterArea[] = riverAreaRects.map((rect) => ({
    kind: 'river',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }));
  if (waterfall !== null) {
    waterAreas.push({
      kind: 'waterfall',
      x: waterfall.x,
      y: 0,
      width: 2,
      height: waterfall.height,
    });
  }

  // Sprinkle lily pads / submerged pebbles / fish on open deep-water cells that have NO animated
  // ripple sprite (`planRiverRipples` is deterministic, so ripples never cover lily pads!).
  const rippleCells = new Set<string>();
  for (const area of waterAreas) {
    if (area.kind !== 'river') continue;
    for (const ripple of planRiverRipples(area)) {
      rippleCells.add(cellKey(ripple.tileX, ripple.tileY));
    }
  }
  for (let y = borderTiles; y < rows - borderTiles; y += 1) {
    for (let x = borderTiles; x < cols - borderTiles; x += 1) {
      if (!innerWaterMask[y * cols + x]) continue;
      if (rippleCells.has(cellKey(x, y))) continue;
      if (rng() < 0.08) {
        const detail = WATER_DETAILS[int(rng, WATER_DETAILS.length)] ?? WATER_DETAILS[0]!;
        waterLayer[y * cols + x] = gid('water', detail);
      }
    }
  }

  // Paint the `bridge` TMX layer with sturdy 4-tile-wide wooden deck planks over the river crossings.
  const bridgeLayer = new Array<number>(cols * rows).fill(0);
  const useAltPlanks = rng() < 0.35;
  for (const bridge of bridges) {
    for (let y = bridge.y; y < bridge.y + bridge.height; y += 1) {
      for (let i = 0; i < bridge.width; i += 1) {
        const local =
          i === 0
            ? BRIDGE_LEFT
            : i === bridge.width - 1
              ? BRIDGE_RIGHT
              : useAltPlanks && (i + y) % 2 === 0
                ? BRIDGE_MID_ALT
                : BRIDGE_MID;
        bridgeLayer[y * cols + (bridge.x + i)] = gid('water', local);
      }
    }
  }

  // Decompose `pitMask` into maximal rectangles for the `.tmx` object layer.
  const pitObstacles = decomposeRects(cols, rows, pitMask);

  // Reserve river, waterfall, bridge decks, and 2-tile north/south bridge aprons so solid props
  // and ground patches never collide with banks or clog a bridge entrance.
  const reservedCells = new Set<string>(waterCells);
  for (const bridge of bridges) {
    for (let y = bridge.y - 2; y < bridge.y + bridge.height + 2; y += 1) {
      for (let x = bridge.x - 1; x <= bridge.x + bridge.width; x += 1) {
        if (x >= 0 && x < cols && y >= 0 && y < rows) reservedCells.add(cellKey(x, y));
      }
    }
  }
  if (waterfall !== null) {
    for (let y = 0; y <= waterfall.height; y += 1) {
      for (let x = waterfall.x - 2; x <= waterfall.x + 3; x += 1) {
        if (x >= 0 && x < cols && y >= 0 && y < rows) reservedCells.add(cellKey(x, y));
      }
    }
  }

  // Queue natural bank reeds/grass along the shoreline + gray rock accents flanking the waterfall.
  const bankDecor: { index: number; gid: number }[] = [];
  const usedDecor = new Set<string>();
  const addDecor = (x: number, y: number, value: number): void => {
    if (x < borderTiles || y < borderTiles || x >= cols - borderTiles || y >= rows - borderTiles) return;
    const key = cellKey(x, y);
    if (waterCells.has(key) || usedDecor.has(key)) return;
    if (bridges.some((b) => x >= b.x - 1 && x <= b.x + b.width && y >= b.y - 2 && y < b.y + b.height + 2)) {
      return;
    }
    usedDecor.add(key);
    bankDecor.push({ index: y * cols + x, gid: value });
  };

  if (waterfall !== null) {
    // Anchor river boulders at the plunge-pool mouth and soft reeds/grass along the upper banks
    // instead of a uniform vertical ladder of identical rock tiles.
    for (const rx of [waterfall.x - 1, waterfall.x + 2]) {
      addDecor(rx, waterfall.poolTop, gid('nature', WATERFALL_ROCK_LOCAL));
      for (let y = borderTiles; y < waterfall.poolTop; y += 1) {
        if (rng() < 0.65) {
          addDecor(rx, y, gid('nature', BANK_REEDS[int(rng, BANK_REEDS.length)] ?? 241));
        }
      }
    }
  }

  for (let x = Math.max(borderTiles, startX); x < Math.min(cols - borderTiles, endX); x += 1) {
    const top = colTop[x] ?? -1;
    const bottom = colBottom[x] ?? -1;
    if (top < 0 || bottom < 0) continue;
    const north = top - 1;
    const south = bottom;
    if (rng() < 0.28) {
      addDecor(x, north, gid('nature', BANK_REEDS[int(rng, BANK_REEDS.length)] ?? 241));
    }
    if (rng() < 0.28) {
      addDecor(x, south, gid('nature', BANK_REEDS[int(rng, BANK_REEDS.length)] ?? 241));
    }
  }

  return {
    waterAreas,
    pitObstacles,
    bridges,
    primaryBridge,
    layers: [
      { name: 'water', tiles: waterLayer },
      { name: 'bridge', tiles: bridgeLayer },
    ],
    reservedCells,
    waterCells,
    bankDecor,
  };
}

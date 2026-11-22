/**
 * Split a room's `.tmx` **rendering** layers into chunks no larger than one 32×18 screen.
 *
 * Why: Cocos' `TiledMap` uploads a whole layer as one static vertex-buffer chunk, and that chunk
 * must fit the 2D batcher's buffer (`macro.BATCHER2D_MEM_INCREMENT` = 144 KB → 4096 vertices with
 * the 36-byte pos/uv/color format). A 128×72 layer is 9216 tiles = 36 864 vertices = 1.33 MB, so
 * the engine throws `Error 9004` ("Failed to allocate chunk in StaticVBAccessor") and the canvas
 * freezes. One 32×18 chunk is 576 tiles = 2304 vertices — safely under the limit, whatever the
 * window aspect (engine culling can add a reserve row/column on top).
 *
 * This module is pure (no `cc`): it slices the CSV of every `<layer>` into a self-contained
 * `.tmx` string per chunk, keeping the map's tilesets so gids stay valid. Objects (`objectgroup`)
 * are **not** copied — collision/level data comes from `parseTmxLevel`, never from these strings.
 * The engine adapter turns each chunk into its own `TiledMap` node.
 *
 * Coordinates: `col`/`row` are the chunk's top-left tile in the source map (Tiled space, y down).
 */
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from './level-data';
import { childrenNamed, elementText, firstChild, parseXml } from './xml';
import type { XmlElement } from './xml';

export interface TmxChunk {
  /** Left tile column in the source map. */
  readonly col: number;
  /** Top tile row in the source map. */
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  /** A standalone `.tmx` string with the same tilesets and the sliced layers. */
  readonly xml: string;
}

interface SourceLayer {
  readonly name: string;
  readonly opacity: string | null;
  readonly visible: string | null;
  readonly values: readonly string[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attribute(element: XmlElement, name: string): string | null {
  const value = element.attributes[name];
  return value === undefined ? null : value;
}

function requiredNumber(element: XmlElement, name: string, what: string): number {
  const raw = attribute(element, name);
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`tmx chunking: ${what}.${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Read one axis of a CSV grid; `<data>` text is whitespace/newline separated cells. */
function readGrid(map: XmlElement, cols: number, rows: number): SourceLayer[] {
  const layers = childrenNamed(map, 'layer');
  return layers.map((layer, index) => {
    const name = attribute(layer, 'name') ?? `layer-${index}`;
    const data = firstChild(layer, 'data');
    if (data === null) {
      throw new Error(`tmx chunking: layer "${name}" has no <data>`);
    }

    const encoding = attribute(data, 'encoding');
    if (encoding !== 'csv') {
      throw new Error(
        `tmx chunking: layer "${name}" must be encoding="csv" (got ${JSON.stringify(encoding)}); ` +
          'compressed/base64 layers cannot be sliced',
      );
    }

    const values = elementText(data)
      .split(',')
      .map((value) => value.trim());
    if (values.length !== cols * rows) {
      throw new Error(
        `tmx chunking: layer "${name}" has ${values.length} cells, expected ${cols * rows} (${cols}×${rows})`,
      );
    }

    const invalid = values.find((value) => !/^\d+$/.test(value));
    if (invalid !== undefined) {
      throw new Error(`tmx chunking: layer "${name}" has a non-integer cell ${JSON.stringify(invalid)}`);
    }

    return {
      name,
      opacity: attribute(layer, 'opacity'),
      visible: attribute(layer, 'visible'),
      values,
    };
  });
}

/** The `<tileset firstgid source/>` entries, copied verbatim — gids in the slices keep working. */
function readTilesets(map: XmlElement): Array<{ firstgid: string; source: string }> {
  return childrenNamed(map, 'tileset').map((tileset, index) => {
    const source = attribute(tileset, 'source');
    if (source === null) {
      throw new Error(
        `tmx chunking: tileset #${index} has no "source"; inline tilesets are not supported by this project`,
      );
    }
    return { firstgid: attribute(tileset, 'firstgid') ?? '1', source };
  });
}

/**
 * Slice every CSV layer of `xml` into `chunkCols × chunkRows` (default: one screen) pieces.
 * A map that already fits one screen returns a single chunk.
 */
export function splitTmxLayers(
  xml: string,
  chunkCols: number = ROOM_COLS,
  chunkRows: number = ROOM_ROWS,
): TmxChunk[] {
  const map = parseXml(xml);
  if (map.name !== 'map') {
    throw new Error(`tmx chunking: root element must be <map>, got <${map.name}>`);
  }
  if (attribute(map, 'infinite') === '1') {
    throw new Error('tmx chunking: infinite maps are not supported');
  }

  const cols = requiredNumber(map, 'width', 'map');
  const rows = requiredNumber(map, 'height', 'map');
  const tileWidth = attribute(map, 'tilewidth') ?? String(TILE_SIZE_PX);
  const tileHeight = attribute(map, 'tileheight') ?? String(TILE_SIZE_PX);
  const orientation = attribute(map, 'orientation') ?? 'orthogonal';
  const renderOrder = attribute(map, 'renderorder') ?? 'right-down';
  const tilesets = readTilesets(map);
  const layers = readGrid(map, cols, rows);

  const chunks: TmxChunk[] = [];
  let layerId = 1;
  for (let row = 0; row < rows; row += chunkRows) {
    for (let col = 0; col < cols; col += chunkCols) {
      const width = Math.min(chunkCols, cols - col);
      const height = Math.min(chunkRows, rows - row);

      const layerXml = layers.map((layer) => {
        const cells: string[] = [];
        for (let y = row; y < row + height; y += 1) {
          for (let x = col; x < col + width; x += 1) {
            cells.push(layer.values[y * cols + x] ?? '0');
          }
        }
        const opacity = layer.opacity === null ? '' : ` opacity="${escapeXml(layer.opacity)}"`;
        const visible = layer.visible === null ? '' : ` visible="${escapeXml(layer.visible)}"`;
        return (
          ` <layer id="${layerId++}" name="${escapeXml(layer.name)}" width="${width}" height="${height}"` +
          `${opacity}${visible}>\n  <data encoding="csv">${cells.join(',')}</data>\n </layer>`
        );
      });

      const tilesetXml = tilesets.map(
        (tileset) =>
          ` <tileset firstgid="${escapeXml(tileset.firstgid)}" source="${escapeXml(tileset.source)}"/>`,
      );

      chunks.push({
        col,
        row,
        cols: width,
        rows: height,
        xml: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          `<map version="1.10" orientation="${escapeXml(orientation)}" renderorder="${escapeXml(renderOrder)}" ` +
            `width="${width}" height="${height}" tilewidth="${escapeXml(tileWidth)}" ` +
            `tileheight="${escapeXml(tileHeight)}" infinite="0">`,
          ...tilesetXml,
          ...layerXml,
          '</map>',
          '',
        ].join('\n'),
      });
    }
  }

  return chunks;
}

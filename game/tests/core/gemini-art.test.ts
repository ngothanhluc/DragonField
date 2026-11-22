import { describe, expect, it } from 'vitest';
import {
  chromaKey,
  clusterToPalette,
  cornerColor,
  cropToOpaque,
  despeckle,
  directionKey,
  dropStrayBlobs,
  hexToRgb,
  nearestResize,
  paletteColors,
  parseSpec,
  quantize,
  resamplePixelArt,
  salienceWeights,
  sheetSize,
  upscaleFactor,
  fitColumnsToCells,
  fitCells,
  fitPoint,
  footPxFor,
  inspectCells,
  limitColors,
  mirrorColumn,
  kindDefaults,
  nativeBlockSize,
  removeMarker,
  type AssetSpec,
  type FitCellsOptions,
  type Rgb,
} from '../../scripts/lib/gemini-art';
import type { PngImage } from '../../scripts/lib/png';

const base: AssetSpec = {
  key: 'sniper.idle.down',
  kind: 'monster',
  source: 'art-source/gemini/sniper.png',
  sheet: 'generated/sniper/idle-down.png',
  frameWidth: 16,
  frameHeight: 16,
  layout: 'grid',
  directions: ['down'],
  frames: 4,
  fps: 8,
  loop: true,
  anchor: 'feet',
};

function image(pixels: readonly (readonly [number, number, number, number])[], width: number, height: number): PngImage {
  const data = Buffer.alloc(width * height * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width, height, data };
}

describe('parseSpec', () => {
  it('accepts a valid asset and defaults its role', () => {
    const spec = parseSpec({ assets: [base] });
    expect(spec.assets[0]?.role).toBeUndefined();
    expect(spec.assets[0]?.key).toBe('sniper.idle.down');
  });

  it('rejects a sheet path that escapes the resource tree', () => {
    expect(() => parseSpec({ assets: [{ ...base, sheet: '../outside.png' }] })).toThrow(/sheet/);
  });

  it('rejects an unknown direction and a malformed key', () => {
    expect(() => parseSpec({ assets: [{ ...base, directions: ['diagonal'] }] })).toThrow(/directions/);
    expect(() => parseSpec({ assets: [{ ...base, key: 'Bad Key' }] })).toThrow(/key/);
  });

  it('parses a chroma-key background and rejects a malformed one', () => {
    const spec = parseSpec({ assets: [{ ...base, background: '#FF00FF' }] });
    expect(spec.assets[0]?.background).toEqual([255, 0, 255]);
    expect(parseSpec({ assets: [{ ...base, background: 'auto' }] }).assets[0]?.background).toBe('auto');
    expect(() => parseSpec({ assets: [{ ...base, background: 'magenta' }] })).toThrow(/background/);
  });

  it('allows several directions only when the key has no trailing direction', () => {
    const multi = { ...base, key: 'sniper.idle', directions: ['down', 'up', 'left', 'right'] };
    expect(parseSpec({ assets: [multi] }).assets[0]?.directions).toHaveLength(4);
    expect(() =>
      parseSpec({ assets: [{ ...multi, key: 'sniper.idle.down' }] }),
    ).toThrow(/trailing direction|at most one/);
  });
});

describe('parseSpec quality options', () => {
  const multi = { ...base, key: 'sniper.idle', directions: ['down', 'up', 'left', 'right'] };

  it('accepts maxColors and a mirror between two of the asset directions', () => {
    const spec = parseSpec({ assets: [{ ...multi, maxColors: 6, mirror: { right: 'left' } }] });
    expect(spec.assets[0]?.maxColors).toBe(6);
    expect(spec.assets[0]?.mirror).toEqual({ right: 'left' });
  });

  it('rejects a mirror that names a missing direction, itself or a mirrored source', () => {
    expect(() => parseSpec({ assets: [{ ...base, mirror: { right: 'down' } }] })).toThrow(/mirror/);
    expect(() => parseSpec({ assets: [{ ...multi, mirror: { left: 'left' } }] })).toThrow(/mirror/);
    expect(() => parseSpec({ assets: [{ ...multi, mirror: { right: 'left', left: 'up' } }] })).toThrow(/mirror/);
    expect(() => parseSpec({ assets: [{ ...multi, maxColors: 0 }] })).toThrow(/maxColors/);
  });
});

describe('sheetSize', () => {
  it('uses direction columns and frame rows for a grid', () => {
    expect(sheetSize(base)).toEqual({ width: 16, height: 64 });
    expect(sheetSize({ ...base, directions: ['down', 'up', 'left', 'right'] })).toEqual({
      width: 64,
      height: 64,
    });
  });

  it('uses one row of frames for a strip', () => {
    expect(sheetSize({ ...base, layout: 'strip' })).toEqual({ width: 64, height: 16 });
  });
});

describe('nearestResize', () => {
  it('repeats source pixels without blending', () => {
    const source = image(
      [
        [10, 20, 30, 255],
        [40, 50, 60, 0],
      ],
      2,
      1,
    );
    const resized = nearestResize(source, 4, 1);
    expect(Array.from(resized.data)).toEqual([
      10, 20, 30, 255, 10, 20, 30, 255, 40, 50, 60, 0, 40, 50, 60, 0,
    ]);
  });
});

describe('paletteColors', () => {
  it('collects opaque colours once', () => {
    const source = image(
      [
        [1, 2, 3, 255],
        [1, 2, 3, 255],
        [4, 5, 6, 0],
      ],
      3,
      1,
    );
    expect(paletteColors(source)).toEqual([[1, 2, 3]]);
  });
});

describe('chromaKey', () => {
  it('drops near-key pixels and keeps palette colours', () => {
    const source = image(
      [
        [255, 0, 255, 255],
        [250, 12, 240, 255],
        [20, 90, 120, 255],
      ],
      3,
      1,
    );
    const result = chromaKey(source, hexToRgb('#ff00ff'));
    expect(Array.from(result.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 20, 90, 120, 255]);
  });

  it('uses the top-left pixel for background "auto"', () => {
    const source = image(
      [
        [10, 200, 30, 255],
        [12, 190, 40, 255],
      ],
      2,
      1,
    );
    expect(cornerColor(source)).toEqual([10, 200, 30]);
    const result = chromaKey(source, cornerColor(source));
    expect(result.data[3]).toBe(0);
    expect(result.data[7]).toBe(0);
  });

  it('peels a blended rim that touches the key but keeps interior colours', () => {
    const blend = [255, 120, 255, 255] as const; // halfway between magenta and white
    const source = image([[255, 0, 255, 255], blend, [10, 20, 30, 255], blend, [11, 22, 33, 255]], 5, 1);
    const result = Array.from(chromaKey(source, hexToRgb('#ff00ff')).data);
    // key and the neighbouring blend vanish; the third blend has no transparent neighbour
    expect(result.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(result.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(result.slice(8, 12)).toEqual([10, 20, 30, 255]);
    expect(result.slice(12, 16)).toEqual([255, 120, 255, 255]);
  });
});

describe('direction helpers', () => {
  it('derives the per-direction key', () => {
    expect(directionKey('sniper.idle', 'down')).toBe('sniper.idle.down');
    expect(directionKey('sniper.idle', 'left')).toBe('sniper.idle.left');
  });
});

describe('upscaleFactor', () => {
  it('scales the long side up to the minimum with whole pixels', () => {
    expect(upscaleFactor(10, 9, 768)).toBe(77);
    expect(upscaleFactor(690, 54, 768)).toBe(2);
    expect(upscaleFactor(2048, 2048, 768)).toBe(1);
  });
});

describe('resamplePixelArt', () => {
  it('picks the dominant colour of a block instead of one sample', () => {
    const source = image(
      [
        [200, 0, 0, 255],
        [200, 0, 0, 255],
        [200, 0, 0, 255],
        [0, 0, 200, 255],
      ],
      2,
      2,
    );
    expect(Array.from(resamplePixelArt(source, 1, 1).data)).toEqual([200, 0, 0, 255]);
  });

  it('drops a block that is mostly transparent', () => {
    const source = image(
      [
        [1, 2, 3, 255],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      2,
      2,
    );
    expect(resamplePixelArt(source, 1, 1).data[3]).toBe(0);
  });
});

describe('fitColumnsToCells', () => {
  it('scales a small sprite up to the frame and keeps it on the floor', () => {
    const pixels: Array<readonly [number, number, number, number]> = new Array(8 * 16).fill([
      0, 0, 0, 0,
    ]);
    const put = (x: number, y: number): void => {
      pixels[y * 8 + x] = [255, 0, 255, 255];
    };
    // frame 1: 2×2 sprite at (1,1); frame 2: same sprite lower and further right
    put(1, 1);
    put(2, 1);
    put(1, 2);
    put(2, 2);
    put(3, 13);
    put(4, 13);
    put(3, 14);
    put(4, 14);

    const out = fitColumnsToCells(image(pixels, 8, 16), 1, 2, 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(8);

    const rowOpaque = (y: number): number => {
      let count = 0;
      for (let x = 0; x < 4; x += 1) {
        if ((out.data[(y * 4 + x) * 4 + 3] ?? 0) >= 128) count += 1;
      }
      return count;
    };
    expect(rowOpaque(0)).toBe(0); // one pixel of headroom
    expect(rowOpaque(3)).toBeGreaterThan(0); // feet on the cell floor
    expect(rowOpaque(7)).toBeGreaterThan(0); // second frame also reaches its floor
  });
});

describe('quantize', () => {
  it('snaps alpha to binary and moves colours onto the palette', () => {
    const source = image(
      [
        [11, 12, 13, 255],
        [200, 200, 200, 128],
        [1, 2, 3, 7],
      ],
      3,
      1,
    );
    const result = quantize(source, [
      [10, 10, 10],
      [250, 250, 250],
    ]);
    expect(Array.from(result.data)).toEqual([
      10, 10, 10, 255, 250, 250, 250, 255, 0, 0, 0, 0,
    ]);
  });
});

type Pixel = readonly [number, number, number, number];
const CLEAR: Pixel = [0, 0, 0, 0];

describe('limitColors', () => {
  it('folds rare near shades into the common ones but keeps a distant accent', () => {
    const green: Pixel = [60, 110, 70, 255];
    const greenish: Pixel = [70, 120, 80, 255]; // rare, close to green
    const black: Pixel = [20, 27, 27, 255];
    const eye: Pixel = [230, 110, 60, 255]; // rare, far from both kept colours
    const pixels: Pixel[] = [
      ...new Array<Pixel>(60).fill(green),
      ...new Array<Pixel>(30).fill(black),
      ...new Array<Pixel>(5).fill(greenish),
      ...new Array<Pixel>(5).fill(eye),
    ];
    const result = limitColors(image(pixels, 100, 1), 2);
    const colours = new Set<string>();
    for (let i = 0; i < result.data.length; i += 4) colours.add(Array.from(result.data.subarray(i, i + 3)).join(','));
    expect(colours).toEqual(new Set(['60,110,70', '20,27,27', '230,110,60']));
  });
});

describe('despeckle', () => {
  it('drops an isolated pixel and keeps connected ones', () => {
    const on: Pixel = [1, 2, 3, 255];
    // row: speck . pair pair
    const result = despeckle(image([on, CLEAR, on, on], 4, 1));
    expect([3, 7, 11, 15].map((i) => result.data[i])).toEqual([0, 0, 255, 255]);
  });
});

describe('mirrorColumn', () => {
  it('writes the flipped source column over the target column', () => {
    const a: Pixel = [10, 0, 0, 255];
    const b: Pixel = [20, 0, 0, 255];
    // two 2-px columns: [a b | clear clear]
    const result = mirrorColumn(image([a, b, CLEAR, CLEAR], 4, 1), 2, 0, 1);
    expect([0, 4, 8, 12].map((i) => result.data[i])).toEqual([10, 20, 20, 10]);
  });
});

describe('inspectCells', () => {
  const red: Pixel = [200, 0, 0, 255];
  const blue: Pixel = [0, 0, 200, 255];
  /** One column of `rows` 8×8 cells, each with a 2×2 block at (3,3) in the given colour. */
  function column(colours: readonly Pixel[], extra?: (put: (x: number, y: number, p: Pixel) => void) => void): PngImage {
    const pixels: Pixel[] = new Array<Pixel>(8 * 8 * colours.length).fill(CLEAR);
    const put = (x: number, y: number, p: Pixel): void => {
      pixels[y * 8 + x] = p;
    };
    colours.forEach((colour, row) => {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) put(3 + dx, row * 8 + 3 + dy, colour);
    });
    extra?.(put);
    return image(pixels, 8, 8 * colours.length);
  }

  it('passes a consistent column', () => {
    expect(inspectCells(column([red, red, red]), 1, 3, { margin: 1 })).toEqual([]);
  });

  it('flags a recoloured frame against the column medoid', () => {
    const issues = inspectCells(column([red, red, blue]), 1, 3, { margin: 1 });
    expect(issues.map((issue) => [issue.kind, issue.row])).toEqual([['drift', 2]]);
  });

  it('flags a sprite touching the side or top edge but not the floor', () => {
    const side = inspectCells(column([red, red], (put) => put(0, 4, red)), 1, 2, { margin: 1 });
    expect(side.map((issue) => [issue.kind, issue.row])).toEqual([['edge', 0]]);
    const floor = inspectCells(column([red, red], (put) => put(4, 7, red)), 1, 2, { margin: 1 });
    expect(floor).toEqual([]);
  });

  it('skips mirrored columns and reports an empty cell', () => {
    const two = image(new Array<Pixel>(4 * 2).fill(CLEAR), 4, 2);
    expect(inspectCells(two, 2, 1, { margin: 0, skipColumns: [1] }).map((issue) => issue.kind)).toEqual(['empty']);
  });
});

describe('dropStrayBlobs', () => {
  it('clears a small blob spilled into a cell and keeps the sprite', () => {
    const on: Pixel = [5, 5, 5, 255];
    // one 6×6 cell: a 3×3 sprite at (2,2) and a one-pixel spill at (0,0)
    const pixels: Pixel[] = new Array<Pixel>(36).fill(CLEAR);
    for (let y = 2; y < 5; y += 1) for (let x = 2; x < 5; x += 1) pixels[y * 6 + x] = on;
    pixels[0] = on;
    const result = dropStrayBlobs(image(pixels, 6, 6), 1, 1, 0.2);
    expect(result.data[3]).toBe(0);
    expect(result.data[(3 * 6 + 3) * 4 + 3]).toBe(255);
  });

  it('treats each cell on its own', () => {
    const on: Pixel = [5, 5, 5, 255];
    // two 2×1 cells, each with one pixel: each is its cell's largest blob
    const result = dropStrayBlobs(image([on, CLEAR, CLEAR, on], 4, 1), 2, 1);
    expect([3, 15].map((i) => result.data[i])).toEqual([255, 255]);
  });
});

describe('salienceWeights', () => {
  it('lets a rare detail win a block it only partly covers', () => {
    const cloak: Pixel = [20, 27, 27, 255];
    const eye: Pixel = [230, 110, 60, 255];
    // sheet: 99 cloak + 1 eye; a 2×2 block split evenly goes to the cloak without weights
    const sheet = image([...new Array<Pixel>(99).fill(cloak), eye], 100, 1);
    const weights = salienceWeights(sheet);
    expect(weights.get(0x141b1b)).toBe(1);
    expect(weights.get(0xe66e3c)).toBe(3); // capped
    const block = image([cloak, cloak, eye, eye], 2, 2);
    expect(Array.from(resamplePixelArt(block, 1, 1).data.subarray(0, 3))).toEqual([20, 27, 27]);
    expect(Array.from(resamplePixelArt(block, 1, 1, weights).data.subarray(0, 3))).toEqual([230, 110, 60]);
  });
});

describe('clusterToPalette', () => {
  it('maps one shade to one palette colour even when its pixels straddle two entries', () => {
    const palette: Rgb[] = [
      [100, 100, 100],
      [120, 120, 120],
      [250, 30, 30],
    ];
    // a shade wobbling around the midpoint 110: per-pixel quantize splits it
    const shade: Pixel[] = [108, 109, 111, 112].map((v) => [v, v, v, 255] as const);
    const accent: Pixel = [240, 40, 40, 255];
    const source = image([...shade, ...shade, accent], 9, 1);
    const split = new Set<number>();
    const perPixel = quantize(source, palette);
    for (let i = 0; i < 8; i += 1) split.add(perPixel.data[i * 4]!);
    expect(split.size).toBe(2);

    const result = clusterToPalette(source, palette, 2);
    const mapped = new Set<number>();
    for (let i = 0; i < 8; i += 1) mapped.add(result.data[i * 4]!);
    expect(mapped.size).toBe(1);
    expect(Array.from(result.data.subarray(32, 36))).toEqual([250, 30, 30, 255]);
  });
});

describe('#20 fitCells fitBox', () => {
  it('fits the shared window inside fitBox and centres it', () => {
    const blue: Pixel = [0, 0, 200, 255];
    const pixels: Pixel[] = new Array<Pixel>(16 * 16).fill(CLEAR);
    // a 10×2 blob, far too wide to be a sword at full frame size
    for (let y = 6; y < 8; y += 1) for (let x = 3; x < 13; x += 1) pixels[y * 16 + x] = blue;

    const out = fitCells(image(pixels, 16, 16), {
      columns: 1,
      rows: 1,
      frameWidth: 16,
      frameHeight: 16,
      anchor: 'center',
      share: 'cell',
      fitBox: [8, 4],
    });

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if ((out.data[(y * 16 + x) * 4 + 3] ?? 0) < 128) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    expect(x1 - x0 + 1).toBeLessThanOrEqual(8);
    expect(y1 - y0 + 1).toBeLessThanOrEqual(4);
    expect(Math.abs(x0 - (15 - x1))).toBeLessThanOrEqual(1);
    expect(Math.abs(y0 - (15 - y1))).toBeLessThanOrEqual(1);
  });
});

describe('#20 attachment fitting', () => {
  it('keeps one size across facings: an upright and a horizontal sword end up as long', () => {
    const red: Pixel = [200, 0, 0, 255];
    const pixels: Pixel[] = new Array<Pixel>(16 * 8).fill(CLEAR);
    // cell 0: a 2×6 upright blade; cell 1: the same length lying horizontally (6×2)
    for (let y = 1; y < 7; y += 1) for (let x = 3; x < 5; x += 1) pixels[y * 16 + x] = red;
    for (let y = 3; y < 5; y += 1) for (let x = 9; x < 15; x += 1) pixels[y * 16 + x] = red;

    const out = fitCells(image(pixels, 16, 8), {
      columns: 2,
      rows: 1,
      frameWidth: 8,
      frameHeight: 8,
      anchor: kindDefaults('attachment').anchor,
      share: kindDefaults('attachment').share,
    });

    const boxOf = (frame: number): { width: number; height: number } => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          if ((out.data[(y * out.width + frame * 8 + x) * 4 + 3] ?? 0) < 128) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
      return { width: x1 - x0 + 1, height: y1 - y0 + 1 };
    };
    expect(boxOf(0).height).toBe(boxOf(1).width);
  });
});

describe('#20 cropToOpaque', () => {
  it('crops a keyed panel margin so the stretched image is fully opaque', () => {
    const red: Pixel = [200, 0, 0, 255];
    const pixels: Pixel[] = new Array<Pixel>(10 * 10).fill(CLEAR);
    for (let y = 4; y < 6; y += 1) for (let x = 3; x < 7; x += 1) pixels[y * 10 + x] = red;

    const cropped = cropToOpaque(image(pixels, 10, 10));
    expect([cropped.width, cropped.height]).toEqual([4, 2]);

    const stretched = resamplePixelArt(cropped, 8, 4);
    for (let index = 3; index < stretched.data.length; index += 4) {
      expect(stretched.data[index]).toBe(255);
    }
  });
});

describe('#20 footPxFor', () => {
  it('uses the bottom solid row for feet and the frame centre for a centre anchor', () => {
    const red: Pixel = [200, 0, 0, 255];
    const pixels: Pixel[] = new Array<Pixel>(4 * 6).fill(CLEAR);
    for (let x = 0; x < 4; x += 1) pixels[3 * 4 + x] = red;
    const sheet = image(pixels, 4, 6);

    expect(footPxFor('feet', sheet, 6)).toBe(2);
    expect(footPxFor('center', sheet, 6)).toBe(3);
    expect(footPxFor('center', sheet, 32)).toBe(16);
  });

  it('returns the frame height for a fully transparent feet sheet', () => {
    expect(footPxFor('feet', image(new Array<Pixel>(9).fill(CLEAR), 3, 3), 3)).toBe(3);
  });
});

describe('#22 fitPoint', () => {
  it('agrees with fitCells for the feet anchor and clamps points outside the sprite', () => {
    const red: Pixel = [200, 0, 0, 255];
    const pixels: Pixel[] = new Array<Pixel>(16 * 16).fill(CLEAR);
    for (let y = 5; y < 14; y += 1) for (let x = 2; x < 13; x += 1) pixels[y * 16 + x] = red;
    const sheet = image(pixels, 16, 16);
    const options = {
      columns: 1,
      rows: 1,
      frameWidth: 16,
      frameHeight: 16,
      anchor: 'feet' as const,
      share: 'cell' as const,
    };
    const out = fitCells(sheet, options);

    // Every source pixel of the sprite maps to an opaque pixel of the fitted sheet.
    for (const [x, y] of [
      [2, 5],
      [7, 9],
      [12, 13],
    ] as const) {
      const [px, py] = fitPoint(sheet, options, [x + 0.5, y + 0.5]);
      expect(out.data[(py * 16 + px) * 4 + 3]).toBe(255);
    }
    expect(fitPoint(sheet, options, [-30, -30])).toEqual([0, 0]);
    expect(fitPoint(sheet, options, [99, 99])).toEqual([15, 15]);
  });
});

describe('#24 align', () => {
  const RED: Pixel = [200, 30, 40, 255];
  const OPTIONS = {
    columns: 1,
    rows: 1,
    frameWidth: 16,
    frameHeight: 16,
    anchor: 'feet' as const,
    share: 'cell' as const,
    align: true,
  };

  /** A 5×15 output-pixel sprite drawn with 3 px blocks at (x, y) — already on a 3 px grid. */
  function alignedSheet(x: number, y: number): PngImage {
    const pixels: Pixel[] = new Array<Pixel>(60 * 60).fill(CLEAR);
    for (let py = 0; py < 15; py += 1) {
      for (let px = 0; px < 5; px += 1) {
        for (let dy = 0; dy < 3; dy += 1) {
          for (let dx = 0; dx < 3; dx += 1) pixels[(y + py * 3 + dy) * 60 + x + px * 3 + dx] = RED;
        }
      }
    }
    return image(pixels, 60, 60);
  }

  it('keeps a source already on the output grid byte-identical to the unaligned fit', () => {
    const sheet = alignedSheet(10, 5);
    const aligned = fitCells(sheet, OPTIONS);
    const plain = fitCells(sheet, { ...OPTIONS, align: false });
    expect(Buffer.compare(aligned.data, plain.data)).toBe(0);
  });

  it('maps a grip through the same aligned window fitCells draws', () => {
    const sheet = alignedSheet(10, 5);
    const out = fitCells(sheet, OPTIONS);
    const [px, py] = fitPoint(sheet, OPTIONS, [17.5, 27.5]);
    expect([px, py]).toEqual([7, 8]);
    expect(out.data[(py * out.width + px) * 4 + 3]).toBe(255);
  });
});

describe('#29 align leaves a full-frame axis still', () => {
  const OUTLINE: Pixel = [20, 27, 27, 255];
  const A: Pixel = [45, 105, 123, 255];
  const B: Pixel = [184, 220, 229, 255];
  const FRAME: FitCellsOptions = {
    columns: 1,
    rows: 1,
    frameWidth: 16,
    frameHeight: 16,
    anchor: 'center',
    share: 'cell',
    fitBox: [16, 16],
    align: true,
  };

  /**
   * A 240 × 180 piece in a 260 × 200 cell: a 10 px outline ring around 15 px stripes that start
   * 5 px off the output grid. Its fitted width is the 16 px frame, so a non-zero offset would
   * push the right outline out of the frame; its height is smaller, so that axis may still shift.
   */
  function banner(): PngImage {
    const pixels: Pixel[] = new Array<Pixel>(260 * 200).fill(CLEAR);
    for (let y = 10; y < 190; y += 1) {
      for (let x = 10; x < 250; x += 1) {
        const edge = x < 20 || x >= 240 || y < 20 || y >= 180;
        const stripe = Math.floor((x + 10) / 15) % 2 === Math.floor((y + 10) / 15) % 2;
        pixels[y * 260 + x] = edge ? OUTLINE : stripe ? A : B;
      }
    }
    return image(pixels, 260, 200);
  }

  /** Whether every opaque row of the piece ends on the outline at the frame's right edge. */
  function rightEdgeIsOutline(sheet: PngImage): boolean {
    let rows = 0;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 15; x >= 0; x -= 1) {
        const from = (y * 16 + x) * 4;
        if (sheet.data[from + 3] === 0) continue;
        rows += 1;
        if (
          sheet.data[from] !== OUTLINE[0] ||
          sheet.data[from + 1] !== OUTLINE[1] ||
          sheet.data[from + 2] !== OUTLINE[2]
        ) {
          return false;
        }
        break;
      }
    }
    return rows > 0;
  }

  it('keeps the outline on the frame edge its axis fills', () => {
    expect(rightEdgeIsOutline(fitCells(banner(), FRAME))).toBe(true);
  });

  it('still shifts the axis that has room, so it is not the unaligned fit', () => {
    const source = banner();
    const aligned = fitCells(source, FRAME);
    const plain = fitCells(source, { ...FRAME, align: false });
    expect(Buffer.compare(aligned.data, plain.data)).not.toBe(0);
  });
});

describe('#27 keepDetails', () => {
  const GREEN: Pixel = [40, 140, 60, 255];
  const RED: Pixel = [200, 30, 40, 255];
  const SOLID_8: FitCellsOptions = { columns: 1, rows: 1, frameWidth: 8, frameHeight: 8, anchor: 'center', share: 'cell' };

  /** Fill a rectangle of a `width × height` sheet with one colour. */
  function sheet(width: number, height: number, base: Pixel): PngImage {
    return image(new Array<Pixel>(width * height).fill(base), width, height);
  }

  function rect(imageIn: PngImage, x0: number, y0: number, w: number, h: number, pixel: Pixel): void {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) imageIn.data.set(pixel, (y * imageIn.width + x) * 4);
  }

  function pixelsOf(out: PngImage, colour: Pixel): Array<[number, number]> {
    const found: Array<[number, number]> = [];
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        const i = (y * out.width + x) * 4;
        if (out.data[i] === colour[0] && out.data[i + 1] === colour[1] && out.data[i + 2] === colour[2]) found.push([x, y]);
      }
    }
    return found;
  }

  it('puts one pixel back where a straddling detail was, at its centroid', () => {
    // 2 source px per output px: a 2×2 detail straddles all four blocks it touches, so each
    // block is 1/4 detail and the background wins every one of them.
    const source = sheet(16, 16, GREEN);
    rect(source, 7, 7, 2, 2, RED);

    expect(pixelsOf(fitCells(source, SOLID_8), RED)).toEqual([]);
    expect(pixelsOf(fitCells(source, { ...SOLID_8, keepDetails: true }), RED)).toEqual([[4, 4]]);
  });

  it('leaves a speck below the bound and a large erased blob above it alone', () => {
    const source = sheet(32, 32, GREEN);
    rect(source, 10, 10, 1, 1, RED); // 1/16 output px²
    rect(source, 3, 10, 26, 2, RED); // 3.25 output px², erased by the vote

    expect(Buffer.compare(fitCells(source, { ...SOLID_8, keepDetails: true }).data, fitCells(source, SOLID_8).data)).toBe(0);
  });

  it('leaves a small blob on the keyed backdrop alone', () => {
    // A 3×3 island floating below the body, still inside the shared crop window.
    const source = sheet(32, 32, CLEAR);
    rect(source, 0, 0, 32, 28, GREEN);
    rect(source, 2, 29, 3, 3, RED);

    expect(Buffer.compare(fitCells(source, { ...SOLID_8, keepDetails: true }).data, fitCells(source, SOLID_8).data)).toBe(0);
  });

  it('changes nothing when the detail already shows', () => {
    const source = sheet(32, 32, GREEN);
    rect(source, 8, 8, 4, 4, RED); // exactly one output pixel: the vote keeps it

    expect(pixelsOf(fitCells(source, { ...SOLID_8, keepDetails: true }), RED)).toEqual([[2, 2]]);
    expect(Buffer.compare(fitCells(source, { ...SOLID_8, keepDetails: true }).data, fitCells(source, SOLID_8).data)).toBe(0);
  });
});

describe('#22 removeMarker', () => {
  it('matches a slightly off shade and fills a plate wider than the search ring', () => {
    const blue: Pixel = [0, 0, 200, 255];
    const nearCyan: Pixel = [12, 240, 245, 255];
    const pixels: Pixel[] = new Array<Pixel>(64 * 64).fill(CLEAR);
    for (let y = 8; y < 56; y += 1) for (let x = 8; x < 56; x += 1) pixels[y * 64 + x] = blue;
    for (let y = 28; y < 36; y += 1) for (let x = 28; x < 36; x += 1) pixels[y * 64 + x] = nearCyan;

    const { image: cleaned, centres } = removeMarker(image(pixels, 64, 64), [0, 255, 255], 1, 1);

    expect(centres[0]).toEqual([32, 32]);
    for (let y = 28; y < 36; y += 1) {
      for (let x = 28; x < 36; x += 1) {
        expect(Array.from(cleaned.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4))).toEqual([...blue]);
      }
    }
  });
});

describe('#22 removeMarker halo', () => {
  it('recolours the blended ring around the plate and keeps the grip at the plate centre', () => {
    const blue: Pixel = [0, 0, 200, 255];
    const blend: Pixel = [30, 150, 165, 255]; // cyan mixed into the item: ~142 from the marker
    const width = 64;
    const pixels: Pixel[] = new Array<Pixel>(width * width).fill(CLEAR);
    for (let y = 20; y < 40; y += 1) for (let x = 20; x < 40; x += 1) pixels[y * width + x] = blue;
    for (let y = 29; y < 35; y += 1) for (let x = 29; x < 35; x += 1) pixels[y * width + x] = [0, 255, 255, 255];
    for (let y = 28; y < 36; y += 1) {
      for (let x = 28; x < 36; x += 1) {
        if (x >= 29 && x < 35 && y >= 29 && y < 35) continue;
        pixels[y * width + x] = blend;
      }
    }

    const { image: cleaned, centres } = removeMarker(image(pixels, width, width), [0, 255, 255], 1, 1);

    expect(centres[0]).toEqual([32, 32]);
    for (let y = 28; y < 36; y += 1) {
      for (let x = 28; x < 36; x += 1) {
        expect(Array.from(cleaned.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))).toEqual([...blue]);
      }
    }
  });
});

describe('#22 nativeBlockSize through noise', () => {
  it('still finds 16 px blocks when a tenth of the pixels are anti-alias specks', () => {
    const colours: Pixel[] = [
      [242, 234, 241, 255],
      [45, 105, 123, 255],
      [59, 54, 67, 255],
      [252, 226, 202, 255],
      [143, 239, 241, 255],
    ];
    const seam: Pixel = [20, 27, 27, 255];
    const width = 512;
    const pixels: Pixel[] = new Array<Pixel>(width * width).fill(CLEAR);
    const put = (x: number, y: number, colour: Pixel): void => {
      pixels[y * width + x] = colour;
    };
    // 30×30 blocks of 16 px from (7, 3), with a 1 px seam on some block edges.
    for (let by = 0; by < 30; by += 1) {
      for (let bx = 0; bx < 30; bx += 1) {
        const colour = colours[(bx * 7 + by * 11 + bx * by) % colours.length]!;
        for (let dy = 0; dy < 16; dy += 1) {
          for (let dx = 0; dx < 16; dx += 1) put(7 + bx * 16 + dx, 3 + by * 16 + dy, colour);
        }
        if (bx % 3 === 0 && by % 2 === 0) {
          for (let dy = 0; dy < 16; dy += 1) put(7 + bx * 16, 3 + by * 16 + dy, seam);
        }
      }
    }
    // Anti-aliased specks, as the real downloads have after the palette mapping.
    let seed = 99;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < pixels.length; index += 1) {
      if (rand() >= 0.1) continue;
      pixels[index] = colours[Math.floor(rand() * colours.length)]!;
    }

    expect(nativeBlockSize(image(pixels, width, width))).toBe(16);
  });
});

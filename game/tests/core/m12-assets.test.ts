import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ccMocks = vi.hoisted(() => {
  let constructedNodes = 0;
  let nearestFilterCalls = 0;

  class MockColor {
    constructor(
      public r = 255,
      public g = 255,
      public b = 255,
      public a = 255,
    ) {}
  }

  class MockRect {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  class MockSize {
    constructor(
      public width = 0,
      public height = 0,
    ) {}
  }

  class MockVec2 {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  }

  class MockUITransform {
    contentWidth = 100;
    contentHeight = 100;
    anchorX = 0.5;
    anchorY = 0.5;
    setContentSize(w: number, h: number): void {
      this.contentWidth = w;
      this.contentHeight = h;
    }
    setAnchorPoint(x: number, y: number): void {
      this.anchorX = x;
      this.anchorY = y;
    }
  }

  class MockSprite {
    static Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    type = MockSprite.Type.SIMPLE;
    sizeMode = MockSprite.SizeMode.TRIMMED;
    trim = true;
    spriteFrame: unknown = null;
    color = new MockColor();
  }

  class MockGraphics {
    lineWidth = 1;
    strokeColor = new MockColor();
    fillColor = new MockColor();
    strokes = 0;
    fills = 0;
    segments = 0;
    cleared = 0;
    clear(): void {
      this.cleared += 1;
      this.segments = 0;
    }
    moveTo(): void {}
    lineTo(): void {
      this.segments += 1;
    }
    circle(): void {}
    rect(): void {}
    fill(): void {
      this.fills += 1;
    }
    stroke(): void {
      this.strokes += 1;
    }
  }

  class MockSpriteFrame {
    texture: unknown = null;
    rect = new MockRect();
    originalSize = new MockSize();
    offset = new MockVec2();
    packable = true;
  }

  class MockTexture2D {
    static Filter = { NEAREST: 0, LINEAR: 1 };
    minFilter = MockTexture2D.Filter.LINEAR;
    magFilter = MockTexture2D.Filter.LINEAR;
    constructor(public readonly path: string) {}
    setFilters(min: number, mag: number): void {
      this.minFilter = min;
      this.magFilter = mag;
      if (min === MockTexture2D.Filter.NEAREST && mag === MockTexture2D.Filter.NEAREST) {
        nearestFilterCalls += 1;
      }
    }
  }

  class MockJsonAsset {
    constructor(public json: unknown) {}
  }

  class MockNode {
    parent: MockNode | null = null;
    active = true;
    isValid = true;
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    readonly children: MockNode[] = [];
    private readonly components = new Map<unknown, unknown>();

    constructor(public readonly name = '') {
      constructedNodes += 1;
      this.components.set(MockUITransform, new MockUITransform());
    }

    addComponent<T>(Ctor: new () => T): T {
      const instance = new Ctor();
      this.components.set(Ctor, instance);
      return instance;
    }

    getComponent<T>(Ctor: new () => T): T | null {
      return (this.components.get(Ctor) as T | undefined) ?? null;
    }

    setPosition(x: number, y: number, z = 0): void {
      this.position = { x, y, z };
    }

    setScale(x: number, y: number, z = 1): void {
      this.scale = { x, y, z };
    }

    destroy(): void {
      this.isValid = false;
      this.active = false;
    }
  }

  return {
    MockColor,
    MockRect,
    MockSize,
    MockVec2,
    MockUITransform,
    MockSprite,
    MockGraphics,
    MockSpriteFrame,
    MockTexture2D,
    MockJsonAsset,
    MockNode,
    getConstructedNodes: () => constructedNodes,
    resetConstructedNodes: () => {
      constructedNodes = 0;
    },
    getNearestFilterCalls: () => nearestFilterCalls,
    resetNearestFilterCalls: () => {
      nearestFilterCalls = 0;
    },
  };
});

vi.mock('cc', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestJson: unknown = JSON.parse(
    readFileSync(join(here, '..', '..', 'assets', 'resources', 'data', 'animations.json'), 'utf8'),
  );

  return {
    Color: ccMocks.MockColor,
    Rect: ccMocks.MockRect,
    Size: ccMocks.MockSize,
    Vec2: ccMocks.MockVec2,
    UITransform: ccMocks.MockUITransform,
    Sprite: ccMocks.MockSprite,
    Graphics: ccMocks.MockGraphics,
    SpriteFrame: ccMocks.MockSpriteFrame,
    Texture2D: ccMocks.MockTexture2D,
    JsonAsset: ccMocks.MockJsonAsset,
    Node: ccMocks.MockNode,
    TiledMap: class {},
    TiledMapAsset: class {},
    Component: class {},
    _decorator: { ccclass: () => (target: unknown) => target },
    warn: () => undefined,
    resources: {
      load: (path: string, _type: unknown, cb: (err: Error | null, asset: unknown) => void) => {
        if (path === 'data/animations') {
          cb(null, new ccMocks.MockJsonAsset(manifestJson));
          return;
        }
        if (path.endsWith('/texture')) {
          cb(null, new ccMocks.MockTexture2D(path));
          return;
        }
        cb(new Error(`Unexpected resource load in test: ${path}`), null);
      },
    },
  };
});

import { SFX_BANK, VariantPicker } from '../../assets/scripts/core/audio/sfx-bank';
import {
  REQUIRED_ACTOR_ANIMATIONS,
  validateManifest,
} from '../../assets/scripts/core/art/manifest';
import { SeededRng } from '../../assets/scripts/core/rng';
import { clearFrameCache } from '../../assets/scripts/game/assets/sprite-frame-cache';
import { clearTextureCache } from '../../assets/scripts/game/assets/texture-cache';
import { SFX_IDS, playSfx, setSfxSink } from '../../assets/scripts/game/audio/sfx';
import { createFxPool } from '../../assets/scripts/game/fx/effect-pool';
import { ACTOR_SCALE } from '../../assets/scripts/game/level-view';
import {
  XP_ORB_MANIFEST_KEYS,
  XP_ORB_POOL_SIZE,
  XP_ORB_SHEETS,
  XP_ORB_TIERS,
  XP_ORB_TIER_PIXEL_RATIO,
  createXpOrbView,
  spawnLevelUpBurst,
  xpOrbTransform,
  type XpOrbVisual,
} from '../../assets/scripts/game/xp-orb-view';
import { readPng } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, '..', '..', 'assets');
const RESOURCES_DIR = join(ASSETS_DIR, 'resources');

function collectMetaFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMetaFiles(full, out);
    } else if (name.endsWith('.meta')) {
      out.push(full);
    }
  }
  return out;
}

describe('M12 audio bank & staged SFX', () => {
  it('declares level-up (3 variants) and xp-pickup (2 variants) in SFX_BANK and SFX_IDS', () => {
    expect(SFX_BANK['level-up']).toEqual([
      'audio/sfx/level-up-1',
      'audio/sfx/level-up-2',
      'audio/sfx/level-up-3',
    ]);
    expect(SFX_BANK['xp-pickup']).toEqual(['audio/sfx/xp-pickup', 'audio/sfx/xp-pickup-2']);
    expect(SFX_IDS).toContain('level-up');
    expect(SFX_IDS).toContain('xp-pickup');

    const picker = new VariantPicker(new SeededRng(2026));
    let prevLevelUp = picker.pick('level-up');
    let prevPickup = picker.pick('xp-pickup');
    for (let i = 0; i < 100; i += 1) {
      const nextLevelUp = picker.pick('level-up');
      const nextPickup = picker.pick('xp-pickup');
      expect(nextLevelUp).not.toBe(prevLevelUp);
      expect(nextPickup).not.toBe(prevPickup);
      prevLevelUp = nextLevelUp;
      prevPickup = nextPickup;
    }
  });

  it('forwards level-up and xp-pickup cleanly through playSfx', () => {
    const played: string[] = [];
    setSfxSink((id) => played.push(id));
    try {
      playSfx('xp-pickup');
      playSfx('level-up');
      expect(played).toEqual(['xp-pickup', 'level-up']);
    } finally {
      setSfxSink(null);
    }
  });

  it('every M12 mp3 exists on disk with a valid audio-clip .meta and positive duration', () => {
    for (const rel of [...SFX_BANK['level-up'], ...SFX_BANK['xp-pickup']]) {
      const mp3 = join(RESOURCES_DIR, `${rel}.mp3`);
      expect(existsSync(mp3), `${rel}.mp3 missing`).toBe(true);
      expect(statSync(mp3).size, `${rel}.mp3 empty`).toBeGreaterThan(1000);

      const metaPath = `${mp3}.meta`;
      expect(existsSync(metaPath), `${rel}.mp3.meta missing`).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        importer?: string;
        uuid?: string;
        userData?: { duration?: number; sampleRate?: number };
      };
      expect(meta.importer).toBe('audio-clip');
      expect(typeof meta.uuid).toBe('string');
      expect(meta.userData?.duration ?? 0).toBeGreaterThan(0.2);
      expect(meta.userData?.sampleRate).toBe(44100);
    }
  });
});

describe('M12 XP crystal orb art & global .meta UUID integrity', () => {
  const manifest = validateManifest(
    JSON.parse(readFileSync(join(RESOURCES_DIR, 'data', 'animations.json'), 'utf8')) as unknown,
  );

  it('registers all 3 XP orb tiers in animations.json and REQUIRED_ACTOR_ANIMATIONS.fx', () => {
    const requiredFx = new Set(REQUIRED_ACTOR_ANIMATIONS.fx);
    for (const tier of XP_ORB_TIERS) {
      const key = XP_ORB_MANIFEST_KEYS[tier];
      expect(requiredFx.has(key), `${key} in REQUIRED_ACTOR_ANIMATIONS.fx`).toBe(true);
      const entry = manifest.sprites[key];
      expect(entry, `${key} in animations.json`).toBeDefined();
      expect(entry).toMatchObject({
        frameWidth: 16,
        frameHeight: 16,
        layout: 'strip',
        directions: [],
        frames: 1,
        anchor: 'center',
        footPx: 8,
      });
    }
  });

  it('stages crisp 16×16 diamond PNGs with nearest-filter .meta and distinct tier palettes', () => {
    expect(existsSync(join(RESOURCES_DIR, 'art/fx/xp-orb.meta'))).toBe(true);

    const palettes: string[] = [];
    for (const sheet of XP_ORB_SHEETS) {
      const pngPath = join(ASSETS_DIR, sheet);
      expect(existsSync(pngPath), `${sheet} missing`).toBe(true);
      expect(existsSync(`${pngPath}.meta`), `${sheet}.meta missing`).toBe(true);

      const png = readPng(pngPath);
      expect([png.width, png.height]).toEqual([16, 16]);

      // Diamond silhouette check: narrow pointed tips on row 0 / row 15 (4 opaque px) vs wide
      // 16 px waist on rows 6..8 — unmistakably diamond, never a round bullet or round coin.
      const rowOpaque = (y: number): number => {
        let count = 0;
        for (let x = 0; x < 16; x += 1) {
          if (png.data[(y * 16 + x) * 4 + 3]! > 0) count += 1;
        }
        return count;
      };
      expect(rowOpaque(0)).toBe(4);
      expect(rowOpaque(7)).toBe(16);
      expect(rowOpaque(15)).toBe(4);

      const colours = new Set<string>();
      for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i + 3]! === 0) continue;
        colours.add(
          `#${png.data[i]!.toString(16).padStart(2, '0')}${png.data[i + 1]!.toString(16).padStart(2, '0')}${png.data[i + 2]!.toString(16).padStart(2, '0')}`,
        );
      }
      expect(colours.has('#141b1b'), `${sheet} has crisp dark outline`).toBe(true);
      palettes.push(Array.from(colours).sort().join(','));

      const meta = JSON.parse(readFileSync(`${pngPath}.meta`, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      expect(meta.importer).toBe('image');
      expect(meta.subMetas?.['6c48a']?.userData?.['minfilter']).toBe('nearest');
      expect(meta.subMetas?.['6c48a']?.userData?.['magfilter']).toBe('nearest');
    }

    // Every tier has its own distinct colour ramp.
    expect(new Set(palettes).size).toBe(3);
  });

  it('every .meta file under game/assets/ is valid JSON with a globally unique UUID', () => {
    const metas = collectMetaFiles(ASSETS_DIR);
    expect(metas.length).toBeGreaterThan(100);
    const seen = new Map<string, string>();

    for (const metaPath of metas) {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
      expect(typeof parsed.uuid, `${metaPath} uuid`).toBe('string');
      const uuid = parsed.uuid as string;
      expect(uuid.length, `${metaPath} empty uuid`).toBeGreaterThan(0);
      expect(seen.get(uuid), `duplicate UUID ${uuid} in ${metaPath}`).toBeUndefined();
      seen.set(uuid, metaPath);
    }
  });
});

describe('XpOrbView pooled renderer & level-up radial burst FX', () => {
  beforeEach(() => {
    clearTextureCache();
    clearFrameCache();
    ccMocks.resetConstructedNodes();
    ccMocks.resetNearestFilterCalls();
  });

  it('computes tier scales off ACTOR_SCALE, subtle idle bob, and area-preserving vacuum stretch', () => {
    const idleSmall = xpOrbTransform({ x: 4, y: 5, tier: 'small', vacuuming: false }, 0, 0.25);
    const idleMedium = xpOrbTransform({ x: 4, y: 5, tier: 'medium', vacuuming: false }, 0, 0.25);
    const idleLarge = xpOrbTransform({ x: 4, y: 5, tier: 'large', vacuuming: false }, 0, 0.25);

    expect(XP_ORB_TIER_PIXEL_RATIO.small * 16).toBe(6);
    expect(XP_ORB_TIER_PIXEL_RATIO.medium * 16).toBe(7.5);
    expect(XP_ORB_TIER_PIXEL_RATIO.large * 16).toBe(9);
    expect(idleSmall.scaleX).toBeCloseTo(ACTOR_SCALE * XP_ORB_TIER_PIXEL_RATIO.small, 6);
    expect(idleMedium.scaleX).toBeCloseTo(ACTOR_SCALE * XP_ORB_TIER_PIXEL_RATIO.medium, 6);
    expect(idleLarge.scaleX).toBeCloseTo(ACTOR_SCALE * XP_ORB_TIER_PIXEL_RATIO.large, 6);
    expect(idleSmall.scaleX).toBeLessThan(idleMedium.scaleX);
    expect(idleMedium.scaleX).toBeLessThan(idleLarge.scaleX);
    expect(Math.abs(idleSmall.bobOffsetTiles)).toBeGreaterThan(0);
    expect(Math.abs(idleSmall.bobOffsetTiles)).toBeLessThanOrEqual(0.05);

    const vacLarge = xpOrbTransform({ x: 4, y: 5, tier: 'large', vacuuming: true }, 0, 0.25);
    expect(vacLarge.bobOffsetTiles).toBe(0);
    expect(vacLarge.scaleY).toBeGreaterThan(vacLarge.scaleX);
    const largeBaseScale = ACTOR_SCALE * XP_ORB_TIER_PIXEL_RATIO.large;
    const areaRatio = (vacLarge.scaleX * vacLarge.scaleY) / (largeBaseScale * largeBaseScale);
    expect(areaRatio).toBeGreaterThan(0.95);
    expect(areaRatio).toBeLessThan(1.05);
  });

  it('pre-allocates 128 CUSTOM/nearest-filtered nodes and allocates zero nodes during sync/overflow', async () => {
    const root = new ccMocks.MockNode('world-fx');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Node passed into Cocos adapter
    const view = await createXpOrbView(root as any);

    expect(view.capacity).toBe(XP_ORB_POOL_SIZE);
    expect(view.activeCount).toBe(0);
    // 3 tier textures loaded through `loadPixelTexture` → NEAREST filter applied.
    expect(ccMocks.getNearestFilterCalls()).toBeGreaterThanOrEqual(3);

    const nodesAfterInit = ccMocks.getConstructedNodes();
    const sample: XpOrbVisual[] = [
      { x: 10, y: 6, tier: 'small', vacuuming: false },
      { x: 12, y: 8, tier: 'medium', vacuuming: true },
      { x: 14, y: 9, tier: 'large', vacuuming: false },
    ];
    view.sync(sample, 1.2);
    expect(view.activeCount).toBe(3);
    expect(ccMocks.getConstructedNodes()).toBe(nodesAfterInit);

    // Overflow past 128 capacity allocates zero extra nodes and caps cleanly at 128.
    const burst: XpOrbVisual[] = Array.from({ length: XP_ORB_POOL_SIZE + 32 }, (_, i) => ({
      x: i * 0.25,
      y: 5,
      tier: XP_ORB_TIERS[i % 3]!,
      vacuuming: i % 2 === 0,
    }));
    view.sync(burst, 2.0);
    expect(view.activeCount).toBe(XP_ORB_POOL_SIZE);
    expect(ccMocks.getConstructedNodes()).toBe(nodesAfterInit);

    view.clear();
    expect(view.activeCount).toBe(0);

    view.destroy();
    expect(view.activeCount).toBe(0);
  });

  it('spawnLevelUpBurst respects Effects: Full vs Reduced and animates expanding shockwaves cleanly', async () => {
    const rootFull = new ccMocks.MockNode('fx-full');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Node passed into Cocos adapter
    const poolFull = await createFxPool(rootFull as any);
    const nodesAfterFullInit = ccMocks.getConstructedNodes();

    spawnLevelUpBurst(poolFull, { x: 16, y: 9 }, 'full', { radiusTiles: 4, durationMs: 360 });
    expect(ccMocks.getConstructedNodes()).toBe(nodesAfterFullInit); // zero `new` on burst
    expect(poolFull.activeShockwaves).toBe(2); // outer + inner echo ring in Full mode

    poolFull.update(180);
    expect(poolFull.activeShockwaves).toBeGreaterThanOrEqual(1);
    poolFull.update(300);
    expect(poolFull.activeShockwaves).toBe(0); // shockwaves expire cleanly at duration end
    poolFull.destroy();

    const rootReduced = new ccMocks.MockNode('fx-reduced');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Node passed into Cocos adapter
    const poolReduced = await createFxPool(rootReduced as any);
    spawnLevelUpBurst(poolReduced, { x: 16, y: 9 }, 'reduced', { radiusTiles: 4, durationMs: 360 });
    expect(poolReduced.activeShockwaves).toBe(1); // single core knockback ring, no secondary echo
    poolReduced.destroy();
  });
});

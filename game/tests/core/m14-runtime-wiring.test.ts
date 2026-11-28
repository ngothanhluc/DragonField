/**
 * M14-T4 runtime wiring tests:
 * - 3-layer class identity (`SkillRun.resetForRun`, `setCharacterForRun`, `derivedStatsForRun`)
 * - Class default projectiles vs elemental overrides (`resolveClassProjectileLook`)
 * - 4-direction hand/back attachment draw order, per-frame bob, Ninja zero-node guard, and
 *   `hiddenBySkill` tracking (`PlayerAttachmentView`)
 * - All 4 Signature Active skills in `CombatLoop` (*Shadow Barrage*, *Piercing Volley*,
 *   *Arcane Nova* with Freeze + `aoePowerMult`, *Ten Thousand Swords* with 1200 ms game-time
 *   `sword-back` hide/show & room/death cleanup)
 * - Distinct Signature Active SFX cues (`playActiveSkillSfx`)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { MockNode, MockSprite, MockUITransform } = vi.hoisted(() => {
  class HoistedVec3 {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
  }

  class HoistedUITransform {
    anchorX = 0.5;
    anchorY = 0.5;
    width = 16;
    height = 16;
    setAnchorPoint(x: number, y: number): void {
      this.anchorX = x;
      this.anchorY = y;
    }
    setContentSize(w: number, h: number): void {
      this.width = w;
      this.height = h;
    }
  }

  class HoistedSprite {
    static Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    sizeMode = 0;
    trim = false;
    spriteFrame: unknown = null;
    color: unknown = null;
  }

  class HoistedNode {
    active = true;
    isValid = true;
    angle = 0;
    readonly children: HoistedNode[] = [];
    readonly position = new HoistedVec3();
    readonly scale = new HoistedVec3(1, 1, 1);
    private parentNode: HoistedNode | null = null;
    private readonly components = new Map<unknown, unknown>();
    siblingIndexHistory: number[] = [];

    constructor(public name = '') {
      this.components.set(HoistedUITransform, new HoistedUITransform());
    }

    get parent(): HoistedNode | null {
      return this.parentNode;
    }

    set parent(next: HoistedNode | null) {
      if (this.parentNode !== null) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = next;
      if (next !== null) next.children.push(this);
    }

    getChildByName(name: string): HoistedNode | null {
      return this.children.find((child) => child.name === name) ?? null;
    }

    addComponent<T>(Ctor: new () => T): T {
      if (Ctor === (HoistedSprite as unknown)) {
        const sprite = new HoistedSprite();
        this.components.set(Ctor, sprite);
        return sprite as unknown as T;
      }
      const inst = new Ctor();
      this.components.set(Ctor, inst);
      return inst;
    }

    getComponent<T>(Ctor: new () => T): T | null {
      return (this.components.get(Ctor) as T | undefined) ?? null;
    }

    setPosition(x: number, y: number, z = 0): void {
      this.position.x = x;
      this.position.y = y;
      this.position.z = z;
    }

    setScale(x: number, y: number, z = 1): void {
      this.scale.x = x;
      this.scale.y = y;
      this.scale.z = z;
    }

    setSiblingIndex(index: number): void {
      this.siblingIndexHistory.push(index);
      if (this.parentNode === null) return;
      const list = this.parentNode.children;
      const current = list.indexOf(this);
      if (current < 0) return;
      list.splice(current, 1);
      const clamped = Math.max(0, Math.min(list.length, index));
      list.splice(clamped, 0, this);
    }

    destroy(): void {
      this.isValid = false;
      this.parent = null;
    }
  }

  return {
    MockNode: HoistedNode,
    MockSprite: HoistedSprite,
    MockUITransform: HoistedUITransform,
  };
});

vi.mock('cc', () => {
  class MockColor {
    constructor(
      public r = 255,
      public g = 255,
      public b = 255,
      public a = 255,
    ) {}
  }
  return {
    Button: class {},
    Color: MockColor,
    Component: class {},
    Font: class {},
    Graphics: class {},
    Input: { EventType: { KEY_DOWN: 'key-down', KEY_UP: 'key-up' } },
    JsonAsset: class {},
    KeyCode: { KEY_1: 49, KEY_2: 50, KEY_3: 51, KEY_R: 82 },
    Label: class {},
    Layers: { Enum: { UI_2D: 1 << 25 } },
    Node: MockNode,
    Rect: class {},
    Size: class {},
    Sprite: MockSprite,
    SpriteFrame: class {},
    Texture2D: class {
      static Filter = { NEAREST: 0, LINEAR: 1 };
    },
    TiledMap: class {},
    TiledMapAsset: class {},
    UIOpacity: class {},
    UITransform: MockUITransform,
    Vec2: class {},
    _decorator: { ccclass: () => (target: unknown) => target },
    input: { on: () => undefined, off: () => undefined },
    resources: { load: () => undefined },
    view: { getVisibleSize: () => ({ width: 512, height: 288 }) },
    warn: () => undefined,
  };
});

vi.mock('../../assets/scripts/game/assets/sprite-frame-cache', () => ({
  getFrame: vi.fn(async () => ({ width: 16, height: 16 })),
}));

import { validateAttachments } from '../../assets/scripts/core/art/attachments';
import { validateManifest } from '../../assets/scripts/core/art/manifest';
import { CHARACTERS, type CharacterDef } from '../../assets/scripts/core/characters/roster';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { TILE_SIZE_PX, type LevelData } from '../../assets/scripts/core/level/level-data';
import { SeededRng } from '../../assets/scripts/core/rng';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import type { DerivedStats } from '../../assets/scripts/core/skills/derived-stats';
import { playActiveSkillSfx, setSfxSink, type SfxId } from '../../assets/scripts/game/audio/sfx';
import { resolveClassProjectileLook } from '../../assets/scripts/game/bullet-view';
import { CombatLoop } from '../../assets/scripts/game/combat-loop';
import type { FxPool } from '../../assets/scripts/game/fx/effect-pool';
import { PlayerAttachmentView } from '../../assets/scripts/game/player-attachment-view';
import type { PlayerController } from '../../assets/scripts/game/player-controller';
import { SkillRun } from '../../assets/scripts/game/skill-run';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', '..', 'assets', 'resources', 'data');
const manifest = validateManifest(
  JSON.parse(readFileSync(join(DATA_DIR, 'animations.json'), 'utf8')) as unknown,
);
const attachments = validateAttachments(
  JSON.parse(readFileSync(join(DATA_DIR, 'attachments.json'), 'utf8')) as unknown,
);

const TEST_LEVEL: LevelData = {
  id: 'test-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: TILE_SIZE_PX,
  playerStart: { x: 10, y: 9 },
  doors: [],
  obstacles: [],
  props: [],
  waves: [],
};

function makeFakePlayer(
  character: CharacterDef,
  stats: DerivedStats,
  position = { x: 10, y: 9 },
) {
  const bullets = new BulletPool();
  const hideCalls: string[] = [];
  const showCalls: string[] = [];
  const player = {
    characterId: character.id,
    characterDef: character,
    bullets,
    position,
    hearts: stats.maxHearts,
    maxHearts: stats.maxHearts,
    isDead: false,
    derivedStats: stats,
    velocity: { x: 0, y: 0 },
    moveDirectionTile: () => ({ x: 0, y: 0 }),
    facingVectorTile: () => ({ x: 1, y: 0 }),
    step: vi.fn(),
    startDash: vi.fn(),
    applyDamage: vi.fn(() => false),
    heal: vi.fn((amount: number) => Math.min(stats.maxHearts, stats.maxHearts + amount)),
    grantInvulnerability: vi.fn(),
    hideAttachmentForSkill: vi.fn((skillId: string) => {
      hideCalls.push(skillId);
    }),
    showAttachmentForSkill: vi.fn((skillId: string) => {
      showCalls.push(skillId);
    }),
  };
  return {
    player: player as unknown as PlayerController,
    state: player,
    bullets,
    hideCalls,
    showCalls,
  };
}

function makeFakeFx() {
  const spawned: Array<{ key: string; at: { x: number; y: number } }> = [];
  const shockwaves: Array<{ at: { x: number; y: number }; endRadiusTiles?: number }> = [];
  const fx = {
    spawn: vi.fn((key: string, at: { x: number; y: number }) => {
      spawned.push({ key, at: { x: at.x, y: at.y } });
    }),
    spawnShockwave: vi.fn((at: { x: number; y: number }, opts?: { endRadiusTiles?: number }) => {
      shockwaves.push({ at: { x: at.x, y: at.y }, endRadiusTiles: opts?.endRadiusTiles });
    }),
    line: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    setAura: vi.fn(),
  };
  return { fx: fx as unknown as FxPool, spawned, shockwaves };
}

describe('M14-T4 SkillRun 3-layer class stats', () => {
  it('computes distinct Layer 1 + Meta + Layer 2 stats for all 4 playable classes', () => {
    const save = {
      ...createDefaultSave(),
      upgrades: {
        ...createDefaultSave().upgrades,
        hearts: 1,
        damage: 2,
        fireRate: 0,
      },
    };
    const run = new SkillRun();

    run.resetForRun(42, save, 'ninja');
    const ninja = run.stats();
    expect(ninja.maxHp).toBe(120); // 100 + 20 meta
    expect(ninja.moveSpeedTilesPerSecond).toBeGreaterThan(DEFAULT_COMBAT.moveSpeedTilesPerSecond);
    expect(ninja.dashCooldownMult).toBeCloseTo(0.85, 6);

    run.resetForRun(42, save, 'archer');
    const archer = run.stats();
    expect(archer.maxHp).toBe(105); // 100 - 15 + 20 meta
    expect(archer.pierce).toBe(1);
    expect(archer.critChance).toBeCloseTo(0.12, 6);
    expect(archer.projectileSpeedTilesPerSecond).toBeGreaterThan(ninja.projectileSpeedTilesPerSecond);
    expect(archer.targetingRangeTiles).toBeGreaterThan(ninja.targetingRangeTiles);

    run.resetForRun(42, save, 'mage');
    const mage = run.stats();
    expect(mage.maxHp).toBe(105);
    expect(mage.activeCooldownMult).toBeCloseTo(0.8, 6);
    expect(mage.activePowerMult).toBeCloseTo(1.25, 6);
    expect(mage.aoePowerMult).toBeCloseTo(1.25, 6);

    run.resetForRun(42, save, 'cultivator');
    const cultivator = run.stats();
    expect(cultivator.maxHp).toBe(140); // 100 + 20 + 20 meta
    expect(cultivator.damage).toBeGreaterThan(ninja.damage);
    expect(cultivator.executeThreshold).toBeCloseTo(0.3, 6);
    expect(cultivator.executeBonus).toBeCloseTo(0.1, 6);
  });

  it('setCharacterForRun preserves owned skills while switching class baseline', () => {
    const save = createDefaultSave();
    const run = new SkillRun();
    run.resetForRun(7, save, 'ninja');
    run.grant('piercing', 1);
    expect(run.stats().pierce).toBe(1);

    run.setCharacterForRun(save, 'archer');
    expect(run.activeCharacterId).toBe('archer');
    // Archer passive (+1) + owned piercing skill (+1) = 2 pierce.
    expect(run.stats().pierce).toBe(2);
  });
});

describe('M14-T4 class projectile look resolution', () => {
  it('uses each class default projectile unless a stronger elemental override applies', () => {
    expect(resolveClassProjectileLook(new Map(), 'fx.shuriken')).toEqual({
      key: 'fx.shuriken',
      tint: null,
    });
    expect(resolveClassProjectileLook(new Map(), 'fx.arrow')).toEqual({
      key: 'fx.arrow',
      tint: null,
    });
    expect(resolveClassProjectileLook(new Map(), 'fx.arcane-bolt')).toEqual({
      key: 'fx.arcane-bolt',
      tint: null,
    });
    expect(resolveClassProjectileLook(new Map(), 'fx.spirit-sword')).toEqual({
      key: 'fx.spirit-sword',
      tint: null,
    });

    // Non-elemental piercing/sharpen keeps non-ninja class projectiles intact.
    expect(resolveClassProjectileLook(new Map([['piercing', 1], ['sharpen', 3]]), 'fx.arrow')).toEqual({
      key: 'fx.arrow',
      tint: null,
    });
    expect(resolveClassProjectileLook(new Map([['piercing', 1]]), 'fx.shuriken')).toEqual({
      key: 'fx.kunai',
      tint: null,
    });

    // Elemental overrides apply cleanly to all classes.
    expect(resolveClassProjectileLook(new Map([['explosive', 1]]), 'fx.arrow')).toEqual({
      key: 'fx.big-energy-ball',
      tint: 'fire',
    });
    expect(resolveClassProjectileLook(new Map([['freeze', 1]]), 'fx.arcane-bolt')).toEqual({
      key: 'fx.ice-spike',
      tint: null,
    });
    expect(resolveClassProjectileLook(new Map([['poison', 1]]), 'fx.spirit-sword')).toEqual({
      key: 'fx.plant-spike',
      tint: null,
    });
  });
});

describe('M14-T4 PlayerAttachmentView 4-direction draw order, bob, and hide/show', () => {
  it('never creates an attachment node for Ninja (projectile weaponForm)', () => {
    const parent = new MockNode('player');
    const body = new MockNode('player-body');
    body.parent = parent;

    const view = new PlayerAttachmentView({
      parent: parent as unknown as never,
      bodyNode: body as unknown as never,
      manifest,
      attachments,
      character: CHARACTERS.ninja,
    });

    expect(view.node).toBeNull();
    expect(parent.getChildByName('player-attachment')).toBeNull();
    expect(view.getSnapshot()).toMatchObject({
      characterId: 'ninja',
      hasNode: false,
      active: false,
      visible: false,
      hiddenBySkill: false,
    });
    view.destroy();
  });

  it('orders hand items behind ONLY facing up and applies per-frame bob for Archer & Mage', async () => {
    for (const id of ['archer', 'mage'] as const) {
      const parent = new MockNode('player');
      const body = new MockNode('player-body');
      body.parent = parent;

      const view = new PlayerAttachmentView({
        parent: parent as unknown as never,
        bodyNode: body as unknown as never,
        manifest,
        attachments,
        character: CHARACTERS[id],
      });
      await Promise.resolve();

      view.updatePose({ animation: 'idle', direction: 'down', frame: 0 });
      expect(view.getSnapshot().behind).toBe(false);
      expect(parent.children.map((c) => c.name)).toEqual(['player-body', 'player-attachment']);

      view.updatePose({ animation: 'idle', direction: 'up', frame: 0 });
      expect(view.getSnapshot().behind).toBe(true);
      expect(parent.children.map((c) => c.name)).toEqual(['player-attachment', 'player-body']);

      view.updatePose({ animation: 'idle', direction: 'left', frame: 0 });
      expect(view.getSnapshot().behind).toBe(false);
      expect(parent.children.map((c) => c.name)).toEqual(['player-body', 'player-attachment']);

      view.updatePose({ animation: 'idle', direction: 'right', frame: 0 });
      expect(view.getSnapshot().behind).toBe(false);

      // Archer/Mage idle frame 2 has bob = 1 (moves localY by -1 relative to frame 0).
      const f0 = view.updatePose({ animation: 'idle', direction: 'down', frame: 0 });
      const f2 = view.updatePose({ animation: 'idle', direction: 'down', frame: 2 });
      expect(f2.bobPx - f0.bobPx).toBe(1);
      expect(f2.localOffsetPx.y).toBe(f0.localOffsetPx.y - 1);

      view.destroy();
    }
  });

  it('orders Cultivator sword-back behind for down/left/right and tracks hiddenBySkill', async () => {
    const parent = new MockNode('player');
    const body = new MockNode('player-body');
    body.parent = parent;

    const view = new PlayerAttachmentView({
      parent: parent as unknown as never,
      bodyNode: body as unknown as never,
      manifest,
      attachments,
      character: CHARACTERS.cultivator,
    });
    await Promise.resolve();

    view.updatePose({ animation: 'idle', direction: 'down', frame: 0 });
    expect(view.getSnapshot().behind).toBe(true);
    expect(parent.children.map((c) => c.name)).toEqual(['player-attachment', 'player-body']);

    view.updatePose({ animation: 'idle', direction: 'up', frame: 0 });
    expect(view.getSnapshot().behind).toBe(false);
    expect(parent.children.map((c) => c.name)).toEqual(['player-body', 'player-attachment']);

    view.updatePose({ animation: 'idle', direction: 'left', frame: 0 });
    expect(view.getSnapshot().behind).toBe(true);

    view.updatePose({ animation: 'idle', direction: 'right', frame: 0 });
    expect(view.getSnapshot().behind).toBe(true);

    // Hide & show for Ten Thousand Swords.
    view.hideForSkill('ten-thousand-swords');
    expect(view.getSnapshot().hiddenBySkill).toBe(true);
    expect(view.getSnapshot().visible).toBe(false);
    expect(view.node?.active).toBe(false);

    view.showForSkill('ten-thousand-swords');
    expect(view.getSnapshot().hiddenBySkill).toBe(false);
    expect(view.getSnapshot().visible).toBe(true);
    expect(view.node?.active).toBe(true);

    view.destroy();
  });
});

describe('M14-T4 CombatLoop 4 Signature Actives & Cultivator sword-back lifecycle', () => {
  it('fires distinct Signature Active projectiles for Ninja, Archer, Mage, and Cultivator', () => {
    const save = createDefaultSave();
    const run = new SkillRun();
    const actorLayer = new MockNode('actors');

    // Archer: Piercing Volley (7 high-pierce arrows)
    run.resetForRun(1, save, 'archer');
    const archerFake = makeFakePlayer(CHARACTERS.archer, run.stats());
    const archerLoop = new CombatLoop({
      player: archerFake.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(1),
    });
    expect(archerLoop.triggerActiveSkill()).toBe(true);
    const archerBullets = archerFake.bullets.active();
    expect(archerBullets.length).toBe(7);
    expect(archerBullets.every((b) => archerLoop.signatureSkillForBullet(b.id) === 'piercing-volley')).toBe(
      true,
    );
    expect(archerBullets[0]!.pierceRemaining).toBe(5);
    archerLoop.destroy();

    // Ninja: Shadow Barrage (10 homing shadow shurikens)
    run.resetForRun(1, save, 'ninja');
    const ninjaFake = makeFakePlayer(CHARACTERS.ninja, run.stats());
    const ninjaLoop = new CombatLoop({
      player: ninjaFake.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(1),
    });
    expect(ninjaLoop.triggerActiveSkill()).toBe(true);
    const ninjaBullets = ninjaFake.bullets.active();
    expect(ninjaBullets.length).toBe(10);
    expect(ninjaBullets.every((b) => ninjaLoop.isShadowBullet(b.id))).toBe(true);
    ninjaLoop.destroy();
  });

  it('Mage Arcane Nova deals scaled AoE damage, applies slow/freeze, and spawns outward bolts', () => {
    const save = createDefaultSave();
    const run = new SkillRun();
    run.resetForRun(1, save, 'mage');
    const mageFake = makeFakePlayer(CHARACTERS.mage, run.stats(), { x: 10, y: 9 });
    const { fx, shockwaves, spawned } = makeFakeFx();
    const actorLayer = new MockNode('actors');
    const loop = new CombatLoop({
      player: mageFake.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(1),
      fx,
    });

    const nearStatusCalls: Array<{ slowOnHit?: { factor: number; durationMs: number }; poisonOnHit?: unknown }> = [];
    const nearEnemy = {
      id: 'near-1',
      role: 'chaser',
      isElite: false,
      isDead: false,
      position: { x: 12, y: 9 },
      radiusTiles: 0.4,
      health: 50,
      maxHealth: 50,
      actionKind: 'walk',
      contactDamage: 1,
      contactRangeTiles: 0.6,
      melee: true,
      enemyState: null,
      chargeHitApplied: false,
      node: new MockNode('near-1'),
      takeDamage: vi.fn((amt: number) => {
        nearEnemy.health = Math.max(0, nearEnemy.health - amt);
      }),
      applyStatus: vi.fn((stats: DerivedStats) => {
        nearStatusCalls.push({
          slowOnHit: stats.slowOnHit,
          poisonOnHit: stats.poisonOnHit,
        });
        return { slowStarted: true, poisonStarted: false, burnStarted: false };
      }),
      hasAnyStatus: vi.fn(() => true),
      step: vi.fn(() => ({ released: null, chargeSweep: null })),
      setCulled: vi.fn(),
    };
    const farEnemy = {
      ...nearEnemy,
      id: 'far-1',
      position: { x: 25, y: 9 },
      health: 50,
      takeDamage: vi.fn(),
      applyStatus: vi.fn(),
      hasAnyStatus: vi.fn(() => false),
      node: new MockNode('far-1'),
    };
    (loop as unknown as { enemies: unknown[] }).enemies.push(nearEnemy, farEnemy);

    expect(loop.triggerActiveSkill()).toBe(true);
    expect(nearEnemy.takeDamage).toHaveBeenCalledTimes(1);
    expect(farEnemy.takeDamage).not.toHaveBeenCalled();
    expect(nearStatusCalls[0]?.slowOnHit).toEqual({ factor: 0.35, durationMs: 2500 });
    expect(nearStatusCalls[0]?.poisonOnHit).toBeUndefined();

    // Mage passive (+25% activePowerMult) boosts 8 -> 9 outward arcane bolts.
    const bolts = mageFake.bullets.active();
    expect(bolts.length).toBeGreaterThanOrEqual(8);
    expect(bolts.every((b) => loop.signatureSkillForBullet(b.id) === 'arcane-nova')).toBe(true);
    expect(shockwaves.length).toBeGreaterThanOrEqual(1);
    expect(spawned.some((s) => s.key === 'fx.boost')).toBe(true);
    loop.destroy();
  });

  it('Cultivator Ten Thousand Swords hides sword-back for 1200ms game-time and restores on timer/room/death', () => {
    const save = createDefaultSave();
    const run = new SkillRun();
    run.resetForRun(1, save, 'cultivator');
    const fake = makeFakePlayer(CHARACTERS.cultivator, run.stats());
    const actorLayer = new MockNode('actors');
    const loop = new CombatLoop({
      player: fake.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(1),
    });

    // Keep one live dummy enemy out of bullet path so the room stays active during the test.
    const dummyEnemy = {
      id: 'dummy-1',
      role: 'chaser',
      isElite: false,
      isDead: false,
      position: { x: 2, y: 2 },
      radiusTiles: 0.4,
      health: 9999,
      maxHealth: 9999,
      actionKind: 'idle',
      contactDamage: 1,
      contactRangeTiles: 0.6,
      melee: false,
      enemyState: null,
      chargeHitApplied: false,
      node: new MockNode('dummy-1'),
      takeDamage: vi.fn(),
      applyStatus: vi.fn(() => ({ slowStarted: false, poisonStarted: false, burnStarted: false })),
      hasAnyStatus: vi.fn(() => false),
      step: vi.fn(() => ({ released: null, chargeSweep: null })),
      setCulled: vi.fn(),
    };
    (loop as unknown as { enemies: unknown[] }).enemies.push(dummyEnemy);

    expect(loop.triggerActiveSkill()).toBe(true);
    expect(fake.bullets.active().length).toBe(14);
    expect(fake.hideCalls).toEqual(['ten-thousand-swords']);
    expect(fake.showCalls).toEqual([]);

    // Step 1100 ms of game-time -> still hidden (hitstop freezes real time, so clockMs tracks game time).
    while (loop.clockMs < 1100) {
      loop.update(50);
    }
    expect(fake.showCalls).toEqual([]);

    // Step past 1200 ms of simulated game-time -> restored automatically.
    while (loop.clockMs < 1250) {
      loop.update(50);
    }
    expect(fake.showCalls).toEqual(['ten-thousand-swords']);

    // Cast again after cooldown (22 s since #108) & verify room change restores immediately.
    const nextReadyAt = loop.clockMs + 23000;
    while (loop.clockMs < nextReadyAt) loop.update(50);
    expect(loop.triggerActiveSkill()).toBe(true);
    expect(fake.hideCalls).toHaveLength(2);
    loop.enterRoom(TEST_LEVEL);
    expect(fake.showCalls).toEqual(['ten-thousand-swords', 'ten-thousand-swords']);

    // Cast again & verify death inside CombatLoop.update restores immediately.
    (loop as unknown as { enemies: unknown[] }).enemies.push(dummyEnemy);
    expect(loop.triggerActiveSkill()).toBe(true);
    expect(fake.hideCalls).toHaveLength(3);
    dummyEnemy.melee = true;
    dummyEnemy.contactRangeTiles = 99;
    fake.state.applyDamage = vi.fn(() => {
      fake.state.isDead = true;
      fake.state.hearts = 0;
      return true;
    });
    const deathStep = loop.update(16);
    expect(deathStep.playerDied).toBe(true);
    expect(fake.showCalls).toEqual([
      'ten-thousand-swords',
      'ten-thousand-swords',
      'ten-thousand-swords',
    ]);
    loop.destroy();
  });
});

describe('M14-T4 distinct Signature Active SFX', () => {
  it('emits distinct SFX cues per Signature Active id', () => {
    const played: SfxId[] = [];
    setSfxSink((id) => played.push(id));

    try {
      const cues: Record<string, SfxId[]> = {};
      for (const id of [
        'shadow-barrage',
        'piercing-volley',
        'arcane-nova',
        'ten-thousand-swords',
      ] as const) {
        played.length = 0;
        playActiveSkillSfx(id);
        cues[id] = [...played];
        expect(cues[id]!.length).toBeGreaterThanOrEqual(1);
      }
      expect(new Set(Object.values(cues).map((list) => list.join('+'))).size).toBe(4);
    } finally {
      setSfxSink(null);
    }
  });
});

/**
 * M15 Wave 2 — Runtime flow, Save/Resume, Ascension/Endless scaling, Utility Meta,
 * DeathCause attribution, Free Rerolls, and HUD badge tests.
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
    enabled = true;
    spriteFrame: unknown = null;
    color: unknown = null;
  }

  class HoistedNode {
    active = true;
    isValid = true;
    angle = 0;
    layer = 0;
    readonly children: HoistedNode[] = [];
    readonly position = new HoistedVec3();
    readonly scale = new HoistedVec3(1, 1, 1);
    private parentNode: HoistedNode | null = null;
    private readonly components = new Map<unknown, unknown>();

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
      if (typeof inst === 'object' && inst !== null && !('node' in inst)) {
        (inst as { node?: HoistedNode }).node = this;
      }
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
  class MockComponent {
    node = new MockNode('comp');
    isValid = true;
    getComponent<T>(Ctor: new () => T): T | null {
      return this.node.getComponent(Ctor);
    }
  }
  return {
    Button: class {},
    Color: MockColor,
    Component: MockComponent,
    Font: class {},
    Graphics: class {
      lineWidth = 1;
      strokeColor: unknown = null;
      fillColor: unknown = null;
      clear(): void {}
      moveTo(): void {}
      lineTo(): void {}
      rect(): void {}
      fill(): void {}
      stroke(): void {}
    },
    Input: { EventType: { KEY_DOWN: 'key-down', KEY_UP: 'key-up' } },
    JsonAsset: class {},
    KeyCode: { KEY_1: 49, KEY_2: 50, KEY_3: 51, KEY_R: 82 },
    Label: class {
      static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
      node = new MockNode('label');
      string = '';
    },
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
    Tween: { stopAllByTarget: () => undefined },
    UIOpacity: class {},
    UITransform: MockUITransform,
    Vec2: class {},
    _decorator: { ccclass: () => (target: unknown) => target },
    input: { on: () => undefined, off: () => undefined },
    resources: { load: () => undefined },
    tween: () => ({ to: () => ({ start: () => undefined }) }),
    view: { getVisibleSize: () => ({ width: 512, height: 288 }) },
    warn: () => undefined,
  };
});

vi.mock('../../assets/scripts/game/assets/sprite-frame-cache', () => ({
  getFrame: vi.fn(async () => ({ width: 16, height: 16 })),
}));

vi.mock('../../assets/scripts/game/assets/texture-cache', () => ({
  loadTexture: vi.fn(async () => ({ width: 128, height: 32 })),
  loadPixelTexture: vi.fn(async () => ({ width: 16, height: 16 })),
}));

import { validateManifest } from '../../assets/scripts/core/art/manifest';
import { BOSSES } from '../../assets/scripts/core/boss/boss-defs';
import { initialBossState, stepBoss } from '../../assets/scripts/core/boss/patterns';
import { CHARACTERS } from '../../assets/scripts/core/characters/roster';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { HealthState } from '../../assets/scripts/core/combat/health';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  contactDamageFor,
  decideAction,
  maxHealthFor,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import { bomberBlastSpec } from '../../assets/scripts/core/enemies/bomber';
import { ENEMY_TUNING, XP_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { TILE_SIZE_PX, type LevelData } from '../../assets/scripts/core/level/level-data';
import { utilityStatsFromSave } from '../../assets/scripts/core/meta/run-stats';
import { SeededRng } from '../../assets/scripts/core/rng';
import {
  canStartEndless,
  combinedDifficultyModifiers,
  nextEndlessStep,
} from '../../assets/scripts/core/run/endless';
import { RunRewards } from '../../assets/scripts/core/run/run-rewards';
import { RunState } from '../../assets/scripts/core/run/run-state';
import { formatDeathCause, formatRunUnlocks, type DeathCause } from '../../assets/scripts/core/run/run-summary';
import { shopOffers } from '../../assets/scripts/core/run/special-rooms';
import {
  RUN_SAVE_VERSION,
  RunSaveRepository,
  migrateRunSave,
  type ActiveRunSave,
} from '../../assets/scripts/core/save/run-save';
import { createDefaultSave, unlockedAscensionForChapter } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';
import { computeHudLayout } from '../../assets/scripts/core/view/hud-layout';
import { rerollCost } from '../../assets/scripts/core/xp/reroll';
import { XpTracker } from '../../assets/scripts/core/xp/xp-curve';
import { XpOrbPool } from '../../assets/scripts/core/xp/xp-orbs';
import { CombatLoop } from '../../assets/scripts/game/combat-loop';
import { formatRunRoomLabel } from '../../assets/scripts/game/hud';
import type { PlayerController } from '../../assets/scripts/game/player-controller';
import { buildRichRunResult, commitRunEnd } from '../../assets/scripts/game/run-end';
import { SkillRun } from '../../assets/scripts/game/skill-run';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', '..', 'assets', 'resources', 'data');
const manifest = validateManifest(
  JSON.parse(readFileSync(join(DATA_DIR, 'animations.json'), 'utf8')) as unknown,
);

const TEST_LEVEL: LevelData = {
  id: 'm15-test-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: TILE_SIZE_PX,
  playerStart: { x: 10, y: 9 },
  doors: [],
  obstacles: [],
  props: [],
  waves: [
    {
      enemies: [
        { role: 'chaser', elite: false, at: { x: 16, y: 9 } },
        { role: 'caster', elite: false, at: { x: 20, y: 9 } },
      ],
    },
  ],
};

function makeLiveFakePlayer(startHearts = 2, maxHearts = 6, position = { x: 10, y: 9 }) {
  const bullets = new BulletPool();
  const health = new HealthState(DEFAULT_COMBAT, startHearts);
  health.configure(maxHearts, 0);
  const save = createDefaultSave();
  const skills = new SkillRun();
  skills.resetForRun(1, save, 'ninja');
  const stats = skills.stats();

  const state = {
    characterId: 'ninja' as const,
    characterDef: CHARACTERS.ninja,
    bullets,
    position: { ...position },
    get hearts(): number {
      return health.current;
    },
    get maxHearts(): number {
      return health.max;
    },
    get isDead(): boolean {
      return health.isDead;
    },
    derivedStats: stats,
    velocity: { x: 0, y: 0 },
    moveDirectionTile: () => ({ x: 0, y: 0 }),
    facingVectorTile: () => ({ x: 1, y: 0 }),
    step: vi.fn(),
    startDash: vi.fn(),
    applyDamage: vi.fn((nowMs: number, amount: number) => {
      return health.tryDamage(amount, nowMs).applied;
    }),
    forceKill: vi.fn(() => {
      health.setHearts(0);
    }),
    heal: vi.fn((amount: number) => health.heal(amount)),
    grantInvulnerability: vi.fn(),
    hideAttachmentForSkill: vi.fn(),
    showAttachmentForSkill: vi.fn(),
  };

  return { player: state as unknown as PlayerController, state, bullets, health };
}

describe('M15 Wave 2 — Safe-Boundary RunSave Round-Trip & Strict Permadeath', () => {
  it('round-trips full run state (build, Evolutions, XP, hearts, room, rerolls, gold, Ascension/Endless)', () => {
    const save = {
      ...createDefaultSave(),
      upgrades: {
        ...createDefaultSave().upgrades,
        hearts: 2,
        damage: 3,
        freeRerolls: 3,
      },
    };
    const runRepo = new RunSaveRepository(new MemorySaveStorage());

    const activeRun: ActiveRunSave = {
      version: RUN_SAVE_VERSION,
      seed: 987654,
      chapter: 2,
      roomIndex: 5,
      chosenDoor: 'xp',
      drawnRooms: [3, 7, 2, 11, 6, 14, 9, 4, 17],
      bossId: 'slime',
      characterId: 'mage',
      hearts: 4,
      maxHearts: 8,
      xpLevel: 7,
      xpCurrent: 42,
      xpTotal: 615,
      pendingLevelUps: 1,
      ownedSkills: {
        'rapid-fire': 3,
        piercing: 3,
        'phantom-volley': 1,
        vitality: 2,
      },
      rerollsUsed: 2,
      freeRerollsLeft: 1,
      goldEarned: 137,
      kills: 94,
      elapsedMs: 145_200,
      ascension: 3,
      endlessLoop: 1,
    };

    runRepo.save(activeRun);
    const loaded = runRepo.load();
    expect(loaded).toEqual(activeRun);

    // Restore every runtime sub-system from `loaded` and verify exact parity.
    const runState = new RunState(loaded!.chapter, loaded!.drawnRooms.length);
    runState.restoreRoom(loaded!.roomIndex);
    expect(runState.room).toBe(5);
    expect(runState.roomLabel).toBe('5/9');
    expect(runState.status).toBe('playing');

    const skills = new SkillRun();
    skills.restoreForRun({
      seed: loaded!.seed,
      save,
      characterId: loaded!.characterId,
      ownedSkills: loaded!.ownedSkills,
      rerollsUsed: loaded!.rerollsUsed,
      freeRerollsLeft: loaded!.freeRerollsLeft,
    });
    expect(skills.stacks('rapid-fire')).toBe(3);
    expect(skills.stacks('piercing')).toBe(3);
    expect(skills.stacks('phantom-volley')).toBe(1);
    expect(skills.stats().activeEvolutions).toContain('phantom-volley');
    expect(skills.rerollsUsed).toBe(2);
    expect(skills.freeRerollsLeft).toBe(1);

    const xp = new XpTracker(loaded!.chapter);
    xp.restore({
      level: loaded!.xpLevel,
      currentXp: loaded!.xpCurrent,
      totalXp: loaded!.xpTotal,
      pendingLevelUps: loaded!.pendingLevelUps,
      chapter: loaded!.chapter,
    });
    expect(xp.level).toBe(7);
    expect(xp.currentXp).toBe(42);
    expect(xp.totalXp).toBe(615);
    expect(xp.pendingLevelUps).toBe(1);

    const rewards = new RunRewards();
    rewards.restore(loaded!.goldEarned, loaded!.kills);
    expect(rewards.goldEarned).toBe(137);
    expect(rewards.killCount).toBe(94);

    const health = new HealthState(DEFAULT_COMBAT);
    health.configure(skills.stats().maxHearts, DEFAULT_COMBAT.invulnerabilityMs);
    health.setHearts(loaded!.hearts);
    expect(health.current).toBe(4);
    expect(health.max).toBe(skills.stats().maxHearts);
  });

  it('enforces strict permadeath: clearing runSave wipes slot and dead runs (hearts <= 0) never load', () => {
    const storage = new MemorySaveStorage();
    const runRepo = new RunSaveRepository(storage);

    const validRun: ActiveRunSave = {
      version: RUN_SAVE_VERSION,
      seed: 123,
      chapter: 1,
      roomIndex: 2,
      chosenDoor: 'gold',
      drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 17],
      bossId: 'tengu',
      characterId: 'ninja',
      hearts: 3,
      maxHearts: 6,
      xpLevel: 2,
      xpCurrent: 5,
      xpTotal: 35,
      pendingLevelUps: 0,
      ownedSkills: {},
      rerollsUsed: 0,
      freeRerollsLeft: 0,
      goldEarned: 15,
      kills: 10,
      elapsedMs: 12_000,
      ascension: 0,
      endlessLoop: 0,
    };

    runRepo.save(validRun);
    expect(runRepo.hasRun()).toBe(true);

    // Permadeath wipe immediately clears storage.
    runRepo.clear();
    expect(runRepo.hasRun()).toBe(false);
    expect(runRepo.load()).toBeNull();

    // Even if tampered raw JSON has hearts: 0, `migrateRunSave` refuses to resume it.
    expect(migrateRunSave({ ...validRun, hearts: 0 })).toBeNull();
  });
});

describe('M15 Wave 2 — Ascension 1–5 & Endless Modifier Wiring and Unlock Progression', () => {
  it('scales enemy HP, damage, attack cooldown, and extra elites under Ascension 5 + Endless Loop 1', () => {
    const mods = combinedDifficultyModifiers(5, 1);
    expect(mods.enemyHealthMult).toBeCloseTo(1.55 * 1.35, 6);
    expect(mods.enemyDamageMult).toBeCloseTo(1.25 * 1.2, 6);
    expect(mods.bossHealthMult).toBeCloseTo(1.55 * 1.4, 6);
    expect(mods.extraElitesPerRoom).toBe(4); // 3 + 1

    const baseHp = maxHealthFor('chaser', false, undefined, 1, 1);
    const scaledHp = maxHealthFor('chaser', false, undefined, 1, mods.enemyHealthMult);
    expect(scaledHp).toBeGreaterThan(baseHp);

    const baseDmg = contactDamageFor('tank', true, undefined, 1, 1);
    const scaledDmg = contactDamageFor('tank', true, undefined, 1, mods.enemyDamageMult);
    expect(scaledDmg).toBeGreaterThan(baseDmg);

    // Faster enemy fire rate shortens caster cooldown proportionally.
    const casterState: EnemyState = {
      id: 'c1',
      role: 'caster',
      elite: false,
      position: { x: 15, y: 9 },
      health: 10,
      maxHealth: 10,
      action: { kind: 'idle' },
      actionStartedMs: 1000,
    };
    // Pick a timestamp strictly between scaled cooldown (base / fireRateMult) and base cooldown:
    // normal fireRate (1.0) is still cooling down, while scaled fireRateMult enters telegraph.
    const baseCooldownMs = ENEMY_TUNING.roles.caster.attackCooldownMs;
    const scaledCooldownMs = baseCooldownMs / mods.enemyFireRateMult;
    const probeNowMs = casterState.actionStartedMs + Math.floor((scaledCooldownMs + baseCooldownMs) / 2);
    const normalAction = decideAction({
      state: casterState,
      player: { x: 10, y: 9 },
      nowMs: probeNowMs,
      level: TEST_LEVEL,
      fireRateMult: 1,
    });
    const ascAction = decideAction({
      state: casterState,
      player: { x: 10, y: 9 },
      nowMs: probeNowMs,
      level: TEST_LEVEL,
      fireRateMult: mods.enemyFireRateMult,
    });
    expect(normalAction.kind).toBe('idle');
    expect(ascAction.kind).toBe('telegraph');

    // Bomber blast scales with enemyDamageMult and preserves elite flag.
    const blast = bomberBlastSpec(
      { id: 'b1', position: { x: 12, y: 9 }, elite: true },
      1,
      undefined,
      mods.enemyDamageMult,
    );
    const normalBlast = bomberBlastSpec(
      { id: 'b1', position: { x: 12, y: 9 }, elite: true },
      1,
      undefined,
      1,
    );
    expect(blast.damage).toBeGreaterThan(normalBlast.damage);
    expect(blast.elite).toBe(true);
  });

  it('scales Boss HP & keeps Phase 2/3 transitions aligned with scaled maxHealth', () => {
    const mods = combinedDifficultyModifiers(5, 1);
    const scaledMaxHp = Math.round(BOSSES.tengu.maxHealth * mods.bossHealthMult);
    const boss = initialBossState('tengu', { x: 16, y: 5 }, 0, 1000, scaledMaxHp);
    expect(boss.health).toBe(scaledMaxHp);
    expect(boss.maxHealth).toBe(scaledMaxHp);

    // At 70% of scaled HP (still above base maxHealth!), boss MUST remain in Phase 1.
    const rng = SeededRng.fromSeed(1);
    const at70 = stepBoss({
      state: { ...boss, health: Math.round(scaledMaxHp * 0.7) },
      nowMs: 1100,
      deltaMs: 16,
      player: { x: 16, y: 14 },
      rng,
    });
    expect(at70.state.phase).toBe(1);

    // At 60% of scaled HP (below 2/3 threshold), boss enters Phase 2 cleanly.
    const at60 = stepBoss({
      state: { ...boss, health: Math.round(scaledMaxHp * 0.6) },
      nowMs: 1100,
      deltaMs: 16,
      player: { x: 16, y: 14 },
      rng,
    });
    expect(at60.state.phase).toBe(2);
    expect(at60.events.some((e) => e.kind === 'phase-change' && e.phase === 2)).toBe(true);

    // CombatLoop spawns BossView with scaled HP and scaled bullets.
    const fake = makeLiveFakePlayer(6, 6);
    const actorLayer = new MockNode('actors');
    const loop = new CombatLoop({
      player: fake.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(7),
      difficulty: mods,
    });
    const spawned = loop.spawnBoss(BOSSES.tengu, { x: 16, y: 5 }, 0);
    expect(spawned.maxHealth).toBe(scaledMaxHp);
    expect(spawned.health).toBe(scaledMaxHp);
    loop.destroy();
  });

  it('scales mid-run shop prices under Ascension 3 and Ascension 5', () => {
    const owned = new Map<string, number>();
    const normalOffers = shopOffers(42, 3, owned, 1);
    const a3Offers = shopOffers(42, 3, owned, combinedDifficultyModifiers(3, 0).shopPriceMult);
    const a5Offers = shopOffers(42, 3, owned, combinedDifficultyModifiers(5, 0).shopPriceMult);

    expect(a3Offers.length).toBe(normalOffers.length);
    for (let i = 0; i < normalOffers.length; i += 1) {
      expect(a3Offers[i]!.price).toBe(Math.round(normalOffers[i]!.price * 1.2));
      expect(a5Offers[i]!.price).toBe(Math.round(normalOffers[i]!.price * 1.35));
    }
  });

  it('advances Ascension unlocks on non-Endless wins, unlocks heroes & Endless, and formats summary', () => {
    const repo = new SaveRepository(new MemorySaveStorage(), new MemorySaveStorage());
    let save = createDefaultSave();

    // Clearing Ch1 at Ascension 0 unlocks Ch2, Archer, and Ch1 Ascension 1.
    const ch1Win = commitRunEnd(save, repo, {
      chapter: 1,
      goldEarned: 100,
      won: true,
      ascension: 0,
      endlessLoop: 0,
    });
    save = ch1Win.save;
    expect(ch1Win.gold).toBe(100);
    expect(ch1Win.unlocked).toBe(true);
    expect(ch1Win.chaptersUnlocked).toBe(2);
    expect(unlockedAscensionForChapter(save, 1)).toBe(1);
    expect(ch1Win.unlockedAscension).toEqual({ chapter: 1, level: 1 });
    expect(ch1Win.unlockedCharacters).toEqual(['archer']);
    expect(ch1Win.endlessUnlocked).toBe(false);
    expect(formatRunUnlocks(ch1Win.unlocks)).toEqual([
      'Chapter 2 unlocked!',
      'Hero unlocked: Archer',
      'Unlocked: Ch1 Ascension 1',
    ]);

    // Clearing Ch4 for the first time unlocks Ch4 Ascension 1 AND Endless Mode!
    save = { ...save, chaptersUnlocked: 4 };
    const ch4Win = commitRunEnd(save, repo, {
      chapter: 4,
      goldEarned: 250,
      won: true,
      ascension: 0,
      endlessLoop: 0,
    });
    expect(ch4Win.endlessUnlocked).toBe(true);
    expect(ch4Win.unlockedAscension).toEqual({ chapter: 4, level: 1 });
    expect(canStartEndless(4, true)).toBe(true);

    const rich = buildRichRunResult({
      chapter: 4,
      roomReached: 9,
      roomsTotal: 9,
      goldEarned: 250,
      goldTotal: ch4Win.gold,
      durationMs: 320_000,
      kills: 410,
      won: true,
      seed: 1337,
      ascension: 0,
      endlessLoop: 0,
      characterId: 'archer',
      deathCause: { kind: 'victory' },
      ownedSkills: new Map([['piercing', 3], ['phantom-volley', 1]]),
      unlocks: ch4Win.unlocks,
    });
    expect(rich.canContinueEndless).toBe(true);
    expect(rich.deathCause).toEqual({ kind: 'victory' });
    expect(rich.ownedSkills).toEqual({ piercing: 3, 'phantom-volley': 1 });

    // Endless progression across Ch4 → Ch1 (loop 1) → Ch2 → Ch3 → Ch4 → Ch1 (loop 2)
    expect(nextEndlessStep(4, 0)).toEqual({ chapter: 1, loop: 1 });
    expect(nextEndlessStep(1, 1)).toEqual({ chapter: 2, loop: 1 });
    expect(nextEndlessStep(3, 1)).toEqual({ chapter: 4, loop: 1 });
    expect(nextEndlessStep(4, 1)).toEqual({ chapter: 1, loop: 2 });

    // Endless victory does NOT unlock new Ascension tiers.
    const endlessWin = commitRunEnd(ch4Win.save, repo, {
      chapter: 4,
      goldEarned: 500,
      won: true,
      ascension: 1,
      endlessLoop: 1,
    });
    expect(unlockedAscensionForChapter(endlessWin.save, 4)).toBe(1);
    expect(endlessWin.unlockedAscension).toBeUndefined();
  });
});

describe('M15 Wave 2 — Meta Utility Tracks (XP Magnet, Gold Bonus, Free Rerolls)', () => {
  it('XP Magnet multiplies XP orb magnetic pull radius cleanly', () => {
    const saveLv0 = createDefaultSave();
    const saveLv5 = {
      ...saveLv0,
      upgrades: { ...saveLv0.upgrades, xpMagnet: 5 },
    };
    const util0 = utilityStatsFromSave(saveLv0);
    const util5 = utilityStatsFromSave(saveLv5);
    expect(util0.xpMagnetMult).toBe(1);
    expect(util5.xpMagnetMult).toBeCloseTo(1.75, 6);

    const baseRadius = XP_TUNING.orbs.magnetRadiusTiles;
    const testDist = baseRadius * 1.4; // outside 1.0× radius, inside 1.75× radius

    const poolNormal = new XpOrbPool({ ...XP_TUNING.orbs, scatterDurationMs: 0 });
    poolNormal.spawn({ position: { x: 10 + testDist, y: 9 }, value: 10 });
    poolNormal.step(0.05, { x: 10, y: 9 }, false, util0.xpMagnetMult);
    expect(poolNormal.activeOrbs[0]?.phase).toBe('idle');

    const poolMagnet = new XpOrbPool({ ...XP_TUNING.orbs, scatterDurationMs: 0 });
    poolMagnet.spawn({ position: { x: 10 + testDist, y: 9 }, value: 10 });
    poolMagnet.step(0.05, { x: 10, y: 9 }, false, util5.xpMagnetMult);
    expect(poolMagnet.activeOrbs[0]?.phase).toBe('magnet');
  });

  it('Gold Bonus combines multiplicatively with Ascension Gold reward across kills, rooms, and bonuses', () => {
    const save = {
      ...createDefaultSave(),
      upgrades: { ...createDefaultSave().upgrades, goldBonus: 5 }, // 1.60×
    };
    const util = utilityStatsFromSave(save);
    const diff = combinedDifficultyModifiers(4, 0); // 1.65× gold
    const combinedMult = util.goldBonusMult * diff.goldRewardMult; // 2.64×

    const rewards = new RunRewards();
    const killGold = rewards.awardKill('tank', true, combinedMult); // base 9 * 2.64 = 23.76 -> 24
    expect(killGold).toBe(Math.round(9 * combinedMult));

    const bossGold = rewards.awardRoomClear(true, combinedMult); // base 50 * 2.64 = 132
    expect(bossGold).toBe(Math.round(50 * combinedMult));

    const bonusGold = rewards.awardBonus(20, combinedMult); // 20 * 2.64 = 53
    expect(bonusGold).toBe(Math.round(20 * combinedMult));
    expect(rewards.goldEarned).toBe(killGold + bossGold + bonusGold);
  });

  it('Free Rerolls cost 0g, do not advance paid reroll ramp, then transition cleanly to escalating gold cost', () => {
    const save = {
      ...createDefaultSave(),
      upgrades: { ...createDefaultSave().upgrades, freeRerolls: 2 },
    };
    const run = new SkillRun();
    run.resetForRun(42, save, 'ninja');

    expect(run.freeRerollsLeft).toBe(2);
    expect(run.rerollsUsed).toBe(0);
    expect(run.nextRerollCost()).toBe(0);

    // Seed an active offer cleanly via internal offer setup using open() mock or roll()
    const initial = run.roll();
    (run as unknown as { offered: unknown }).offered = initial;

    // 1st free reroll: 0g, freeRerollsLeft 2 -> 1, paid rerollsUsed stays 0!
    const r1 = run.reroll();
    expect(r1).not.toBeNull();
    expect(run.freeRerollsLeft).toBe(1);
    expect(run.rerollsUsed).toBe(0);
    expect(run.nextRerollCost()).toBe(0);

    // 2nd free reroll: 0g, freeRerollsLeft 1 -> 0, paid rerollsUsed STILL 0 -> next costs baseCost!
    (run as unknown as { offered: unknown }).offered = r1;
    const r2 = run.reroll();
    expect(r2).not.toBeNull();
    expect(run.freeRerollsLeft).toBe(0);
    expect(run.rerollsUsed).toBe(0);
    expect(run.nextRerollCost()).toBe(rerollCost(0));

    // 3rd reroll (first PAID reroll): increments rerollsUsed 0 -> 1, next costs rerollCost(1)!
    (run as unknown as { offered: unknown }).offered = r2;
    const r3 = run.reroll();
    expect(r3).not.toBeNull();
    expect(run.freeRerollsLeft).toBe(0);
    expect(run.rerollsUsed).toBe(1);
    expect(run.nextRerollCost()).toBe(rerollCost(1));
  });
});

describe('M15 Wave 2 — Exact DeathCause Attribution & Debug Kill', () => {
  it('attributes lethal enemy bullet, boss bullet, melee contact, and debug death accurately', () => {
    const actorLayer = new MockNode('actors');

    // 1. Enemy sniper bullet kills player -> { kind: 'enemy-bullet', role: 'sniper' }
    const fake1 = makeLiveFakePlayer(1, 6, { x: 10, y: 9 });
    const loop1 = new CombatLoop({
      player: fake1.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(1),
    });
    fake1.bullets.spawn({
      position: { x: 10, y: 9 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0.2,
      damage: 1,
      owner: 'enemy',
      ttlMs: 1000,
      source: { kind: 'enemy-bullet', role: 'sniper' },
    });
    const res1 = loop1.update(16);
    expect(res1.playerDied).toBe(true);
    expect(loop1.deathCause).toEqual({ kind: 'enemy-bullet', role: 'sniper' });
    expect(formatDeathCause(loop1.deathCause!)).toBe('Slain by Sniper bullet');
    loop1.destroy();

    // 2. Boss bullet kills player -> { kind: 'boss', bossId: 'samurai', phase: 2 }
    const fake2 = makeLiveFakePlayer(1, 6, { x: 10, y: 9 });
    const loop2 = new CombatLoop({
      player: fake2.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(2),
    });
    fake2.bullets.spawn({
      position: { x: 10, y: 9 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0.3,
      damage: 2,
      owner: 'enemy',
      ttlMs: 1000,
      source: { kind: 'boss', bossId: 'samurai', phase: 2 },
    });
    const res2 = loop2.update(16);
    expect(res2.playerDied).toBe(true);
    expect(loop2.deathCause).toEqual({ kind: 'boss', bossId: 'samurai', phase: 2 });
    expect(formatDeathCause(loop2.deathCause!)).toBe('Slain by Samurai (Phase 2)');
    loop2.destroy();

    // 3. Debug triggerDeath bypasses godMode and records explicit cause
    const fake3 = makeLiveFakePlayer(6, 6, { x: 10, y: 9 });
    const loop3 = new CombatLoop({
      player: fake3.player,
      bulletView: null,
      manifest,
      actorLayer: actorLayer as unknown as never,
      level: TEST_LEVEL,
      monsterFor: () => 'bluebat',
      rng: SeededRng.fromSeed(3),
    });
    loop3.setGodMode(true);
    const cause: DeathCause = { kind: 'bomber-blast', elite: true };
    expect(loop3.triggerDebugDeath(cause)).toBe(true);
    expect(fake3.state.isDead).toBe(true);
    expect(loop3.deathCause).toEqual(cause);
    expect(formatDeathCause(loop3.deathCause!)).toBe('Slain by Elite Bomber blast');
    loop3.destroy();
  });
});

describe('M15 Wave 2 — HUD Compact Ascension/Endless Room Label', () => {
  it('formats room label with compact A<n>/E<n> tags and clears top-centre Boss bar', () => {
    expect(formatRunRoomLabel('1/9', 0, 0)).toBe('1/9');
    expect(formatRunRoomLabel('3/9', 4, 0)).toBe('3/9 A4');
    expect(formatRunRoomLabel('2/9', 0, 2)).toBe('2/9 E2');
    expect(formatRunRoomLabel('9/9', 5, 3)).toBe('9/9 A5 E3');

    const layout = computeHudLayout({
      roomLabel: formatRunRoomLabel('9/9', 5, 9),
      enemiesLeft: 24,
    });
    // Top-right plate must stay cleanly to the right of the top-centre Boss bar (no overlap).
    expect(layout.topRight.plate.left).toBeGreaterThanOrEqual(layout.bossBar.plate.right + 4);
  });
});

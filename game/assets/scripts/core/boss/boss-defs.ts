/**
 * Definitions of the chapter bosses (GDD §5): TenguBlue → SquidGreen → GiantBlueSamurai,
 * plus the pool alternatives picked by the run seed: GiantFrog (ch1) and GiantSlime (ch2) from
 * #43, GiantBamboo (ch3) with GiantRacoon and the red Tengu (ch4) from #44.
 *
 * This file has **pure data** only: no time, no RNG, no `cc`.
 * Detailed patterns live in `patterns.ts`, enemy spawning in `summon.ts`.
 *
 * Bosses take frames from the pack's `Actor/Boss`; each sheet is **one horizontal row**
 * (`layout: "strip"` in `assets/resources/data/animations.json`), so core only *names*
 * animations while the adapter handles slicing and flipping.
 */
export const BOSS_IDS = [
  'tengu',
  'squid',
  'samurai',
  'frog',
  'slime',
  'bamboo',
  'racoon',
  'redtengu',
] as const;
export type BossId = (typeof BOSS_IDS)[number];

export type BossPhase = 1 | 2 | 3;

/** Direction the boss faces. For Samurai this is also the **attack tell** (GDD §5). */
export type Facing = 'left' | 'right';

/**
 * Boss animations are named **by intent**, not by file name. The adapter looks up
 * `animationFor()` to get the real manifest key. That lets Samurai use
 * `attack` → `samurai.attack.left|right` without patterns knowing.
 */
export type BossAnimKind = 'idle' | 'walk' | 'attack' | 'charge' | 'loop' | 'shoot' | 'teleport' | 'hit';

/** One animation key in the manifest, with a "has facing" flag (Samurai L/R). */
interface AnimationEntry {
  /** Base key; when `perFacing`, the `.left` / `.right` suffix is appended. */
  readonly base: string;
  /** Samurai has separate left/right sheets; the other two bosses have one sheet. */
  readonly perFacing?: boolean;
}

/**
 * Animation table per boss, containing only what the pack **actually has**
 * (`docs/art/pack-inventory.md` §3). A missing kind makes `animationFor` fall back to
 * `attack` then `idle` — a pattern never asks for a kind the boss does not have.
 */
const ANIMATION_TABLE: Readonly<
  Record<BossId, Readonly<Partial<Record<BossAnimKind, AnimationEntry>>>>
> = {
  tengu: {
    idle: { base: 'tengu.idle' },
    walk: { base: 'tengu.walk' },
    attack: { base: 'tengu.attack' },
    teleport: { base: 'tengu.trans' },
    hit: { base: 'tengu.hit' },
  },
  squid: {
    idle: { base: 'squid.idle' },
    walk: { base: 'squid.walk' },
    attack: { base: 'squid.attack' },
    loop: { base: 'squid.attack-loop' },
    shoot: { base: 'squid.shoot' },
    hit: { base: 'squid.hit' },
  },
  samurai: {
    idle: { base: 'samurai.idle' },
    walk: { base: 'samurai.walk' },
    attack: { base: 'samurai.attack', perFacing: true },
    charge: { base: 'samurai.charge', perFacing: true },
    hit: { base: 'samurai.hit' },
  },
  // GiantFrog hops on `Jump` (walk) and leans back on `Charge` (charge intent).
  frog: {
    idle: { base: 'frog.idle' },
    walk: { base: 'frog.jump' },
    attack: { base: 'frog.attack' },
    charge: { base: 'frog.charge' },
    hit: { base: 'frog.hit' },
  },
  // GiantSlime has no separate attack sheet: `attack`/`loop` fall back to idle.
  slime: {
    idle: { base: 'slime.idle' },
    walk: { base: 'slime.jump' },
    hit: { base: 'slime.hit' },
  },
  // GiantBamboo stomps on `Walk` and telegraphs with `Charge` (charge intent).
  bamboo: {
    idle: { base: 'bamboo.idle' },
    walk: { base: 'bamboo.walk' },
    attack: { base: 'bamboo.attack' },
    charge: { base: 'bamboo.charge' },
    hit: { base: 'bamboo.hit' },
  },
  // GiantRacoon hops on `Jump` (walk); it has no hit sheet, so `hit` falls back to attack.
  racoon: {
    idle: { base: 'racoon.idle' },
    walk: { base: 'racoon.jump' },
    attack: { base: 'racoon.attack' },
    charge: { base: 'racoon.charge' },
  },
  // Red Tengu mirrors the blue sheets with a stronger pattern (#44).
  redtengu: {
    idle: { base: 'redtengu.idle' },
    walk: { base: 'redtengu.walk' },
    attack: { base: 'redtengu.attack' },
    teleport: { base: 'redtengu.trans' },
    hit: { base: 'redtengu.hit' },
  },
};

/**
 * Phase thresholds, based on the **remaining health fraction**.
 *
 * The boundary counts as the later phase: health exactly at the threshold is already the new phase. That makes
 * `phaseFor` two comparisons with no "in-between" gap.
 */
export interface PhaseThresholds {
  /** Health <= this fraction enters phase 2. */
  readonly phase2: number;
  /** Health <= this fraction enters phase 3. */
  readonly phase3: number;
}

/** 2/3 and 1/3 — shared by all three bosses, the GDD does not differentiate. */
export const PHASE_THRESHOLDS: PhaseThresholds = {
  phase2: 2 / 3,
  phase3: 1 / 3,
};

export interface BossDef {
  readonly id: BossId;
  /** Display name on the HUD (GDD §5). */
  readonly displayName: string;
  /** Real art folder name, matching `LevelData.boss.name`. */
  readonly spriteName: string;
  /**
   * Chapter the boss belongs to, as a plain number: chapter 4 has bosses (#44) before it has
   * levels (#45), so this is not `BossPhase`.
   */
  readonly chapter: number;
  /** Max health: 60 / 80 / 100 for the chapter bosses, 60 / 80 / 100 / 120 / 120 for the pool (#43, #44). */
  readonly maxHealth: number;
  /**
   * **Hitbox** radius, tiles — a collision proxy, not the sprite size.
   *
   * Boss sprites in the pack (see `docs/art/pack-inventory.md` §3) are 82×82 px
   * (Tengu while walking/attacking), 76×79 px (Squid) and 96×96 px (Samurai while
   * attacking/charging). At 16 px/tile that is 4.75–6 tiles, but frames have transparent
   * borders and the body is only ~70–85% of the width. Take **half the body width**, rounded to 1/4
   * tile:
   *
   * | boss    | frame | body ≈ | radius |
   * |---------|-------|--------|----------|
   * | tengu   | 82 px | 70 %   | 1.75     |
   * | squid   | 76 px | 85 %   | 2        |
   * | samurai | 96 px | 75 %   | 2.25     |
   * | frog    | 40 px | 80 %   | 1        |
   * | slime   | 62 px | 70 %   | 1.5      |
   * | bamboo  | 62 px | 90 %   | 1.75     |
   * | racoon  | 60 px | 93 %   | 1.75     |
   * | redtengu| 82 px | 70 %   | 1.75     |
   *
   * The hitbox is smaller than the sprite so the player never gets "hit by air".
   */
  readonly hitboxRadiusTiles: number;
  /**
   * The **solid pixel** extent of the sprite measured from the feet anchor, tiles, max over every
   * frame of every animation (measured from the PNG — `tests/core/art-files.test.ts` re-checks it).
   * Patterns use this so the boss never walks to a spot where the sprite spills outside
   * the room and is cropped by the camera (Samurai charging against the wall was cut in half in M6).
   */
  readonly spriteExtentTiles: SpriteExtent;
  readonly phaseThresholds: PhaseThresholds;
  /** Every animation key this boss has in the manifest. The adapter preloads from this list. */
  readonly animations: readonly string[];
}

/** How much of the sprite lies left / right / above the feet anchor, tiles. */
export interface SpriteExtent {
  readonly left: number;
  readonly right: number;
  readonly up: number;
}

/**
 * The boss sprite feet sit this much below the hitbox centre (tiles, room y axis pointing down)
 * so the silhouette does not cover the player. The view places the node at exactly this offset.
 */
export const BOSS_FEET_OFFSET_TILES = 0.75;

function animationsOf(id: BossId): readonly string[] {
  const table = ANIMATION_TABLE[id];
  const keys = new Set<string>();
  for (const entry of Object.values(table)) {
    if (entry === undefined) continue;
    if (entry.perFacing === true) {
      keys.add(`${entry.base}.left`);
      keys.add(`${entry.base}.right`);
    } else {
      keys.add(entry.base);
    }
  }
  return Array.from(keys);
}

export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  tengu: {
    id: 'tengu',
    displayName: 'Tengu',
    spriteName: 'TenguBlue',
    chapter: 1,
    maxHealth: 60,
    hitboxRadiusTiles: 1.75,
    phaseThresholds: PHASE_THRESHOLDS,
    spriteExtentTiles: { left: 2.375, right: 2.3125, up: 5.0625 },
    animations: animationsOf('tengu'),
  },
  squid: {
    id: 'squid',
    displayName: 'Squid',
    spriteName: 'SquidGreen',
    chapter: 2,
    maxHealth: 80,
    hitboxRadiusTiles: 2,
    phaseThresholds: PHASE_THRESHOLDS,
    spriteExtentTiles: { left: 2.125, right: 2.125, up: 3.9375 },
    animations: animationsOf('squid'),
  },
  samurai: {
    id: 'samurai',
    displayName: 'Samurai',
    spriteName: 'GiantBlueSamurai',
    chapter: 3,
    maxHealth: 100,
    hitboxRadiusTiles: 2.25,
    phaseThresholds: PHASE_THRESHOLDS,
    spriteExtentTiles: { left: 2.4375, right: 2.25, up: 3.6875 },
    animations: animationsOf('samurai'),
  },
  frog: {
    id: 'frog',
    displayName: 'Giant Frog',
    spriteName: 'GiantFrog',
    chapter: 1,
    maxHealth: 60,
    hitboxRadiusTiles: 1,
    phaseThresholds: PHASE_THRESHOLDS,
    // Measured from the 40×40 sheets (Idle/Jump/Charge/Attack/Hit), feet anchor.
    spriteExtentTiles: { left: 1.25, right: 1.25, up: 2.125 },
    animations: animationsOf('frog'),
  },
  slime: {
    id: 'slime',
    displayName: 'Giant Slime',
    spriteName: 'GiantSlime',
    chapter: 2,
    maxHealth: 80,
    hitboxRadiusTiles: 1.5,
    phaseThresholds: PHASE_THRESHOLDS,
    // Measured from the 62×52 sheets (Idle/Jump/Hit), feet anchor.
    spriteExtentTiles: { left: 1.875, right: 1.8125, up: 2.8125 },
    animations: animationsOf('slime'),
  },
  bamboo: {
    id: 'bamboo',
    displayName: 'Giant Bamboo',
    spriteName: 'GiantBamboo',
    chapter: 3,
    maxHealth: 100,
    hitboxRadiusTiles: 1.75,
    phaseThresholds: PHASE_THRESHOLDS,
    // Measured from the 62×62 sheets (Idle/Walk/Attack/Charge/Hit), feet anchor.
    spriteExtentTiles: { left: 1.6875, right: 1.6875, up: 3.75 },
    animations: animationsOf('bamboo'),
  },
  racoon: {
    id: 'racoon',
    displayName: 'Giant Racoon',
    spriteName: 'GiantRacoon',
    chapter: 4,
    maxHealth: 120,
    hitboxRadiusTiles: 1.75,
    phaseThresholds: PHASE_THRESHOLDS,
    // Measured from the 60×60 sheets (Idle/Jump/Attack/Charge), feet anchor.
    spriteExtentTiles: { left: 1.75, right: 1.75, up: 3.3125 },
    animations: animationsOf('racoon'),
  },
  redtengu: {
    id: 'redtengu',
    displayName: 'Red Tengu',
    spriteName: 'TenguRed',
    chapter: 4,
    maxHealth: 120,
    hitboxRadiusTiles: 1.75,
    phaseThresholds: PHASE_THRESHOLDS,
    // Measured from the 82×82 sheets (Idle/Walk/Attack/Trans/Hit), feet anchor.
    spriteExtentTiles: { left: 2.375, right: 2.3125, up: 5.0625 },
    animations: animationsOf('redtengu'),
  },
};

/**
 * Look up a boss by `LevelData.boss.name` (art folder name, e.g. `TenguBlue`).
 *
 * The TMX only holds the **sprite name**, not a boss id: renaming in Tiled
 * therefore does not drag internal ids around, and a wrong name surfaces immediately ("no boss ...").
 */
export function bossForSpriteName(spriteName: string): BossDef | undefined {
  for (const boss of Object.values(BOSSES)) {
    if (boss.spriteName === spriteName) return boss;
  }
  return undefined;
}

/**
 * Phase by remaining health. `healthFraction` must be finite; 1 = full health.
 *
 * Boundary: `1 → 1`, `0.66 → 2`, `0.33 → 3`, `0 → 3` (with thresholds 2/3 and 1/3).
 */export function phaseFor(bossId: BossId, healthFraction: number): BossPhase {
  if (!Number.isFinite(healthFraction)) {
    throw new Error(`phaseFor needs a finite healthFraction, got ${healthFraction}`);
  }

  const thresholds = BOSSES[bossId].phaseThresholds;
  if (healthFraction <= thresholds.phase3) return 3;
  if (healthFraction <= thresholds.phase2) return 2;
  return 1;
}

/** Remaining health fraction, clamped into [0, 1] so overheal cannot push past a threshold. */
export function healthFraction(bossId: BossId, health: number): number {
  if (!Number.isFinite(health)) {
    throw new Error(`healthFraction needs finite health, got ${health}`);
  }
  const ratio = health / BOSSES[bossId].maxHealth;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/**
 * Manifest animation key for a boss intent. `facing` is only used by bosses with
 * directional sheets (Samurai); the other two ignore it.
 */
export function animationFor(bossId: BossId, kind: BossAnimKind, facing: Facing): string {
  const table = ANIMATION_TABLE[bossId];
  const entry = table[kind] ?? table.attack ?? table.idle;
  if (entry === undefined) {
    throw new Error(`Boss ${bossId} has no animation to fall back to`);
  }
  return entry.perFacing === true ? `${entry.base}.${facing}` : entry.base;
}

/** Opposite direction — Samurai flips direction on its second charge (GDD §5). */
export function oppositeFacing(facing: Facing): Facing {
  return facing === 'left' ? 'right' : 'left';
}

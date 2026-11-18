/**
 * Draw bullets from `BulletPool` with **pre-pooled** sprite nodes (no `new` per shot).
 *
 * `core/combat/bullets.ts` owns the lifecycle (travel, ttl expiry, recall, pool full). This
 * file only reads `pool.active()` each frame and assigns positions/frames to existing nodes.
 *
 * Ticket #3: the sprite is not fixed any more.
 * - Player bullets pick their look from the live loadout (`playerProjectileLook`), so a skill
 *   pickup changes the bullet on the next frame.
 * - Enemy bullets are round and per chapter (`enemyProjectileKey`); only ch1 keeps the old tint.
 * - A pooled **ghost trail** follows each player bullet, tinted by `trailElement`.
 *
 * All frames come from the manifest and are sliced once at init — no path is assembled here.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { resolve } from '../core/art/manifest';
import type { Bullet, BulletPool } from '../core/combat/bullets';
import { FEEL_TUNING } from '../core/enemies/tuning';
import type { Vec2 } from '../core/math/vec2';
import {
  ELEMENT_TINTS,
  effectsLayers,
  enemyProjectileKey,
  playerProjectileLook,
  trailElement,
  type EffectsMode,
  type VfxElement,
} from '../core/vfx/weapon-vfx';
import { loadAnimationManifest } from './anim/sprite-animator';
import { getFrame } from './assets/sprite-frame-cache';
import { tileToWorld } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

/** Every projectile the player can shoot (`playerProjectileLook` only returns these). */
const PLAYER_KEYS = [
  'fx.shuriken',
  'fx.big-shuriken',
  'fx.kunai',
  'fx.big-kunai',
  'fx.ice-spike',
  'fx.plant-spike',
  'fx.shuriken-magic',
  'fx.big-energy-ball',
] as const;

/** Round enemy balls, one per chapter (`enemyProjectileKey`). */
const ENEMY_KEYS = ['fx.energy-ball', 'fx.bubble', 'fx.canon-ball', 'fx.fireball'] as const;

/** Pointed sprites are rotated into the flight direction; the spinning shuriken art is not. */
const ROTATING_KEYS: ReadonlySet<string> = new Set([
  'fx.ice-spike',
  'fx.plant-spike',
  'fx.kunai',
  'fx.big-kunai',
]);

/**
 * Base colour (unchanged) and a **warm orange** for ch1 enemy bullets — clearly unlike the
 * player's blue shuriken. Chapters 2–4 use the art's own colour (ADR-016: round + dark outline).
 */
const BULLET_NO_TINT = new CocosColor(255, 255, 255, 255);
const ENEMY_BULLET_TINT = new CocosColor(255, 142, 78, 255);

/** Cached `cc.Color` per element — the trail spawns many ghosts and must not allocate per frame. */
const ELEMENT_COLORS: Readonly<Record<VfxElement, Color>> = {
  fire: new CocosColor(ELEMENT_TINTS.fire.r, ELEMENT_TINTS.fire.g, ELEMENT_TINTS.fire.b, 255),
  ice: new CocosColor(ELEMENT_TINTS.ice.r, ELEMENT_TINTS.ice.g, ELEMENT_TINTS.ice.b, 255),
  poison: new CocosColor(ELEMENT_TINTS.poison.r, ELEMENT_TINTS.poison.g, ELEMENT_TINTS.poison.b, 255),
  homing: new CocosColor(ELEMENT_TINTS.homing.r, ELEMENT_TINTS.homing.g, ELEMENT_TINTS.homing.b, 255),
  crit: new CocosColor(ELEMENT_TINTS.crit.r, ELEMENT_TINTS.crit.g, ELEMENT_TINTS.crit.b, 255),
};

/**
 * Maximum number of pre-built bullet nodes. The pool holds 256 bullets, but a 32×18 tile screen
 * rarely has more than a few dozen at once; past this threshold extra bullets are simply not
 * drawn (silently, no crash) instead of allocating unbounded nodes.
 */
const MAX_BULLET_NODES = 64;

/** Drawn diameter of one bullet, world units — larger than the 0.15 tile hitbox so it is visible. */
const BULLET_DRAW_UNITS = 0.6;
/**
 * Big variants must read as *bigger*, not just different: a `big-kunai` has the same longest
 * side as `kunai`. Visual only — the 0.15 tile hitbox is unchanged.
 */
const BIG_DRAW_SCALE = 1.4;
const DRAW_SCALE: Readonly<Record<string, number>> = {
  'fx.big-shuriken': BIG_DRAW_SCALE,
  'fx.big-kunai': BIG_DRAW_SCALE,
};
/** Ghosts are slightly smaller than the bullet so the trail reads as "behind", not "another shot". */
const GHOST_SCALE = 0.85;

export interface BulletViewOptions {
  /** Live loadout (skill id → stacks), i.e. `SkillLoadout.snapshot()`. */
  readonly loadout: () => ReadonlyMap<string, number>;
  /** Chapter of the current run — picks the enemy ball. */
  readonly chapter: () => number;
  /** Full/Reduced: Reduced turns the trail off. */
  readonly effects: () => EffectsMode;
}

interface KeyData {
  readonly frames: readonly SpriteFrame[];
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

interface BulletNode {
  readonly node: Node;
  readonly sprite: Sprite;
  lastFrame: number;
  lastKey: string;
}

interface GhostNode {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly color: Color;
  active: boolean;
  remainingMs: number;
  totalMs: number;
}

@ccclass('BulletView')
export class BulletView extends Component {
  private pool: BulletPool | null = null;
  private options: BulletViewOptions | null = null;
  private readonly byKey = new Map<string, KeyData>();
  private readonly nodes: BulletNode[] = [];
  private readonly ghosts: GhostNode[] = [];
  /** Last ghost spawn time per player bullet id (bullets are recycled, ids never repeat). */
  private readonly ghostClock = new Map<number, number>();
  private limit = MAX_BULLET_NODES;
  private elapsedMs = 0;
  private playerKey = 'fx.shuriken';
  private enemyKey = 'fx.energy-ball';

  /** Preload every projectile sheet and **pre-build every node** — no allocation during play. */
  async init(pool: BulletPool, options: BulletViewOptions): Promise<void> {
    this.pool = pool;
    this.options = options;
    this.limit = Math.max(1, Math.min(pool.capacity, MAX_BULLET_NODES));

    const manifest = await loadAnimationManifest();
    for (const key of [...PLAYER_KEYS, ...ENEMY_KEYS]) {
      const entry = resolve(manifest, key);
      const frames = await Promise.all(
        Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
      );
      this.byKey.set(key, {
        frames,
        fps: entry.fps,
        width: entry.frameWidth,
        height: entry.frameHeight,
      });
    }

    // Ghosts first: children of one node draw in creation order, so the trail stays behind bullets.
    for (let index = 0; index < FEEL_TUNING.vfx.trailPoolSize; index += 1) {
      this.ghosts.push(this.createGhost(index));
    }
    // The node pool is built once here: 8 enemies + 40 bullets spawn no nodes mid-run.
    for (let index = 0; index < this.limit; index += 1) {
      this.ensureNode(index);
    }
  }

  /** Bullet + ghost animation clock (independent of the display frame rate). */
  update(deltaTime: number): void {
    this.elapsedMs += Math.max(0, deltaTime) * 1000;
    const step = Math.max(0, deltaTime) * 1000;

    for (const ghost of this.ghosts) {
      if (!ghost.active) continue;
      ghost.remainingMs -= step;
      if (ghost.remainingMs <= 0) {
        ghost.active = false;
        ghost.node.active = false;
        continue;
      }
      // Fade out linearly; the tint stays so the element colour is readable.
      ghost.color.a = Math.round(255 * Math.min(1, ghost.remainingMs / ghost.totalMs));
      ghost.sprite.color = ghost.color;
    }
  }

  /** Call every frame **after** `BulletPool.update()` so positions are final. */
  sync(): void {
    const pool = this.pool;
    const options = this.options;
    if (pool === null || options === null) return;

    const owned = options.loadout();
    const layers = effectsLayers(options.effects());
    const look = playerProjectileLook(owned);
    this.playerKey = look.key;
    this.enemyKey = enemyProjectileKey(options.chapter());

    const playerTint = look.tint === null ? BULLET_NO_TINT : ELEMENT_COLORS[look.tint];
    const enemyTint = options.chapter() === 1 ? ENEMY_BULLET_TINT : BULLET_NO_TINT;

    const active = pool.active();
    const drawn = Math.min(active.length, this.limit);

    for (let index = 0; index < drawn; index += 1) {
      const bullet: Bullet | undefined = active[index];
      if (bullet === undefined) continue;

      const entry = this.ensureNode(index);
      if (entry === null) break;

      const player = bullet.owner === 'player';
      const key = player ? look.key : this.enemyKey;
      const data = this.byKey.get(key);
      if (data === undefined) continue;

      const frameIndex = Math.floor((this.elapsedMs * data.fps) / 1000) % data.frames.length;
      const frame = data.frames[frameIndex];
      if (frame === undefined) continue;

      const drawScale =
        (BULLET_DRAW_UNITS / Math.max(data.width, data.height)) * (DRAW_SCALE[key] ?? 1);

      if (entry.lastFrame !== frameIndex || entry.lastKey !== key) {
        entry.lastFrame = frameIndex;
        entry.lastKey = key;
        entry.sprite.spriteFrame = frame;

        const transform = entry.node.getComponent(CocosUITransform);
        // `sizeMode = CUSTOM` takes its size from UITransform — set the sliced frame size.
        if (transform !== null) transform.setContentSize(data.width, data.height);
        entry.node.setScale(drawScale, drawScale, 1);
      }

      entry.sprite.color = player ? playerTint : enemyTint;
      this.applyPosition(entry.node, bullet.position);
      // Nodes are pre-built inactive; the pool only ever deactivates them, so a drawn bullet
      // must switch itself back on every frame.
      entry.node.active = true;
      // Tile space has y down, Cocos rotation counter-clockwise: negate the angle.
      const angle =
        player && ROTATING_KEYS.has(key)
          ? (-Math.atan2(bullet.velocity.y, bullet.velocity.x) * 180) / Math.PI
          : 0;
      entry.node.angle = angle;

      if (player && layers.trail) {
        const element = trailElement(owned, bullet.crit);
        if (element !== null) {
          this.spawnGhost(bullet, data, frameIndex, element, angle, drawScale);
        }
      }
    }

    for (let index = drawn; index < this.nodes.length; index += 1) {
      const entry: BulletNode | undefined = this.nodes[index];
      if (entry !== undefined && entry.node.isValid) entry.node.active = false;
    }
  }

  /** Debug `vfx()`: how many trail ghosts are alive right now. */
  get trailGhostsActive(): number {
    return this.ghosts.filter((ghost) => ghost.active).length;
  }

  /** Debug `vfx()`: the projectile key the current loadout selects. */
  get projectileKey(): string {
    return this.playerKey;
  }

  /** Debug `vfx()`: the enemy ball of the current chapter. */
  get enemyProjectileKey(): string {
    return this.enemyKey;
  }

  private spawnGhost(
    bullet: Bullet,
    data: KeyData,
    frameIndex: number,
    element: VfxElement,
    angle: number,
    drawScale: number,
  ): void {
    const now = this.elapsedMs;
    const last = this.ghostClock.get(bullet.id);
    const spawnMs = FEEL_TUNING.vfx.trailSpawnMs;
    if (last !== undefined && now - last < spawnMs) return;
    this.ghostClock.set(bullet.id, now);
    // Bound the map: bullets are recycled by id, so dead ids would leak without pruning.
    if (this.ghostClock.size > 512) {
      for (const id of this.ghostClock.keys()) {
        if (id !== bullet.id) {
          this.ghostClock.delete(id);
          break;
        }
      }
    }

    const ghost = this.ghosts.find((candidate) => !candidate.active);
    if (ghost === undefined) return;

    const frame = data.frames[frameIndex];
    if (frame === undefined) return;

    const tint = ELEMENT_COLORS[element];
    ghost.color.r = tint.r;
    ghost.color.g = tint.g;
    ghost.color.b = tint.b;
    ghost.color.a = 255;
    ghost.sprite.color = ghost.color;
    ghost.active = true;
    ghost.remainingMs = FEEL_TUNING.vfx.trailLifetimeMs;
    ghost.totalMs = ghost.remainingMs;
    ghost.node.active = true;
    ghost.sprite.spriteFrame = frame;
    // A rotated bullet (spike/kunai) leaves an equally rotated trail; every other key is 0.
    ghost.node.angle = angle;

    const transform = ghost.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(data.width, data.height);
    const scale = drawScale * GHOST_SCALE;
    ghost.node.setScale(scale, scale, 1);
    this.applyPosition(ghost.node, bullet.position);
  }

  private ensureNode(index: number): BulletNode | null {
    const existing: BulletNode | undefined = this.nodes[index];
    if (existing !== undefined) {
      return existing.node.isValid ? existing : null;
    }
    if (this.nodes.length >= this.limit) return null;

    const node = new CocosNode(`bullet-${index}`);
    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    node.parent = this.node;
    node.active = false;

    const entry: BulletNode = { node, sprite, lastFrame: -1, lastKey: '' };
    this.nodes.push(entry);
    return entry;
  }

  private createGhost(index: number): GhostNode {
    const node = new CocosNode(`bullet-trail-${index}`);
    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    node.parent = this.node;
    node.active = false;
    return {
      node,
      sprite,
      color: new CocosColor(255, 255, 255, 255),
      active: false,
      remainingMs: 0,
      totalMs: 1,
    };
  }

  private applyPosition(node: Node, position: Vec2): void {
    const world = tileToWorld(position);
    node.setPosition(world.x, world.y, 0);
  }
}

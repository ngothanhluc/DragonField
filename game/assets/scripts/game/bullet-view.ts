/**
 * Draw bullets from `BulletPool` with **pre-pooled** sprite nodes (no `new` per shot).
 *
 * `core/combat/bullets.ts` owns the lifecycle (travel, ttl expiry, recall, pool full). This
 * file only reads `pool.active()` each frame and assigns positions/frames to existing nodes.
 *
 * Frames come from the manifest (`fx.shuriken`, `fx.energy-ball`) and advance with time:
 * the shuriken spins through 15 frames, the energy ball has 4. All frames are sliced once at init.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import type { Bullet, BulletOwner, BulletPool } from '../core/combat/bullets';
import type { Vec2 } from '../core/math/vec2';
import { loadTexture } from './assets/texture-cache';
import { sliceFrame, tileToWorld } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

/** Player bullet: `fx/shuriken`. 690×54 px sheet; 690/15 = 46 ⇒ 46×54 frames. */
export const PLAYER_BULLET_SHEET = 'resources/art/fx/shuriken/SpriteSheet.png';
/** Enemy bullet: `fx/energy-ball`, 64×16 = 4 frames of 16×16. */
export const ENEMY_BULLET_SHEET = 'resources/art/fx/energy-ball/EnergyBall.png';

const PLAYER_BULLET_RECT: TileRect = { x: 0, y: 0, width: 46, height: 54 };
const ENEMY_BULLET_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };
const PLAYER_FRAMES = 15;
const ENEMY_FRAMES = 4;
const PLAYER_FPS = 20;
const ENEMY_FPS = 12;

/** Base colour (unchanged) and a **warm orange** for enemy bullets — clearly unlike the player's blue shuriken. */
const BULLET_NO_TINT = new CocosColor(255, 255, 255, 255);
const ENEMY_BULLET_TINT = new CocosColor(255, 142, 78, 255);

/**
 * Maximum number of pre-built nodes. The pool holds 256 bullets, but a 32×18 tile screen
 * rarely has more than a few dozen at once; past this threshold extra bullets are simply not
 * drawn (silently, no crash) instead of allocating unbounded nodes.
 */
const MAX_BULLET_NODES = 64;

/** Drawn diameter of one bullet, world units — larger than the 0.15 tile hitbox so it is visible. */
const BULLET_DRAW_UNITS = 0.6;

interface BulletFrames {
  readonly player: readonly SpriteFrame[];
  readonly enemy: readonly SpriteFrame[];
}

interface BulletNode {
  readonly node: Node;
  readonly sprite: Sprite;
  lastFrame: number;
  lastOwner: BulletOwner | null;
}

@ccclass('BulletView')
export class BulletView extends Component {
  private pool: BulletPool | null = null;
  private frames: BulletFrames | null = null;
  private readonly nodes: BulletNode[] = [];
  private limit = MAX_BULLET_NODES;
  private elapsedMs = 0;

  /** Preload both bullet sheets and **pre-build every node** — no allocation during play. */
  async init(pool: BulletPool): Promise<void> {
    this.pool = pool;
    this.limit = Math.max(1, Math.min(pool.capacity, MAX_BULLET_NODES));

    const [playerTexture, enemyTexture] = await Promise.all([
      loadTexture(PLAYER_BULLET_SHEET),
      loadTexture(ENEMY_BULLET_SHEET),
    ]);
    this.frames = {
      player: Array.from({ length: PLAYER_FRAMES }, (_, index) =>
        sliceFrame(playerTexture, { ...PLAYER_BULLET_RECT, x: index * PLAYER_BULLET_RECT.width }),
      ),
      enemy: Array.from({ length: ENEMY_FRAMES }, (_, index) =>
        sliceFrame(enemyTexture, { ...ENEMY_BULLET_RECT, x: index * ENEMY_BULLET_RECT.width }),
      ),
    };

    // The node pool is built once here: 8 enemies + 40 bullets spawn no nodes mid-run.
    for (let index = 0; index < this.limit; index += 1) {
      this.ensureNode(index);
    }
  }

  /** Bullet animation clock (independent of the display frame rate). */
  update(deltaTime: number): void {
    this.elapsedMs += Math.max(0, deltaTime) * 1000;
  }

  /** Call every frame **after** `BulletPool.update()` so positions are final. */
  sync(): void {
    const pool = this.pool;
    const frames = this.frames;
    if (pool === null || frames === null) return;

    const active = pool.active();
    const drawn = Math.min(active.length, this.limit);

    for (let index = 0; index < drawn; index += 1) {
      const bullet: Bullet | undefined = active[index];
      if (bullet === undefined) continue;

      const entry = this.ensureNode(index);
      if (entry === null) break;

      const player = bullet.owner === 'player';
      const list = player ? frames.player : frames.enemy;
      const fps = player ? PLAYER_FPS : ENEMY_FPS;
      const frameIndex = Math.floor((this.elapsedMs * fps) / 1000) % list.length;
      const frame = list[frameIndex];
      if (frame === undefined) continue;

      if (entry.lastFrame !== frameIndex || entry.lastOwner !== bullet.owner) {
        entry.lastFrame = frameIndex;
        entry.lastOwner = bullet.owner;
        entry.sprite.spriteFrame = frame;
        entry.sprite.color = player ? BULLET_NO_TINT : ENEMY_BULLET_TINT;

        const rect = player ? PLAYER_BULLET_RECT : ENEMY_BULLET_RECT;
        const transform = entry.node.getComponent(CocosUITransform);
        if (transform !== null) transform.setContentSize(rect.width, rect.height);
        const scale = BULLET_DRAW_UNITS / Math.max(rect.width, rect.height);
        entry.node.setScale(scale, scale, 1);
      }

      this.applyPosition(entry.node, bullet.position);
      entry.node.active = true;
    }

    for (let index = drawn; index < this.nodes.length; index += 1) {
      const entry: BulletNode | undefined = this.nodes[index];
      if (entry !== undefined && entry.node.isValid) entry.node.active = false;
    }
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

    const entry: BulletNode = { node, sprite, lastFrame: -1, lastOwner: null };
    this.nodes.push(entry);
    return entry;
  }

  private applyPosition(node: Node, position: Vec2): void {
    const world = tileToWorld(position);
    node.setPosition(world.x, world.y, 0);
  }
}

/**
 * Vẽ đạn từ `BulletPool` bằng node sprite **pool sẵn** (không `new` mỗi phát).
 *
 * `core/combat/bullets.ts` lo vòng đời (bay, hết ttl, thu hồi, pool đầy). Ở đây
 * chỉ đọc `pool.active()` mỗi frame rồi gán vị trí/frame cho node có sẵn.
 *
 * Frame lấy từ manifest (`fx.shuriken`, `fx.energy-ball`) và phát theo thời gian:
 * shuriken xoay 15 frame, energy ball 4 frame. Tất cả frame slice một lần ở init.
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

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

/** Đạn player: `fx/shuriken`. Sheet 690×54 px; 690/15 = 46 ⇒ frame 46×54. */
export const PLAYER_BULLET_SHEET = 'resources/art/fx/shuriken/SpriteSheet.png';
/** Đạn enemy: `fx/energy-ball`, 64×16 = 4 frame 16×16. */
export const ENEMY_BULLET_SHEET = 'resources/art/fx/energy-ball/EnergyBall.png';

const PLAYER_BULLET_RECT: TileRect = { x: 0, y: 0, width: 46, height: 54 };
const ENEMY_BULLET_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };
const PLAYER_FRAMES = 15;
const ENEMY_FRAMES = 4;
const PLAYER_FPS = 20;
const ENEMY_FPS = 12;

/** Màu gốc (không đổi) và màu **cam ấm** cho đạn enemy — khác hẳn shuriken xanh của player. */
const BULLET_NO_TINT = new CocosColor(255, 255, 255, 255);
const ENEMY_BULLET_TINT = new CocosColor(255, 142, 78, 255);

/**
 * Số node tối đa dựng sẵn. Pool chứa được 256 viên nhưng màn hình 32×18 tile hiếm
 * khi có quá vài chục viên cùng lúc; vượt ngưỡng này thì đạn thừa không được vẽ
 * (im lặng, không crash) thay vì cấp phát node không giới hạn.
 */
const MAX_BULLET_NODES = 64;

/** Đường kính vẽ của một viên đạn, world unit — to hơn hitbox 0.15 tile để nhìn thấy. */
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

  /** Load sẵn hai sheet đạn và **dựng sẵn toàn bộ node** — không cấp phát trong lúc chơi. */
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

    // Pool node dựng một lần ở đây: 8 enemy + 40 viên đạn không sinh node nào giữa run.
    for (let index = 0; index < this.limit; index += 1) {
      this.ensureNode(index);
    }
  }

  /** Đồng hồ animation đạn (không phụ thuộc frame rate màn hình). */
  update(deltaTime: number): void {
    this.elapsedMs += Math.max(0, deltaTime) * 1000;
  }

  /** Gọi mỗi frame **sau** `BulletPool.update()` để vị trí là vị trí cuối cùng. */
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

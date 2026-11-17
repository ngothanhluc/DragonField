/**
 * Vẽ đạn từ `BulletPool` bằng node sprite **pool sẵn** (không `new` mỗi phát).
 *
 * `core/combat/bullets.ts` đã lo vòng đời viên đạn (bay, hết ttl, thu hồi, pool đầy).
 * Ở đây chỉ đọc `pool.active()` mỗi frame rồi gán vị trí cho các node có sẵn: node thứ
 * i hiển thị viên thứ i. Không map theo `bullet.id` vì slot của pool đã tái dùng, nên
 * id không ổn định qua các frame — đúng như tài liệu của pool cảnh báo.
 *
 * FX chưa có schema trong `animations.json` (import-checklist §6.2), nên sheet phải
 * khai báo trực tiếp ở đây, không đi qua manifest. TODO(fx): thêm key FX vào manifest
 * rồi bỏ hai hằng sheet này.
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
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

/** Đạn player: `fx/shuriken`. Sheet 690×54 px; 690/15 = 46 ⇒ frame 46×54 (xem §3.4). */
export const PLAYER_BULLET_SHEET = 'resources/art/fx/shuriken/SpriteSheet.png';
/** Đạn enemy: `fx/energy-ball`, 64×16 = 4 frame 16×16 (chia hết, chắc chắn). */
export const ENEMY_BULLET_SHEET = 'resources/art/fx/energy-ball/EnergyBall.png';

const PLAYER_BULLET_RECT: TileRect = { x: 0, y: 0, width: 46, height: 54 };
const ENEMY_BULLET_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };

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
  readonly player: SpriteFrame;
  readonly enemy: SpriteFrame;
}

@ccclass('BulletView')
export class BulletView extends Component {
  private pool: BulletPool | null = null;
  private frames: BulletFrames | null = null;
  private readonly nodes: Node[] = [];
  private limit = MAX_BULLET_NODES;

  /** Load sẵn hai sheet đạn và **dựng sẵn toàn bộ node** — không cấp phát trong lúc chơi. */
  async init(pool: BulletPool): Promise<void> {
    this.pool = pool;
    this.limit = Math.max(1, Math.min(pool.capacity, MAX_BULLET_NODES));

    const [playerTexture, enemyTexture] = await Promise.all([
      loadTexture(PLAYER_BULLET_SHEET),
      loadTexture(ENEMY_BULLET_SHEET),
    ]);
    this.frames = {
      player: sliceFrame(playerTexture, PLAYER_BULLET_RECT),
      enemy: sliceFrame(enemyTexture, ENEMY_BULLET_RECT),
    };

    // Pool node dựng một lần ở đây: 8 enemy + 40 viên đạn không sinh node nào giữa run.
    for (let index = 0; index < this.limit; index += 1) {
      this.ensureNode(index);
    }
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

      const node = this.ensureNode(index);
      if (node === null) break;

      const frame = frames[frameKeyFor(bullet.owner)];
      const rect = bullet.owner === 'player' ? PLAYER_BULLET_RECT : ENEMY_BULLET_RECT;
      this.applyFrame(node, frame, rect, bullet.owner);
      this.applyPosition(node, bullet.position);
      node.active = true;
    }

    for (let index = drawn; index < this.nodes.length; index += 1) {
      const node: Node | undefined = this.nodes[index];
      if (node !== undefined && node.isValid) node.active = false;
    }
  }

  private ensureNode(index: number): Node | null {
    const existing: Node | undefined = this.nodes[index];
    if (existing !== undefined) {
      return existing.isValid ? existing : null;
    }
    if (this.nodes.length >= this.limit) return null;

    const node = new CocosNode(`bullet-${index}`);
    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    node.parent = this.node;
    node.active = false;

    this.nodes.push(node);
    return node;
  }

  private applyFrame(
    node: Node,
    frame: SpriteFrame,
    rect: TileRect,
    owner: BulletOwner,
  ): void {
    const sprite: Sprite | null = node.getComponent(CocosSprite);
    if (sprite === null) return;
    if (sprite.spriteFrame === frame) return;
    sprite.spriteFrame = frame;

    // Đạn enemy tint cam ấm: khác shuriken xanh của player và khác thân enemy.
    const tint: Color = owner === 'enemy' ? ENEMY_BULLET_TINT : BULLET_NO_TINT;
    sprite.color = tint;

    const transform = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(rect.width, rect.height);

    const scale = BULLET_DRAW_UNITS / Math.max(rect.width, rect.height);
    node.setScale(scale, scale, 1);
  }

  private applyPosition(node: Node, position: Vec2): void {
    const world = tileToWorld(position);
    node.setPosition(world.x, world.y, 0);
  }
}

function frameKeyFor(owner: BulletOwner): keyof BulletFrames {
  return owner === 'player' ? 'player' : 'enemy';
}

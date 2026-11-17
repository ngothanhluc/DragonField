/**
 * Flash vụ nổ (Explosive) — chỉ là hình, không có logic sát thương.
 *
 * Pool node dựng một lần (giống bullet view): một phòng hiếm khi có quá vài vụ
 * nổ cùng lúc, và vòng đời 0.25 s nên không cần cấp phát theo phát bắn.
 * Dùng lại vòng telegraph của pack làm hình nổ để không thêm asset pack.
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import type { Vec2 } from '../core/math/vec2';
import { loadTelegraphFrames } from './enemy-view';
import { tileToWorld } from './level-view';

type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof loadTelegraphFrames>>[number];

const POOL_SIZE = 12;
const LIFETIME_MS = 250;
const FRAME_SIZE_PX = 32;
const START_SCALE = 0.55;
const END_SCALE = 1.15;

interface Burst {
  readonly node: Node;
  readonly sprite: Sprite;
  frameIndex: number;
  ageMs: number;
  radiusTiles: number;
  active: boolean;
  readonly color: Color;
}

export class FxBurstPool {
  private readonly bursts: Burst[] = [];
  private frames: SpriteFrame[] = [];

  /** Khởi tạo pool dưới `parent` (actor layer, world unit). Không chặn frame đầu. */
  async init(parent: Node): Promise<void> {
    this.frames = await loadTelegraphFrames();
    for (let index = 0; index < POOL_SIZE; index += 1) {
      this.bursts.push(this.createBurst(parent, index));
    }
  }

  /** Nổ tại `position` (tile unit) với bán kính `radiusTiles`. */
  spawn(position: Vec2, radiusTiles: number): void {
    const burst = this.bursts.find((candidate) => !candidate.active) ?? this.bursts[0];
    if (burst === undefined) return;

    burst.active = true;
    burst.ageMs = 0;
    burst.frameIndex = 0;
    burst.radiusTiles = Math.max(0.2, radiusTiles);
    burst.node.active = true;
    const world = tileToWorld(position);
    burst.node.setPosition(world.x, world.y, 0);
    this.applyFrame(burst, 0);
    this.applyVisual(burst);
  }

  update(deltaMs: number): void {
    for (const burst of this.bursts) {
      if (!burst.active) continue;
      burst.ageMs += deltaMs;
      if (burst.ageMs >= LIFETIME_MS) {
        burst.active = false;
        burst.node.active = false;
        continue;
      }

      const progress = burst.ageMs / LIFETIME_MS;
      const frame = Math.min(this.frames.length - 1, Math.floor(progress * this.frames.length));
      if (frame !== burst.frameIndex) this.applyFrame(burst, frame);
      this.applyVisual(burst, progress);
    }
  }

  destroy(): void {
    for (const burst of this.bursts) {
      if (burst.node.isValid) burst.node.destroy();
    }
    this.bursts.length = 0;
  }

  private createBurst(parent: Node, index: number): Burst {
    const node = new CocosNode(`fx-burst-${index}`);
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(FRAME_SIZE_PX, FRAME_SIZE_PX);
    node.active = false;

    return {
      node,
      sprite,
      frameIndex: -1,
      ageMs: 0,
      radiusTiles: 1,
      active: false,
      color: new CocosColor(255, 190, 90, 255),
    };
  }

  private applyFrame(burst: Burst, index: number): void {
    const frame = this.frames[index];
    if (frame === undefined) return;
    burst.frameIndex = index;
    burst.sprite.spriteFrame = frame;
  }

  private applyVisual(burst: Burst, progress = 0): void {
    const scale = ((burst.radiusTiles * 2) / FRAME_SIZE_PX) * (START_SCALE + (END_SCALE - START_SCALE) * progress);
    burst.node.setScale(scale, scale, 1);
    burst.color.a = Math.round(230 * (1 - progress));
    burst.sprite.color = burst.color;
  }
}

/** Dựng pool dưới `actorLayer` (world unit); bootstrap chỉ cần một dòng. */
export async function createFxBurstPool(parent: Node): Promise<FxBurstPool> {
  const pool = new FxBurstPool();
  await pool.init(parent);
  return pool;
}

/**
 * Lớp "juice" phía UI: coin bay về ô vàng HUD và số damage bay lên.
 *
 * Cả hai sống dưới Canvas (UI camera) vì HUD không được rung/trôi theo camera
 * world; toạ độ tile của world được đổi sang pixel design ở đây (1 tile =
 * 16 × `hudScale` px — band world có thể nhỏ hơn band UI, xem `world-camera`).
 *
 * Không `new` node mỗi hit: coin và label dựng sẵn theo pool size trong
 * `feel.*` của `config/tuning.json`.
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  Layers,
} from 'cc';
import type { Label as CocosLabel } from 'cc';
import { loadAnimationManifest } from './anim/sprite-animator';
import { getFrame } from './assets/sprite-frame-cache';
import { resolve } from '../core/art/manifest';
import { FEEL_TUNING } from '../core/enemies/tuning';
import { coinFlyPosition } from '../core/feel/coin-fly';
import { damagePopupState, formatDamage } from '../core/feel/damage-number';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { createLabel } from './hud';

type Color = InstanceType<typeof CocosColor>;
type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

/**
 * Cỡ coin trước khi biết frame thật (init set lại theo `SpriteFrame.rect`).
 * Cảnh báo: `SpriteFrame.width/height` là cỡ **cả texture** (40×10 của sheet
 * Coin2), không phải cỡ frame đã cắt — dùng nhầm là coin bị kéo dài 4×.
 */
const COIN_FALLBACK_PX = 10;
const DAMAGE_COLOR = new CocosColor(255, 255, 255, 255);
const CRIT_COLOR = new CocosColor(255, 214, 90, 255);

export interface FeelViewOptions {
  /** Ô vàng HUD trong pixel design của canvas — coin bay về đây. */
  readonly goldAnchor: () => Vec2;
  /** Một coin vừa tới HUD; cộng đúng số tiền coin mang. */
  readonly onCoinArrive: (amount: number) => void;
}

interface CoinSlot {
  readonly node: Node;
  readonly sprite: Sprite;
  frames: readonly SpriteFrame[];
  fps: number;
  active: boolean;
  elapsedMs: number;
  delayMs: number;
  from: Vec2;
  to: Vec2;
  amount: number;
  frameIndex: number;
}

interface PopupSlot {
  readonly node: Node;
  readonly label: Label;
  readonly color: Color;
  active: boolean;
  elapsedMs: number;
  origin: Vec2;
  crit: boolean;
}

export class FeelView {
  /** Setting "Damage numbers" — tắt thì không spawn label nào. */
  damageNumbersEnabled = false;

  private readonly coinSlots: CoinSlot[] = [];
  private readonly popupSlots: PopupSlot[] = [];
  private coinFrames: readonly SpriteFrame[] = [];
  private coinFps = 10;
  private options: FeelViewOptions | null = null;
  /** Tỉ lệ world/UI hiện tại (camera báo mỗi lần viewport đổi). */
  private hudScale = 1;

  async init(parent: Node, options: FeelViewOptions): Promise<void> {
    this.options = options;
    const manifest = await loadAnimationManifest();
    const entry = resolve(manifest, 'fx.coin');
    this.coinFps = entry.fps;
    this.coinFrames = await Promise.all(
      Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
    );

    const coinLayer = this.createLayer(parent, 'coin-fly');
    const firstFrame = this.coinFrames[0];
    for (let index = 0; index < FEEL_TUNING.coin.poolSize; index += 1) {
      const slot = this.createCoinSlot(coinLayer, index);
      // `sizeMode = CUSTOM` lấy kích thước từ UITransform: phải set đúng cỡ **frame
      // đã cắt** (`frame.rect` 10×10), không phải `frame.width/height` (cỡ cả sheet
      // 40×10) và cũng không để default 100×100 — cả hai đều làm coin méo (AGENTS.md).
      const transform: UITransform | null = slot.node.getComponent(CocosUITransform);
      if (transform !== null && firstFrame !== undefined) {
        transform.setContentSize(firstFrame.rect.width, firstFrame.rect.height);
      }
      this.coinSlots.push(slot);
    }

    const popupLayer = this.createLayer(parent, 'damage-numbers');
    for (let index = 0; index < FEEL_TUNING.damageNumbers.poolSize; index += 1) {
      this.popupSlots.push(this.createPopupSlot(popupLayer, index));
    }
  }

  /** Camera đổi band → đổi tỉ lệ tile → pixel design. */
  setHudScale(scale: number): void {
    if (Number.isFinite(scale) && scale > 0) this.hudScale = scale;
  }

  /**
   * Vàng vừa nhận từ `fromTile`: vài coin bay theo vòng cung về ô vàng HUD.
   * Số vàng HUD chỉ cộng khi từng coin tới (tổng chia hết, coin cuối nhận lẻ).
   */
  flyGold(fromTile: Vec2, amount: number): void {
    const options = this.options;
    const total = Math.round(amount);
    if (options === null || total <= 0) return;

    const coins = Math.max(1, FEEL_TUNING.coin.coinsPerPickup);
    const from = this.toCanvas(fromTile);
    const to = options.goldAnchor();
    let remaining = total;

    for (let index = 0; index < coins; index += 1) {
      const share = index === coins - 1 ? remaining : Math.floor(total / coins);
      remaining -= share;

      const slot = this.takeCoinSlot();
      if (slot === null) {
        // Hết slot: cộng luôn để tổng vàng không bị mất (không có coin để bay).
        options.onCoinArrive(share);
        continue;
      }
      slot.active = true;
      slot.elapsedMs = 0;
      slot.delayMs = index * FEEL_TUNING.coin.staggerMs;
      slot.from = from;
      slot.to = to;
      slot.amount = Math.max(0, share);
      slot.frameIndex = 0;
      slot.frames = this.coinFrames;
      slot.fps = this.coinFps;
      slot.node.active = true;
      slot.node.setPosition(from.x, from.y, 0);
      slot.node.setScale(1, 1, 1);
      if (this.coinFrames.length > 0) slot.sprite.spriteFrame = this.coinFrames[0]!;
    }
  }

  /** Số damage bay lên tại `tile` — crit to hơn và vàng hơn. */
  spawnDamage(tile: Vec2, amount: number, crit: boolean): void {
    if (!this.damageNumbersEnabled) return;
    const slot = this.popupSlots.find((candidate) => !candidate.active);
    if (slot === undefined) return;

    slot.active = true;
    slot.elapsedMs = 0;
    slot.origin = this.toCanvas(tile);
    slot.crit = crit;
    slot.label.string = formatDamage(amount, crit);
    const tint = crit ? CRIT_COLOR : DAMAGE_COLOR;
    slot.color.r = tint.r;
    slot.color.g = tint.g;
    slot.color.b = tint.b;
    slot.color.a = 255;
    slot.label.color = slot.color;
    slot.node.active = true;
    slot.node.setPosition(slot.origin.x, slot.origin.y, 0);
    slot.node.setScale(1, 1, 1);
  }

  update(deltaMs: number): void {
    const step = Math.max(0, deltaMs);
    this.updateCoins(step);
    this.updatePopups(step);
  }

  destroy(): void {
    for (const slot of this.coinSlots) if (slot.node.isValid) slot.node.destroy();
    for (const slot of this.popupSlots) if (slot.node.isValid) slot.node.destroy();
    this.coinSlots.length = 0;
    this.popupSlots.length = 0;
    this.coinFrames = [];
    this.options = null;
  }

  private updateCoins(deltaMs: number): void {
    const options = this.options;
    if (options === null) return;

    for (const slot of this.coinSlots) {
      if (!slot.active) continue;
      slot.elapsedMs += deltaMs;
      const flying = slot.elapsedMs - slot.delayMs;
      if (flying < 0) {
        slot.node.active = false;
        continue;
      }
      slot.node.active = true;

      const duration = Math.max(1, FEEL_TUNING.coin.durationMs);
      const t = Math.min(1, flying / duration);
      const position = coinFlyPosition(
        slot.from,
        slot.to,
        t,
        FEEL_TUNING.coin.arcHeightTiles * TILE_SIZE_PX * this.hudScale,
      );
      slot.node.setPosition(position.x, position.y, 0);
      // Cung nhô lên nên coin "sáng" dần rồi tắt đúng lúc vào ô vàng.
      slot.node.setScale(1, 1, 1);

      if (slot.frames.length > 0) {
        const index = Math.floor((flying * slot.fps) / 1000) % slot.frames.length;
        if (index !== slot.frameIndex) {
          slot.frameIndex = index;
          const frame = slot.frames[index];
          if (frame !== undefined) slot.sprite.spriteFrame = frame;
        }
      }

      if (t >= 1) {
        slot.active = false;
        slot.node.active = false;
        options.onCoinArrive(slot.amount);
      }
    }
  }

  private updatePopups(deltaMs: number): void {
    for (const slot of this.popupSlots) {
      if (!slot.active) continue;
      slot.elapsedMs += deltaMs;
      const state = damagePopupState(slot.elapsedMs, {
        lifetimeMs: FEEL_TUNING.damageNumbers.lifetimeMs,
        riseTiles: FEEL_TUNING.damageNumbers.riseTiles,
        crit: slot.crit,
      });

      slot.node.setPosition(
        slot.origin.x,
        slot.origin.y + state.rise * TILE_SIZE_PX * this.hudScale,
        0,
      );
      slot.node.setScale(state.scale, state.scale, 1);
      slot.color.a = Math.round(Math.max(0, Math.min(1, state.alpha)) * 255);
      slot.label.color = slot.color;

      if (state.alpha <= 0) {
        slot.active = false;
        slot.node.active = false;
      }
    }
  }

  private takeCoinSlot(): CoinSlot | null {
    const slot = this.coinSlots.find((candidate) => !candidate.active);
    return slot ?? null;
  }

  private createLayer(parent: Node, name: string): Node {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = parent;
    return node;
  }

  private createCoinSlot(parent: Node, index: number): CoinSlot {
    const node = new CocosNode(`coin-${index}`);
    node.layer = Layers.Enum.UI_2D;
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(COIN_FALLBACK_PX, COIN_FALLBACK_PX);

    node.active = false;
    return {
      node,
      sprite,
      frames: [],
      fps: 10,
      active: false,
      elapsedMs: 0,
      delayMs: 0,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      amount: 0,
      frameIndex: 0,
    };
  }

  private createPopupSlot(parent: Node, index: number): PopupSlot {
    const label = createLabel(parent, `damage-${index}`, '');
    label.fontSize = 10;
    label.lineHeight = 12;
    const node = label.node;
    node.active = false;
    return {
      node,
      label,
      color: new CocosColor(255, 255, 255, 255),
      active: false,
      elapsedMs: 0,
      origin: { x: 0, y: 0 },
      crit: false,
    };
  }

  /** Tile của `LevelData` (y hướng xuống) → pixel design của canvas UI. */
  private toCanvas(tile: Vec2): Vec2 {
    const tilePx = TILE_SIZE_PX * this.hudScale;
    return {
      x: (tile.x - ROOM_COLS / 2) * tilePx,
      y: (ROOM_ROWS / 2 - tile.y) * tilePx,
    };
  }
}

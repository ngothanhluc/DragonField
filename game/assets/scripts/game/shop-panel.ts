/**
 * Mid-run shop panel (#40): the three offers of a shop room, priced in **meta gold**.
 *
 * Reuses the skill-pick card look (`sliceSliced` + `createLabel` + the same card size) so the
 * shop reads as the same UI. Rules (price, purchase, save write) stay in `core/run/special-rooms`
 * and bootstrap; this file only draws and reports a click/key.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Layers,
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
  view,
} from 'cc';
import { describeSkill } from '../core/skills/description';
import { getSkill } from '../core/skills/pool';
import type { SkillDef } from '../core/skills/pool';
import type { ShopOffer } from '../core/run/special-rooms';
import { loadPixelTexture } from './assets/texture-cache';
import { loadSkillCardIcon, SKILL_ICON_SIZE_PX } from './assets/skill-icon';
import { playSfx } from './audio/sfx';
import { createBackdropPanel, createLabel, RARITY_COLORS } from './hud';
import { sliceSliced } from './screens/menu';
import type { TileRect } from './level-view';

/** `cc` is an any module: import names only work in value position. */
type Button = InstanceType<typeof CocosButton>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Same panel frame the pick cards use: the inner square of theme-wood would double-frame. */
const CARD_SHEET = 'resources/art/ui/theme-wood/nine_path_panel_interior.png';
const CARD_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };
const CARD_BORDERS = { left: 4, right: 4, top: 4, bottom: 4 } as const;
const CARD_WIDTH = 140;
const CARD_HEIGHT = 150;
const CARD_GAP = 12;
const CARD_Y = -12;
const CARD_ICON_SCALE = 2;
const CARD_ICON_SIZE = SKILL_ICON_SIZE_PX * CARD_ICON_SCALE;

/** One heart from the pack's 5-frame Heart.png. */
const HEART_SHEET = 'resources/art/ui/Heart.png';
const HEART_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };

const TITLE_COLOR = new CocosColor(255, 230, 120, 255);
const TEXT_COLOR = new CocosColor(238, 238, 238, 255);
const MUTED_COLOR = new CocosColor(170, 170, 170, 255);
const PRICE_COLOR = new CocosColor(255, 214, 90, 255);
const DENIED_COLOR = new CocosColor(255, 110, 110, 255);
const CARD_TINT = new CocosColor(150, 110, 90, 255);

export interface ShopBuyResult {
  readonly ok: boolean;
  /** Meta gold after the attempt (unchanged on failure). */
  readonly gold: number;
  /** Why the purchase was refused; `null` when it went through. */
  readonly message: string | null;
}

export interface ShopPanelOptions {
  readonly parent: Node;
  readonly offers: readonly ShopOffer[];
  /** Current skill stacks, for the icon's Disabled variant. */
  readonly owned: ReadonlyMap<string, number>;
  /** Meta gold when the panel opens. */
  readonly gold: number;
  /** Run one purchase; a success closes the shop and leaves the room. */
  readonly onBuy: (index: number) => ShopBuyResult;
  /** Leave the shop (Esc / the leave card); bootstrap opens the exit door. */
  readonly onClose: () => void;
}

export interface ShopPanel {
  readonly node: Node;
  destroy(): void;
}

/** Build the shop panel under `parent` (the UI canvas). */
export async function buildShopPanel(options: ShopPanelOptions): Promise<ShopPanel> {
  // Keys are wired **before** the card texture loads: the player may hit 1/2/3 or Esc on the
  // opening frame (AGENTS: a listener attached after an await loses that press).
  let closed = false;
  let busy = false;
  let gold = options.gold;
  let rootNode: Node | null = null;
  const messageHolder: { label: ReturnType<typeof createLabel> | null } = { label: null };
  const goldHolder: { label: ReturnType<typeof createLabel> | null } = { label: null };
  let pendingMessage: string | null = null;
  const setMessage = (text: string): void => {
    pendingMessage = text;
    if (messageHolder.label !== null) messageHolder.label.string = text;
  };
  const setGold = (value: number): void => {
    if (goldHolder.label !== null) goldHolder.label.string = `Gold ${value}`;
  };

  const detach = (): void => {
    document.removeEventListener('keydown', onKey, true);
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    detach();
    if (rootNode !== null && rootNode.isValid) rootNode.destroy();
    options.onClose();
  };
  const buy = (index: number): void => {
    if (closed || busy) return;
    if (index < 0 || index >= options.offers.length) return;
    busy = true;
    const result = options.onBuy(index);
    gold = result.gold;
    if (result.ok) {
      playSfx('skill-acquired');
      close();
      return;
    }
    busy = false;
    playSfx('ui-move');
    setMessage(result.message ?? 'Not enough gold');
    setGold(gold);
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.keyCode === 27) {
      event.preventDefault();
      close();
      return;
    }
    const digit = /^Digit([1-3])$/.exec(event.code) ?? /^([1-3])$/.exec(event.key);
    if (digit !== null) {
      event.preventDefault();
      buy(Number(digit[1]) - 1);
    }
  }
  document.addEventListener('keydown', onKey, true);

  let texture;
  try {
    texture = await loadPixelTexture(CARD_SHEET);
  } catch (error: unknown) {
    detach();
    throw error;
  }
  const frame: SpriteFrame = sliceSliced(texture, CARD_RECT, CARD_BORDERS);

  const root = new CocosNode('shop-panel');
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;
  rootNode = root;

  addDim(root);

  const title = createLabel(root, 'shop-title', 'SHOP');
  title.fontSize = 20;
  title.lineHeight = 24;
  title.color = TITLE_COLOR;
  title.node.setPosition(0, 112, 0);

  const hint = createLabel(root, 'shop-hint', 'Click a card, press 1 / 2 / 3, or Esc to leave');
  hint.fontSize = 10;
  hint.color = MUTED_COLOR;
  hint.node.setPosition(0, 92, 0);

  const goldLabel = createLabel(root, 'shop-gold', `Gold ${gold}`);
  goldLabel.fontSize = 12;
  goldLabel.color = PRICE_COLOR;
  goldLabel.node.setPosition(-182, 112, 0);
  goldHolder.label = goldLabel;

  const message = createLabel(root, 'shop-message', pendingMessage ?? '');
  message.fontSize = 12;
  message.color = DENIED_COLOR;
  message.node.setPosition(0, -104, 0);
  messageHolder.label = message;

  const count = options.offers.length;
  const rowWidth = count * CARD_WIDTH + Math.max(0, count - 1) * CARD_GAP;
  const firstX = -rowWidth / 2 + CARD_WIDTH / 2;

  options.offers.forEach((offer, index) => {
    makeCard(
      root,
      frame,
      offer,
      options.owned,
      index + 1,
      firstX + index * (CARD_WIDTH + CARD_GAP),
      () => buy(index),
    );
  });

  if (closed) {
    // Esc pressed while the texture was loading: do not leave a panel behind.
    root.destroy();
  }

  return {
    node: root,
    destroy(): void {
      closed = true;
      detach();
      if (root.isValid) root.destroy();
    },
  };
}

function addDim(parent: Node): void {
  // Graphics, not a stretched button frame: transparent corners would leave see-through holes.
  const size = view.getVisibleSize();
  createBackdropPanel(parent, 'shop-dim', size.width, size.height, 210);
}

function makeCard(
  parent: Node,
  frame: SpriteFrame,
  offer: ShopOffer,
  owned: ReadonlyMap<string, number>,
  hotkey: number,
  x: number,
  onPick: () => void,
): Node {
  const node = new CocosNode(`shop-card-${offer.item}`);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(x, CARD_Y, 0);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;
  sprite.color = CARD_TINT;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(CARD_WIDTH, CARD_HEIGHT);

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;
  node.on(CocosButton.EventType.CLICK, onPick);

  const key = createLabel(node, 'hotkey', String(hotkey));
  key.fontSize = 10;
  key.color = MUTED_COLOR;
  key.node.setPosition(-CARD_WIDTH / 2 + 10, CARD_HEIGHT / 2 - 10, 0);

  const skill = offer.item === 'heart-refill' ? null : safeSkill(offer.item);
  const icon = new CocosNode('icon');
  icon.layer = Layers.Enum.UI_2D;
  icon.parent = node;
  const iconSprite: Sprite = icon.addComponent(CocosSprite);
  iconSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  iconSprite.trim = false;
  const iconTransform: UITransform | null = icon.getComponent(CocosUITransform);
  if (iconTransform !== null) iconTransform.setContentSize(CARD_ICON_SIZE, CARD_ICON_SIZE);
  icon.setPosition(0, CARD_HEIGHT / 2 - 12 - CARD_ICON_SIZE / 2, 0);

  if (skill === null) {
    loadHeartIcon().then((heart) => {
      if (icon.isValid) iconSprite.spriteFrame = heart;
    }).catch(() => undefined);
  } else {
    void loadSkillCardIcon(skill, owned.get(skill.id) ?? 0)
      .then((iconFrame) => {
        if (icon.isValid) iconSprite.spriteFrame = iconFrame;
      })
      .catch(() => undefined);
  }

  const nameText = skill === null ? 'Heart Refill' : skill.name;
  const name = createLabel(node, 'name', nameText);
  name.fontSize = 13;
  name.lineHeight = 15;
  name.color = TEXT_COLOR;
  name.node.setPosition(0, 6, 0);

  const kind = createLabel(
    node,
    'kind',
    skill === null ? 'RESTORE' : skill.rarity.toUpperCase(),
  );
  kind.fontSize = 9;
  kind.color = skill === null ? new CocosColor(255, 130, 150, 255) : RARITY_COLORS[skill.rarity];
  kind.node.setPosition(0, -6, 0);

  const effect = createLabel(
    node,
    'effect',
    skill === null ? 'Restore all hearts' : describeSkill(skill),
  );
  effect.fontSize = 9;
  effect.lineHeight = 11;
  effect.color = TEXT_COLOR;
  effect.enableWrapText = true;
  const effectTransform: UITransform | null = effect.node.getComponent(CocosUITransform);
  if (effectTransform !== null) effectTransform.setContentSize(CARD_WIDTH - 16, 38);
  effect.node.setPosition(0, -32, 0);
  effect.updateRenderData?.(true);

  const price = createLabel(node, 'price', `${offer.price} GOLD`);
  price.fontSize = 10;
  price.color = PRICE_COLOR;
  price.node.setPosition(0, -CARD_HEIGHT / 2 + 12, 0);

  return node;
}

/** `getSkill` throws for an unknown id; a stale offer must not crash the shop. */
function safeSkill(id: string): SkillDef | null {
  try {
    return getSkill(id);
  } catch {
    return null;
  }
}

const heartFrame = new Map<string, Promise<SpriteFrame>>();

/** First 16×16 heart of `Heart.png`, cached like the skill icons. */
function loadHeartIcon(): Promise<SpriteFrame> {
  const cached = heartFrame.get(HEART_SHEET);
  if (cached !== undefined) return cached;

  const task = loadPixelTexture(HEART_SHEET).then((texture) => {
    const frame = new CocosSpriteFrame();
    frame.texture = texture;
    frame.rect = new Rect(HEART_RECT.x, HEART_RECT.y, HEART_RECT.width, HEART_RECT.height);
    frame.originalSize = new Size(HEART_RECT.width, HEART_RECT.height);
    frame.offset = new EngineVec2(0, 0);
    frame.packable = false;
    return frame;
  });
  heartFrame.set(HEART_SHEET, task);
  task.catch(() => {
    if (heartFrame.get(HEART_SHEET) === task) heartFrame.delete(HEART_SHEET);
  });
  return task;
}

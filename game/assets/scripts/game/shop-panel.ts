/**
 * Mid-run shop panel (#40): the three offers of a shop room, priced in gold (the save's gold
 * plus the gold earned this run — the same total the HUD shows).
 *
 * Reuses the skill-pick card look (`sliceSliced` + `createLabel` + the same card size) so the
 * shop reads as the same UI. Rules (price, purchase, save write) stay in `core/run/special-rooms`
 * and bootstrap; this file only draws and reports a click/key.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Graphics as CocosGraphics,
  Layers,
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  Tween,
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
  tween,
  view,
} from 'cc';
import { localizeRarity, localizeSkillName, t } from '../core/i18n';
import { describeSkill } from '../core/skills/description';
import { getSkill, type BaseSkillDef } from '../core/skills/pool';
import type { ShopOffer } from '../core/run/special-rooms';
import {
  nextShopFocus,
  shopOfferState,
  type ShopFocusInput,
  type ShopFocusStep,
  type ShopOfferState,
} from '../core/run/shop-focus';
import { loadPixelTexture } from './assets/texture-cache';
import { loadSkillCardIcon, SKILL_ICON_SIZE_PX } from './assets/skill-icon';
import { playSfx } from './audio/sfx';
import { createBackdropPanel, createLabel, RARITY_COLORS } from './hud';
import { MENU_FOCUS_COLOR, sliceSliced } from './screens/menu';
import type { TileRect } from './level-view';

/** `cc` is an any module: import names only work in value position. */
type Button = InstanceType<typeof CocosButton>;
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
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

/** Staged M17 Health Potion icon (16×16) for the mid-run shop HP refill card. */
const HEART_SHEET = 'resources/art/generated/fx/health-potion.png';
const HEART_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };

const TITLE_COLOR = new CocosColor(255, 230, 120, 255);
const TEXT_COLOR = new CocosColor(238, 238, 238, 255);
const MUTED_COLOR = new CocosColor(170, 170, 170, 255);
const PRICE_COLOR = new CocosColor(255, 214, 90, 255);
const DENIED_COLOR = new CocosColor(255, 110, 110, 255);
const CARD_TINT = new CocosColor(150, 110, 90, 255);

/** Hover/focus feedback (#65): same ring look as the menu, eased in and out. */
const CARD_FOCUS_SCALE = 1.05;
const FOCUS_TWEEN_SECONDS = 0.1;
/** Brighter than `CARD_TINT` so the highlighted card pops without changing the art. */
const CARD_FOCUS_TINT = new CocosColor(196, 152, 124, 255);
/** Dimmed card (unaffordable/maxed): darker than the rest, with a grey ring. */
const CARD_DIM_TINT = new CocosColor(104, 78, 64, 255);
const DIM_RING_COLOR = new CocosColor(128, 128, 128, 255);
/** Reason line sits just under the row of cards, above the shop message. */
const REASON_Y = CARD_Y - CARD_HEIGHT / 2 - 12;

export interface ShopBuyResult {
  readonly ok: boolean;
  /** Shop total (save gold + this run's gold) after the attempt; unchanged on failure. */
  readonly gold: number;
  /** Why the purchase was refused; `null` when it went through. */
  readonly message: string | null;
}

export interface ShopPanelOptions {
  readonly parent: Node;
  readonly offers: readonly ShopOffer[];
  /** Current skill stacks, for the icon's Disabled variant. */
  readonly owned: ReadonlyMap<string, number>;
  /** Gold when the panel opens: save gold + this run's gold (the HUD total). */
  readonly gold: number;
  /** Run one purchase; a success closes the shop and leaves the room. */
  readonly onBuy: (index: number) => ShopBuyResult;
  /** Leave the shop (Esc / the leave card); bootstrap opens the exit door. */
  readonly onClose: () => void;
  /** Optional Ascension shop price multiplier (M15); when > 1 displays compact surcharge cue. */
  readonly priceMultiplier?: number;
}

export interface ShopPanel {
  readonly node: Node;
  destroy(): void;
}

/** One offer card: its node (for hover listeners) and the highlight it should show. */
interface ShopCard {
  readonly node: Node;
  /** The buy highlight or the dimmed one with its reason; `null` clears the highlight. */
  setHighlight(state: ShopOfferState | null): void;
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
  const reasonHolder: { label: ReturnType<typeof createLabel> | null } = { label: null };
  let pendingMessage: string | null = null;
  const setMessage = (text: string): void => {
    pendingMessage = text;
    if (messageHolder.label !== null) messageHolder.label.string = text;
  };
  const setGold = (value: number): void => {
    if (goldHolder.label !== null) goldHolder.label.string = t('hud.gold', { gold: value });
  };

  // One highlight shared by mouse and keyboard (`core/run/shop-focus` decides it). Nothing is
  // highlighted when the shop opens.
  const cards: ShopCard[] = [];
  let focusedIndex: number | null = null;
  let firstX = 0;
  const stateOf = (index: number): ShopOfferState | null => {
    const offer = options.offers[index];
    return offer === undefined ? null : shopOfferState(offer, gold, options.owned);
  };
  const renderFocus = (): void => {
    cards.forEach((card, index) => {
      card.setHighlight(index === focusedIndex ? stateOf(index) : null);
    });
    const reason = reasonHolder.label;
    if (reason === null) return;
    const state = focusedIndex === null ? null : stateOf(focusedIndex);
    const dimmed = state !== null && state.kind !== 'buy';
    reason.string = dimmed ? (state.reason ?? '') : '';
    if (dimmed && focusedIndex !== null) {
      reason.node.setPosition(firstX + focusedIndex * (CARD_WIDTH + CARD_GAP), REASON_Y, 0);
    }
  };
  const applyFocus = (step: ShopFocusStep): void => {
    // Soft tick only when the highlight lands on another offer, not when it clears or repeats.
    if (step.playMove) playSfx('ui-move');
    focusedIndex = step.index;
    renderFocus();
  };
  const moveFocus = (input: ShopFocusInput): void => {
    applyFocus(nextShopFocus(focusedIndex, input, options.offers.length));
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
    setMessage(result.message ?? t('runShop.notEnoughGold'));
    setGold(gold);
    // The refusal may have been about gold: dim the card the player is on right away.
    renderFocus();
  };
  function onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key === 'Escape' || event.keyCode === 27) {
      event.preventDefault();
      close();
      return;
    }
    const digit = /^Digit([1-3])$/.exec(event.code) ?? /^([1-3])$/.exec(event.key);
    if (digit !== null) {
      event.preventDefault();
      const index = Number(digit[1]) - 1;
      // 1/2/3 keep buying directly: highlight the offer they buy, then try it.
      moveFocus({ kind: 'hotkey', index });
      buy(index);
      return;
    }
    const key = event.key;
    const code = event.keyCode;
    const left = key === 'ArrowLeft' || code === 37;
    const right = key === 'ArrowRight' || code === 39;
    const up = key === 'ArrowUp' || code === 38;
    const down = key === 'ArrowDown' || code === 40;
    if (left || right || up || down) {
      event.preventDefault();
      moveFocus({ kind: 'move', delta: left || up ? -1 : 1 });
      return;
    }
    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      if (focusedIndex !== null) buy(focusedIndex);
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

  const surchargePct =
    options.priceMultiplier !== undefined &&
    Number.isFinite(options.priceMultiplier) &&
    options.priceMultiplier > 1
      ? Math.round((options.priceMultiplier - 1) * 100)
      : 0;
  const titleText =
    surchargePct > 0 ? t('runShop.titleSurcharge', { pct: surchargePct }) : t('runShop.title');
  const title = createLabel(root, 'shop-title', titleText);
  title.fontSize = 20;
  title.lineHeight = 25;
  title.color = TITLE_COLOR;
  title.node.setPosition(0, 112, 0);

  const hint = createLabel(root, 'shop-hint', t('runShop.hint'));
  hint.fontSize = 10;
  hint.lineHeight = 14;
  hint.color = MUTED_COLOR;
  hint.node.setPosition(0, 92, 0);

  const goldLabel = createLabel(root, 'shop-gold', t('hud.gold', { gold }));
  goldLabel.fontSize = 12;
  goldLabel.lineHeight = 16;
  goldLabel.color = PRICE_COLOR;
  goldLabel.node.setPosition(-182, 112, 0);
  goldHolder.label = goldLabel;

  // Mouse exit: in fullscreen the browser eats Esc, so Esc must never be the only way out
  // (AGENTS.md trap). A player with 0 gold can always leave through this button.
  const leave = createBackdropPanel(root, 'shop-leave', 84, 26, 150);
  leave.setPosition(186, 112, 0);
  const leaveTransform: UITransform =
    leave.getComponent(CocosUITransform) ?? leave.addComponent(CocosUITransform);
  leaveTransform.setContentSize(84, 26);
  const leaveButton: Button = leave.addComponent(CocosButton);
  leaveButton.transition = CocosButton.Transition.NONE;
  leave.on(CocosButton.EventType.CLICK, () => {
    playSfx('ui-move');
    close();
  });
  const leaveLabel = createLabel(leave, 'shop-leave-label', t('runShop.leave'));
  leaveLabel.fontSize = 11;
  leaveLabel.lineHeight = 15;
  leaveLabel.color = TEXT_COLOR;
  leaveLabel.node.setPosition(0, 0, 0);

  const message = createLabel(root, 'shop-message', pendingMessage ?? '');
  message.fontSize = 12;
  message.lineHeight = 16;
  message.color = DENIED_COLOR;
  message.node.setPosition(0, -116, 0);
  messageHolder.label = message;

  // Why a dimmed card cannot be bought; follows the highlighted card, blank when it can buy.
  const reason = createLabel(root, 'shop-reason', '');
  reason.fontSize = 9;
  reason.lineHeight = 13;
  reason.color = DENIED_COLOR;
  reason.node.setPosition(0, REASON_Y, 0);
  reasonHolder.label = reason;

  const count = options.offers.length;
  const rowWidth = count * CARD_WIDTH + Math.max(0, count - 1) * CARD_GAP;
  firstX = -rowWidth / 2 + CARD_WIDTH / 2;

  options.offers.forEach((offer, index) => {
    const card = makeCard(
      root,
      frame,
      offer,
      options.owned,
      index + 1,
      firstX + index * (CARD_WIDTH + CARD_GAP),
      () => buy(index),
    );
    // Mouse and keyboard share the one highlight: entering a card focuses it, leaving clears it.
    card.node.on(CocosNode.EventType.MOUSE_ENTER, () => moveFocus({ kind: 'hover', index }));
    card.node.on(CocosNode.EventType.MOUSE_LEAVE, () => moveFocus({ kind: 'unhover', index }));
    cards.push(card);
  });
  // A key pressed during the texture load already moved the highlight: draw it now.
  renderFocus();

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
): ShopCard {
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

  // Same ring look as the menu (`createFocusRing`): 2 px, 2 px outside the card.
  const ring = new CocosNode('focus-ring');
  ring.layer = Layers.Enum.UI_2D;
  ring.parent = node;
  const graphics: Graphics = ring.addComponent(CocosGraphics);
  const drawRing = (color: Color): void => {
    graphics.clear();
    graphics.lineWidth = 2;
    graphics.strokeColor = color;
    graphics.rect(-CARD_WIDTH / 2 - 2, -CARD_HEIGHT / 2 - 2, CARD_WIDTH + 4, CARD_HEIGHT + 4);
    graphics.stroke();
  };
  ring.active = false;

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

  const nameText =
    skill === null ? t('runShop.heartRefill') : localizeSkillName(skill.id, skill.name);
  const name = createLabel(node, 'name', nameText);
  name.fontSize = 13;
  name.lineHeight = 17;
  name.color = TEXT_COLOR;
  name.node.setPosition(0, 6, 0);

  const kind = createLabel(
    node,
    'kind',
    skill === null ? t('runShop.restoreKind') : localizeRarity(skill.rarity),
  );
  kind.fontSize = 9;
  kind.lineHeight = 13;
  kind.color = skill === null ? new CocosColor(255, 130, 150, 255) : RARITY_COLORS[skill.rarity];
  kind.node.setPosition(0, -6, 0);

  const effect = createLabel(
    node,
    'effect',
    skill === null ? t('runShop.restoreEffect') : describeSkill(skill),
  );
  effect.fontSize = 9;
  effect.lineHeight = 13;
  effect.color = TEXT_COLOR;
  effect.enableWrapText = true;
  const effectTransform: UITransform | null = effect.node.getComponent(CocosUITransform);
  if (effectTransform !== null) effectTransform.setContentSize(CARD_WIDTH - 16, 40);
  effect.node.setPosition(0, -32, 0);
  effect.updateRenderData?.(true);

  const price = createLabel(node, 'price', t('runShop.price', { price: offer.price }));
  price.fontSize = 10;
  price.lineHeight = 14;
  price.color = PRICE_COLOR;
  price.node.setPosition(0, -CARD_HEIGHT / 2 + 12, 0);

  // Highlight feedback (`game-feel`: small tier — eased scale + tint, no shake). One tween drives
  // both properties from wherever the card is now, so a fast hover in/out retargets smoothly.
  const tint = new CocosColor(CARD_TINT.r, CARD_TINT.g, CARD_TINT.b, CARD_TINT.a);
  const fromTint = new CocosColor(CARD_TINT.r, CARD_TINT.g, CARD_TINT.b, CARD_TINT.a);
  const toTint = new CocosColor(CARD_TINT.r, CARD_TINT.g, CARD_TINT.b, CARD_TINT.a);
  const progress = { t: 1 };
  let fromScale = 1;
  let toScale = 1;
  const applyTween = (): void => {
    if (!node.isValid) {
      Tween.stopAllByTarget(progress);
      return;
    }
    const t = progress.t;
    const scale = fromScale + (toScale - fromScale) * t;
    node.setScale(scale, scale, 1);
    tint.r = Math.round(fromTint.r + (toTint.r - fromTint.r) * t);
    tint.g = Math.round(fromTint.g + (toTint.g - fromTint.g) * t);
    tint.b = Math.round(fromTint.b + (toTint.b - fromTint.b) * t);
    sprite.color = tint;
  };
  const easeTo = (scale: number, target: Color): void => {
    fromScale = node.scale.x;
    fromTint.set(tint);
    toScale = scale;
    toTint.set(target);
    Tween.stopAllByTarget(progress);
    progress.t = 0;
    tween(progress)
      .to(FOCUS_TWEEN_SECONDS, { t: 1 }, { easing: 'quadOut', onUpdate: applyTween })
      .start();
  };

  let shown = 'none';
  const setHighlight = (state: ShopOfferState | null): void => {
    const kind = state === null ? 'none' : state.kind;
    if (kind === shown) return;
    shown = kind;
    ring.active = state !== null;
    if (state !== null) drawRing(state.kind === 'buy' ? MENU_FOCUS_COLOR : DIM_RING_COLOR);
    // An offer the player cannot buy is dimmed and stays at rest: no scale-up.
    easeTo(
      state?.kind === 'buy' ? CARD_FOCUS_SCALE : 1,
      state?.kind === 'buy'
        ? CARD_FOCUS_TINT
        : state === null
          ? CARD_TINT
          : CARD_DIM_TINT,
    );
  };

  return { node, setHighlight };
}

/** `getSkill` throws for an unknown id; a stale offer must not crash the shop. */
function safeSkill(id: string): BaseSkillDef | null {
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

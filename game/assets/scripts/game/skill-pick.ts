/**
 * The 1-of-3 skill picker shown after a room is cleared (GDD §6, §9).
 *
 * Built 100% in code, no scene/prefab edits. Each card uses layered `Theme Wood` 9-slice framing
 * (`nine_path_bg_2` pixel drop shadow + carved wooden outer rim + `nine_path_panel_interior`
 * dark mahogany well + recessed icon pedestal + `nine_path_focus` 9-slice focus ring) and can be
 * picked with **a mouse click, arrows + Enter/Space, or keys 1 / 2 / 3**.
 *
 * Key listeners attach **before** any `await` (`AGENTS.md` trap) so a player pressing 1/2/3 on
 * the opening frame never loses the input.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Graphics as CocosGraphics,
  Input,
  KeyCode,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  input,
  view,
} from 'cc';
import { describeSkill } from '../core/skills/description';
import { evolutionHintsForSkill } from '../core/skills/evolutions';
import { getSkill, type Rarity, type SkillDef } from '../core/skills/pool';
import {
  PANEL_SHADOW_EXPAND_PX,
  PANEL_WELL_INSET_PX,
  computeSkillCardLayout,
  type SkillCardLayout,
} from '../core/view/menu-layout';
import { loadSkillCardIcon } from './assets/skill-icon';
import { playSfx } from './audio/sfx';
import { createBackdropPanel, createLabel, RARITY_COLORS } from './hud';
import {
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  PANEL_RIM_TINT,
  PANEL_SHADOW_TINT,
  PANEL_WELL_TINT,
  addSlicedSpriteNode,
  createFocusFrame,
  createMenuButton,
  loadMenuFrames,
  type MenuButtonHandle,
  type MenuFrames,
} from './screens/menu';

/** `cc` is an any module: import names only work in value position. */
type Button = InstanceType<typeof CocosButton>;
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

const CARD_RIM_FOCUS_TINT = new CocosColor(255, 244, 224, 255);
const CARD_RIM_HOVER_TINT = new CocosColor(255, 255, 255, 255);
const CARD_RIM_PRESSED_TINT = new CocosColor(240, 218, 198, 255);
const LEGENDARY_GOLD_COLOR = new CocosColor(255, 214, 72, 255);
const LEGENDARY_RIM_TINT = new CocosColor(255, 216, 92, 255);
const LEGENDARY_RIM_FOCUS_TINT = new CocosColor(255, 232, 134, 255);
const LEGENDARY_RIM_HOVER_TINT = new CocosColor(255, 242, 168, 255);
const LEGENDARY_RIM_PRESSED_TINT = new CocosColor(240, 194, 72, 255);
const LEGENDARY_WELL_TINT = new CocosColor(64, 48, 24, 255);
const PAIR_HINT_MUTED_COLOR = new CocosColor(196, 184, 156, 255);
const PAIR_HINT_READY_COLOR = new CocosColor(255, 214, 72, 255);
const ICON_SLOT_TINT = new CocosColor(255, 255, 255, 240);
const HOTKEY_COLOR = new CocosColor(232, 210, 168, 255);

function rarityColorFor(rarity: Rarity): Color {
  return rarity === 'legendary' ? LEGENDARY_GOLD_COLOR : RARITY_COLORS[rarity];
}

const HOTKEY_CODES = [KeyCode.KEY_1, KeyCode.KEY_2, KeyCode.KEY_3] as const;

export interface SkillPickRerollOptions {
  readonly cost: number;
  readonly availableGold: number;
  readonly hasAlternatives: boolean;
  readonly onReroll: () => boolean;
}

export interface SkillPickOptions {
  readonly choices: readonly SkillDef[];
  /** Current stacks by id. */
  readonly owned: ReadonlyMap<string, number>;
  readonly onPick: (index: number) => void;
  /** Optional Gold Reroll control below the 3 cards (level-up modal, ADR-021). */
  readonly reroll?: SkillPickRerollOptions;
}

/** Built screen; call `destroy()` after picking or when leaving the run. */
export interface SkillPickScreen {
  readonly node: Node;
  destroy(): void;
}

interface KeyEvent {
  readonly keyCode: number;
}

interface SkillCardHandle {
  readonly node: Node;
  setState(focused: boolean, hovered: boolean, pressed: boolean): void;
}

/**
 * Build the picker under `parent` (the UI canvas node). Resolves quickly; pixel textures load
 * asynchronously through the shared menu cache.
 */
export async function buildSkillPick(
  parent: Node,
  options: SkillPickOptions,
): Promise<SkillPickScreen> {
  // Listen for keys **before** loading textures: the player may hit 1/2/3/R on the very frame
  // status becomes 'skill-pick', before assets resolve.
  let picked = false;
  let rerolling = false;
  let destroyed = false;
  let focused = 0;
  let hoveredIndex: number | null = null;
  let pressedIndex: number | null = null;
  let rerollFocused = false;
  let rerollHovered = false;
  let rerollPressed = false;
  const cards: SkillCardHandle[] = [];
  let rerollHandle: MenuButtonHandle | null = null;

  const rerollOpt = options.reroll;
  const canRerollNow =
    rerollOpt !== undefined &&
    rerollOpt.hasAlternatives &&
    rerollOpt.availableGold >= rerollOpt.cost;

  const applyFocus = (): void => {
    cards.forEach((card, index) => {
      card.setState(
        !rerollFocused && index === focused,
        index === hoveredIndex,
        index === pressedIndex,
      );
    });
    if (rerollHandle !== null) {
      rerollHandle.setFocused(rerollFocused);
      rerollHandle.setHovered?.(rerollHovered);
      rerollHandle.setPressed?.(rerollPressed);
    }
  };

  const moveFocus = (delta: number): void => {
    if (cards.length === 0) return;
    rerollFocused = false;
    hoveredIndex = null;
    pressedIndex = null;
    focused = (focused + delta + cards.length) % cards.length;
    playSfx('ui-move');
    applyFocus();
  };

  const pick = (index: number): void => {
    if (picked || destroyed || rerolling) return;
    if (index < 0 || index >= options.choices.length) return;
    picked = true;
    playSfx('skill-acquired');
    options.onPick(index);
  };

  const triggerReroll = (): void => {
    if (picked || destroyed || rerolling || rerollOpt === undefined) return;
    if (!canRerollNow) {
      playSfx('ui-move');
      return;
    }
    rerolling = true;
    if (!rerollOpt.onReroll()) {
      rerolling = false;
    }
  };

  const onKey = (event: KeyEvent): void => {
    const index = HOTKEY_CODES.findIndex((code) => code === event.keyCode);
    if (index >= 0) pick(index);
  };

  // Two listening paths: Cocos `input` and capture-phase DOM (`AGENTS.md` trap).
  const onDomKey = (event: KeyboardEvent): void => {
    if (event.repeat || picked || destroyed) return;

    const digit = /^Digit([1-3])$/.exec(event.code) ?? /^([1-3])$/.exec(event.key);
    if (digit !== null) {
      event.preventDefault();
      pick(Number(digit[1]) - 1);
      return;
    }

    if (
      rerollOpt !== undefined &&
      (event.code === 'KeyR' || event.key === 'r' || event.key === 'R' || event.keyCode === 82)
    ) {
      event.preventDefault();
      triggerReroll();
      return;
    }

    const key = event.key;
    if (key === 'ArrowLeft' || event.keyCode === 37) {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (key === 'ArrowRight' || event.keyCode === 39) {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (key === 'ArrowDown' || event.keyCode === 40) {
      event.preventDefault();
      if (rerollOpt !== undefined && !rerollFocused) {
        rerollFocused = true;
        hoveredIndex = null;
        pressedIndex = null;
        playSfx('ui-move');
        applyFocus();
      } else if (rerollOpt === undefined) {
        moveFocus(1);
      }
      return;
    }
    if (key === 'ArrowUp' || event.keyCode === 38) {
      event.preventDefault();
      if (rerollFocused) {
        rerollFocused = false;
        playSfx('ui-move');
        applyFocus();
      } else if (rerollOpt === undefined) {
        moveFocus(-1);
      }
      return;
    }
    if (key === 'Enter' || key === ' ' || event.keyCode === 13 || event.keyCode === 32) {
      event.preventDefault();
      if (rerollFocused) triggerReroll();
      else pick(focused);
    }
  };

  const removeListeners = (): void => {
    input.off(Input.EventType.KEY_DOWN, onKey);
    document.removeEventListener('keydown', onDomKey, true);
  };

  input.on(Input.EventType.KEY_DOWN, onKey);
  document.addEventListener('keydown', onDomKey, true);

  let frames: MenuFrames;
  try {
    frames = await loadMenuFrames();
  } catch (error: unknown) {
    removeListeners();
    throw error;
  }

  if (destroyed) {
    removeListeners();
    const cancelled = new CocosNode('skill-pick-cancelled');
    return {
      node: cancelled,
      destroy(): void {
        if (cancelled.isValid) cancelled.destroy();
      },
    };
  }

  const layout = computeSkillCardLayout(options.choices.length);

  const root = new CocosNode('skill-pick');
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  addDim(root);

  const title = createLabel(root, 'skill-pick-title', 'CHOOSE A SKILL');
  title.fontSize = 20;
  title.lineHeight = 24;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, layout.titleY, 0);

  const hintText =
    rerollOpt !== undefined
      ? 'Click a card, arrows + Enter, 1 / 2 / 3, or R to reroll'
      : 'Click a card, ←/→ + Enter, or press 1 / 2 / 3';
  const subtitle = createLabel(root, 'skill-pick-hint', hintText);
  subtitle.fontSize = 10;
  subtitle.lineHeight = 12;
  subtitle.color = MENU_MUTED_COLOR;
  subtitle.node.setPosition(0, layout.subtitleY, 0);

  options.choices.forEach((skill, index) => {
    const x = layout.cardXs[index] ?? 0;
    const stacks = options.owned.get(skill.id) ?? 0;
    const card = makeCard(root, frames, layout, skill, options.owned, stacks, index + 1, x, () => {
      pressedIndex = null;
      rerollFocused = false;
      focused = index;
      applyFocus();
      pick(index);
    });
    card.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      if (rerollFocused || focused !== index) playSfx('ui-move');
      rerollFocused = false;
      focused = index;
      hoveredIndex = index;
      applyFocus();
    });
    card.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      if (hoveredIndex === index) hoveredIndex = null;
      if (pressedIndex === index) pressedIndex = null;
      applyFocus();
    });
    card.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      rerollFocused = false;
      focused = index;
      pressedIndex = index;
      applyFocus();
    });
    card.node.on(CocosNode.EventType.MOUSE_UP, () => {
      if (pressedIndex === index) pressedIndex = null;
      applyFocus();
    });
    cards.push(card);
  });

  if (rerollOpt !== undefined) {
    const label = rerollOpt.hasAlternatives
      ? `Reroll (R) — ${rerollOpt.cost}g`
      : 'Reroll (R)';
    const detail = !rerollOpt.hasAlternatives
      ? 'No alternative skills'
      : canRerollNow
        ? `Gold: ${rerollOpt.availableGold}g`
        : `Gold: ${rerollOpt.availableGold}g — Not enough gold`;

    const handle = createMenuButton(
      root,
      'skill-pick-reroll',
      {
        label,
        detail,
        disabled: !canRerollNow,
        activate: triggerReroll,
      },
      frames,
      {
        width: layout.rerollWidth,
        height: layout.rerollHeight,
        fontSize: 11,
      },
    );
    handle.node.setPosition(0, layout.rerollY, 0);
    handle.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      if (!rerollFocused) playSfx('ui-move');
      rerollFocused = true;
      rerollHovered = true;
      hoveredIndex = null;
      applyFocus();
    });
    handle.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      rerollHovered = false;
      rerollPressed = false;
      applyFocus();
    });
    handle.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      rerollFocused = true;
      rerollPressed = true;
      applyFocus();
    });
    handle.node.on(CocosNode.EventType.MOUSE_UP, () => {
      rerollPressed = false;
      applyFocus();
    });
    handle.node.on(CocosButton.EventType.CLICK, () => {
      rerollPressed = false;
      rerollFocused = true;
      applyFocus();
      triggerReroll();
    });
    rerollHandle = handle;
  }

  applyFocus();

  return {
    node: root,
    destroy(): void {
      destroyed = true;
      removeListeners();
      if (root.isValid) root.destroy();
    },
  };
}

/** Dark backdrop over the whole screen (`Graphics`, never a stretched 16×8 button frame). */
function addDim(parent: Node): void {
  const size = view.getVisibleSize();
  createBackdropPanel(parent, 'skill-pick-dim', size.width, size.height, 206);
}

function makeCard(
  parent: Node,
  frames: MenuFrames,
  layout: SkillCardLayout,
  skill: SkillDef,
  owned: ReadonlyMap<string, number>,
  stacks: number,
  hotkey: number,
  x: number,
  onPick: () => void,
): SkillCardHandle {
  const isLegendary = skill.rarity === 'legendary';
  const node = new CocosNode(`skill-card-${skill.id}`);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(x, layout.cardY, 0);

  // `node` owns the UITransform + Button so `uiText()` checks child labels against `cardWidth × cardHeight`.
  const transform: UITransform =
    node.getComponent(CocosUITransform) ?? node.addComponent(CocosUITransform);
  transform.setContentSize(layout.cardWidth, layout.cardHeight);

  // Sibling background layers in strict back-to-front draw order: shadow -> wooden/gold rim -> recessed well.
  const shadow = addSlicedSpriteNode(
    node,
    'card-shadow',
    frames.shadow,
    layout.cardWidth + PANEL_SHADOW_EXPAND_PX,
    layout.cardHeight + PANEL_SHADOW_EXPAND_PX,
    PANEL_SHADOW_TINT,
  );
  shadow.node.setPosition(0, -1, 0);

  const restingRimTint = isLegendary ? LEGENDARY_RIM_TINT : PANEL_RIM_TINT;
  const { sprite: rimSprite } = addSlicedSpriteNode(
    node,
    'card-rim',
    frames.normal,
    layout.cardWidth,
    layout.cardHeight,
    restingRimTint,
  );

  addSlicedSpriteNode(
    node,
    'card-well',
    frames.panel,
    layout.cardWidth - PANEL_WELL_INSET_PX * 2,
    layout.cardHeight - PANEL_WELL_INSET_PX * 2,
    isLegendary ? LEGENDARY_WELL_TINT : PANEL_WELL_TINT,
  );

  // Dedicated gold inner frame for Legendary Evolution cards (sibling Graphics node, single colour).
  if (isLegendary) {
    const goldFrameNode = new CocosNode('legendary-border');
    goldFrameNode.layer = Layers.Enum.UI_2D;
    goldFrameNode.parent = node;
    const goldGfx: Graphics = goldFrameNode.addComponent(CocosGraphics);
    goldGfx.strokeColor = LEGENDARY_GOLD_COLOR;
    goldGfx.lineWidth = 1.5;
    const inset = PANEL_WELL_INSET_PX;
    goldGfx.rect(
      -layout.cardWidth / 2 + inset,
      -layout.cardHeight / 2 + inset,
      layout.cardWidth - inset * 2,
      layout.cardHeight - inset * 2,
    );
    goldGfx.stroke();
  }

  // Recessed dark pedestal behind the 48×48 skill icon.
  const iconSlot = addSlicedSpriteNode(
    node,
    'icon-slot',
    frames.shadow,
    layout.iconFrameSize,
    layout.iconFrameSize,
    ICON_SLOT_TINT,
  );
  iconSlot.node.setPosition(0, layout.iconY, 0);

  // 2 px rarity divider bar cleanly below the rarity label (one Graphics node, one colour).
  const rarityBar = new CocosNode('rarity-accent');
  rarityBar.layer = Layers.Enum.UI_2D;
  rarityBar.parent = node;
  rarityBar.setPosition(0, layout.accentY, 0);
  const rarityGfx: Graphics = rarityBar.addComponent(CocosGraphics);
  const rarityColor: Color = rarityColorFor(skill.rarity);
  rarityGfx.fillColor = rarityColor;
  rarityGfx.rect(-20, 0, 40, 2);
  rarityGfx.fill();

  const ring = createFocusFrame(node, frames.focus, layout.cardWidth, layout.cardHeight);

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;
  node.on(CocosButton.EventType.CLICK, onPick);

  const key = createLabel(node, 'hotkey', String(hotkey));
  key.fontSize = 10;
  key.lineHeight = 12;
  key.color = isLegendary ? LEGENDARY_GOLD_COLOR : HOTKEY_COLOR;
  key.node.setPosition(layout.hotkeyX, layout.hotkeyY, 0);

  const icon = new CocosNode('icon');
  icon.layer = Layers.Enum.UI_2D;
  icon.parent = node;
  const iconSprite: Sprite = icon.addComponent(CocosSprite);
  iconSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  iconSprite.trim = false;
  const iconTransform: UITransform | null = icon.getComponent(CocosUITransform);
  if (iconTransform !== null) iconTransform.setContentSize(layout.iconSize, layout.iconSize);
  icon.setPosition(0, layout.iconY, 0);
  void loadSkillCardIcon(skill, stacks)
    .then((iconFrame) => {
      if (icon.isValid) iconSprite.spriteFrame = iconFrame;
    })
    .catch(() => undefined);

  const name = createLabel(node, 'name', skill.name);
  name.fontSize = 12;
  name.lineHeight = 14;
  name.color = isLegendary ? LEGENDARY_GOLD_COLOR : MENU_TEXT_COLOR;
  name.node.setPosition(0, layout.nameY, 0);

  const headerText = isLegendary ? 'EVOLUTION' : skill.rarity.toUpperCase();
  const rarity = createLabel(node, 'rarity', headerText);
  rarity.fontSize = 9;
  rarity.lineHeight = 11;
  rarity.color = rarityColor;
  rarity.node.setPosition(0, layout.rarityY, 0);

  const effect = createLabel(node, 'effect', describeSkill(skill));
  effect.fontSize = 9;
  effect.lineHeight = 11;
  effect.color = MENU_TEXT_COLOR;
  effect.enableWrapText = true;
  effect.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;
  const effectTransform: UITransform | null = effect.node.getComponent(CocosUITransform);
  if (effectTransform !== null) {
    effectTransform.setContentSize(layout.effectWidth, layout.effectHeight);
  }
  effect.node.setPosition(0, layout.effectY, 0);
  effect.updateRenderData?.(true);

  if (isLegendary && skill.requires !== undefined) {
    const [reqA, reqB] = skill.requires;
    const recipe = `${getSkill(reqA).name} + ${getSkill(reqB).name}`;
    const pairHint = createLabel(node, 'pair-hint', recipe);
    pairHint.fontSize = 8;
    pairHint.lineHeight = 10;
    pairHint.color = LEGENDARY_GOLD_COLOR;
    pairHint.node.setPosition(0, layout.pairHintY, 0);
  } else if (!isLegendary) {
    const hint = evolutionHintsForSkill(skill.id, owned)[0];
    if (hint !== undefined) {
      const pairHint = createLabel(node, 'pair-hint', hint.text);
      pairHint.fontSize = 8;
      pairHint.lineHeight = 10;
      pairHint.color = hint.ready ? PAIR_HINT_READY_COLOR : PAIR_HINT_MUTED_COLOR;
      pairHint.node.setPosition(0, layout.pairHintY, 0);
    }
  }

  const stackLine = isLegendary
    ? 'LEGENDARY'
    : stacks <= 0
      ? 'NEW'
      : `Stack ${stacks} / ${skill.maxStacks}`;
  const stack = createLabel(node, 'stack', stackLine);
  stack.fontSize = 9;
  stack.lineHeight = 11;
  stack.color = isLegendary || stacks > 0 ? rarityColor : MENU_MUTED_COLOR;
  stack.node.setPosition(0, layout.stackY, 0);

  return {
    node,
    setState(isFocused: boolean, isHovered: boolean, isPressed: boolean): void {
      if (isPressed) {
        rimSprite.spriteFrame = frames.pressed;
        rimSprite.color = isLegendary ? LEGENDARY_RIM_PRESSED_TINT : CARD_RIM_PRESSED_TINT;
        ring.applyStyle('gleam');
        return;
      }
      if (isHovered) {
        rimSprite.spriteFrame = frames.hover;
        rimSprite.color = isLegendary ? LEGENDARY_RIM_HOVER_TINT : CARD_RIM_HOVER_TINT;
        ring.applyStyle('gleam');
        return;
      }
      if (isFocused) {
        rimSprite.spriteFrame = frames.hover;
        rimSprite.color = isLegendary ? LEGENDARY_RIM_FOCUS_TINT : CARD_RIM_FOCUS_TINT;
        ring.applyStyle('gold');
        return;
      }
      rimSprite.spriteFrame = frames.normal;
      rimSprite.color = restingRimTint;
      ring.applyStyle(isLegendary ? 'gold' : 'none');
    },
  };
}

/**
 * 4-class Character Select & Early Unlock screen (GDD §14, §15.4, M14-T3).
 *
 * Built 100% in code, zero `.scene`/`.prefab` edits:
 * - Leaves the left flank (`x ∈ [-256, -126]`) open over Chapter 1's living room (`backdropAlpha = 84`)
 *   so the highlighted class (`Ninja`, `Archer`, `Mage`, `Cultivator`) previews live with its real
 *   `idle` animation and held/worn weapon attachment (`bow-hand`, `staff-hand`, `sword-back`).
 * - Docks a layered `Theme Wood` 9-slice plaque on the right with:
 *   1) 2×2 `Theme Wood` class cards showing lock/equip status (`SELECTED`, `UNLOCKED`, `LOCKED`),
 *   2) Recessed 3-layer class summary well (`Weapon`, `Passive`, `Signature [E]`),
 *   3) Dynamic Primary Action / Early Meta Gold Unlock button (`Unlock <Class> — <Cost>g`,
 *      disabled cleanly with exact gold-shortage reason when unaffordable!) + `Back` button.
 * - Capture-phase keyboard listener attaches BEFORE `await loadMenuFrames()` (`AGENTS.md` trap)
 *   and shares a single focus state with mouse hover/press/click.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import {
  CHARACTER_ROSTER,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../../core/characters/roster';
import { t } from '../../core/i18n';
import { canBuyCharacter, type SaveData } from '../../core/save/save-data';
import {
  PANEL_WELL_INSET_PX,
  computeCharacterSelectLayout,
  computeMenuButtonTextLayout,
  formatCharacterCardText,
  formatCharacterPrimaryAction,
  formatCharacterSelectSubtitle,
  formatCharacterSummaryLines,
  nextCharacterSelectFocus,
  resolveMenuButtonVisualState,
  type CharacterCardText,
  type CharacterPrimaryActionSpec,
  type CharacterSummaryLines,
  type MenuButtonBox,
  type MenuGridDirection,
} from '../../core/view/menu-layout';
import { playSfx } from '../audio/sfx';
import { createLabel } from '../hud';
import {
  MENU_DISABLED_COLOR,
  MENU_GOOD,
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  addPanelDivider,
  addSlicedSpriteNode,
  createFocusFrame,
  createMenuPanel,
  createScreenBackdrop,
  loadMenuFrames,
  visibleUiSize,
  type MenuFrames,
} from './menu';

/** `cc` is an any module: import names only work in value position. */
type Button = InstanceType<typeof CocosButton>;
type Label = ReturnType<typeof createLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Same gentle dim as Title & Chapter Select so the living room and rigged hero shine on the left. */
const CHARACTER_BACKDROP_ALPHA = 84;

const SUMMARY_WELL_TINT = new CocosColor(84, 92, 102, 248);
const SUMMARY_SHADOW_TINT = new CocosColor(255, 255, 255, 196);
const WEAPON_LABEL_COLOR = new CocosColor(255, 232, 148, 255);
const PASSIVE_TITLE_COLOR = new CocosColor(148, 234, 255, 255);
const SIGNATURE_TITLE_COLOR = new CocosColor(228, 176, 255, 255);
const LOCKED_STATUS_COLOR = new CocosColor(255, 198, 132, 255);

const CARD_NORMAL_TINT = new CocosColor(242, 230, 218, 255);
const CARD_SELECTED_TINT = new CocosColor(255, 240, 198, 255);
const CARD_LOCKED_TINT = new CocosColor(206, 196, 186, 255);
const CARD_FOCUS_TINT = new CocosColor(255, 248, 232, 255);
const CARD_HOVER_TINT = new CocosColor(255, 255, 255, 255);
const CARD_PRESSED_TINT = new CocosColor(244, 224, 206, 255);
const BUTTON_DISABLED_TINT = new CocosColor(186, 176, 166, 255);
const BUTTON_DISABLED_FOCUS_TINT = new CocosColor(214, 204, 194, 255);

const INK_DARK = new CocosColor(30, 15, 6, 255);
const INK_FOCUS = new CocosColor(48, 14, 4, 255);
const INK_DETAIL = new CocosColor(62, 28, 10, 255);
const INK_DETAIL_FOCUS = new CocosColor(78, 30, 8, 255);
const INK_LOCKED = new CocosColor(58, 34, 20, 255);
const INK_DISABLED_DETAIL = new CocosColor(202, 190, 176, 255);

export interface CharacterSelectOptions {
  readonly parent: Node;
  readonly save: SaveData;
  readonly initialCharacterId?: CharacterId;
  /** Fired immediately whenever focus/hover highlights a character (drives living backdrop preview). */
  readonly onHighlightCharacter?: (character: CharacterDef) => void;
  /** Equip an unlocked character for the next run. */
  readonly onSelectCharacter: (characterId: CharacterId) => void;
  /** Spend Meta gold to unlock `characterId` early and equip it. */
  readonly onUnlockCharacter: (characterId: CharacterId) => void;
  readonly onBack: () => void;
}

export interface CharacterSelectScreen {
  readonly node: Node;
  /** Synchronously refresh gold, lock badges, 3-layer status, and unlock button from `save`. */
  setSave(save: SaveData): void;
  destroy(): void;
}

export {
  formatCharacterCardText,
  formatCharacterPrimaryAction,
  formatCharacterSelectSubtitle,
  formatCharacterSummaryLines,
  type CharacterCardText,
  type CharacterPrimaryActionSpec,
  type CharacterSummaryLines,
};

interface InteractiveControl {
  readonly node: Node;
  setInteraction(focused: boolean, hovered: boolean, pressed: boolean): void;
  isDisabled(): boolean;
}

export async function buildCharacterSelectScreen(
  options: CharacterSelectOptions,
): Promise<CharacterSelectScreen> {
  let currentSave = options.save;
  let destroyed = false;

  const initialTarget =
    options.initialCharacterId ?? resolveSelectedCharacter(currentSave).id;
  const initialCardIdx = Math.max(
    0,
    CHARACTER_ROSTER.findIndex((entry) => entry.id === initialTarget),
  );

  let focusedIndex = initialCardIdx;
  let highlightedCardIndex = initialCardIdx;
  let hoveredIndex: number | null = null;
  let pressedIndex: number | null = null;
  let lastNotifiedHighlightId: CharacterId | null = null;

  let syncVisuals: (() => void) | null = null;

  const notifyHighlight = (cardIndex: number): void => {
    const def = CHARACTER_ROSTER[cardIndex];
    if (def === undefined || def.id === lastNotifiedHighlightId) return;
    lastNotifiedHighlightId = def.id;
    options.onHighlightCharacter?.(def);
  };

  const setFocus = (nextIndex: number, fromPointer = false): void => {
    const clamped = Math.min(5, Math.max(0, nextIndex));
    const changed = clamped !== focusedIndex;
    if (!fromPointer) {
      hoveredIndex = null;
      pressedIndex = null;
    }
    focusedIndex = clamped;
    if (clamped <= 3) {
      highlightedCardIndex = clamped;
      notifyHighlight(clamped);
    }
    if (changed) playSfx('ui-move');
    syncVisuals?.();
  };

  const activateCard = (cardIndex: number): void => {
    const def = CHARACTER_ROSTER[cardIndex];
    if (def === undefined) return;
    highlightedCardIndex = cardIndex;
    focusedIndex = cardIndex;
    notifyHighlight(cardIndex);

    if (isCharacterUnlocked(def.id, currentSave)) {
      playSfx('ui-confirm');
      options.onSelectCharacter(def.id);
      syncVisuals?.();
      return;
    }

    // Locked card: if affordable, step focus directly onto the Unlock button preserving highlight.
    if (canBuyCharacter(currentSave, def.id)) {
      focusedIndex = 4;
      playSfx('ui-move');
    } else {
      playSfx('ui-move');
    }
    syncVisuals?.();
  };

  const activatePrimary = (): void => {
    const def = CHARACTER_ROSTER[highlightedCardIndex];
    if (def === undefined) return;
    const action = formatCharacterPrimaryAction(def, currentSave);
    if (action.disabled) {
      playSfx('ui-move');
      return;
    }
    if (action.kind === 'confirm') {
      playSfx('ui-confirm');
      options.onBack();
      return;
    }
    if (action.kind === 'select') {
      playSfx('ui-confirm');
      options.onSelectCharacter(def.id);
      syncVisuals?.();
      return;
    }
    playSfx('ui-confirm');
    options.onUnlockCharacter(def.id);
    syncVisuals?.();
  };

  const activateIndex = (index: number): void => {
    if (index <= 3) {
      activateCard(index);
      return;
    }
    if (index === 4) {
      activatePrimary();
      return;
    }
    playSfx('ui-confirm');
    options.onBack();
  };

  // Attach capture-phase key listener BEFORE awaiting `loadMenuFrames()` (`AGENTS.md` trap).
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || destroyed) return;
    const key = event.key;
    const code = event.keyCode;

    if (key === 'Escape' || code === 27) {
      event.preventDefault();
      options.onBack();
      return;
    }

    const digit = /^Digit([1-4])$/.exec(event.code) ?? /^([1-4])$/.exec(key);
    if (digit !== null) {
      event.preventDefault();
      const cardIdx = Number(digit[1]) - 1;
      setFocus(cardIdx);
      if (isCharacterUnlocked(CHARACTER_ROSTER[cardIdx]?.id ?? '', currentSave)) {
        activateCard(cardIdx);
      }
      return;
    }

    if (event.code === 'KeyU' || key === 'u' || key === 'U') {
      const def = CHARACTER_ROSTER[highlightedCardIndex];
      if (def !== undefined && canBuyCharacter(currentSave, def.id)) {
        event.preventDefault();
        focusedIndex = 4;
        activatePrimary();
      }
      return;
    }

    let dir: MenuGridDirection | null = null;
    if (key === 'ArrowLeft' || code === 37) dir = 'left';
    else if (key === 'ArrowRight' || code === 39) dir = 'right';
    else if (key === 'ArrowUp' || code === 38) dir = 'up';
    else if (key === 'ArrowDown' || code === 40) dir = 'down';

    if (dir !== null) {
      event.preventDefault();
      const next = nextCharacterSelectFocus(focusedIndex, dir, highlightedCardIndex);
      setFocus(next);
      return;
    }

    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      activateIndex(focusedIndex);
    }
  };

  const removeListeners = (): void => {
    document.removeEventListener('keydown', onKeyDown, true);
  };
  document.addEventListener('keydown', onKeyDown, true);

  // Trigger initial highlight immediately so the living backdrop matches the initial card.
  notifyHighlight(highlightedCardIndex);

  let frames: MenuFrames;
  try {
    frames = await loadMenuFrames();
  } catch (error: unknown) {
    removeListeners();
    throw error;
  }

  if (destroyed) {
    removeListeners();
    const cancelled = new CocosNode('character-select-cancelled');
    return {
      node: cancelled,
      setSave(): void {},
      destroy(): void {
        if (cancelled.isValid) cancelled.destroy();
      },
    };
  }

  const size = visibleUiSize();
  const layout = computeCharacterSelectLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
  });

  const root = new CocosNode('character-select');
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;

  createScreenBackdrop(root, CHARACTER_BACKDROP_ALPHA);

  const panel = createMenuPanel(
    root,
    'character-select-panel',
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY - layout.panelY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(layout.panelX, layout.panelY, 0);

  const title = createLabel(root, 'character-select-title', t('charSelect.title'));
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 4;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(layout.panelX, layout.titleY, 0);

  const subtitle = createLabel(
    root,
    'character-select-subtitle',
    formatCharacterSelectSubtitle(currentSave.gold),
  );
  subtitle.fontSize = layout.subtitleFontSize;
  subtitle.lineHeight = layout.subtitleFontSize + 4;
  subtitle.color = MENU_TEXT_COLOR;
  subtitle.node.setPosition(layout.panelX, layout.subtitleY, 0);

  const controls: InteractiveControl[] = [];
  const cardUpdaters: Array<(save: SaveData, isHighlighted: boolean) => void> = [];

  CHARACTER_ROSTER.forEach((character, index) => {
    const slot = layout.cards[index]!;
    const builtCard = createCharacterCardControl(
      root,
      `character-card-${character.id}`,
      character,
      currentSave,
      frames,
      slot,
    );
    controls.push(builtCard.control);
    cardUpdaters.push(builtCard.syncSave);
  });

  // Recessed 3-layer class summary well (`UITransform` enforces `insideParent` in `uiText()`).
  const summaryNode = new CocosNode('character-summary');
  summaryNode.layer = Layers.Enum.UI_2D;
  summaryNode.parent = root;
  summaryNode.setPosition(layout.summaryX, layout.summaryY, 0);
  const summaryTransform: UITransform =
    summaryNode.getComponent(CocosUITransform) ?? summaryNode.addComponent(CocosUITransform);
  summaryTransform.setContentSize(layout.summaryWidth, layout.summaryHeight);

  addSlicedSpriteNode(
    summaryNode,
    'summary-rim',
    frames.shadow,
    layout.summaryWidth,
    layout.summaryHeight,
    SUMMARY_SHADOW_TINT,
  );
  addSlicedSpriteNode(
    summaryNode,
    'summary-well',
    frames.panel,
    layout.summaryWidth - PANEL_WELL_INSET_PX,
    layout.summaryHeight - PANEL_WELL_INSET_PX,
    SUMMARY_WELL_TINT,
  );
  addPanelDivider(summaryNode, layout.summaryDividerWidth, layout.summaryDividerLocalY);

  const initialHero = CHARACTER_ROSTER[highlightedCardIndex]!;
  const initialSummary = formatCharacterSummaryLines(initialHero, currentSave);

  const statusLabel = createLabel(summaryNode, 'summary-status', initialSummary.statusLine);
  statusLabel.fontSize = layout.statusFontSize;
  statusLabel.lineHeight = layout.statusFontSize + 2;
  statusLabel.node.setPosition(0, layout.statusLocalY, 0);

  const weaponLabel = createLabel(summaryNode, 'summary-weapon', initialSummary.weaponLine);
  weaponLabel.fontSize = layout.weaponFontSize;
  weaponLabel.lineHeight = layout.weaponFontSize + 2;
  weaponLabel.color = WEAPON_LABEL_COLOR;
  weaponLabel.node.setPosition(0, layout.weaponLocalY, 0);

  const passiveTitleLabel = createLabel(
    summaryNode,
    'summary-passive-title',
    initialSummary.passiveTitle,
  );
  passiveTitleTitleStyle(passiveTitleLabel, layout.passiveTitleFontSize, layout.passiveTitleLocalY);

  const passiveBodyLabel = createLabel(
    summaryNode,
    'summary-passive-body',
    initialSummary.passiveBody,
  );
  passiveBodyLabel.fontSize = layout.passiveBodyFontSize;
  passiveBodyLabel.lineHeight = layout.passiveBodyFontSize + 2;
  passiveBodyLabel.color = MENU_TEXT_COLOR;
  passiveBodyLabel.node.setPosition(0, layout.passiveBodyLocalY, 0);

  const sigTitleLabel = createLabel(
    summaryNode,
    'summary-signature-title',
    initialSummary.signatureTitle,
  );
  sigTitleLabel.fontSize = layout.signatureTitleFontSize;
  sigTitleLabel.lineHeight = layout.signatureTitleFontSize + 2;
  sigTitleLabel.color = SIGNATURE_TITLE_COLOR;
  sigTitleLabel.node.setPosition(0, layout.signatureTitleLocalY, 0);

  const sigBodyLabel = createLabel(
    summaryNode,
    'summary-signature-body',
    initialSummary.signatureBody,
  );
  sigBodyLabel.fontSize = layout.signatureBodyFontSize;
  sigBodyLabel.lineHeight = layout.signatureBodyFontSize + 2;
  sigBodyLabel.color = MENU_TEXT_COLOR;
  sigBodyLabel.node.setPosition(0, layout.signatureBodyLocalY, 0);

  // Primary Action / Early Unlock button (index 4) + Back button (index 5).
  const primaryBuilt = createDynamicButtonControl(
    root,
    'character-primary-action',
    formatCharacterPrimaryAction(initialHero, currentSave),
    frames,
    layout.primaryButton,
  );
  controls.push(primaryBuilt.control);

  const backBuilt = createDynamicButtonControl(
    root,
    'character-back',
    { label: t('common.back'), disabled: false },
    frames,
    layout.backButton,
  );
  controls.push(backBuilt.control);

  const hint = createLabel(root, 'character-select-hint', t('charSelect.hint'));
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 4;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(layout.panelX, layout.hintY, 0);

  controls.forEach((control, index) => {
    control.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      hoveredIndex = index;
      setFocus(index, true);
    });
    control.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      if (hoveredIndex === index) hoveredIndex = null;
      if (pressedIndex === index) pressedIndex = null;
      syncVisuals?.();
    });
    control.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      hoveredIndex = index;
      pressedIndex = index;
      setFocus(index, true);
    });
    control.node.on(CocosNode.EventType.MOUSE_UP, () => {
      if (pressedIndex === index) pressedIndex = null;
      syncVisuals?.();
    });
    control.node.on(CocosButton.EventType.CLICK, () => {
      pressedIndex = null;
      setFocus(index, true);
      activateIndex(index);
    });
  });

  syncVisuals = (): void => {
    if (destroyed || !root.isValid) return;

    subtitle.string = formatCharacterSelectSubtitle(currentSave.gold);
    cardUpdaters.forEach((updateCard, idx) => {
      updateCard(currentSave, idx === highlightedCardIndex);
    });

    const hero = CHARACTER_ROSTER[highlightedCardIndex] ?? CHARACTER_ROSTER[0]!;
    const summary = formatCharacterSummaryLines(hero, currentSave);
    statusLabel.string = summary.statusLine;
    statusLabel.color =
      summary.statusKind === 'selected'
        ? MENU_GOOD
        : summary.statusKind === 'unlocked'
          ? MENU_TEXT_COLOR
          : LOCKED_STATUS_COLOR;
    weaponLabel.string = summary.weaponLine;
    passiveTitleLabel.string = summary.passiveTitle;
    passiveBodyLabel.string = summary.passiveBody;
    sigTitleLabel.string = summary.signatureTitle;
    sigBodyLabel.string = summary.signatureBody;

    primaryBuilt.updateSpec(formatCharacterPrimaryAction(hero, currentSave));

    controls.forEach((control, idx) => {
      control.setInteraction(
        idx === focusedIndex,
        idx === hoveredIndex,
        idx === pressedIndex,
      );
    });
  };

  syncVisuals();

  return {
    node: root,
    setSave(nextSave: SaveData): void {
      currentSave = nextSave;
      syncVisuals?.();
    },
    destroy(): void {
      destroyed = true;
      removeListeners();
      if (root.isValid) root.destroy();
    },
  };
}

function passiveTitleTitleStyle(label: Label, fontSize: number, localY: number): void {
  label.fontSize = fontSize;
  label.lineHeight = fontSize + 2;
  label.color = PASSIVE_TITLE_COLOR;
  label.node.setPosition(0, localY, 0);
}

function createCharacterCardControl(
  parent: Node,
  name: string,
  character: CharacterDef,
  initialSave: SaveData,
  frames: MenuFrames,
  box: MenuButtonBox,
): {
  readonly control: InteractiveControl;
  readonly syncSave: (save: SaveData, isHighlighted: boolean) => void;
} {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(box.x, box.y, 0);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(box.width, box.height);

  const ring = createFocusFrame(node, frames.focus, box.width, box.height);

  const textLayout = computeMenuButtonTextLayout({
    width: box.width,
    height: box.height,
    fontSize: box.fontSize,
    hasDetail: true,
  });

  const initialText = formatCharacterCardText(character, initialSave);
  const label = createLabel(node, 'label', initialText.label);
  label.fontSize = textLayout.labelFontSize;
  label.lineHeight = textLayout.labelLineHeight;
  label.node.setPosition(0, textLayout.labelY, 0);

  const detail = createLabel(node, 'detail', initialText.detail);
  detail.fontSize = textLayout.detailFontSize;
  detail.lineHeight = textLayout.detailLineHeight;
  detail.node.setPosition(0, textLayout.detailY, 0);

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;

  let cardStatus = initialText.status;
  let highlighted = false;
  let focused = false;
  let hovered = false;
  let pressed = false;

  const applyVisual = (): void => {
    const visual = resolveMenuButtonVisualState({
      disabled: false,
      focused,
      hovered,
      pressed,
    });

    sprite.spriteFrame =
      visual.frame === 'pressed'
        ? frames.pressed
        : visual.frame === 'hover'
          ? frames.hover
          : frames.normal;

    if (visual.state === 'pressed') {
      sprite.color = CARD_PRESSED_TINT;
    } else if (visual.state === 'hovered') {
      sprite.color = CARD_HOVER_TINT;
    } else if (visual.state === 'focused') {
      sprite.color = CARD_FOCUS_TINT;
    } else if (cardStatus === 'selected') {
      sprite.color = CARD_SELECTED_TINT;
    } else if (cardStatus === 'locked') {
      sprite.color = CARD_LOCKED_TINT;
    } else {
      sprite.color = CARD_NORMAL_TINT;
    }

    if (visual.focusRingStyle !== 'none') {
      ring.applyStyle(visual.focusRingStyle);
    } else if (highlighted) {
      ring.applyStyle('muted');
    } else {
      ring.applyStyle('none');
    }

    const activeFocus =
      visual.state === 'focused' || visual.state === 'hovered' || visual.state === 'pressed';
    label.node.setPosition(0, textLayout.labelY + visual.contentOffsetY, 0);
    label.color = activeFocus
      ? INK_FOCUS
      : cardStatus === 'locked'
        ? INK_LOCKED
        : INK_DARK;

    detail.node.setPosition(0, textLayout.detailY + visual.contentOffsetY, 0);
    detail.color = activeFocus ? INK_DETAIL_FOCUS : INK_DETAIL;
  };

  applyVisual();

  return {
    control: {
      node,
      setInteraction(nextFocused: boolean, nextHovered: boolean, nextPressed: boolean): void {
        focused = nextFocused;
        hovered = nextHovered;
        pressed = nextPressed;
        applyVisual();
      },
      isDisabled: (): boolean => false,
    },
    syncSave(save: SaveData, isHighlighted: boolean): void {
      const next = formatCharacterCardText(character, save);
      cardStatus = next.status;
      highlighted = isHighlighted;
      label.string = next.label;
      detail.string = next.detail;
      applyVisual();
    },
  };
}

interface DynamicButtonSpec {
  readonly label: string;
  readonly detail?: string;
  readonly disabled: boolean;
}

function createDynamicButtonControl(
  parent: Node,
  name: string,
  initialSpec: DynamicButtonSpec,
  frames: MenuFrames,
  box: MenuButtonBox,
): {
  readonly control: InteractiveControl;
  readonly updateSpec: (spec: DynamicButtonSpec) => void;
} {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(box.x, box.y, 0);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(box.width, box.height);

  const ring = createFocusFrame(node, frames.focus, box.width, box.height);

  const hasDetail = initialSpec.detail !== undefined;
  const textLayout = computeMenuButtonTextLayout({
    width: box.width,
    height: box.height,
    fontSize: box.fontSize,
    hasDetail,
  });

  const label = createLabel(node, 'label', initialSpec.label);
  label.fontSize = textLayout.labelFontSize;
  label.lineHeight = textLayout.labelLineHeight;
  label.node.setPosition(0, textLayout.labelY, 0);

  let detail: Label | null = null;
  if (hasDetail) {
    detail = createLabel(node, 'detail', initialSpec.detail ?? '');
    detail.fontSize = textLayout.detailFontSize;
    detail.lineHeight = textLayout.detailLineHeight;
    detail.node.setPosition(0, textLayout.detailY, 0);
  }

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;

  let disabled = initialSpec.disabled;
  let focused = false;
  let hovered = false;
  let pressed = false;

  const applyVisual = (): void => {
    const visual = resolveMenuButtonVisualState({ disabled, focused, hovered, pressed });
    sprite.spriteFrame =
      visual.frame === 'disabled'
        ? frames.disabled
        : visual.frame === 'pressed'
          ? frames.pressed
          : visual.frame === 'hover'
            ? frames.hover
            : frames.normal;
    sprite.color =
      visual.state === 'disabled'
        ? BUTTON_DISABLED_TINT
        : visual.state === 'disabled-focused'
          ? BUTTON_DISABLED_FOCUS_TINT
          : visual.state === 'pressed'
            ? CARD_PRESSED_TINT
            : visual.state === 'hovered'
              ? CARD_HOVER_TINT
              : visual.state === 'focused'
                ? CARD_FOCUS_TINT
                : CARD_NORMAL_TINT;

    ring.applyStyle(visual.focusRingStyle);

    const activeFocus =
      visual.state === 'focused' || visual.state === 'hovered' || visual.state === 'pressed';
    label.node.setPosition(0, textLayout.labelY + visual.contentOffsetY, 0);
    label.color = disabled ? MENU_DISABLED_COLOR : activeFocus ? INK_FOCUS : INK_DARK;

    if (detail !== null) {
      detail.node.setPosition(0, textLayout.detailY + visual.contentOffsetY, 0);
      detail.color = disabled
        ? INK_DISABLED_DETAIL
        : activeFocus
          ? INK_DETAIL_FOCUS
          : INK_DETAIL;
    }
  };

  applyVisual();

  return {
    control: {
      node,
      setInteraction(nextFocused: boolean, nextHovered: boolean, nextPressed: boolean): void {
        focused = nextFocused;
        hovered = nextHovered;
        pressed = nextPressed;
        applyVisual();
      },
      isDisabled: (): boolean => disabled,
    },
    updateSpec(spec: DynamicButtonSpec): void {
      disabled = spec.disabled;
      label.string = spec.label;
      if (detail !== null && spec.detail !== undefined) {
        detail.string = spec.detail;
      }
      applyVisual();
    },
  };
}

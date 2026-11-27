/**
 * Character Detail & Skill Codex screen (M20, `docs/gdd/m19-m20-class-skills-and-art.md` §4).
 *
 * Upgrades the M14 Character Select into a reusable inspector a caller opens and closes
 * (`buildCharacterSelectScreen` → `{ node, setSave, destroy }`), so M21's Dojo Master can open it
 * on top of the hub. Built 100% in code, zero `.scene`/`.prefab` edits:
 *
 * - Left column: 4 stacked 64×64 class tabs (portrait, class name, SELECTED/OPEN/LOCK badge); the
 *   highlighted tab drives the living room's live rigged preview (`ninja`, `archer`, `mage`,
 *   `cultivator` with its `bow-hand` / `staff-hand` / `sword-back` attachment).
 * - Right panel: base HP, weapon form & attack speed, the weapon line, Nội Tại (passive), Tuyệt Kỹ
 *   `[E]` with its base cooldown, and the 4 class-exclusive skills (icons, names, descriptions) in
 *   a 2×2 grid plus the Class Evolution with its 2-skill recipe.
 * - Locked classes stay fully inspectable; selecting and the early Meta gold unlock keep writing
 *   `selectedCharacter` / `unlockedCharacters` exactly as before.
 * - Capture-phase keyboard listener attaches BEFORE `await` (`AGENTS.md` trap) and shares one focus
 *   state with mouse hover/press/click; every label is sized from the pure `CharacterCodexLayout`.
 *
 * All display strings come from the pure view-model `core/view/skill-codex.ts`; this adapter only
 * loads textures and lays them out.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  JsonAsset as CocosJsonAsset,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  resources,
} from 'cc';
import type { SpriteFrame as CocosSpriteFrame } from 'cc';
import type { AnimationManifest } from '../../core/art/manifest';
import {
  CHARACTER_ROSTER,
  isCharacterUnlocked,
  resolveCharacterAnimKey,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../../core/characters/roster';
import {
  validateAttachments,
  type AttachmentsData,
} from '../../core/art/attachments';
import { getLocale, t, type Locale } from '../../core/i18n';
import { canBuyCharacter, type SaveData } from '../../core/save/save-data';
import {
  PANEL_WELL_INSET_PX,
  computeCharacterSelectLayout,
  computeMenuButtonTextLayout,
  formatCharacterPrimaryAction,
  formatCharacterSummaryLines,
  nextCharacterSelectFocus,
  resolveMenuButtonVisualState,
  type CharacterPrimaryActionSpec,
  type CodexCardBox,
  type MenuButtonBox,
  type MenuGridDirection,
} from '../../core/view/menu-layout';
import {
  buildSkillCodex,
  type CharacterCodexView,
  type CodexEvolutionEntry,
  type CodexSkillEntry,
  type CodexWeaponForm,
} from '../../core/view/skill-codex';
import { createPortraitSpriteNode, loadCharacterPortrait } from '../assets/portrait-icon';
import { loadSkillIcon } from '../assets/skill-icon';
import { getFrame } from '../assets/sprite-frame-cache';
import { SpriteAnimator, loadAnimationManifest } from '../anim/sprite-animator';
import { playSfx } from '../audio/sfx';
import { createBackdropPanel, createLabel } from '../hud';
import { MenuBackdropActorRig } from '../menu-backdrop';
import { PlayerAttachmentView } from '../player-attachment-view';
import {
  MENU_DISABLED_COLOR,
  MENU_GOOD,
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  PANEL_RIM_TINT,
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
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;
type Color = InstanceType<typeof CocosColor>;

/** Gentle dim so the living room and the rigged hero preview still shine on the left. */
const CODEX_BACKDROP_ALPHA = 84;

const PANEL_TEXT_COLOR = MENU_TEXT_COLOR;
const PANEL_MUTED_COLOR = MENU_MUTED_COLOR;
const WEAPON_LABEL_COLOR = new CocosColor(255, 232, 148, 255);
const PASSIVE_TITLE_COLOR = new CocosColor(148, 234, 255, 255);
const SIGNATURE_TITLE_COLOR = new CocosColor(228, 176, 255, 255);
const EVOLUTION_TITLE_COLOR = new CocosColor(255, 206, 120, 255);
const LOCKED_STATUS_COLOR = new CocosColor(255, 198, 132, 255);
const UNLOCKED_STATUS_COLOR = new CocosColor(180, 244, 190, 255);
const SELECTED_STATUS_COLOR = MENU_GOOD;

const CARD_TINT = new CocosColor(62, 68, 78, 244);
const EVOLUTION_TINT = new CocosColor(74, 58, 82, 246);
const CARD_RIM_TINT = new CocosColor(255, 255, 255, 200);
const BADGE_PLATE_ALPHA = 210;
const NAME_PLATE_ALPHA = 180;

const TAB_LOCKED_TINT = new CocosColor(156, 162, 178, 255);
const TAB_UNLOCKED_TINT = new CocosColor(255, 255, 255, 255);

const BUTTON_DISABLED_TINT = new CocosColor(186, 176, 166, 255);
const BUTTON_DISABLED_FOCUS_TINT = new CocosColor(214, 204, 194, 255);
const CARD_SELECTED_TINT = new CocosColor(255, 240, 198, 255);
const CARD_FOCUS_TINT = new CocosColor(255, 248, 232, 255);
const CARD_HOVER_TINT = new CocosColor(255, 255, 255, 255);
const CARD_PRESSED_TINT = new CocosColor(244, 224, 206, 255);

const INK_DARK = new CocosColor(30, 15, 6, 255);const INK_FOCUS = new CocosColor(48, 14, 4, 255);
const INK_DETAIL = new CocosColor(62, 28, 10, 255);
const INK_DETAIL_FOCUS = new CocosColor(78, 30, 8, 255);
const INK_DISABLED_DETAIL = new CocosColor(202, 190, 176, 255);

/** Live rigged preview: integer ×3 so the 16–32 px bodies stay pixel-crisp and readable. */
const PREVIEW_X = -132;
const PREVIEW_Y = -14;
const PREVIEW_SCALE = 3;
const ATTACHMENTS_PATH = 'data/attachments';

/** Load + validate `resources/data/attachments.json`; `null` when unavailable (no weapon preview). */
function loadPreviewAttachments(): Promise<AttachmentsData | null> {
  return new Promise<AttachmentsData | null>((resolve) => {
    resources.load(
      ATTACHMENTS_PATH,
      CocosJsonAsset,
      (error: Error | null | undefined, asset: InstanceType<typeof CocosJsonAsset> | null | undefined) => {
        if (error || !asset) {
          resolve(null);
          return;
        }
        try {
          resolve(validateAttachments(asset.json));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export interface CharacterSelectOptions {
  readonly parent: Node;
  readonly save: SaveData;
  readonly initialCharacterId?: CharacterId;
  /** Fired immediately whenever focus/hover highlights a character (drives the live backdrop preview). */
  readonly onHighlightCharacter?: (character: CharacterDef) => void;
  /** Equip an unlocked character for the next run. */
  readonly onSelectCharacter: (characterId: CharacterId) => void;
  /** Spend Meta gold to unlock `characterId` early and equip it. */
  readonly onUnlockCharacter: (characterId: CharacterId) => void;
  readonly onBack: () => void;
}

export interface CharacterSelectScreen {
  readonly node: Node;
  /** Synchronously refresh gold, lock badges, stats, skills and the unlock button from `save`. */
  setSave(save: SaveData): void;
  destroy(): void;
}

interface InteractiveControl {
  readonly node: Node;
  setInteraction(focused: boolean, hovered: boolean, pressed: boolean): void;
  isDisabled(): boolean;
}

interface TextSpec {
  readonly fontSize: number;
  readonly color?: Color;
  /** When set, the label wraps at this width and is left-aligned from its node position. */
  readonly wrapWidth?: number;
}

function sizeLabelText(label: Label, text: string): void {
  const transform: UITransform =
    label.node.getComponent(CocosUITransform) ?? label.node.addComponent(CocosUITransform);
  transform.setContentSize(Math.ceil(text.length * label.fontSize * 0.62), label.lineHeight);
}

function addText(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  spec: TextSpec,
): Label {
  const label = createLabel(parent, name, text);
  label.fontSize = spec.fontSize;
  label.lineHeight = spec.fontSize + 3;
  label.color = spec.color ?? PANEL_TEXT_COLOR;
  const transform: UITransform =
    label.node.getComponent(CocosUITransform) ?? label.node.addComponent(CocosUITransform);
  if (spec.wrapWidth !== undefined) {
    label.enableWrapText = true;
    label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;
    label.horizontalAlign = CocosLabel.HorizontalAlign.LEFT;
    transform.setContentSize(spec.wrapWidth, spec.fontSize + 3);
    transform.setAnchorPoint(0, 0.5);
  } else {
    // A fresh `Node` has no UITransform; once added it defaults to 100×100, which would make
    // `uiText()` report every short label as overflowing a 64×64 tab. Size it to the text.
    sizeLabelText(label, text);
  }
  label.node.setPosition(x, y, 0);
  return label;
}

/** A dark recessed well (rim + interior) with a `UITransform` so `uiText()` can check overflow. */
function createWell(
  parent: Node,
  name: string,
  frames: MenuFrames,
  box: CodexCardBox,
  tint: Color,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(box.x, box.y, 0);

  const transform: UITransform =
    node.getComponent(CocosUITransform) ?? node.addComponent(CocosUITransform);
  transform.setContentSize(box.width, box.height);

  addSlicedSpriteNode(node, 'rim', frames.shadow, box.width, box.height, CARD_RIM_TINT);
  addSlicedSpriteNode(
    node,
    'well',
    frames.panel,
    box.width - PANEL_WELL_INSET_PX,
    box.height - PANEL_WELL_INSET_PX,
    tint,
  );
  return node;
}

function weaponFormLabel(form: CodexWeaponForm, locale: Locale): string {
  if (form === 'hand') return t('codex.weaponFormHand', undefined, locale);
  if (form === 'back') return t('codex.weaponFormBack', undefined, locale);
  return t('codex.weaponFormProjectile', undefined, locale);
}

function badgeLabel(view: CharacterCodexView, locale: Locale): string {
  if (view.lock.status === 'selected') return t('codex.badgeSelected', undefined, locale);
  if (view.lock.status === 'unlocked') return t('codex.badgeUnlocked', undefined, locale);
  return t('codex.badgeLocked', undefined, locale);
}

function statusColor(view: CharacterCodexView): Color {
  if (view.lock.status === 'selected') return SELECTED_STATUS_COLOR;
  if (view.lock.status === 'unlocked') return UNLOCKED_STATUS_COLOR;
  return LOCKED_STATUS_COLOR;
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function statsLine(view: CharacterCodexView, locale: Locale): string {
  const hp = t('codex.statHp', { hp: view.stats.maxHp }, locale);
  const rate = t('codex.statAttackSpeed', { rate: formatRate(view.stats.attacksPerSecond) }, locale);
  return `${hp} · ${weaponFormLabel(view.stats.weaponForm, locale)} · ${rate}`;
}

export async function buildCharacterSelectScreen(
  options: CharacterSelectOptions,
): Promise<CharacterSelectScreen> {
  let currentSave = options.save;
  let destroyed = false;
  const locale = getLocale();

  const initialTarget = options.initialCharacterId ?? resolveSelectedCharacter(currentSave).id;
  const initialTab = Math.max(
    0,
    CHARACTER_ROSTER.findIndex((entry) => entry.id === initialTarget),
  );

  let focusedIndex = initialTab;
  let highlightedTabIndex = initialTab;
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
      highlightedTabIndex = clamped;
      notifyHighlight(clamped);
    }
    if (changed) playSfx('ui-move');
    syncVisuals?.();
  };

  const activateTab = (cardIndex: number): void => {
    const def = CHARACTER_ROSTER[cardIndex];
    if (def === undefined) return;
    highlightedTabIndex = cardIndex;
    focusedIndex = cardIndex;
    notifyHighlight(cardIndex);

    if (isCharacterUnlocked(def.id, currentSave)) {
      playSfx('ui-confirm');
      options.onSelectCharacter(def.id);
      syncVisuals?.();
      return;
    }

    // Locked tab: if affordable, step focus onto the Unlock button preserving the tab.
    if (canBuyCharacter(currentSave, def.id)) {
      focusedIndex = 4;
    }
    playSfx('ui-move');
    syncVisuals?.();
  };

  const activatePrimary = (): void => {
    const def = CHARACTER_ROSTER[highlightedTabIndex];
    if (def === undefined) return;
    const action = formatCharacterPrimaryAction(def, currentSave, locale);
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
      activateTab(index);
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
        activateTab(cardIdx);
      }
      return;
    }

    if (event.code === 'KeyU' || key === 'u' || key === 'U') {
      const def = CHARACTER_ROSTER[highlightedTabIndex];
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
      setFocus(nextCharacterSelectFocus(focusedIndex, dir));
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

  notifyHighlight(highlightedTabIndex);

  const initialViews = buildSkillCodex(currentSave, locale);
  const skillIds: string[] = [];
  for (const view of initialViews) {
    for (const skill of view.exclusives.skills) skillIds.push(skill.id);
    skillIds.push(view.exclusives.evolution.id);
  }

  let frames: MenuFrames;
  let manifest: AnimationManifest | null = null;
  let attachments: AttachmentsData | null = null;
  const portraitFrames = new Map<CharacterId, SpriteFrame>();
  const skillFrames = new Map<string, SpriteFrame>();
  try {
    const loaded = await Promise.all([
      loadMenuFrames(),
      ...CHARACTER_ROSTER.map((character) => loadCharacterPortrait(character.id).catch(() => null)),
      ...skillIds.map((id) => loadSkillIcon(id).catch(() => null)),
    ]);
    frames = loaded[0] as MenuFrames;
    const portraitResults = loaded.slice(1, 1 + CHARACTER_ROSTER.length) as (SpriteFrame | null)[];
    CHARACTER_ROSTER.forEach((character, idx) => {
      const frame = portraitResults[idx];
      if (frame !== null && frame !== undefined) portraitFrames.set(character.id, frame);
    });
    const skillResults = loaded.slice(1 + CHARACTER_ROSTER.length) as (SpriteFrame | null)[];
    skillIds.forEach((id, idx) => {
      const frame = skillResults[idx];
      if (frame !== null && frame !== undefined) skillFrames.set(id, frame);
    });
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

  createScreenBackdrop(root, CODEX_BACKDROP_ALPHA);

  const panel = createMenuPanel(
    root,
    'codex-panel',
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY - layout.panelY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(layout.panelX, layout.panelY, 0);

  const title = addText(panel, 'codex-title', t('codex.title', undefined, locale), 0, layout.titleY, {
    fontSize: layout.titleFontSize,
    color: MENU_TITLE_COLOR,
  });
  title.lineHeight = layout.titleFontSize + 4;

  const status = addText(panel, 'codex-status', '', 0, layout.statusY, {
    fontSize: layout.statusFontSize,
    wrapWidth: layout.statusWidth,
  });
  status.horizontalAlign = CocosLabel.HorizontalAlign.CENTER;
  status.node.getComponent(CocosUITransform)?.setAnchorPoint(0.5, 0.5);

  const stats = addText(panel, 'codex-stats', '', 0, layout.statsY, {
    fontSize: layout.statsFontSize,
    color: PANEL_TEXT_COLOR,
  });

  const gold = addText(panel, 'codex-gold', '', 112, layout.titleY, {
    fontSize: 8,
    color: WEAPON_LABEL_COLOR,
  });

  const weapon = addText(panel, 'codex-weapon', '', 0, layout.weaponY, {
    fontSize: layout.weaponFontSize,
    color: WEAPON_LABEL_COLOR,
    wrapWidth: layout.statusWidth,
  });
  weapon.horizontalAlign = CocosLabel.HorizontalAlign.CENTER;
  weapon.node.getComponent(CocosUITransform)?.setAnchorPoint(0.5, 0.5);

  const passiveHeading = addText(panel, 'codex-passive-heading', '', 0, layout.passiveHeadingY, {
    fontSize: layout.passiveHeadingFontSize,
    color: PASSIVE_TITLE_COLOR,
  });

  const passiveBody = addText(panel, 'codex-passive-body', '', 0, layout.passiveBodyY, {
    fontSize: layout.passiveBodyFontSize,
    color: PANEL_TEXT_COLOR,
    wrapWidth: layout.statusWidth,
  });
  passiveBody.horizontalAlign = CocosLabel.HorizontalAlign.CENTER;
  passiveBody.node.getComponent(CocosUITransform)?.setAnchorPoint(0.5, 0.5);

  const activeHeading = addText(panel, 'codex-active-heading', '', 0, layout.activeHeadingY, {
    fontSize: layout.activeHeadingFontSize,
    color: SIGNATURE_TITLE_COLOR,
  });

  const activeBody = addText(panel, 'codex-active-body', '', 0, layout.activeBodyY, {
    fontSize: layout.activeBodyFontSize,
    color: PANEL_TEXT_COLOR,
    wrapWidth: layout.statusWidth,
  });
  activeBody.horizontalAlign = CocosLabel.HorizontalAlign.CENTER;
  activeBody.node.getComponent(CocosUITransform)?.setAnchorPoint(0.5, 0.5);

  const exclusivesHeading = addText(
    panel,
    'codex-exclusives-heading',
    '',
    0,
    layout.exclusivesHeadingY,
    { fontSize: layout.exclusivesHeadingFontSize, color: PANEL_MUTED_COLOR },
  );

  // --- Per-class detail blocks (only the highlighted class is active) ---
  interface ClassCardRefs {
    readonly group: Node;
    readonly skillNames: readonly Label[];
    readonly skillDescs: readonly Label[];
    readonly evolutionName: Label;
    readonly evolutionRecipe: Label;
    readonly evolutionDesc: Label;
    readonly icons: readonly (Sprite | null)[];
    readonly evolutionIcon: Sprite | null;
  }

  const classCards = new Map<CharacterId, ClassCardRefs>();

  const buildSkillCard = (
    parent: Node,
    name: string,
    box: CodexCardBox,
    entry: CodexSkillEntry,
  ): { name: Label; desc: Label; icon: Sprite | null } => {
    const card = createWell(parent, name, frames, box, CARD_TINT);
    const built = createPortraitSpriteNode(
      card,
      'icon-frame',
      layout.skillIconSize,
      layout.skillIconSize,
      skillFrames.get(entry.id) ?? null,
    );
    built.node.setPosition(layout.skillIconLocalX, layout.skillIconLocalY, 0);
    built.node.active = skillFrames.has(entry.id);

    const nameLabel = addText(card, 'skill-name', entry.name, layout.skillNameLocalX, layout.skillNameLocalY, {
      fontSize: layout.skillNameFontSize,
      color: PANEL_TEXT_COLOR,
      wrapWidth: layout.skillDescWidth,
    });
    const descLabel = addText(card, 'skill-desc', entry.description, layout.skillDescLocalX, layout.skillDescLocalY, {
      fontSize: layout.skillDescFontSize,
      color: PANEL_MUTED_COLOR,
      wrapWidth: layout.skillDescWidth,
    });
    return { name: nameLabel, desc: descLabel, icon: built.sprite };
  };

  CHARACTER_ROSTER.forEach((character) => {
    const view = initialViews.find((entry) => entry.id === character.id) ?? initialViews[0]!;    const group = new CocosNode(`codex-class-${character.id}`);
    group.layer = Layers.Enum.UI_2D;
    group.parent = panel;
    group.setPosition(0, 0, 0);

    const skillNames: Label[] = [];
    const skillDescs: Label[] = [];
    const icons: (Sprite | null)[] = [];
    view.exclusives.skills.forEach((entry, index) => {
      const box = layout.skillCards[index];
      if (box === undefined) return;
      const card = buildSkillCard(group, `codex-skill-${character.id}-${index}`, box, entry);
      skillNames.push(card.name);
      skillDescs.push(card.desc);
      icons.push(card.icon);
    });

    const evolution = createWell(
      group,
      `codex-evolution-${character.id}`,
      frames,
      layout.evolution,
      EVOLUTION_TINT,
    );
    const evolutionIconBuilt = createPortraitSpriteNode(
      evolution,
      'icon-frame',
      layout.evolutionIconSize,
      layout.evolutionIconSize,
      skillFrames.get(view.exclusives.evolution.id) ?? null,
    );
    evolutionIconBuilt.node.setPosition(layout.evolutionIconLocalX, layout.evolutionIconLocalY, 0);
    evolutionIconBuilt.node.active = skillFrames.has(view.exclusives.evolution.id);

    const evolutionName = addText(
      evolution,
      'evolution-name',
      evolutionTitle(view.exclusives.evolution, locale),
      layout.evolutionNameLocalX,
      layout.evolutionNameLocalY,
      {
        fontSize: layout.evolutionNameFontSize,
        color: EVOLUTION_TITLE_COLOR,
        wrapWidth: layout.evolutionDescWidth,
      },
    );
    const evolutionRecipe = addText(
      evolution,
      'evolution-recipe',
      evolutionRecipeLine(view.exclusives.evolution, locale),
      layout.evolutionRecipeLocalX,
      layout.evolutionRecipeLocalY,
      {
        fontSize: layout.evolutionRecipeFontSize,
        color: WEAPON_LABEL_COLOR,
        wrapWidth: layout.evolutionDescWidth,
      },
    );
    const evolutionDesc = addText(
      evolution,
      'evolution-desc',
      view.exclusives.evolution.description,
      layout.evolutionDescLocalX,
      layout.evolutionDescLocalY,
      {
        fontSize: layout.evolutionDescFontSize,
        color: PANEL_MUTED_COLOR,
        wrapWidth: layout.evolutionDescWidth,
      },
    );

    classCards.set(character.id, {
      group,
      skillNames,
      skillDescs,
      evolutionName,
      evolutionRecipe,
      evolutionDesc,
      icons,
      evolutionIcon: evolutionIconBuilt.sprite,
    });
  });

  // --- Left-column class tabs ---
  interface TabRefs {
    readonly control: InteractiveControl;
    readonly portrait: Sprite;
    readonly badge: Label;
    readonly name: Label;
    readonly badgePlate: Node;
  }

  const tabControls: InteractiveControl[] = [];
  const tabRefs = new Map<CharacterId, TabRefs>();

  CHARACTER_ROSTER.forEach((character, index) => {
    const slot = layout.tabs[index];
    if (slot === undefined) return;

    const tab = new CocosNode(`codex-tab-${character.id}`);
    tab.layer = Layers.Enum.UI_2D;
    tab.parent = root;
    tab.setPosition(slot.x, slot.y, 0);
    const transform: UITransform =
      tab.getComponent(CocosUITransform) ?? tab.addComponent(CocosUITransform);
    // +4 px hit area so the 0.25em-anchored name/badge labels stay inside their parent rect.
    transform.setContentSize(slot.size + 4, slot.size + 4);

    addSlicedSpriteNode(tab, 'rim', frames.shadow, slot.size, slot.size, PANEL_RIM_TINT);
    const builtPortrait = createPortraitSpriteNode(
      tab,
      `character-portrait-${character.id}`,
      slot.size,
      slot.size,
      portraitFrames.get(character.id) ?? null,
    );

    const tabView = initialViews.find((entry) => entry.id === character.id) ?? initialViews[0]!;
    const namePlate = createBackdropPanel(tab, 'name-plate', 56, 9, NAME_PLATE_ALPHA);
    namePlate.setPosition(0, slot.nameLocalY, 0);
    const nameLabel = addText(tab, 'class-name', tabView.name, 0, slot.nameLocalY, {
      fontSize: 6,
      color: MENU_TITLE_COLOR,
    });

    const badgePlate = createBackdropPanel(
      tab,
      'badge-plate',
      slot.badgeWidth,
      slot.badgeHeight,
      BADGE_PLATE_ALPHA,
    );
    badgePlate.setPosition(0, slot.badgeLocalY, 0);
    const badge = addText(tab, 'lock-badge', '', 0, slot.badgeLocalY, {
      fontSize: 6,
      color: PANEL_MUTED_COLOR,
    });

    const ring = createFocusFrame(tab, frames.focus, slot.size, slot.size);
    const button: Button = tab.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;

    let hovered = false;
    let pressed = false;
    let focused = false;

    const control: InteractiveControl = {
      node: tab,
      setInteraction(nextFocused: boolean, nextHovered: boolean, nextPressed: boolean): void {
        focused = nextFocused;
        hovered = nextHovered;
        pressed = nextPressed;
        const visual = resolveMenuButtonVisualState({ disabled: false, focused, hovered, pressed });
        ring.applyStyle(visual.focusRingStyle);
      },
      isDisabled: (): boolean => false,
    };

    tabControls.push(control);
    tabRefs.set(character.id, {
      control,
      portrait: builtPortrait.sprite,
      badge,
      name: nameLabel,
      badgePlate,
    });
  });

  // --- Primary Select / Early Unlock + Back ---
  const initialHero = CHARACTER_ROSTER[highlightedTabIndex] ?? CHARACTER_ROSTER[0]!;
  const primaryBuilt = createDynamicButtonControl(
    root,
    'codex-primary-action',
    formatCharacterPrimaryAction(initialHero, currentSave, locale),
    frames,
    layout.primaryButton,
  );
  tabControls.push(primaryBuilt.control);

  const backBuilt = createDynamicButtonControl(
    root,
    'codex-back',
    { label: t('common.back'), disabled: false },
    frames,
    layout.backButton,
  );
  tabControls.push(backBuilt.control);

  const controls = tabControls;

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

  // Live rigged preview on the UI layer (idle 4-direction sheet + hand/back weapon attachment).
  let previewNode: Node | null = null;
  let previewCharacterId: CharacterId | null = null;

  let previewToken = 0;

  const buildPreview = (character: CharacterDef): void => {
    previewCharacterId = character.id;
    const token = ++previewToken;
    if (previewNode !== null && previewNode.isValid) previewNode.destroy();
    previewNode = null;
    const loadedManifest = manifest;
    if (loadedManifest === null) return;

    // First frame before the node exists: an active Sprite with a null frame would show up in
    // `__yokai.placeholders()` while the sprint sheet is still loading.
    const idleKey = resolveCharacterAnimKey(loadedManifest, character, 'idle', 'down');
    const entry = loadedManifest.sprites[idleKey];
    if (entry === undefined) return;
    void getFrame(entry, 'down', 0)
      .catch(() => null)
      .then((frame) => {
        if (
          frame === null ||
          destroyed ||
          token !== previewToken ||
          !root.isValid
        ) {
          return;
        }

        const container = new CocosNode('codex-preview');
        container.layer = Layers.Enum.UI_2D;
        container.parent = root;
        container.setPosition(PREVIEW_X, PREVIEW_Y, 0);
        container.setScale(PREVIEW_SCALE, PREVIEW_SCALE, 1);

        const body = new CocosNode('codex-preview-body');
        body.layer = Layers.Enum.UI_2D;
        body.parent = container;

        const sprite: Sprite = body.addComponent(CocosSprite);
        sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
        sprite.trim = false;
        sprite.spriteFrame = frame;

        const animator: SpriteAnimator = body.addComponent(SpriteAnimator);
        animator.play(idleKey, 'down');

        const attachment = new PlayerAttachmentView({
          parent: container,
          bodyNode: body,
          manifest: loadedManifest,
          attachments,
          character,
          initialPose: { animation: 'idle', direction: 'down', frame: 0 },
        });
        const rig: MenuBackdropActorRig = container.addComponent(MenuBackdropActorRig);
        rig.bind(animator, attachment);

        previewNode = container;
      });
  };

  let views: readonly CharacterCodexView[] = initialViews;

  syncVisuals = (): void => {
    if (destroyed || !root.isValid) return;

    views = buildSkillCodex(currentSave, locale);
    const hero = CHARACTER_ROSTER[highlightedTabIndex] ?? CHARACTER_ROSTER[0]!;
    const view = views.find((entry) => entry.id === hero.id) ?? views[0]!;
    if (previewCharacterId !== hero.id) buildPreview(hero);

    status.string = formatCharacterSummaryLines(hero, currentSave, locale).statusLine;
    status.color = statusColor(view);
    gold.string = t('title.goldLine', { gold: currentSave.gold }, locale);
    stats.string = statsLine(view, locale);
    weapon.string = view.stats.weaponLine;
    passiveHeading.string = `${view.passive.heading} · ${view.passive.name}`;
    passiveBody.string = view.passive.description;
    activeHeading.string = `${view.active.heading} · ${view.active.name} · ${view.active.cooldownLabel}`;
    activeBody.string = view.active.description;
    exclusivesHeading.string = view.exclusives.heading;

    for (const character of CHARACTER_ROSTER) {
      const classView = views.find((entry) => entry.id === character.id) ?? view;
      const cards = classCards.get(character.id);
      if (cards !== undefined) {
        cards.group.active = character.id === hero.id;
        cards.skillNames.forEach((label, idx) => {
          label.string = classView.exclusives.skills[idx]?.name ?? '';
        });
        cards.skillDescs.forEach((label, idx) => {
          label.string = classView.exclusives.skills[idx]?.description ?? '';
        });
        cards.evolutionName.string = evolutionTitle(classView.exclusives.evolution, locale);
        cards.evolutionRecipe.string = evolutionRecipeLine(classView.exclusives.evolution, locale);
        cards.evolutionDesc.string = classView.exclusives.evolution.description;
      }

      const tab = tabRefs.get(character.id);
      if (tab !== undefined) {
        const unlocked = isCharacterUnlocked(character.id, currentSave);
        tab.portrait.color = unlocked ? TAB_UNLOCKED_TINT : TAB_LOCKED_TINT;
        tab.name.string = classView.name;
        tab.name.color = unlocked ? MENU_TITLE_COLOR : PANEL_MUTED_COLOR;
        const locked = !unlocked;
        tab.badge.string = badgeLabel(classView, locale);
        tab.badge.color = locked ? LOCKED_STATUS_COLOR : statusColor(classView);
      }
    }

    primaryBuilt.updateSpec(formatCharacterPrimaryAction(hero, currentSave, locale));

    controls.forEach((control, idx) => {
      control.setInteraction(
        idx === focusedIndex,
        idx === hoveredIndex,
        idx === pressedIndex,
      );
    });
  };

  syncVisuals();

  // The preview rig (animation manifest + weapon attachments) loads in the background: the panel
  // and tabs are usable immediately, and the live sprite appears as soon as its assets are ready.
  void Promise.all([
    loadAnimationManifest().catch(() => null),
    loadPreviewAttachments(),
  ]).then(([loadedManifest, loadedAttachments]) => {
    if (destroyed || !root.isValid) return;
    manifest = loadedManifest;
    attachments = loadedAttachments;
    previewCharacterId = null;
    syncVisuals?.();
  });

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

/** `Class Evolution · <name>` title line for the Evolution card. */
function evolutionTitle(entry: CodexEvolutionEntry, locale: Locale): string {
  return `${t('codex.evolutionHeading', undefined, locale)} · ${entry.name}`;
}

/** `Recipe: <a> + <b>` from the Evolution's two prerequisite class skills. */
function evolutionRecipeLine(entry: CodexEvolutionEntry, locale: Locale): string {
  return t(
    'codex.recipe',
    { a: entry.recipe[0].name, b: entry.recipe[1].name },
    locale,
  );
}

interface DynamicButtonSpec {
  readonly label: string;
  readonly detail?: string;
  readonly disabled: boolean;
}

function createDynamicButtonControl(
  parent: Node,
  name: string,
  initialSpec: DynamicButtonSpec | CharacterPrimaryActionSpec,
  frames: MenuFrames,
  box: MenuButtonBox,
): {
  readonly control: InteractiveControl;
  readonly updateSpec: (spec: DynamicButtonSpec | CharacterPrimaryActionSpec) => void;
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
  sizeLabelText(label, initialSpec.label);
  label.node.setPosition(0, textLayout.labelY, 0);

  let detail: Label | null = null;
  if (hasDetail) {
    detail = createLabel(node, 'detail', initialSpec.detail ?? '');
    detail.fontSize = textLayout.detailFontSize;
    detail.lineHeight = textLayout.detailLineHeight;
    sizeLabelText(detail, initialSpec.detail ?? '');
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
                : CARD_SELECTED_TINT;

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
    updateSpec(spec: DynamicButtonSpec | CharacterPrimaryActionSpec): void {
      disabled = spec.disabled;
      label.string = spec.label;
      sizeLabelText(label, spec.label);
      if (detail !== null && spec.detail !== undefined) {
        detail.string = spec.detail;
        sizeLabelText(detail, spec.detail);
      }
      applyVisual();
    },
  };
}

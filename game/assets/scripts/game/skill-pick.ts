/**
 * Màn chọn 1 trong 3 skill sau khi dọn phòng (GDD §6, §9).
 *
 * Dựng 100% bằng code, không sửa scene/prefab. Ba thẻ hiện tên, rarity (màu),
 * hiệu ứng và stack hiện có; chọn bằng **click chuột hoặc phím 1/2/3**.
 *
 * File này chỉ là adapter UI: danh sách thẻ do `core/skills/roll.ts` quyết
 * (seed của run), luật stack do `core/skills/loadout.ts` quyết khi nhặt.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Input,
  KeyCode,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  input,
} from 'cc';
import { describeSkill } from '../core/skills/description';
import type { SkillDef } from '../core/skills/pool';
import { loadTexture } from './assets/texture-cache';
import { RARITY_COLORS, createLabel } from './hud';
import { sliceFrame } from './level-view';
import type { TileRect } from './level-view';

/** `cc` là any module: tên import chỉ dùng được ở vị trí value. */
type Button = InstanceType<typeof CocosButton>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

const CARD_SHEET = 'resources/art/ui/theme-wood/button_normal.png';
const CARD_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };
const CARD_WIDTH = 140;
const CARD_HEIGHT = 150;
const CARD_GAP = 12;
const CARD_Y = -12;

const TITLE_COLOR = new CocosColor(255, 230, 120, 255);
const TEXT_COLOR = new CocosColor(238, 238, 238, 255);
const MUTED_COLOR = new CocosColor(170, 170, 170, 255);
const CARD_TINT = new CocosColor(126, 100, 74, 255);
const DIM_COLOR = new CocosColor(10, 8, 16, 210);

const HOTKEY_CODES = [KeyCode.KEY_1, KeyCode.KEY_2, KeyCode.KEY_3] as const;

export interface SkillPickOptions {
  readonly choices: readonly SkillDef[];
  /** Stack hiện có theo id. */
  readonly owned: ReadonlyMap<string, number>;
  readonly onPick: (index: number) => void;
}

/** Màn đã dựng; gọi `destroy()` khi chọn xong hoặc rời run. */
export interface SkillPickScreen {
  readonly node: Node;
  destroy(): void;
}

interface KeyEvent {
  readonly keyCode: number;
}

/**
 * Dựng màn chọn dưới `parent` (node UI canvas). Trả ngay; texture nút load
 * bất đồng bộ nên hàm là `async`.
 */
export async function buildSkillPick(
  parent: Node,
  options: SkillPickOptions,
): Promise<SkillPickScreen> {
  // Nghe phím **trước** khi load texture: người chơi có thể bấm 1/2/3 ngay frame
  // status đổi sang 'skill-pick', trước khi asset kịp về.
  let picked = false;
  const pick = (index: number): void => {
    if (picked) return;
    if (index < 0 || index >= options.choices.length) return;
    picked = true;
    options.onPick(index);
  };
  const onKey = (event: KeyEvent): void => {
    const index = HOTKEY_CODES.findIndex((code) => code === event.keyCode);
    if (index >= 0) pick(index);
  };
  // Hai đường nghe: `input` của Cocos (giống player WASD) và DOM. DOM là đường
  // dự phòng cho môi trường không gắn keyCode vào event engine (headless CDP gửi
  // `key`/`code` nhưng Cocos có thể đọc `keyCode` = 0). `picked` chặn trùng.
  const onDomKey = (event: KeyboardEvent): void => {
    const digit = /^Digit([1-3])$/.exec(event.code) ?? /^([1-3])$/.exec(event.key);
    if (digit !== null) pick(Number(digit[1]) - 1);
  };
  input.on(Input.EventType.KEY_DOWN, onKey);
  // Capture phase: Cocos gắn listener phím trên canvas và có thể chặn bubble của
  // sự kiện; capture ở document luôn chạy trước. `picked` chặn trùng.
  document.addEventListener('keydown', onDomKey, true);

  let texture;
  try {
    texture = await loadTexture(CARD_SHEET);
  } catch (error: unknown) {
    input.off(Input.EventType.KEY_DOWN, onKey);
    document.removeEventListener('keydown', onDomKey);
    throw error;
  }
  const frame = sliceFrame(texture, CARD_RECT);

  const root = new CocosNode('skill-pick');
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  addDim(root, frame);

  const title = createLabel(root, 'skill-pick-title', 'CHOOSE A SKILL');
  title.fontSize = 20;
  title.lineHeight = 24;
  title.color = TITLE_COLOR;
  title.node.setPosition(0, 112, 0);

  const subtitle = createLabel(root, 'skill-pick-hint', 'Click a card or press 1 / 2 / 3');
  subtitle.fontSize = 10;
  subtitle.color = MUTED_COLOR;
  subtitle.node.setPosition(0, 92, 0);

  const count = options.choices.length;
  const rowWidth = count * CARD_WIDTH + Math.max(0, count - 1) * CARD_GAP;
  const firstX = -rowWidth / 2 + CARD_WIDTH / 2;

  options.choices.forEach((skill, index) => {
    const x = firstX + index * (CARD_WIDTH + CARD_GAP);
    const stacks = options.owned.get(skill.id) ?? 0;
    makeCard(root, frame, skill, stacks, index + 1, x, () => pick(index));
  });

  return {
    node: root,
    destroy(): void {
      input.off(Input.EventType.KEY_DOWN, onKey);
      document.removeEventListener('keydown', onDomKey, true);
      if (root.isValid) root.destroy();
    },
  };
}

/** Nền tối phủ cả màn để thẻ nổi bật, không phải nhìn xuyên qua phòng. */
function addDim(parent: Node, frame: SpriteFrame): void {
  const node = new CocosNode('skill-pick-dim');
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;
  sprite.color = DIM_COLOR;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(512, 288);
  node.setPosition(0, 0, -1);
}

function makeCard(
  parent: Node,
  frame: SpriteFrame,
  skill: SkillDef,
  stacks: number,
  hotkey: number,
  x: number,
  onPick: () => void,
): void {
  const node = new CocosNode(`skill-card-${skill.id}`);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(x, CARD_Y, 0);

  const sprite: Sprite = node.addComponent(CocosSprite);
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

  const name = createLabel(node, 'name', skill.name);
  name.fontSize = 13;
  name.lineHeight = 15;
  name.color = TEXT_COLOR;
  name.node.setPosition(0, CARD_HEIGHT / 2 - 28, 0);

  const rarity = createLabel(node, 'rarity', skill.rarity.toUpperCase());
  rarity.fontSize = 9;
  rarity.color = RARITY_COLORS[skill.rarity];
  rarity.node.setPosition(0, CARD_HEIGHT / 2 - 46, 0);

  const effect = createLabel(node, 'effect', describeSkill(skill));
  effect.fontSize = 9;
  effect.lineHeight = 11;
  effect.color = TEXT_COLOR;
  effect.enableWrapText = true;
  effect.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;
  const effectTransform: UITransform | null = effect.node.getComponent(CocosUITransform);
  if (effectTransform !== null) effectTransform.setContentSize(CARD_WIDTH - 16, 60);
  effect.node.setPosition(0, 4, 0);

  const stackLine =
    stacks <= 0 ? 'NEW' : `Stack ${stacks} / ${skill.maxStacks}`;
  const stack = createLabel(node, 'stack', stackLine);
  stack.fontSize = 9;
  stack.color = stacks > 0 ? RARITY_COLORS[skill.rarity] : MUTED_COLOR;
  stack.node.setPosition(0, -CARD_HEIGHT / 2 + 12, 0);
}

/**
 * HUD tối thiểu: hàng tim, vàng kiếm trong run, nhãn phòng.
 *
 * Đây là UI thật (Canvas + Camera UI_2D riêng) chứ không phải sprite trong world: HUD
 * phải đứng yên khi camera world đổi, và toạ độ UI tính theo pixel design 512×288.
 *
 * Hai TODO có chủ ý:
 * - `TODO(ui)`: font pixel của pack. Pack đã stage không có file font (`.ttf`/`.fnt`),
 *   nên đang dùng font hệ thống của engine. Thêm font vào `resources/art/ui/` rồi gán
 *   `Label.font` là xong, không phải đổi layout.
 * - `TODO(ui)`: icon vàng + khung nine-path. Art đã stage (`ui/theme-wood`), nhưng cần
 *   set Border trong Sprite Editor trước (import-checklist §2.4) nên chưa làm ở đây.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Graphics as CocosGraphics,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  view,
} from 'cc';
import { loadPixelTexture } from './assets/texture-cache';
import type { OwnedSkillStacks } from '../core/skills/pool';
import { skillAbbreviation } from '../core/skills/description';
import { applyPixelFont } from './ui-font';
import { sliceFrame } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** `Heart.png` 80×16 = 5 trạng thái 16×16 xếp ngang, rỗng → đầy (import-checklist §3.5). */
export const HEART_SHEET = 'resources/art/ui/Heart.png';
/** Nền thanh máu boss — dùng lại nút gỗ của pack, tint theo trạng thái. */
const BAR_SHEET = 'resources/art/ui/theme-wood/button_normal.png';
const BAR_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };

const HEART_SIZE_PX = 16;
/** Trạng thái 0 = tim rỗng (xám); trạng thái 4 = tim đầy (đỏ). */
const HEART_EMPTY_INDEX = 0;
const HEART_FULL_INDEX = 4;
/** Khoảng cách giữa hai tim, px design (16 px tim + 2 px thở). */
const HEART_SPACING_PX = 18;

const TEXT_COLOR = new CocosColor(255, 255, 255, 255);
const LABEL_FONT_SIZE = 12;

/** Màu rarity dùng chung cho thẻ skill và hàng skill HUD. */
export const RARITY_COLORS = {
  common: new CocosColor(222, 222, 222, 255),
  rare: new CocosColor(110, 170, 255, 255),
  epic: new CocosColor(200, 140, 255, 255),
} as const;

/** Số ô skill tối đa trên HUD (GDD §9: tối đa 8). */
const SKILL_SLOTS = 8;
const SKILL_SLOT_WIDTH_PX = 34;

/** Thanh máu boss. */
const BOSS_BAR_WIDTH_PX = 180;
const BOSS_BAR_HEIGHT_PX = 8;
const BOSS_BAR_TOP_PX = 20;
const BOSS_FILL_COLOR = new CocosColor(232, 74, 74, 255);
const BOSS_BG_COLOR = new CocosColor(44, 30, 30, 255);

/** Chỗ đặt HUD, tính từ mép trên-trái / trên-phải của màn hình design. */
const PADDING_PX = 8;
const HEART_ROW_TOP_PX = 10;
const GOLD_ROW_TOP_PX = 28;

function heartRect(index: number): TileRect {
  return {
    x: index * HEART_SIZE_PX,
    y: 0,
    width: HEART_SIZE_PX,
    height: HEART_SIZE_PX,
  };
}

@ccclass('Hud')
export class Hud extends Component {
  private readonly heartNodes: Node[] = [];
  private maxHeartNodes = 0;
  private lastHearts = 0;
  private frames: {
    readonly full: SpriteFrame;
    readonly empty: SpriteFrame;
  } | null = null;
  private roomLabel: Label | null = null;
  private goldLabel: Label | null = null;
  private shownHearts = -1;
  private shownRoom = '';
  private shownGold = -1;

  /** Ô skill HUD: chữ tắt + stack, tô màu rarity. Tạo một lần, ẩn khi rỗng. */
  private readonly skillLabels: Label[] = [];
  private skillRowBackdrop: Node | null = null;
  private shownSkills = '';

  /** Thanh máu boss: nền + fill (anchor trái) + nhãn tên/phase. */
  private bossRoot: Node | null = null;
  private bossFill: Node | null = null;
  private bossTitle: Label | null = null;
  private shownBoss = '';

  /**
   * Dựng HUD. `node` này phải là con của một `Canvas` (bootstrap tạo), nếu không
   * sẽ không có gì được vẽ.
   */
  async init(maxHearts: number, roomText: string): Promise<void> {
    const [texture, barTexture] = await Promise.all([
      loadPixelTexture(HEART_SHEET),
      loadPixelTexture(BAR_SHEET),
    ]);
    const frames = {
      full: sliceFrame(texture, heartRect(HEART_FULL_INDEX)),
      empty: sliceFrame(texture, heartRect(HEART_EMPTY_INDEX)),
    };
    this.frames = frames;
    const barFrame = sliceFrame(barTexture, BAR_RECT);

    const size = view.getVisibleSize();
    const left = -size.width / 2 + PADDING_PX;
    const top = size.height / 2 - HEART_ROW_TOP_PX;

    this.ensureHeartNodes(maxHearts, left, top);

    this.roomLabel = createLabel(this.node, 'room-label', roomText);
    this.roomLabel.node.setPosition(size.width / 2 - PADDING_PX, top, 0);

    // Placeholder: chưa có meta/save nối vào run (M4). Vẫn hiện số 0 để HUD có đủ ô.
    this.goldLabel = createLabel(this.node, 'gold-label', 'Gold 0');
    this.goldLabel.node.setPosition(left, top - GOLD_ROW_TOP_PX, 0);
    // Neo trái để chữ bắt đầu đúng lề trái thay vì bị đẩy ra ngoài màn hình.
    const goldTransform: UITransform | null = this.goldLabel.node.getComponent(CocosUITransform);
    if (goldTransform !== null) goldTransform.setAnchorPoint(0, 0.5);

    this.createSkillRow(left, -size.height / 2 + 12);
    this.createBossBar(barFrame, size.height);

    this.setRoomLabel(roomText);
    this.setHearts(maxHearts);
    this.setGold(0);
    this.setSkills([]);
  }

  /** Cập nhật hàng tim; chỉ đổi spriteFrame khi số tim thật sự đổi. */
  setHearts(hearts: number): void {
    const frames = this.frames;
    if (frames === null || hearts === this.shownHearts) return;
    this.shownHearts = hearts;
    this.lastHearts = hearts;

    this.heartNodes.forEach((node, index) => {
      const sprite: Sprite | null = node.getComponent(CocosSprite);
      if (sprite === null) return;
      node.active = index < this.maxHeartNodes;
      sprite.spriteFrame = index < hearts ? frames.full : frames.empty;
    });
  }

  /** Vitality có thể nâng trần giữa run: thêm ô tim thay vì vẽ thiếu. */
  setMaxHearts(maxHearts: number): void {
    const frames = this.frames;
    if (frames === null || maxHearts === this.maxHeartNodes) return;

    const size = view.getVisibleSize();
    this.ensureHeartNodes(maxHearts, -size.width / 2 + PADDING_PX, size.height / 2 - HEART_ROW_TOP_PX);
    // Buộc vẽ lại vì số ô đổi nhưng số tim hiện tại có thể không đổi.
    this.shownHearts = -1;
    this.setHearts(this.lastHearts);
  }

  /** Nhãn `3/9` của `RunState.roomLabel`. */
  setRoomLabel(text: string): void {
    const label = this.roomLabel;
    if (label === null || text === this.shownRoom) return;
    this.shownRoom = text;
    label.string = text;
    // Nhãn neo phải-trên để mép phải luôn cách lề PADDING_PX dù nội dung dài ngắn.
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(1, 0.5);
    label.node.setPosition(view.getVisibleSize().width / 2 - PADDING_PX, label.node.position.y, 0);
  }

  /** Vàng kiếm trong run (M5); shop hiện tổng trong save. */
  setGold(gold: number): void {
    const label = this.goldLabel;
    if (label === null || gold === this.shownGold) return;
    this.shownGold = gold;
    label.string = `Gold ${gold}`;
  }

  /**
   * Hàng skill đã nhặt: chữ tắt + stack (GDD §9 "icon skill, tối đa 8").
   * Không có icon art cho skill trong pack nên dùng chữ tắt, tô màu rarity.
   */
  setSkills(entries: readonly OwnedSkillStacks[]): void {
    // Không có skill thì ẩn luôn dải nền tối, đừng để một thanh đen trống ở HUD.
    if (this.skillRowBackdrop !== null) this.skillRowBackdrop.active = entries.length > 0;
    const signature = entries
      .map((entry) => `${entry.def.id}:${entry.stacks}`)
      .join(',');
    if (signature === this.shownSkills) return;
    this.shownSkills = signature;

    const shown = entries.slice(0, SKILL_SLOTS);
    for (let index = 0; index < this.skillLabels.length; index += 1) {
      const label = this.skillLabels[index];
      if (label === null) continue;
      const entry = shown[index];
      if (entry === undefined) {
        label.node.active = false;
        continue;
      }
      label.node.active = true;
      label.string = `${skillAbbreviation(entry.def)}${entry.stacks > 1 ? entry.stacks : ''}`;
      label.color = RARITY_COLORS[entry.def.rarity];
    }

    // Quá 8 skill: ô cuối báo phần còn lại thay vì im lặng cắt.
    const extra = entries.length - SKILL_SLOTS;
    if (extra > 0) {
      const last = this.skillLabels[SKILL_SLOTS - 1];
      if (last !== null && last !== undefined) last.string = `+${extra}`;
    }
  }

  /** Hiện/ẩn thanh máu boss. `hp === null` để ẩn. */
  setBoss(
    info: { readonly name: string; readonly hp: number; readonly maxHp: number; readonly phase: number } | null,
  ): void {
    const root = this.bossRoot;
    const fill = this.bossFill;
    if (root === null || fill === null) return;

    if (info === null) {
      if (root.active) root.active = false;
      this.shownBoss = '';
      return;
    }

    if (!root.active) root.active = true;
    const key = `${info.name}:${info.phase}`;
    if (key !== this.shownBoss) {
      this.shownBoss = key;
      const title = this.bossTitle;
      if (title !== null) title.string = `${info.name}  ·  PHASE ${info.phase}`;
    }

    const fraction = info.maxHp > 0 ? Math.min(1, Math.max(0, info.hp / info.maxHp)) : 0;
    // Anchor trái: scale.x thu ngắn thanh từ bên phải.
    fill.setScale(fraction, 1, 1);
  }

  private createSkillRow(left: number, y: number): void {
    // Nền tối bán trong suốt: chữ tắt phải đọc được trên sàn vàng/xanh/trắng.
    const width = SKILL_SLOTS * SKILL_SLOT_WIDTH_PX - 8;
    const backdrop = createBackdropPanel(this.node, 'skill-row-backdrop', width, 18, 150);
    backdrop.setPosition(left + width / 2 - 4, y, 0);
    backdrop.active = false;
    this.skillRowBackdrop = backdrop;

    for (let index = 0; index < SKILL_SLOTS; index += 1) {
      const label = createLabel(this.node, `skill-${index}`, '');
      label.fontSize = 9;
      label.lineHeight = 11;
      label.node.setPosition(left + index * SKILL_SLOT_WIDTH_PX, y, 0);
      const transform: UITransform | null = label.node.getComponent(CocosUITransform);
      if (transform !== null) transform.setAnchorPoint(0, 0.5);
      label.node.active = false;
      this.skillLabels.push(label);
    }
  }

  private createBossBar(
    frame: SpriteFrame,
    height: number,
  ): void {
    const root = new CocosNode('boss-bar');
    root.layer = Layers.Enum.UI_2D;
    root.parent = this.node;
    root.setPosition(0, height / 2 - BOSS_BAR_TOP_PX - BOSS_BAR_HEIGHT_PX, 0);

    this.makeBar('boss-bg', frame, BOSS_BG_COLOR, root);
    this.bossFill = this.makeBar('boss-fill', frame, BOSS_FILL_COLOR, root);

    const title = createLabel(root, 'boss-title', '');
    title.fontSize = 10;
    title.lineHeight = 12;
    title.node.setPosition(0, BOSS_BAR_HEIGHT_PX + 2, 0);
    this.bossTitle = title;

    root.active = false;
    this.bossRoot = root;
  }

  /** Một thanh: sprite gỗ tint màu, neo trái để scale.x = tỉ lệ máu. */
  private makeBar(
    name: string,
    frame: SpriteFrame,
    color: Color,
    parent: Node,
  ): Node {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frame;
    sprite.color = color;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(BOSS_BAR_WIDTH_PX, BOSS_BAR_HEIGHT_PX);
      // Neo trái: scale.x thu từ phải về trái, đầu thanh không nhảy.
      transform.setAnchorPoint(0, 0.5);
    }
    node.setPosition(-BOSS_BAR_WIDTH_PX / 2, 0, 0);
    return node;
  }

  /** Tạo thêm ô tim khi trần máu tăng; ô dư bị ẩn thay vì xoá. */
  private ensureHeartNodes(maxHearts: number, left: number, top: number): void {
    const frames = this.frames;
    if (frames === null) return;
    this.maxHeartNodes = Math.max(0, Math.floor(maxHearts));

    for (let index = 0; index < this.maxHeartNodes; index += 1) {
      if (this.heartNodes[index] !== undefined) continue;
      const node = this.makeSprite(`heart-${index}`, frames.full);
      node.setPosition(left + index * HEART_SPACING_PX + HEART_SIZE_PX / 2, top, 0);
      this.heartNodes.push(node);
    }
  }

  private makeSprite(name: string, frame: SpriteFrame): Node {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.spriteFrame = frame;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(HEART_SIZE_PX, HEART_SIZE_PX);

    return node;
  }
}

/**
 * Tấm nền tối bán trong suốt, vẽ bằng `Graphics` (không cần texture).
 *
 * Dùng cho hàng skill HUD và banner giữa màn: sàn chapter 3 sáng/vàng làm chữ
 * trắng hoặc banner vàng không đọc được nếu không có nền.
 */
export function createBackdropPanel(
  parent: Node,
  name: string,
  width: number,
  height: number,
  alpha = 160,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = new CocosColor(8, 7, 12, Math.min(255, Math.max(0, alpha)));
  graphics.rect(-width / 2, -height / 2, width, height);
  graphics.fill();

  return node;
}

/**
 * Tạo một node `Label` con của `parent` (phải nằm dưới Canvas).
 *
 * Export để `bootstrap` dùng lại cho màn hình lỗi load — màn đó cần chữ to, đỏ, không
 * phụ thuộc HUD đã dựng xong hay chưa.
 */
export function createLabel(parent: Node, name: string, text: string): Label {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const label: Label = node.addComponent(CocosLabel);
  label.string = text;
  label.fontSize = LABEL_FONT_SIZE;
  label.lineHeight = LABEL_FONT_SIZE + 2;
  label.color = TEXT_COLOR;
  // Font pixel của pack (NormalFont.ttf); load async nên label đổi font khi về.
  applyPixelFont(label);

  return label;
}

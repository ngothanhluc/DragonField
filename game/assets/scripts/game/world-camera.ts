/**
 * Dựng camera world + camera nền letterbox và giữ band 16:9 đúng khi canvas đổi.
 *
 * Trước M6 code này nằm trong `bootstrap.ts`; tách ra để run-flow không phình và
 * để quy ước camera chỉ có một chỗ.
 */
import {
  Camera as CocosCamera,
  Canvas as CocosCanvas,
  Color as CocosColor,
  Layers,
  Node as CocosNode,
  director,
  view,
} from 'cc';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import { FEEL_TUNING } from '../core/enemies/tuning';
import { ScreenShake } from '../core/feel/screen-shake';
import { applyWorldLetterbox, fillBrowserViewport } from './viewport';

type Camera = InstanceType<typeof CocosCamera>;
type Node = InstanceType<typeof CocosNode>;

const CAMERA_ORTHO_HEIGHT = ROOM_ROWS / 2;
const ROOM_CENTER = { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 };
const CAMERA_Z = 1000;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 2000;
const BACKDROP_COLOR = new CocosColor(14, 12, 20, 255);

export class WorldCamera {
  private readonly camera: Camera;
  private readonly designWidth: number;
  private readonly designHeight: number;
  /**
   * Trauma shake của **camera world** (không phải HUD): offset cộng vào vị trí
   * camera mỗi frame, không cộng dồn nên không trôi. `bootstrap` tắt theo setting.
   */
  readonly shake = new ScreenShake(FEEL_TUNING.shake, Math.random);
  /** Tỉ lệ band world / band UI hiện tại (≤ 1); HUD nhân node theo số này. */
  hudScale = 1;
  /** Gọi mỗi lần band world đổi (resize, fullscreen). */
  onViewportChange: ((hudScale: number) => void) | null = null;

  constructor(parent: Node, designWidth: number, designHeight: number) {
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    this.camera = this.pickWorldCamera(parent);

    this.camera.projection = CocosCamera.ProjectionType.ORTHO;
    this.camera.orthoHeight = CAMERA_ORTHO_HEIGHT;
    this.camera.visibility = Layers.Enum.DEFAULT;
    this.camera.priority = 0;
    this.camera.clearFlags = CocosCamera.ClearFlag.SOLID_COLOR;
    this.camera.clearColor = BACKDROP_COLOR;
    this.camera.near = CAMERA_NEAR;
    this.camera.far = CAMERA_FAR;
    this.camera.node.setPosition(ROOM_CENTER.x, ROOM_CENTER.y, CAMERA_Z);

    this.createBackdropCamera(parent);
    this.applyViewport();

    view.on('canvas-resize', this.handleCanvasResize, this);
    window.addEventListener('resize', this.handleWindowResize);
    fillBrowserViewport();
  }

  applyViewport(): void {
    this.hudScale = applyWorldLetterbox(this.camera, this.designWidth, this.designHeight);
    this.onViewportChange?.(this.hudScale);
  }

  /**
   * Một frame: trauma tàn theo thời gian **thật** rồi áp offset nguyên texel vào
   * vị trí camera world. Gọi cả trong hitstop để camera không đứng lệch tâm.
   */
  update(deltaMs: number): void {
    this.shake.update(deltaMs);
    const offset = this.shake.offset();
    this.camera.node.setPosition(
      ROOM_CENTER.x + offset.x,
      ROOM_CENTER.y + offset.y,
      CAMERA_Z,
    );
  }

  destroy(): void {
    view.off('canvas-resize', this.handleCanvasResize, this);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  private readonly handleWindowResize = (): void => {
    fillBrowserViewport();
    this.applyViewport();
  };

  private readonly handleCanvasResize = (): void => {
    this.applyViewport();
  };

  /**
   * Camera nền cho bar letterbox: camera thường chỉ clear trong viewport của nó,
   * nên phần ngoài band 16:9 là backbuffer (màu không đảm bảo); camera này phủ
   * cả canvas nhưng `visibility = 0` (không vẽ layer nào).
   */
  private createBackdropCamera(parent: Node): void {
    const node = new CocosNode('letterbox-camera');
    node.layer = Layers.Enum.DEFAULT;
    node.parent = parent;

    const camera: Camera = node.addComponent(CocosCamera);
    camera.projection = CocosCamera.ProjectionType.ORTHO;
    camera.visibility = 0;
    camera.priority = -1;
    camera.clearFlags = CocosCamera.ClearFlag.SOLID_COLOR;
    camera.clearColor = BACKDROP_COLOR;
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;
    node.setPosition(ROOM_CENTER.x, ROOM_CENTER.y, CAMERA_Z);
  }

  /**
   * Scene 2D mặc định có `Canvas > Camera` và camera đó chỉ thấy UI_2D. Ưu tiên
   * camera **không** nằm dưới Canvas; nếu không có thì tự tạo camera world.
   */
  private pickWorldCamera(parent: Node): Camera {
    const scene = director.getScene();
    const candidates: Camera[] = scene === null ? [] : scene.getComponentsInChildren(CocosCamera);
    const world = candidates.find((candidate) => !hasCanvasAncestor(candidate.node));
    if (world !== undefined) return world;

    const node = new CocosNode('world-camera');
    node.layer = Layers.Enum.DEFAULT;
    node.parent = parent;
    return node.addComponent(CocosCamera);
  }
}

function hasCanvasAncestor(node: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current.getComponent(CocosCanvas) !== null) return true;
    current = current.parent;
  }
  return false;
}

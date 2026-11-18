/**
 * Builds the world camera + letterbox backdrop camera and keeps the 16:9 band correct when the
 * canvas changes.
 *
 * Before M6 this code lived in `bootstrap.ts`; it was split out so run-flow does not grow and
 * the camera convention lives in one place.
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
   * Trauma shake of the **world camera** (not the HUD): the offset is added to the camera
   * position each frame and never accumulated, so it cannot drift. `bootstrap` switches it off per setting.
   */
  readonly shake = new ScreenShake(FEEL_TUNING.shake, Math.random);
  /** Current world band / UI band ratio (≤ 1); the HUD multiplies its node by it. */
  hudScale = 1;
  /** Called whenever the world band changes (resize, fullscreen). */
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
   * One frame: trauma decays over **real** time, then the whole-texel offset is applied to the
   * world camera position. Called even during hitstop so the camera does not freeze off-centre.
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
   * Backdrop camera for the letterbox bars: a normal camera only clears inside its viewport,
   * so the area outside the 16:9 band is backbuffer (no guaranteed colour); this camera covers
   * the whole canvas with `visibility = 0` (drawing no layers).
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
   * A default 2D scene has `Canvas > Camera` and that camera only sees UI_2D. Prefer a camera
   * that is **not** under a Canvas; if there is none, create the world camera.
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

/**
 * Builds the world camera + letterbox backdrop camera and keeps the 16:9 band correct when the
 * canvas changes.
 *
 * Before M6 this code lived in `bootstrap.ts`; it was split out so run-flow does not grow and
 * the camera convention lives in one place.
 *
 * Since M9 (ticket #37) the camera **follows the player** in rooms larger than one screen:
 * `core/camera/follow-camera.ts` owns the deadzone/look-ahead/smoothing/clamp maths, this adapter
 * feeds it the player and applies the result to the Cocos camera node. A 32×18 room (every boss
 * room, every chapter room until #38) clamps to a single centre, so its camera is still static.
 * Screen shake is added here, **after** the follow state, and never fed back into it.
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
import { FollowCamera } from '../core/camera/follow-camera';
import { CAMERA_TUNING, FEEL_TUNING } from '../core/enemies/tuning';
import { ScreenShake } from '../core/feel/screen-shake';
import type { LevelData, RoomSize } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { applyWorldLetterbox, fillBrowserViewport } from './viewport';

type Camera = InstanceType<typeof CocosCamera>;
type Node = InstanceType<typeof CocosNode>;

/** The camera always shows exactly one screen (32×18 tiles); only the room behind it is bigger. */
const VIEW: RoomSize = { cols: ROOM_COLS, rows: ROOM_ROWS };
const CAMERA_Z = 1000;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 2000;
const BACKDROP_COLOR = new CocosColor(14, 12, 20, 255);

/** What the camera follows this frame, in `LevelData` tile units (y down). */
export interface CameraFocus {
  readonly target: Vec2;
  /** Player velocity, tiles/s — the camera looks ahead along it. */
  readonly velocity: Vec2;
}

/** Visible rectangle in world units (bottom-left origin, y up), for `world-culler`. */
export interface WorldViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class WorldCamera {
  private readonly camera: Camera;
  private readonly designWidth: number;
  private readonly designHeight: number;
  /** Follow state; replaced on room entry so a big room starts from a hard cut. */
  private follow = new FollowCamera(VIEW, VIEW, CAMERA_TUNING);
  private room: RoomSize = VIEW;
  /** Over-actors atmosphere node (raylight/fog/ashes/vignette): stays on screen, not in the room. */
  private screenSpaceNode: Node | null = null;
  /** Room height (tiles) of the current room, for the tile y → world y flip. */
  private roomRows = ROOM_ROWS;
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
    this.camera.orthoHeight = VIEW.rows / 2;
    this.camera.visibility = Layers.Enum.DEFAULT;
    this.camera.priority = 0;
    this.camera.clearFlags = CocosCamera.ClearFlag.SOLID_COLOR;
    this.camera.clearColor = BACKDROP_COLOR;
    this.camera.near = CAMERA_NEAR;
    this.camera.far = CAMERA_FAR;
    this.apply();

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
   * Room entry (and every rebuild): hard cut, no smoothing, to the player's start, with the
   * view clamped to the new room. A bigger room therefore starts centred on the player instead
   * of sliding over from the previous room.
   */
  enterRoom(level: LevelData): void {
    this.room = level.size;
    this.roomRows = level.size.rows;
    this.follow = new FollowCamera(level.size, VIEW, CAMERA_TUNING);
    this.follow.reset(level.playerStart);
    this.apply();
  }

  /**
   * Back to the one-screen static view — menus/title, or between runs. Without this the camera
   * would stay panned at the spot where the run ended and the living menu room would be off-centre.
   */
  showScreen(): void {
    this.room = VIEW;
    this.roomRows = ROOM_ROWS;
    this.follow = new FollowCamera(VIEW, VIEW, CAMERA_TUNING);
    this.follow.reset({ x: VIEW.cols / 2, y: VIEW.rows / 2 });
    this.apply();
  }

  /**
   * World nodes that must stay **on screen** instead of scrolling with the room (atmosphere
   * overlays). `null` when the room has none (or it was destroyed with the room).
   */
  setScreenSpaceNode(node: Node | null): void {
    this.screenSpaceNode = node;
    this.apply();
  }

  /**
   * One frame: trauma decays over **real** time, then the follow state advances and the whole
   * offset is applied to the world camera position. Called even during hitstop so the camera
   * does not freeze off-centre; `focus === null` keeps the current centre (menus, loading).
   */
  update(deltaMs: number, focus: CameraFocus | null = null): void {
    this.shake.update(deltaMs);
    if (focus !== null) {
      this.follow.update(focus.target, focus.velocity, Math.max(0, deltaMs) / 1000);
    }
    this.apply();
  }

  /** Camera centre, room tiles (y down), texel-aligned. Screen shake is not included. */
  get position(): Vec2 {
    return this.follow.position;
  }

  /** Size of the room the camera is clamped to (tests/debug). */
  get roomSize(): RoomSize {
    return this.room;
  }

  /** Visible rectangle in world units (bottom-left origin) — what `world-culler` keeps alive. */
  worldViewRect(): WorldViewRect {
    const centre = this.follow.position;
    return {
      x: centre.x - VIEW.cols / 2,
      y: this.roomRows - centre.y - VIEW.rows / 2,
      width: VIEW.cols,
      height: VIEW.rows,
    };
  }

  destroy(): void {
    view.off('canvas-resize', this.handleCanvasResize, this);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  /** Write the follow centre + shake offset to the camera node, and pin screen-space overlays. */
  private apply(): void {
    const centre = this.follow.position;
    const offset = this.shake.offset();
    const worldY = this.roomRows - centre.y;
    this.camera.node.setPosition(centre.x + offset.x, worldY + offset.y, CAMERA_Z);

    const overlay = this.screenSpaceNode;
    if (overlay !== null && overlay.isValid) {
      // Overlay particles are laid out in 0..cols × 0..rows view units: its bottom-left
      // corner is the view's bottom-left corner in the room.
      overlay.setPosition(centre.x - VIEW.cols / 2, worldY - VIEW.rows / 2, 0);
    }
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
    node.setPosition(this.camera.node.position);
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

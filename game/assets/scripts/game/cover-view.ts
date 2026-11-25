/**
 * See-through canopies/roofs and walk-in grass, engine side (#36). **Visual only.**
 *
 * `core/view/cover.ts` owns every rule (`overlayAlphaTarget`, `actorCoverAlpha`, `easeAlpha`);
 * this adapter only feeds it the living bodies and writes the result to node colours:
 *
 * - an overlay sprite (canopy/roof, on the `overlays` layer) eases toward `cover.overlayAlpha`
 *   while the player or an enemy circle overlaps it, back to 1 when nobody is under it;
 * - an actor whose feet stand in grass eases toward `cover.actorInCoverAlpha`;
 * - a copy of the grass drawing (same sprite frame) sits on the `overlays` layer and is shown
 *   only while someone stands inside, so the tips draw over the actor's legs.
 *
 * The actor alpha goes through `Sprite.color`, which is also where the hit/shield/status tints
 * live. Ordering matters: `CoverView.update` runs **after** the combat step, so the alpha it
 * writes is the last word for the frame; the tint code rewrites the RGB (alpha 255) next frame
 * and the fade is re-applied from the eased value. One scratch `Color` per node keeps this
 * allocation-free (`Sprite.color` ignores an assignment of its own internal object).
 */
import { Color as CocosColor, Sprite as CocosSprite } from 'cc';
import type { Node as CocosNode } from 'cc';
import { COVER_TUNING } from '../core/enemies/tuning';
import {
  actorCoverAlpha,
  easeAlpha,
  overlayAlphaTarget,
  type Body,
  type TileArea,
} from '../core/view/cover';
import type { PropView } from './level-view';
import { cullNodesOutside, type CullRect } from './world-culler';

type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type Color = InstanceType<typeof CocosColor>;

/** One living actor (player, enemy, boss) as the cover rules need it. */
export interface CoverBody extends Body {
  readonly node: Node;
  /** Foot y in room tiles (y down) — also the depth-sort key. */
  readonly footY: number;
}

/** The alpha is "there" once it is within one 8-bit step of the target. */
const ALPHA_EPSILON = 1 / 255;

/** Writes sprite alpha on a node and all child sprites with one reused `Color` (no per-frame allocation). */
class Fade {
  private readonly scratch = new CocosColor(255, 255, 255, 255);
  private sprites: Sprite[] = [];
  private cachedChildCount = -1;

  constructor(private readonly node: Node) {
    this.refreshSprites();
  }

  get isValid(): boolean {
    return this.node.isValid;
  }

  set(alpha: number): void {
    if (!this.node.isValid) return;
    if (this.cachedChildCount !== this.node.children.length) {
      this.refreshSprites();
    }

    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    for (const sprite of this.sprites) {
      if (!sprite.isValid) continue;
      const color: Color = sprite.color;
      this.scratch.r = color.r;
      this.scratch.g = color.g;
      this.scratch.b = color.b;
      this.scratch.a = a;
      sprite.color = this.scratch;
    }
  }

  private refreshSprites(): void {
    if (!this.node.isValid) {
      this.sprites = [];
      this.cachedChildCount = -1;
      return;
    }
    this.sprites = this.node.getComponentsInChildren(CocosSprite);
    this.cachedChildCount = this.node.children.length;
  }
}

interface OverlayState {
  readonly area: TileArea;
  readonly fade: Fade;
  alpha: number;
  /** Last value written to the node (skips redundant colour updates). */
  applied: number;
}

interface ActorState {
  readonly fade: Fade;
  alpha: number;
}

interface PatchState {
  readonly node: Node;
  readonly area: TileArea;
}

export class CoverView {
  private readonly overlays: OverlayState[] = [];
  private readonly patches: PatchState[] = [];
  private readonly actors = new Map<Node, ActorState>();
  /** All cover areas of the room, rebuilt on `setProps`. */
  private readonly coverAreas: TileArea[] = [];
  /** Reused `[area]` argument for the point-in-area check (no per-frame array). */
  private readonly oneArea: TileArea[] = [];
  /** Prop nodes this view owns (they live on the shared actor/overlay layers). */
  private readonly owned: Node[] = [];

  /** Take the room's built props: overlay sprites and grass patches to animate. */
  setProps(views: readonly PropView[]): void {
    this.clear();
    for (const view of views) {
      this.owned.push(view.base);

      if (view.overlay !== null && view.overlayArea !== null) {
        this.owned.push(view.overlay);
        this.overlays.push({
          area: view.overlayArea,
          fade: new Fade(view.overlay),
          alpha: 1,
          applied: 1,
        });
      }

      if (view.coverArea !== null) {
        this.coverAreas.push(view.coverArea);
        if (view.tips !== null) {
          this.owned.push(view.tips);
          // Hidden until someone stands in it; the tips sprite is a copy of the same drawing.
          view.tips.active = false;
          this.patches.push({ node: view.tips, area: view.coverArea });
        }
      }
    }
  }

  /**
   * One frame: overlay fade by body overlap, actor fade in grass, grass tips over the legs.
   * `deltaMs` is real time, so a fade keeps moving during hitstop.
   */
  update(deltaMs: number, bodies: readonly CoverBody[]): void {
    const seconds = Math.max(0, deltaMs) / 1000;
    const tuning = COVER_TUNING;

    if (this.overlays.length > 0) {
      for (const overlay of this.overlays) {
        const target = overlayAlphaTarget(overlay.area, bodies, tuning.overlayAlpha);
        const alpha = settle(overlay.alpha, target, seconds, tuning.fadeRate);
        overlay.alpha = alpha;
        if (alpha !== overlay.applied) {
          overlay.applied = alpha;
          overlay.fade.set(alpha);
        }
      }
    }

    if (this.coverAreas.length > 0) {
      for (const body of bodies) {
        const target = actorCoverAlpha(body.position, this.coverAreas, tuning.actorInCoverAlpha);
        let state = this.actors.get(body.node);
        if (state === undefined) {
          if (target === 1) continue;
          state = { fade: new Fade(body.node), alpha: 1 };
          this.actors.set(body.node, state);
        }

        const alpha = settle(state.alpha, target, seconds, tuning.fadeRate);
        state.alpha = alpha;
        // Still fading out of cover: keep writing until it is back to fully opaque.
        state.fade.set(alpha);
        if (target === 1 && alpha === 1) this.actors.delete(body.node);
      }

      if (this.actors.size > bodies.length) this.pruneActors(bodies);

      for (const patch of this.patches) {
        this.oneArea[0] = patch.area;
        const inside = anyInside(this.oneArea, bodies);
        if (patch.node.active !== inside) patch.node.active = inside;
      }
    }
  }

  /** Destroy every prop node this view owns (called on room change). */
  destroy(): void {
    this.clear();
  }

  /**
   * Cull the room's prop sprites by the camera view (#41). They live on the shared actor/overlay
   * layers since #36, outside the room tree `cullWorld` walks, so the room owner passes the view
   * here. Grass tips are re-shown by `update` when someone stands inside, which is harmless: a
   * tip whose patch is off screen is off screen too.
   */
  cullToView(view: CullRect): void {
    cullNodesOutside(this.owned, view);
  }

  private clear(): void {
    for (const node of this.owned) {
      if (node.isValid) node.destroy();
    }
    this.owned.length = 0;
    this.overlays.length = 0;
    this.patches.length = 0;
    this.coverAreas.length = 0;
    this.actors.clear();
  }

  /** Restore actors that left the level (dead enemy, room change) and forget their state. */
  private pruneActors(bodies: readonly CoverBody[]): void {
    const alive = new Set<Node>();
    for (const body of bodies) alive.add(body.node);

    for (const [node, state] of this.actors) {
      if (!node.isValid || !alive.has(node)) {
        if (node.isValid) state.fade.set(1);
        this.actors.delete(node);
      }
    }
  }
}

/** Ease, snapping when the remaining gap is below one 8-bit alpha step. */
function settle(current: number, target: number, seconds: number, rate: number): number {
  if (Math.abs(target - current) <= ALPHA_EPSILON) return target;
  return easeAlpha(current, target, seconds, rate);
}

/** Whether any body's feet stand inside `areas` (the same containment rule as the actor fade). */
function anyInside(areas: readonly TileArea[], bodies: readonly CoverBody[]): boolean {
  for (const body of bodies) {
    if (actorCoverAlpha(body.position, areas, 0) === 0) return true;
  }
  return false;
}

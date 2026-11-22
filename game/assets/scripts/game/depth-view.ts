/**
 * Y-sorting for the actors layer (#36).
 *
 * Prop bases are nested **in the actors layer** (not in the room's own `props` container) so a
 * base sprite and the player/enemies/boss are siblings and their draw order can interleave:
 * a larger foot y (feet lower on screen) draws in front. Overlays (canopies, roofs) live on the
 * `overlays` layer instead, so they always draw above every actor.
 *
 * Per frame this must be cheap (`stress()` targets 60 fps):
 * - entries are reused objects, the sorted array is reused, sorting happens in place;
 * - `setSiblingIndex` is only called for nodes whose index actually changed (front to back, so
 *   fixing index `i` also pushes later nodes right, which is stable);
 * - dead actors simply drop out of the list (their nodes are deactivated by `EnemyView`).
 */
import type { Node as CocosNode } from 'cc';
import { sortDepthInPlace } from '../core/view/cover';
import type { PropView } from './level-view';

type Node = InstanceType<typeof CocosNode>;

/** One sortable sprite: an actor node or a prop base (already placed in the actors layer). */
export interface DepthBody {
  readonly node: Node;
  /** Foot y in room tiles (y down): larger draws in front. */
  readonly footY: number;
}

interface Entry {
  readonly node: Node;
  footY: number;
}

/** Above this many unused entries the map is swept once (nodes destroyed/deactivated). */
const PRUNE_SLACK = 32;

export class DepthView {
  private readonly layer: Node;
  /** Prop bases of the current room. */
  private readonly props: Entry[] = [];
  /** Actor entries by node (created once per actor, reused every frame). */
  private readonly actors = new Map<Node, Entry>();
  /** Reused sort buffer: props + living actors. */
  private readonly sorted: Entry[] = [];

  constructor(layer: Node) {
    this.layer = layer;
  }

  /** Replace the room's prop bases (empty after a room change). */
  setProps(views: readonly PropView[]): void {
    this.clearProps();
    for (const view of views) {
      const entry: Entry = { node: view.base, footY: view.footY };
      this.props.push(entry);
      this.actors.set(entry.node, entry);
    }
  }

  clearProps(): void {
    for (const entry of this.props) this.actors.delete(entry.node);
    this.props.length = 0;
  }

  /** Sort the layer for this frame: prop bases plus the living actor bodies. */
  update(bodies: readonly DepthBody[]): void {
    if (!this.layer.isValid) return;

    const sorted = this.sorted;
    sorted.length = 0;
    for (const entry of this.props) sorted.push(entry);

    for (const body of bodies) {
      let entry = this.actors.get(body.node);
      if (entry === undefined) {
        entry = { node: body.node, footY: body.footY };
        this.actors.set(body.node, entry);
      }
      entry.footY = body.footY;
      sorted.push(entry);
    }

    if (this.actors.size > sorted.length + PRUNE_SLACK) this.prune(bodies);

    sortDepthInPlace(sorted);

    for (let index = 0; index < sorted.length; index += 1) {
      const node = (sorted[index] as Entry).node;
      if (!node.isValid) continue;
      if (node.getSiblingIndex() !== index) node.setSiblingIndex(index);
    }
  }

  /** Drop entries whose node is gone (destroyed or deactivated, e.g. a dead enemy). */
  private prune(bodies: readonly DepthBody[]): void {
    const alive = new Set<Node>();
    for (const body of bodies) alive.add(body.node);
    for (const entry of this.props) alive.add(entry.node);

    for (const [node] of this.actors) {
      if (!node.isValid || !alive.has(node)) this.actors.delete(node);
    }
  }
}

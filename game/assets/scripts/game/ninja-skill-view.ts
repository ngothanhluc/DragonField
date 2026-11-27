/**
 * Cocos view for the Ninja exclusive-skill runtime (M20, ADR-027; #84).
 *
 * The runtime (`core/skills/ninja-runtime.ts`) is pure and engine-free; this adapter only *reads*
 * its live state each frame:
 * - shadow clones → the player's own body frame tinted dark violet (a silhouette, no new art),
 * - smoke zones / venom clouds → one persistent `Graphics` disc each (one node per colour),
 * - flying clone shurikens / venom shurikens / kunai → pooled `FxPool` sprites that travel to the
 *   projectile's end point (the shared FX clock does the motion; no per-projectile nodes).
 *
 * Clones/zones are created lazily on first sight and destroyed when the runtime drops them, so a
 * run with no Ninja class skills pays one null check per frame.
 */
import {
  Color as CocosColor,
  Graphics as CocosGraphics,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import type {
  NinjaCloud,
  NinjaSmokeZone,
  NinjaSkillRuntime,
} from '../core/skills/ninja-runtime';
import type { Vec2 } from '../core/math/vec2';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_SCALE, tileToWorld } from './level-view';

type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

const CLONE_TINT = new CocosColor(92, 58, 170, 176);
const CLONE_RIPPLE_TINT = new CocosColor(150, 108, 255, 255);
const SMOKE_FILL = new CocosColor(118, 106, 148, 92);
const SMOKE_EDGE = new CocosColor(160, 144, 200, 130);
const VENOM_FILL = new CocosColor(94, 186, 74, 78);
const VENOM_EDGE = new CocosColor(150, 236, 110, 120);
const KINDAI_TINT = new CocosColor(255, 244, 222, 255);
const VENOM_TINT = new CocosColor(152, 240, 110, 255);

interface CloneSlot {
  readonly node: Node;
  readonly sprite: Sprite;
}

interface ZoneSlot {
  readonly node: Node;
  readonly graphics: Graphics;
}

/** Build one disc node (its own `Graphics`: never fill twice in the same buffer). */
function makeDiscNode(parent: Node, name: string, fill: Color, edge: Color): ZoneSlot {
  const node = new CocosNode(name);
  node.parent = parent;
  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = fill;
  graphics.strokeColor = edge;
  graphics.lineWidth = 0.06;
  return { node, graphics };
}

function drawDisc(slot: ZoneSlot, position: Vec2, radiusTiles: number): void {
  const world = tileToWorld(position);
  slot.node.setPosition(world.x, world.y, 0);
  slot.graphics.clear();
  slot.graphics.circle(0, 0, Math.max(0.1, radiusTiles));
  slot.graphics.fill();
  slot.graphics.circle(0, 0, Math.max(0.1, radiusTiles));
  slot.graphics.stroke();
}

export class NinjaSkillView {
  private readonly parent: Node;
  private readonly fx: FxPool | null;
  private readonly bodySprite: Sprite | null;
  private readonly cloneSlots: CloneSlot[] = [];
  private readonly smokeSlots = new Map<number, ZoneSlot>();
  private readonly cloudSlots = new Map<number, ZoneSlot>();
  /** Ids already drawn once (FX are spawned on first sight, not every frame). */
  private readonly seenProjectiles = new Set<number>();

  constructor(parent: Node, playerNode: Node, fx: FxPool | null) {
    this.parent = parent;
    this.fx = fx;
    // Rooms reuse the actor layer: drop a previous loop's clone/zone nodes (they would stay
    // visible forever once their runtime is gone).
    const stale = parent.children.filter((child: Node) => child.name.startsWith('ninja-'));
    for (const child of stale) child.destroy();
    const body = playerNode.getChildByName('player-body');
    this.bodySprite = body?.getComponent(CocosSprite) ?? playerNode.getComponent(CocosSprite);
  }

  /** Mirror the runtime's live state into the world this frame. */
  sync(runtime: NinjaSkillRuntime): void {
    this.syncClones(runtime);
    this.syncZones(runtime.activeSmokeZones, runtime.activeClouds);
    this.syncProjectiles(runtime);
  }

  /** Drop every node (room change). */
  destroy(): void {
    for (const slot of this.cloneSlots) slot.node.destroy();
    this.cloneSlots.length = 0;
    for (const slot of this.smokeSlots.values()) slot.node.destroy();
    this.smokeSlots.clear();
    for (const slot of this.cloudSlots.values()) slot.node.destroy();
    this.cloudSlots.clear();
    this.seenProjectiles.clear();
  }

  private syncClones(runtime: NinjaSkillRuntime): void {
    const clones = runtime.activeClones;
    for (let index = 0; index < clones.length; index += 1) {
      const clone = clones[index];
      if (clone === undefined) continue;
      let slot = this.cloneSlots[index];
      if (slot === undefined) {
        const node = new CocosNode('ninja-shadow-clone');
        node.parent = this.parent;
        const sprite: Sprite = node.addComponent(CocosSprite);
        sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
        sprite.trim = false;
        slot = { node, sprite };
        this.cloneSlots.push(slot);
        this.fx?.spawn('fx.cloud-shadow', clone.position, {
          drawUnits: 1.6,
          tint: CLONE_RIPPLE_TINT,
          lifetimeMs: 420,
        });
      }
      const frame = this.bodySprite?.spriteFrame ?? null;
      if (frame !== null && slot.sprite.spriteFrame !== frame) {
        slot.sprite.spriteFrame = frame;
        const transform: UITransform | null = slot.node.getComponent(CocosUITransform);
        if (transform !== null) {
          transform.setContentSize(frame.rect.width, frame.rect.height);
        }
      }
      slot.node.active = true;
      slot.node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
      const world = tileToWorld(clone.position);
      slot.node.setPosition(world.x, world.y, 0);
      slot.sprite.color = CLONE_TINT;
    }
    for (let index = clones.length; index < this.cloneSlots.length; index += 1) {
      const slot = this.cloneSlots[index];
      if (slot !== undefined) slot.node.active = false;
    }
  }

  private syncZones(zones: readonly NinjaSmokeZone[], clouds: readonly NinjaCloud[]): void {
    const liveSmoke = new Set<number>();
    for (const zone of zones) {
      liveSmoke.add(zone.id);
      let slot = this.smokeSlots.get(zone.id);
      if (slot === undefined) {
        slot = makeDiscNode(this.parent, 'ninja-smoke-zone', SMOKE_FILL, SMOKE_EDGE);
        this.smokeSlots.set(zone.id, slot);
        this.fx?.spawn('fx.smoke-circular', zone.position, {
          drawUnits: zone.radiusTiles * 2,
          lifetimeMs: 620,
        });
      }
      drawDisc(slot, zone.position, zone.radiusTiles);
    }
    for (const [id, slot] of this.smokeSlots) {
      if (liveSmoke.has(id)) continue;
      slot.node.destroy();
      this.smokeSlots.delete(id);
    }

    const liveClouds = new Set<number>();
    for (const cloud of clouds) {
      liveClouds.add(cloud.id);
      let slot = this.cloudSlots.get(cloud.id);
      if (slot === undefined) {
        slot = makeDiscNode(this.parent, 'ninja-venom-cloud', VENOM_FILL, VENOM_EDGE);
        this.cloudSlots.set(cloud.id, slot);
        this.fx?.spawn('fx.poison', cloud.position, {
          drawUnits: cloud.radiusTiles * 1.6,
          lifetimeMs: 600,
        });
      }
      drawDisc(slot, cloud.position, cloud.radiusTiles);
    }
    for (const [id, slot] of this.cloudSlots) {
      if (liveClouds.has(id)) continue;
      slot.node.destroy();
      this.cloudSlots.delete(id);
    }
  }

  private syncProjectiles(runtime: NinjaSkillRuntime): void {
    const fx = this.fx;
    if (fx === null) return;
    // Bound the "already drawn" set on very long runs.
    if (this.seenProjectiles.size > 4096) this.seenProjectiles.clear();

    for (const projectile of runtime.activeProjectiles) {
      if (this.seenProjectiles.has(projectile.id)) continue;
      this.seenProjectiles.add(projectile.id);

      const remainingSeconds = Math.max(0.05, projectile.remainingMs / 1000);
      const to = {
        x: projectile.position.x + projectile.velocity.x * remainingSeconds,
        y: projectile.position.y + projectile.velocity.y * remainingSeconds,
      };
      const key =
        projectile.skillId === 'ninja-venom-shuriken'
          ? 'fx.big-shuriken'
          : projectile.skillId === 'ninja-kunai-burst'
            ? 'fx.kunai'
            : 'fx.shuriken';
      fx.spawn(key, projectile.position, {
        ...(projectile.skillId === 'ninja-venom-shuriken'
          ? { tint: VENOM_TINT, drawUnits: 1.2 }
          : projectile.skillId === 'ninja-kunai-burst'
            ? { tint: KINDAI_TINT, drawUnits: 0.7 }
            : { tint: CLONE_RIPPLE_TINT, drawUnits: 0.6 }),
        to,
        travelMs: remainingSeconds * 1000,
      });
    }
  }
}

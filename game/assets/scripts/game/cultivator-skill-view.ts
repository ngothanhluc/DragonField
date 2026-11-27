/**
 * Cocos view for the Cultivator exclusive-skill runtime (M20, ADR-027; #87).
 *
 * The runtime (`core/skills/cultivator-runtime.ts`) is pure and engine-free; this adapter only
 * *reads* its live state each frame:
 * - orbiting spirit swords → pooled `fx.orbit-sword` sprites at the runtime's orbit positions
 *   (throttled, so 4 swords never drain the shared pool),
 * - planted Sword Arrays → one persistent `Graphics` disc each (one node per colour),
 * - Sword Qi / barrier / Myriad Swords crescents → pooled `fx.sword-qi` sprites that travel to the
 *   wave's end point (the shared FX clock does the motion; no per-wave nodes),
 * - the Qi shield → one `Graphics` ring around the player.
 *
 * Everything is created lazily on first sight and destroyed when the runtime drops it, so a run
 * with no Cultivator class skills pays one null check per frame.
 */
import {
  Color as CocosColor,
  Graphics as CocosGraphics,
  Node as CocosNode,
} from 'cc';
import type {
  CultivatorSkillRuntime,
  SwordArrayZone,
  SwordWave,
} from '../core/skills/cultivator-runtime';
import type { Vec2 } from '../core/math/vec2';
import type { FxPool } from './fx/effect-pool';
import { tileToWorld } from './level-view';

type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;

const SWORD_TINT = new CocosColor(180, 255, 236, 255);
const ARRAY_FILL = new CocosColor(82, 217, 180, 58);
const ARRAY_EDGE = new CocosColor(146, 244, 214, 150);
const QI_TINT = new CocosColor(150, 246, 220, 255);
const BARRIER_TINT = new CocosColor(255, 236, 170, 255);
const EVOLUTION_TINT = new CocosColor(214, 255, 246, 255);
const SHIELD_EDGE = new CocosColor(150, 246, 220, 200);

/** Per-sword FX respawn interval, ms: keeps the orbit readable without draining the pool. */
const ORBIT_FX_INTERVAL_MS = 260;

interface DiscSlot {
  readonly node: Node;
  readonly graphics: Graphics;
}

function makeDiscNode(parent: Node, name: string, fill: Color, edge: Color): DiscSlot {
  const node = new CocosNode(name);
  node.parent = parent;
  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = fill;
  graphics.strokeColor = edge;
  graphics.lineWidth = 0.06;
  return { node, graphics };
}

function drawDisc(slot: DiscSlot, position: Vec2, radiusTiles: number): void {
  const world = tileToWorld(position);
  slot.node.setPosition(world.x, world.y, 0);
  slot.graphics.clear();
  slot.graphics.circle(0, 0, Math.max(0.1, radiusTiles));
  slot.graphics.fill();
  slot.graphics.circle(0, 0, Math.max(0.1, radiusTiles));
  slot.graphics.stroke();
}

function waveTint(skillId: string): Color {
  if (skillId === 'cultivator-qi-barrier') return BARRIER_TINT;
  if (skillId === 'cultivator-myriad-swords') return EVOLUTION_TINT;
  return QI_TINT;
}

export class CultivatorSkillView {
  private readonly parent: Node;
  private readonly fx: FxPool | null;
  private readonly arraySlots = new Map<number, DiscSlot>();
  private readonly seenWaves = new Set<number>();
  private readonly orbitNextSpawnAt: number[] = [];
  private shieldRing: DiscSlot | null = null;
  private shieldWasUp = false;

  constructor(parent: Node, fx: FxPool | null) {
    this.parent = parent;
    this.fx = fx;
    // Rooms reuse the actor layer: drop a previous loop's array/shield nodes.
    const stale = parent.children.filter((child: Node) =>
      child.name.startsWith('cultivator-'),
    );
    for (const child of stale) child.destroy();
  }

  /** Mirror the runtime's live state into the world this frame. */
  sync(runtime: CultivatorSkillRuntime, playerPosition: Vec2, nowMs: number): void {
    this.syncOrbitSwords(runtime, playerPosition, nowMs);
    this.syncArrays(runtime.activeArrays);
    this.syncWaves(runtime.activeWaves);
    this.syncShield(runtime, playerPosition);
  }

  /** Drop every node (room change). */
  destroy(): void {
    for (const slot of this.arraySlots.values()) slot.node.destroy();
    this.arraySlots.clear();
    this.seenWaves.clear();
    this.orbitNextSpawnAt.length = 0;
    this.shieldRing?.node.destroy();
    this.shieldRing = null;
  }

  private syncOrbitSwords(
    runtime: CultivatorSkillRuntime,
    playerPosition: Vec2,
    nowMs: number,
  ): void {
    const fx = this.fx;
    if (fx === null) return;
    const positions = runtime.orbitSwordPositions(playerPosition, nowMs);
    if (this.orbitNextSpawnAt.length > positions.length) {
      this.orbitNextSpawnAt.length = positions.length;
    }
    for (let index = 0; index < positions.length; index += 1) {
      const nextAt = this.orbitNextSpawnAt[index] ?? 0;
      if (nowMs < nextAt) continue;
      this.orbitNextSpawnAt[index] = nowMs + ORBIT_FX_INTERVAL_MS;
      const position = positions[index];
      if (position === undefined) continue;
      fx.spawn('fx.orbit-sword', position, {
        drawUnits: 0.8,
        tint: SWORD_TINT,
        lifetimeMs: 300,
      });
    }
  }

  private syncArrays(arrays: readonly SwordArrayZone[]): void {
    const fx = this.fx;
    const live = new Set<number>();
    for (const array of arrays) {
      live.add(array.id);
      let slot = this.arraySlots.get(array.id);
      if (slot === undefined) {
        // An array never moves, so draw its disc exactly once: rebuilding a filled 3.2-tile
        // `Graphics` circle every frame cost ~17 fps in the stress run (M20, #87 R1).
        slot = makeDiscNode(this.parent, 'cultivator-sword-array', ARRAY_FILL, ARRAY_EDGE);
        this.arraySlots.set(array.id, slot);
        drawDisc(slot, array.position, array.radiusTiles);
        fx?.spawn('fx.sword-array', array.position, {
          drawUnits: array.radiusTiles * 2.4,
          tint: QI_TINT,
          lifetimeMs: 460,
        });
      }
    }
    for (const [id, slot] of this.arraySlots) {
      if (live.has(id)) continue;
      slot.node.destroy();
      this.arraySlots.delete(id);
    }
  }

  private syncWaves(waves: readonly SwordWave[]): void {
    const fx = this.fx;
    if (fx === null) return;
    if (this.seenWaves.size > 4096) this.seenWaves.clear();
    for (const wave of waves) {
      if (this.seenWaves.has(wave.id)) continue;
      this.seenWaves.add(wave.id);
      const remainingSeconds = Math.max(0.05, wave.remainingMs / 1000);
      const to = {
        x: wave.position.x + wave.velocity.x * remainingSeconds,
        y: wave.position.y + wave.velocity.y * remainingSeconds,
      };
      fx.spawn('fx.sword-qi', wave.position, {
        drawUnits: wave.radiusTiles * 2.2,
        tint: waveTint(wave.skillId),
        to,
        travelMs: remainingSeconds * 1000,
      });
    }
  }

  private syncShield(runtime: CultivatorSkillRuntime, playerPosition: Vec2): void {
    const up = runtime.hasQiShield;
    if (up && this.shieldRing === null) {
      const ring = makeDiscNode(
        this.parent,
        'cultivator-qi-shield',
        new CocosColor(0, 0, 0, 0),
        SHIELD_EDGE,
      );
      // Constant shape: draw once, then only move the node with the player.
      ring.graphics.circle(0, 0, 1.05);
      ring.graphics.stroke();
      ring.graphics.circle(0, 0, 0.92);
      ring.graphics.stroke();
      this.shieldRing = ring;
    }
    const ring = this.shieldRing;
    if (ring !== null) {
      ring.node.active = up;
      if (up) {
        const world = tileToWorld(playerPosition);
        ring.node.setPosition(world.x, world.y, 0);
      }
    }
    if (up && !this.shieldWasUp) {
      this.fx?.spawn('fx.shield', playerPosition, {
        drawUnits: 2.6,
        tint: BARRIER_TINT,
        lifetimeMs: 420,
      });
    }
    this.shieldWasUp = up;
  }
}

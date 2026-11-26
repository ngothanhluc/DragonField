/**
 * Bullets and the object pool (ADR-008, M3: "no `new` per shot").
 *
 * Tile-unit coordinates, same system as `LevelData`. A bullet is a circle; collision is
 * circle overlap, touching the boundary counts as a hit.
 *
 * The pool has a **hard capacity**: when full, the **oldest** bullet is retired and reused
 * for the new shot instead of letting the array grow. That keeps 8 enemies + 40 bullets
 * at 60 fps with no frame allocating unpredictably. Consequence: do not keep a
 * `Bullet` reference across `spawn` calls — the slot may already belong to another
 * bullet. Compare `id` if you need identity.
 *
 * Bullet lifecycle contract:
 *
 * - `spawn` puts the slot into `live` (and returns that same mutable object so the adapter
 *   can read it this frame).
 * - A bullet leaves the pool by **one of three** paths: `ttlMs` runs out (in `update`),
 *   it is pushed out when the pool is full (`spawn`), or it is consumed on purpose (`consume` /
 *   `consumeWhere`). All three return the slot to `recycled` for the next
 *   `spawn` — no `new` inside the game loop.
 * - Ids increase monotonically and **never come back**: a consumed bullet is no longer
 *   in `active()`, and its id can never appear on another bullet.
 *
 * So never simulate "a bullet hit" by setting `bullet.ttlMs = 0` and waiting for the
 * next `update`: that bullet is still in `active()` (still occupying the slot, still
 * visible to the adapter) until the following frame. Use `consume(id)` / `consumeWhere(...)`
 * to kill it in the collision frame.
 */
import type { LevelData, Obstacle } from '../level/level-data';
import { distanceSquared, type Vec2 } from '../math/vec2';
import type { DeathCause } from '../run/run-summary';

export type BulletOwner = 'player' | 'enemy';

export interface Bullet {
  id: number;
  position: Vec2;
  /** Mutable so Homing/Ricochet can rotate the bullet's own flight direction. */
  velocity: { x: number; y: number };
  radiusTiles: number;
  damage: number;
  owner: BulletOwner;
  ttlMs: number;
  /** Enemies it can still pass through (Piercing). 0 = stops at the first enemy. */
  pierceRemaining: number;
  /** Remaining bounces to another enemy (Ricochet). 0 = no bounce. */
  ricochetRemaining: number;
  /** Bullet tracks its target (Homing). */
  homing: boolean;
  /** Explosion radius on hit, tiles; 0 = no explosion (Explosive). */
  explosiveRadiusTiles: number;
  /** Explosion damage, crit + ratio already applied. */
  explosiveDamage: number;
  /** Rolled at fire time (crit chance lives in `shot-effects.ts`); drives the VFX trail colour. */
  crit: boolean;
  /** Actor ids already hit — a piercing/ricocheting bullet never hits the same target twice. */
  hitIds: string[];
  /** Optional killer attribution for enemy/boss bullets (M15 rich death cause). */
  source?: DeathCause | undefined;
}

export interface CircleArea {
  readonly position: Vec2;
  readonly radiusTiles: number;
}

export interface BulletSpawnArgs {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  readonly owner: BulletOwner;
  readonly ttlMs: number;
  readonly pierceRemaining?: number;
  readonly ricochetRemaining?: number;
  readonly homing?: boolean;
  readonly explosiveRadiusTiles?: number;
  readonly explosiveDamage?: number;
  readonly crit?: boolean;
  readonly source?: DeathCause;
}

/** Default capacity: more than 5× the M3 target of max on-screen bullets (40). */
export const DEFAULT_BULLET_CAPACITY = 256;

/**
 * Internal version uses a mutable `{ x, y }` so each frame allocates no new
 * coordinate object. It still assigns to `Bullet` because `Vec2` is only `readonly` at the type level.
 */
interface MutableBullet extends Bullet {
  position: { x: number; y: number };
}

/** Circle collision; touching at exactly one point still counts as a hit. */
export function hitsCircle(a: CircleArea, b: CircleArea): boolean {
  const reach = a.radiusTiles + b.radiusTiles;
  return distanceSquared(a.position, b.position) <= reach * reach;
}

export interface SweepArea {
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface ObstacleHit {
  readonly obstacle: Obstacle;
  readonly point: Vec2;
  /** 0..1 along the segment `from` -> `to`. */
  readonly progress: number;
}

/**
 * First obstacle on the bullet path from `from` to `to`.
 *
 * Exact segment/AABB test (slab method), so a line that only grazes a thin corner is still a hit.
 * The old 0.25-tile sampling could step over a 1×0.5 prop corner: a caster standing just behind
 * it believed it had line of sight to the player while the player's bullet hit the prop — the
 * room then never cleared (found by the headless run on 64×36 rooms, #66).
 *
 * Reads only `level.obstacles`; no other field of `LevelData` is used.
 * Pits are **not** solid for projectiles (GDD §8): they block walkers only, so a bullet flies
 * over open ground.
 */
export function firstHit(area: SweepArea, level: LevelData): ObstacleHit | null {
  let best: ObstacleHit | null = null;
  for (const obstacle of level.obstacles) {
    if (!stopsBullets(obstacle)) continue;
    const progress = segmentRectEntry(area.from, area.to, obstacle);
    if (progress === null) continue;
    if (best !== null && progress >= best.progress) continue;
    best = {
      obstacle,
      point: {
        x: area.from.x + (area.to.x - area.from.x) * progress,
        y: area.from.y + (area.to.y - area.from.y) * progress,
      },
      progress,
    };
  }
  return best;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Entry parameter `t` in [0, 1] of the segment `from → to` into `rect`, or `null` when the
 * segment misses it. `0` when the segment starts inside. Closed rectangle: touching a face or a
 * corner counts, the same as a projectile whose centre only grazes an obstacle.
 */
function segmentRectEntry(from: Vec2, to: Vec2, rect: Rect): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let exit = 1;

  const axis = (origin: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) < 1e-12) return origin >= min && origin <= max;
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    return enter <= exit;
  };

  if (!axis(from.x, dx, rect.x, rect.x + rect.width)) return null;
  if (!axis(from.y, dy, rect.y, rect.y + rect.height)) return null;
  return Math.max(0, Math.min(1, enter));
}

/** A pit is a hole in the floor: walkers fall in, bullets do not. */
function stopsBullets(obstacle: Obstacle): boolean {
  return obstacle.kind !== 'pit';
}

export class BulletPool {
  private readonly live: MutableBullet[] = [];
  private readonly recycled: MutableBullet[] = [];
  private nextId = 1;

  constructor(readonly capacity: number = DEFAULT_BULLET_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`BulletPool needs capacity to be an integer >= 1, got ${capacity}`);
    }
  }

  get size(): number {
    return this.live.length;
  }

  /**
   * Number of slots waiting to be reused. `size + recycledCount` **never exceeds
   * `capacity`** — the "1000 shots without a leak" test relies on this invariant.
   */
  get recycledCount(): number {
    return this.recycled.length;
  }

  /**
   * Spawn a bullet. When the pool is full the **oldest** bullet is retired to free a slot —
   * the pool never exceeds `capacity`.
   */
  spawn(args: BulletSpawnArgs): Bullet {
    if (!(args.ttlMs > 0)) {
      throw new Error(`Bullet needs ttlMs > 0, got ${args.ttlMs}`);
    }

    const bullet = this.takeSlot();
    bullet.id = this.nextId;
    this.nextId += 1;
    bullet.position = { x: args.position.x, y: args.position.y };
    bullet.velocity = { x: args.velocity.x, y: args.velocity.y };
    bullet.radiusTiles = args.radiusTiles;
    bullet.damage = args.damage;
    bullet.owner = args.owner;
    bullet.ttlMs = args.ttlMs;
    bullet.pierceRemaining = Math.max(0, Math.floor(args.pierceRemaining ?? 0));
    bullet.ricochetRemaining = Math.max(0, Math.floor(args.ricochetRemaining ?? 0));
    bullet.homing = args.homing === true;
    bullet.explosiveRadiusTiles = Math.max(0, args.explosiveRadiusTiles ?? 0);
    bullet.explosiveDamage = Math.max(0, args.explosiveDamage ?? 0);
    bullet.crit = args.crit === true;
    bullet.hitIds.length = 0;
    bullet.source = args.source;

    this.live.push(bullet);
    return bullet;
  }

  /**
   * Fly by velocity, subtract ttl, retire expired bullets. A bullet that expires this frame
   * is dropped without flying further — it has "lived" its full time.
   */
  update(deltaMs: number): void {
    if (!(deltaMs >= 0)) {
      throw new Error(`BulletPool.update needs deltaMs >= 0, got ${deltaMs}`);
    }

    const seconds = deltaMs / 1000;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const bullet = this.live[readIndex];
      if (bullet === undefined) continue;

      bullet.ttlMs -= deltaMs;
      if (bullet.ttlMs <= 0) {
        this.recycled.push(bullet);
        continue;
      }

      bullet.position.x += bullet.velocity.x * seconds;
      bullet.position.y += bullet.velocity.y * seconds;

      this.live[writeIndex] = bullet;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
  }

  /** Live bullets, oldest first. Read only — do not modify the elements. */
  active(): readonly Bullet[] {
    return this.live;
  }

  /**
   * Retire bullet `id` immediately (if present) and return the slot to `recycled`.
   *
   * Returns `true` when that bullet was alive and just dropped, `false` when the id is not
   * in the pool — calling twice with the same id always returns `false` (ids do not come
   * back). Capacity is unchanged: consuming only lowers `size`, the slot is reused
   * by the next `spawn`.
   *
   * Do not call while `update`/`consumeWhere` is running — those two manage
   * the array themselves. Calling after `update` (or after iterating `active()`) is fine.
   */
  consume(id: number): boolean {
    for (let index = 0; index < this.live.length; index += 1) {
      const bullet = this.live[index];
      if (bullet === undefined || bullet.id !== id) continue;

      this.retireAt(index);
      return true;
    }
    return false;
  }

  /**
   * Retire every bullet matching `predicate`, returning the **count** dropped.
   *
   * Used for collision resolution: a frame can have several bullets hit, collect
   * them then call once instead of `consume` per id (each `consume` has to scan
   * and compact the array). The predicate may only **read** bullets — do not call `spawn` /
   * `consume` inside it; if you need to change the pool, do so after this function returns.
   *
   * The "oldest first" order of `active()` is preserved for the remaining bullets.
   */
  consumeWhere(predicate: (bullet: Readonly<Bullet>) => boolean): number {
    let writeIndex = 0;
    let removed = 0;

    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const bullet = this.live[readIndex];
      if (bullet === undefined) continue;

      if (predicate(bullet)) {
        this.recycled.push(bullet);
        removed += 1;
        continue;
      }

      this.live[writeIndex] = bullet;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
    return removed;
  }

  /** Deep copy, for tests and debugging. */
  snapshot(): Bullet[] {
    return this.live.map((bullet) => ({
      id: bullet.id,
      position: { x: bullet.position.x, y: bullet.position.y },
      velocity: { x: bullet.velocity.x, y: bullet.velocity.y },
      radiusTiles: bullet.radiusTiles,
      damage: bullet.damage,
      owner: bullet.owner,
      ttlMs: bullet.ttlMs,
      pierceRemaining: bullet.pierceRemaining,
      ricochetRemaining: bullet.ricochetRemaining,
      homing: bullet.homing,
      explosiveRadiusTiles: bullet.explosiveRadiusTiles,
      explosiveDamage: bullet.explosiveDamage,
      crit: bullet.crit,
      hitIds: bullet.hitIds.slice(),
      ...(bullet.source !== undefined ? { source: bullet.source } : {}),
    }));
  }

  /** Retire every bullet, e.g. when changing rooms. */
  clear(): void {
    this.recycled.push(...this.live);
    this.live.length = 0;
  }

  /**
   * Remove element `index` from `live` and return the slot to `recycled`, shifting the tail
   * left to keep oldest → newest order. `index` must be a valid index into `live`.
   */
  private retireAt(index: number): void {
    const bullet = this.live[index];
    if (bullet === undefined) return;

    for (let read = index + 1; read < this.live.length; read += 1) {
      const next = this.live[read];
      if (next !== undefined) this.live[read - 1] = next;
    }

    this.live.length -= 1;
    this.recycled.push(bullet);
  }

  private takeSlot(): MutableBullet {
    if (this.live.length >= this.capacity) {
      const oldest = this.live.shift();
      if (oldest !== undefined) return oldest;
    }

    const reused = this.recycled.pop();
    if (reused !== undefined) return reused;

    return {
      id: 0,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0,
      damage: 0,
      owner: 'enemy',
      ttlMs: 0,
      pierceRemaining: 0,
      ricochetRemaining: 0,
      homing: false,
      explosiveRadiusTiles: 0,
      explosiveDamage: 0,
      crit: false,
      hitIds: [],
    };
  }
}

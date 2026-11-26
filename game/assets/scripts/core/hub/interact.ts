/**
 * Proximity interactable detection (`<= 2.0` tiles), nearest floating `[E]` prompt selection,
 * and automatic doorway/gate step-trigger resolution for the Village Hub & Shop Interior.
 *
 * Pure TS — zero `cc` imports.
 */
import type { Vec2 } from '../math/vec2';
import {
  DEFAULT_HUB_INTERACT_RADIUS_TILES,
  type HubMapData,
  type HubNpcId,
  type HubPromptKey,
  type HubTriggerBounds,
  type HubTriggerId,
  type HubTriggerZone,
  type HubVillagerId,
} from './hub-tmx';

/** Canonical proximity prompt distance in tiles (`2.0` tiles per GDD M21 §4). */
export const INTERACT_RADIUS_TILES = DEFAULT_HUB_INTERACT_RADIUS_TILES;

/** Keyboard shortcut badge shown beside localized floating prompts. */
export const INTERACT_KEY_HINT = '[E]';

export type HubInteractAction =
  | { readonly kind: 'talk-villager'; readonly npcId: HubVillagerId }
  | { readonly kind: 'talk-shopkeeper'; readonly npcId: 'shopkeeper' }
  | { readonly kind: 'open-dojo'; readonly npcId: 'dojo-master' }
  | { readonly kind: 'enter-shop'; readonly triggerId: 'shop-entrance' }
  | { readonly kind: 'exit-shop'; readonly triggerId: 'shop-exit' }
  | { readonly kind: 'open-expedition'; readonly triggerId: 'expedition-gate' };

export interface HubInteractable {
  readonly id: string;
  readonly kind: 'npc' | 'trigger';
  /** World/tile anchor above which the floating `[E]` prompt renders. */
  readonly anchor: Vec2;
  /** Optional rectangular zone (used by doorways/gates so distance measures to the nearest edge). */
  readonly rect: HubTriggerBounds | null;
  readonly radiusTiles: number;
  readonly promptKey: HubPromptKey;
  readonly action: HubInteractAction;
  /** Tie-break priority when two interactables sit at equal distance (lower wins). */
  readonly priority: number;
}

export interface HubPromptDescriptor {
  readonly id: string;
  readonly anchor: Vec2;
  readonly distanceTiles: number;
  readonly keyHint: typeof INTERACT_KEY_HINT;
  readonly promptKey: HubPromptKey;
  readonly action: HubInteractAction;
}

export interface LiveNpcPosition {
  readonly id: HubNpcId;
  readonly position: Vec2;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Euclidean distance from `point` to a trigger rectangle (`0` when inside) or point anchor. */
export function distanceToInteractable(point: Vec2, item: HubInteractable): number {
  if (item.rect !== null) {
    const nx = clamp(point.x, item.rect.x, item.rect.x + item.rect.width);
    const ny = clamp(point.y, item.rect.y, item.rect.y + item.rect.height);
    return Math.hypot(point.x - nx, point.y - ny);
  }
  return Math.hypot(point.x - item.anchor.x, point.y - item.anchor.y);
}

function triggerToAction(id: HubTriggerId): HubInteractAction {
  switch (id) {
    case 'shop-entrance':
      return { kind: 'enter-shop', triggerId: 'shop-entrance' };
    case 'shop-exit':
      return { kind: 'exit-shop', triggerId: 'shop-exit' };
    case 'expedition-gate':
      return { kind: 'open-expedition', triggerId: 'expedition-gate' };
  }
}

/**
 * Build the live interactable list from `map`, substituting current patrolling villager positions
 * when `liveNpcs` is provided.
 */
export function buildHubInteractables(
  map: HubMapData,
  liveNpcs: readonly LiveNpcPosition[] = [],
): HubInteractable[] {
  const liveById = new Map<HubNpcId, Vec2>();
  for (const entry of liveNpcs) {
    liveById.set(entry.id, entry.position);
  }

  const out: HubInteractable[] = [];

  for (const npc of map.npcs) {
    const anchor = liveById.get(npc.id) ?? npc.at;
    if (npc.role === 'shopkeeper') {
      out.push({
        id: npc.id,
        kind: 'npc',
        anchor,
        rect: null,
        radiusTiles: npc.interactRadius,
        promptKey: npc.promptKey,
        action: { kind: 'talk-shopkeeper', npcId: 'shopkeeper' },
        priority: 0,
      });
    } else if (npc.role === 'dojo-master') {
      out.push({
        id: npc.id,
        kind: 'npc',
        anchor,
        rect: null,
        radiusTiles: npc.interactRadius,
        promptKey: npc.promptKey,
        action: { kind: 'open-dojo', npcId: 'dojo-master' },
        priority: 0,
      });
    } else {
      out.push({
        id: npc.id,
        kind: 'npc',
        anchor,
        rect: null,
        radiusTiles: npc.interactRadius,
        promptKey: npc.promptKey,
        action: { kind: 'talk-villager', npcId: npc.id as HubVillagerId },
        priority: 2,
      });
    }
  }

  for (const trigger of map.triggers) {
    out.push({
      id: trigger.id,
      kind: 'trigger',
      anchor: trigger.at,
      rect: trigger.rect,
      radiusTiles: trigger.interactRadius,
      promptKey: trigger.promptKey,
      action: triggerToAction(trigger.id),
      priority: 1,
    });
  }

  return out;
}

/**
 * Select the single nearest interactable within `maxRadiusTiles` (`2.0` tiles default).
 * Returns `null` when nothing is in range or `playerPos` has non-finite coordinates.
 */
export function findNearestInteractable(
  playerPos: Vec2,
  interactables: readonly HubInteractable[],
  maxRadiusTiles: number = INTERACT_RADIUS_TILES,
): HubPromptDescriptor | null {
  if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return null;
  const globalCap = Number.isFinite(maxRadiusTiles) && maxRadiusTiles > 0 ? maxRadiusTiles : 0;
  if (globalCap <= 0) return null;

  let best: { item: HubInteractable; dist: number } | null = null;
  const TIE_EPSILON = 1e-6;

  for (const item of interactables) {
    const allowedRadius = Math.min(globalCap, item.radiusTiles);
    if (allowedRadius <= 0) continue;
    const dist = distanceToInteractable(playerPos, item);
    if (dist > allowedRadius + 1e-9) continue;

    if (best === null) {
      best = { item, dist };
      continue;
    }

    const diff = dist - best.dist;
    if (
      diff < -TIE_EPSILON ||
      (Math.abs(diff) <= TIE_EPSILON &&
        (item.priority < best.item.priority ||
          (item.priority === best.item.priority && item.id.localeCompare(best.item.id) < 0)))
    ) {
      best = { item, dist };
    }
  }

  if (best === null) return null;
  return {
    id: best.item.id,
    anchor: { x: best.item.anchor.x, y: best.item.anchor.y },
    distanceTiles: best.dist,
    keyHint: INTERACT_KEY_HINT,
    promptKey: best.item.promptKey,
    action: best.item.action,
  };
}

/**
 * Check whether `playerPos` lies inside an `autoEnterOnStep` trigger zone (`shop-entrance`,
 * `shop-exit`, or walking straight into `expedition-gate`).
 */
export function findStepTrigger(
  playerPos: Vec2,
  triggers: readonly HubTriggerZone[],
): HubTriggerZone | null {
  if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return null;
  for (const trigger of triggers) {
    if (!trigger.autoEnterOnStep || trigger.rect === null) continue;
    const insideX =
      playerPos.x >= trigger.rect.x && playerPos.x <= trigger.rect.x + trigger.rect.width;
    const insideY =
      playerPos.y >= trigger.rect.y && playerPos.y <= trigger.rect.y + trigger.rect.height;
    if (insideX && insideY) return trigger;
  }
  return null;
}

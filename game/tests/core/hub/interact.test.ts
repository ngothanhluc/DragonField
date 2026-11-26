/**
 * Unit tests for `core/hub/interact.ts` (`2.0`-tile proximity prompts, nearest selection,
 * priority tie-breaking, and step-in doorway triggers).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INTERACT_KEY_HINT,
  INTERACT_RADIUS_TILES,
  buildHubInteractables,
  findNearestInteractable,
  findStepTrigger,
  parseHubTmx,
  type HubInteractable,
} from '../../../assets/scripts/core/hub';

const HERE = dirname(fileURLToPath(import.meta.url));
const VILLAGE_DIR = join(HERE, '../../../assets/resources/data/levels/village');
const villageMap = parseHubTmx(readFileSync(join(VILLAGE_DIR, 'village-hub.tmx'), 'utf8'));

describe('Hub proximity interactables & floating [E] prompts', () => {
  it('surfaces localized [E] prompts within 2.0 tiles and returns null beyond 2.0 tiles', () => {
    const items = buildHubInteractables(villageMap);
    const dojo = villageMap.npcs.find((n) => n.id === 'dojo-master')!;

    // Within 2.0 tiles (`1.9` tiles south of Dojo Master) → `[E] hub.prompt.dojo`.
    const nearDojo = findNearestInteractable(
      { x: dojo.at.x, y: dojo.at.y + 1.9 },
      items,
    );
    expect(nearDojo).not.toBeNull();
    expect(nearDojo?.keyHint).toBe(INTERACT_KEY_HINT);
    expect(nearDojo?.promptKey).toBe('hub.prompt.dojo');
    expect(nearDojo?.action).toEqual({ kind: 'open-dojo', npcId: 'dojo-master' });

    // Beyond 2.0 tiles (`2.1` tiles away, away from other NPCs) → `null`.
    const farFromAll = findNearestInteractable({ x: 18, y: 13.5 }, items);
    expect(farFromAll).toBeNull();
  });

  it('picks the strictly nearest interactable and breaks exact distance ties deterministically', () => {
    const synthetic: readonly HubInteractable[] = [
      {
        id: 'villager-1',
        kind: 'npc',
        anchor: { x: 10, y: 8.5 },
        rect: null,
        radiusTiles: INTERACT_RADIUS_TILES,
        promptKey: 'hub.prompt.talk',
        action: { kind: 'talk-villager', npcId: 'villager-1' },
        priority: 2,
      },
      {
        id: 'dojo-master',
        kind: 'npc',
        anchor: { x: 10, y: 11.5 },
        rect: null,
        radiusTiles: INTERACT_RADIUS_TILES,
        promptKey: 'hub.prompt.dojo',
        action: { kind: 'open-dojo', npcId: 'dojo-master' },
        priority: 0,
      },
    ];

    // Closer to villager (`y = 9.6`: 1.1 from villager vs 1.9 from dojo-master) → villager wins.
    expect(findNearestInteractable({ x: 10, y: 9.6 }, synthetic)?.id).toBe('villager-1');

    // Exact midpoint (`y = 10.0`: 1.5 from both) → higher-priority landmark NPC (`dojo-master`) wins!
    expect(findNearestInteractable({ x: 10, y: 10 }, synthetic)?.id).toBe('dojo-master');
  });

  it('updates live patrolling villager positions and detects doorway/gate step triggers', () => {
    const movedItems = buildHubInteractables(villageMap, [
      { id: 'villager-1', position: { x: 18, y: 12.2 } },
    ]);
    const prompt = findNearestInteractable({ x: 18, y: 13.5 }, movedItems);
    expect(prompt?.id).toBe('villager-1');
    expect(prompt?.promptKey).toBe('hub.prompt.talk');

    const shopEntrance = villageMap.triggers.find((t) => t.id === 'shop-entrance')!;
    expect(findStepTrigger(shopEntrance.at, villageMap.triggers)?.id).toBe('shop-entrance');

    const northGate = villageMap.triggers.find((t) => t.id === 'expedition-gate')!;
    expect(findStepTrigger(northGate.at, villageMap.triggers)?.id).toBe('expedition-gate');
  });
});

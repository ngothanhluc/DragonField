/**
 * Village Life rendering (M21 #92): the 5 wandering villagers and the 4 yard animals of the
 * Village Hub. Positions, facing, animation keys and animal bounds all come from the pure
 * session (`core/hub/village-life.ts`); this adapter only moves sprites and plays clips.
 *
 * Villagers use `SpriteAnimator` (`npc.villager-N-step/stand.<dir>`, feet-anchored) and are
 * Y-sorted with the player through the hub's `DepthView`. Animals use one `SpriteAnimator` per
 * animal on their 2-frame sheet and flip by `facing` (scale x).
 */
import { Node as CocosNode, Sprite as CocosSprite } from 'cc';
import type { AnimalState } from '../core/atmosphere/living-decor';
import type { NpcPatrolState } from '../core/hub';
import type { VillageAnimal, VillageLifeState } from '../core/hub/village-life';
import type { DepthBody } from './depth-view';
import { ACTOR_SCALE } from './level-view';
import { SpriteAnimator } from './anim/sprite-animator';

type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;

export interface HubLifeViewConfig {
  readonly actorLayer: Node;
  /** Map rows, for the tile (y down) → world (y up) flip. */
  readonly rows: number;
}

interface VillagerSprite {
  readonly node: Node;
  readonly animator: SpriteAnimator;
  /** `animKey|facing` of the clip already playing (never restart an unchanged clip). */
  playing: string;
}

interface AnimalSprite {
  readonly node: Node;
  readonly animator: SpriteAnimator;
}

/** Tile position → world feet (same rule as `LivingDecor` and the player: bottom of the 1×1 cell). */
function feetOf(at: { readonly x: number; readonly y: number }, rows: number): { x: number; y: number } {
  return { x: at.x, y: rows - (at.y + 0.5) };
}

export class HubLifeView {
  private readonly villagers = new Map<string, VillagerSprite>();
  private readonly animals = new Map<string, AnimalSprite>();
  /** Every sprite is a direct child of the actors layer so the hub's Y-sort interleaves it with the player. */
  private readonly actorLayer: Node;
  private rows = 24;
  private destroyed = false;

  constructor(config: HubLifeViewConfig) {
    this.rows = config.rows;
    this.actorLayer = config.actorLayer;
  }

  /** Create every sprite; safe to call once per hub session. Missing art only logs a problem. */
  init(state: VillageLifeState): void {
    for (const villager of state.villagers) {
      const node = this.createActorNode(villager.id);
      node.addComponent(SpriteAnimator);
      const animator = node.getComponent(SpriteAnimator) as SpriteAnimator;
      this.villagers.set(villager.id, { node, animator, playing: '' });
    }

    for (const animal of state.animals) {
      const node = this.createActorNode(animal.id);
      const sprite: Sprite = node.addComponent(CocosSprite);
      sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
      sprite.trim = false;
      node.addComponent(SpriteAnimator);
      const animator = node.getComponent(SpriteAnimator) as SpriteAnimator;
      animator.play(animal.sprite);
      this.animals.set(animal.id, { node, animator });
    }

    this.apply(state);
  }

  /** One visual frame from the pure session state. */
  apply(state: VillageLifeState): void {
    if (this.destroyed) return;

    for (const villager of state.villagers) {
      const view = this.villagers.get(villager.id);
      if (view === undefined) continue;
      this.placeVillager(view, villager);
    }
    for (const animal of state.animals) {
      const view = this.animals.get(animal.id);
      if (view === undefined) continue;
      this.placeAnimal(view, animal);
    }
  }

  /** Feed the actors' feet into the hub's Y-sort (called from `updateDepthAndCover`). */
  collectBodies(out: DepthBody[]): void {
    if (this.destroyed) return;
    for (const view of this.villagers.values()) {
      if (view.node.isValid) out.push({ node: view.node, footY: view.node.position.y });
    }
    for (const view of this.animals.values()) {
      if (view.node.isValid) out.push({ node: view.node, footY: view.node.position.y });
    }
  }

  /** Number of sprites created (debug/proof helper). */
  get counts(): { readonly villagers: number; readonly animals: number } {
    return { villagers: this.villagers.size, animals: this.animals.size };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of this.villagers.values()) {
      if (view.node.isValid) view.node.destroy();
    }
    for (const view of this.animals.values()) {
      if (view.node.isValid) view.node.destroy();
    }
    this.villagers.clear();
    this.animals.clear();
  }

  private createActorNode(id: string): Node {
    const node = new CocosNode(id);
    node.parent = this.actorLayer;
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    return node;
  }

  private placeVillager(view: VillagerSprite, villager: NpcPatrolState): void {
    const feet = feetOf(villager.position, this.rows);
    view.node.setPosition(feet.x, feet.y, 0);

    const signature = `${villager.animKey}|${villager.facing}`;
    if (view.playing !== signature) {
      view.playing = signature;
      view.animator.play(villager.animKey, villager.facing, villager.fallbackAnimKey);
    }
  }

  private placeAnimal(view: AnimalSprite, animal: VillageAnimal): void {
    const state: AnimalState = animal.state;
    const feet = feetOf(state.at, this.rows);
    view.node.setPosition(feet.x, feet.y, 0);
    view.node.setScale(ACTOR_SCALE * state.facing, ACTOR_SCALE, 1);
  }
}

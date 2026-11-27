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
import { NPC_BODY_RADIUS_TILES, resolveNpcAnimKey, type NpcPatrolState } from '../core/hub';
import type { VillageAnimal, VillageLifeState } from '../core/hub/village-life';
import type { CoverBody } from './cover-view';
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
  /** Live tile position (y down) — the cover pass works in tile space, not world units. */
  at: { x: number; y: number };
}

interface AnimalSprite {
  readonly node: Node;
  readonly animator: SpriteAnimator;
  at: { x: number; y: number };
}

/** Small circular body used for the cover pass (animals are slightly slimmer than villagers). */
const ANIMAL_BODY_RADIUS_TILES = 0.3;

/** Tile position → world feet (same rule as `LivingDecor` and the player: bottom of the 1×1 cell). */
function feetOf(at: { readonly x: number; readonly y: number }, rows: number): { x: number; y: number } {
  return { x: at.x, y: rows - (at.y + 0.5) };
}

export class HubLifeView {
  private readonly villagers = new Map<string, VillagerSprite>();
  private readonly animals = new Map<string, AnimalSprite>();
  /** Shopkeeper standing behind the counter inside the Shop Interior (#93); `null` outside it. */
  private shopkeeper: (VillagerSprite & { rows: number }) | null = null;
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
      this.villagers.set(villager.id, {
        node,
        animator,
        playing: '',
        at: { x: villager.position.x, y: villager.position.y },
      });
    }

    for (const animal of state.animals) {
      const node = this.createActorNode(animal.id);
      const sprite: Sprite = node.addComponent(CocosSprite);
      sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
      sprite.trim = false;
      node.addComponent(SpriteAnimator);
      const animator = node.getComponent(SpriteAnimator) as SpriteAnimator;
      animator.play(animal.sprite);
      this.animals.set(animal.id, { node, animator, at: { x: animal.state.at.x, y: animal.state.at.y } });
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

  /** Feed the actors' feet into the hub's Y-sort and cover pass (called from `updateDepthAndCover`). */
  collectBodies(out: CoverBody[]): void {
    if (this.destroyed) return;
    for (const villager of this.villagers.values()) {
      if (!villager.node.isValid) continue;
      out.push({
        node: villager.node,
        position: villager.at,
        radiusTiles: NPC_BODY_RADIUS_TILES,
        footY: villager.at.y,
      });
    }
    for (const animal of this.animals.values()) {
      if (!animal.node.isValid) continue;
      out.push({
        node: animal.node,
        position: animal.at,
        radiusTiles: ANIMAL_BODY_RADIUS_TILES,
        footY: animal.at.y,
      });
    }
    const keeper = this.shopkeeper;
    if (keeper !== null && keeper.node.isValid) {
      out.push({
        node: keeper.node,
        position: keeper.at,
        radiusTiles: NPC_BODY_RADIUS_TILES,
        footY: keeper.at.y,
      });
    }
  }

  /**
   * Village villagers and yard animals only exist in the village; the Shop Interior hides them
   * (and shows its Shopkeeper) so nobody from the square is drawn inside the shop (#93).
   */
  setVillageVisible(visible: boolean): void {
    if (this.destroyed) return;
    for (const view of this.villagers.values()) {
      if (view.node.isValid) view.node.active = visible;
    }
    for (const view of this.animals.values()) {
      if (view.node.isValid) view.node.active = visible;
    }
  }

  /** Stand the Shopkeeper at `at` (shop tiles) facing down, behind the counter. */
  showShopkeeper(at: { readonly x: number; readonly y: number }, rows: number): void {
    if (this.destroyed) return;
    if (this.shopkeeper !== null) {
      this.shopkeeper.at = { x: at.x, y: at.y };
      this.shopkeeper.rows = rows;
      this.placeShopkeeper(this.shopkeeper);
      this.shopkeeper.node.active = true;
      return;
    }
    const node = this.createActorNode('shopkeeper');
    node.addComponent(SpriteAnimator);
    const animator = node.getComponent(SpriteAnimator) as SpriteAnimator;
    const view = { node, animator, playing: '', at: { x: at.x, y: at.y }, rows };
    this.shopkeeper = view;
    this.placeShopkeeper(view);
  }

  /** Hide the Shopkeeper again when the player leaves the shop. */
  hideShopkeeper(): void {
    if (this.shopkeeper === null) return;
    if (this.shopkeeper.node.isValid) this.shopkeeper.node.active = false;
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
    if (this.shopkeeper !== null && this.shopkeeper.node.isValid) this.shopkeeper.node.destroy();
    this.shopkeeper = null;
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
    view.at = { x: villager.position.x, y: villager.position.y };
    const feet = feetOf(view.at, this.rows);
    view.node.setPosition(feet.x, feet.y, 0);

    const signature = `${villager.animKey}|${villager.facing}`;
    if (view.playing !== signature) {
      view.playing = signature;
      view.animator.play(villager.animKey, villager.facing, villager.fallbackAnimKey);
    }
  }

  private placeAnimal(view: AnimalSprite, animal: VillageAnimal): void {
    const state: AnimalState = animal.state;
    view.at = { x: state.at.x, y: state.at.y };
    const feet = feetOf(view.at, this.rows);
    view.node.setPosition(feet.x, feet.y, 0);
    view.node.setScale(ACTOR_SCALE * state.facing, ACTOR_SCALE, 1);
  }

  /** Shopkeeper: one standing clip (`npc.shopkeeper-stand.down`), feet on its tile centre. */
  private placeShopkeeper(view: VillagerSprite & { rows: number }): void {
    const feet = feetOf(view.at, view.rows);
    view.node.setPosition(feet.x, feet.y, 0);
    view.node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    const stand = resolveNpcAnimKey('shopkeeper', 'stand', 'down');
    const signature = stand.key;
    if (view.playing !== signature) {
      view.playing = signature;
      view.animator.play(stand.key, 'down', stand.fallback);
    }
  }
}

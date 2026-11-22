/**
 * Wires `Bootstrap` into `window.__yokai` (only when `?debug=1`).
 *
 * Split from bootstrap so run-flow does not grow with acceptance hooks; the
 * `placeholders`/`audio`/`anim` logic lives here too instead of being scattered through the class.
 */
import type { Node as CocosNode } from 'cc';
import { director } from 'cc';
import type { AudioManager } from './audio/audio-manager';
import type {
  DebugAnimationSnapshot,
  DebugAtmosphereSnapshot,
  DebugAudioSnapshot,
  DebugBossSnapshot,
  DebugDoorSnapshot,
  DebugEnemySnapshot,
  DebugMenuBackdropSnapshot,
  DebugProvider,
  DebugScreenId,
  DebugSpecialSnapshot,
  DebugStatus,
  DebugUiText,
  DebugVfxSnapshot,
} from './debug-api';
import { installDebugApi } from './debug-api';
import { animationOfNode, collectAnimations, collectPlaceholders } from './debug-extras';
import type { DerivedStats } from '../core/skills/derived-stats';
import { SFX_BANK } from '../core/audio/sfx-bank';
import type { Vec2 } from '../core/math/vec2';

type Node = InstanceType<typeof CocosNode>;

export interface DebugWiringHost {
  readonly status: () => DebugStatus;
  readonly chapter: () => number;
  readonly room: () => number;
  readonly roomTotal: () => number;
  readonly killAll: () => number;
  readonly spawn: (role: string, elite?: boolean, at?: Vec2) => string;
  readonly stress: () => boolean;
  readonly fps: () => { readonly fps: number; readonly frameMs: number; readonly samples: number };
  readonly godMode: (on: boolean) => boolean;
  readonly enemies: () => readonly DebugEnemySnapshot[];
  readonly bulletCount: () => number;
  readonly skillChoices: () => string[] | null;
  readonly pickSkill: (indexOrId: number | string) => boolean;
  readonly grantSkill: (id: string, stacks?: number) => number;
  readonly stats: () => DerivedStats;
  readonly boss: () => DebugBossSnapshot | null;
  readonly setBossHp: (fraction: number) => boolean;
  readonly startChapter: (chapter: number, seed?: number) => Promise<boolean>;
  readonly loadRoom: (id: string) => Promise<boolean>;
  readonly screen: () => DebugScreenId;
  readonly save: () => unknown;
  readonly setGold: (gold: number) => boolean;
  readonly markChapterCleared: (chapter: number) => boolean;
  readonly uiText: () => readonly DebugUiText[];
  readonly skillPreview: (ids: readonly string[]) => Promise<boolean>;
  readonly closeSkillPreview: () => boolean;
  readonly roomRoot: () => Node | null;
  readonly actorLayer: () => Node | null;
  readonly bulletLayer: () => Node | null;
  readonly fxLayer: () => Node | null;
  readonly uiRoot: () => Node | null;
  readonly audioManager: () => AudioManager | null;
  readonly setEffects: (mode: 'full' | 'reduced') => boolean;
  readonly vfx: () => DebugVfxSnapshot;
  readonly atmosphere: () => DebugAtmosphereSnapshot;
  readonly menuBackdrop: () => DebugMenuBackdropSnapshot | null;
  readonly doors: () => DebugDoorSnapshot;
  readonly takeDoor: (index: number) => boolean;
  readonly special: () => DebugSpecialSnapshot;
  readonly useSpecial: () => boolean;
}

/** Nodes of the whole scene, recursively — proves the menu backdrop leaves nothing behind. */
function countNodes(node: Node): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

/** Install the API if the URL has `?debug=1`; returns `true` when installed. */
export function installDebugWiring(host: DebugWiringHost): boolean {
  const provider: DebugProvider = {
    status: host.status,
    chapter: host.chapter,
    room: host.room,
    roomTotal: host.roomTotal,
    killAll: host.killAll,
    spawn: host.spawn,
    stress: host.stress,
    fps: host.fps,
    godMode: host.godMode,
    enemies: host.enemies,
    bulletCount: host.bulletCount,
    skillChoices: host.skillChoices,
    pickSkill: host.pickSkill,
    grantSkill: host.grantSkill,
    stats: host.stats,
    boss: host.boss,
    setBossHp: host.setBossHp,
    startChapter: host.startChapter,
    loadRoom: host.loadRoom,
    screen: host.screen,
    save: host.save,
    setGold: host.setGold,
    markChapterCleared: host.markChapterCleared,
    uiText: host.uiText,
    skillPreview: host.skillPreview,
    closeSkillPreview: host.closeSkillPreview,
    placeholders: () =>
      collectPlaceholders([
        host.roomRoot(),
        host.actorLayer(),
        host.bulletLayer(),
        host.fxLayer(),
        host.uiRoot(),
      ]),
    audio: (): DebugAudioSnapshot =>
      host.audioManager()?.snapshot() ?? {
        unlocked: false,
        volume: 0,
        music: null,
        lastSfx: [],
        bank: SFX_BANK,
        lastClips: [],
      },
    anim: (nodeName?: string): string | DebugAnimationSnapshot | null =>
      nodeName === undefined
        ? collectAnimations(host.actorLayer())
        : animationOfNode(host.actorLayer(), nodeName),
    setEffects: host.setEffects,
    vfx: host.vfx,
    atmosphere: host.atmosphere,
    menuBackdrop: host.menuBackdrop,
    doors: host.doors,
    takeDoor: host.takeDoor,
    special: host.special,
    useSpecial: host.useSpecial,
    nodeCount: () => {
      const scene: Node | null = director.getScene() as Node | null;
      return scene === null ? 0 : countNodes(scene);
    },
  };

  return installDebugApi(provider);
}

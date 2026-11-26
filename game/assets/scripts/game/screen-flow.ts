/**
 * M5/M14/M15 screen routing: title (+ Continue Run), character select, chapter select (+ Ascension
 * 0–5), 6-track meta shop, settings (+ Music/SFX sliders), credits, pause (+ Music/SFX sliders &
 * ducking), and rich result (+ Continue Endless). Split from `bootstrap.ts` so run-flow does not
 * grow with UI.
 *
 * All new M15 options on `ScreenFlowOptions` / `ScreenFlowHost` are optional so `bootstrap.ts`
 * compiles cleanly both before and after Wave 3 merges.
 */
import type { Node as CocosNode } from 'cc';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  getUnlockedCharacters,
  isCharacterId,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../core/characters/roster';
import { setLocale } from '../core/i18n';
import { buy, canBuy, UPGRADE_TRACKS } from '../core/meta/upgrades';
import type { UpgradeTrack } from '../core/meta/upgrades';
import { clampAscension } from '../core/run/ascension';
import { canStartEndless } from '../core/run/endless';
import { applyGold, MAX_GOLD, summariseRun } from '../core/run/rewards';
import { CHAPTERS_PER_RUN, ROOMS_PER_CHAPTER } from '../core/run/run-state';
import type { DeathCause, RunUnlocksSummary } from '../core/run/run-summary';
import { chapterGate } from '../core/save/chapter-gate';
import type { ActiveRunSave } from '../core/save/run-save';
import {
  buyCharacter,
  canBuyCharacter,
  unlockNextChapter,
  unlockedAscensionForChapter,
  withBest,
  withSelectedCharacter,
  type SaveData,
} from '../core/save/save-data';
import {
  applySettings,
  stepMusicVolume,
  stepSfxVolume,
  type Settings,
} from '../core/save/settings';
import type { SaveRepository } from '../core/save/storage';
import { menuBackdropChapter, type MenuBackdropScreen } from '../core/view/menu-backdrop';
import type { MusicId } from './audio/audio-manager';
import { playSfx } from './audio/sfx';
import { buildChapterSelect, type ChapterButton, type ChapterSelectScreen } from './chapter-select';
import type { DebugCharacterSnapshot, DebugScreenId, DebugStatus } from './debug-api';
import { commitRunEnd } from './run-end';
import {
  buildCharacterSelectScreen,
  type CharacterSelectScreen,
} from './screens/character-select-screen';
import { buildCreditsScreen } from './screens/credits-screen';
import { buildPauseScreen } from './screens/pause-screen';
import {
  buildResultScreen,
  type RunResultData,
  type RunResultOwnedSkills,
} from './screens/result-screen';
import {
  SETTINGS_LANGUAGE_ROW_INDEX,
  buildSettingsScreen,
} from './screens/settings-screen';
import {
  SHOP_CHARACTER_START_INDEX,
  SHOP_CHAR_SELECT_BUTTON_INDEX,
  SHOP_UNLOCK_CHARACTER_IDS,
  buildShopScreen,
} from './screens/shop-screen';
import { buildTitleScreen, type TitleScreen } from './screens/title-screen';

type Node = InstanceType<typeof CocosNode>;

/** Extended screen union including M14's `'character-select'`. */
export type ScreenFlowScreenId = DebugScreenId | 'character-select';

/** One run snapshot taken before teardown; enough to build the result and credit gold. */
export interface RunSnapshot {
  readonly chapter: number;
  readonly room: number;
  readonly roomsTotal: number;
  readonly durationMs: number;
  readonly goldEarned: number;
  readonly kills: number;
  readonly seed?: number;
  readonly ascension?: number;
  readonly endlessLoop?: number;
  readonly characterId?: CharacterId;
  readonly deathCause?: DeathCause;
  readonly ownedSkills?: RunResultOwnedSkills;
  readonly unlocks?: RunUnlocksSummary;
  readonly canContinueEndless?: boolean;
}

export interface ScreenFlowHost {
  /** UI canvas (created lazily by bootstrap). */
  uiRoot(): Node;
  save(): SaveData | null;
  repository(): SaveRepository | null;
  setSave(save: SaveData): void;
  status(): DebugStatus;
  setStatus(status: DebugStatus): void;
  /** Whether a chapter has level data in this build. */
  chapterAvailable(chapter: number): boolean;
  /** Draw the living room of `chapter` behind the title / chapter select (#8). */
  showMenuBackdrop(chapter: number): void;
  /** Destroy every living-backdrop node (leaving the menu, entering a run). */
  clearMenuBackdrop(): void;
  /** Start a run from chapter select (accepts optional Ascension 0..5, M15). */
  startChapter(chapter: number, ascension?: number): void;
  /** Optional explicit start-chapter callback receiving `(chapter, ascension?)` (M15). */
  readonly onStartChapter?: (chapter: number, ascension?: number) => void;
  /** Snapshot the current run; `null` when not in a run. */
  runSnapshot(): RunSnapshot | null;
  launchChapter(chapter: number, seed?: number, ascension?: number): Promise<void>;
  teardownRun(clearRunSave?: boolean): void;
  /** Background music per screen; `null` = stop (result/pause leave it alone). */
  setMusic(id: MusicId | null): void;
  /** Legacy master volume fallback when `onMusicVolume` / `onSfxVolume` are omitted. */
  readonly setVolume?: (volume: number) => void;
  /** Independent Music channel callback (M15). */
  readonly onMusicVolume?: (volume: number) => void;
  /** Independent SFX channel callback (M15). */
  readonly onSfxVolume?: (volume: number) => void;
  /** Smooth music ducking callback when Pause opens (`true`) or closes (`false`) (M15). */
  readonly onMusicDucked?: (ducked: boolean) => void;
  /** Return active safe-boundary run save for Title's `Continue Run` button (M15). */
  readonly getActiveRunSave?: () => ActiveRunSave | null;
  /** Resume a saved active run from Title's `Continue Run` button (M15). */
  readonly onContinueRun?: (run: ActiveRunSave) => void;
  /** Advance into Endless loop from Result's `Continue Endless` button (M15). */
  readonly onContinueEndless?: () => void;
  /** Accessibility flags (shake, damage numbers) applied immediately to the running game. */
  applyFeelSettings(settings: Settings): void;
  /** Optional M10/M14 callback when character selection or preview changes. */
  readonly onCharacterChanged?: (character: CharacterDef) => void;
  fail(error: unknown): void;
}

export type ScreenFlowOptions = ScreenFlowHost;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ScreenFlow {
  private menu: { readonly node: Node; destroy(): void } | null = null;
  private titleScreen: TitleScreen | null = null;
  private characterSelectScreen: CharacterSelectScreen | null = null;
  private chapterSelectScreen: ChapterSelectScreen | null = null;
  private token = 0;
  private currentScreen: ScreenFlowScreenId = 'title';
  private settingsBack: (() => void) | null = null;
  private shopBack: (() => void) | null = null;
  /** Chapter currently drawn behind title/character-select/chapter-select; `null` when cleared. */
  private backdropChapter: number | null = null;
  /** Selected Ascension tier (0..5) preserved across Character Select <-> Chapter Select -> Start Run. */
  private selectedAscension = 0;
  private selectedChapterForAscension = 1;
  /** Tracks whether Pause currently holds music ducking active so closing Pause always unducks cleanly. */
  private pauseDucked = false;

  constructor(private readonly host: ScreenFlowHost) {
    document.addEventListener('keydown', this.onKey, true);
  }

  /** Esc/P during a run opens pause. Capture phase so it does not depend on canvas focus. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.repeat || this.host.status() !== 'playing') return;
    const key = event.key;
    const pause =
      key === 'Escape' || key === 'p' || key === 'P' || event.keyCode === 27 || event.keyCode === 80;
    if (!pause) return;
    event.preventDefault();
    void this.showPause().catch((error: unknown) => this.host.fail(error));
  };

  /** Remove the listener + current screen when Bootstrap is destroyed. */
  destroy(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.releasePauseDucking();
    this.clearMenu();
    this.clearBackdrop();
  }

  /** Current open screen id. */
  get screenId(): DebugScreenId {
    return this.currentScreen as DebugScreenId;
  }

  /** Selected Ascension tier (0..5) preserved across menu navigation. */
  get ascension(): number {
    return this.selectedAscension;
  }

  /** Update preserved Ascension tier (e.g. from debug hook or external controller). */
  setAscension(tier: number): void {
    this.selectedAscension = clampAscension(tier);
    this.chapterSelectScreen?.setAscension(this.selectedAscension);
  }

  /** Bootstrap reports the running screen (playing/skill-pick) — status is unchanged. */
  setScreen(id: ScreenFlowScreenId): void {
    this.currentScreen = id;
  }

  /** Tear down the open screen (used before entering a run or when the component is destroyed). */
  clearMenu(): void {
    this.releasePauseDucking();
    this.titleScreen = null;
    this.characterSelectScreen = null;
    this.chapterSelectScreen = null;
    this.menu?.destroy();
    this.menu = null;
  }

  private setPauseDucking(ducked: boolean): void {
    if (this.pauseDucked === ducked) return;
    this.pauseDucked = ducked;
    this.host.onMusicDucked?.(ducked);
  }

  private releasePauseDucking(): void {
    if (!this.pauseDucked) return;
    this.pauseDucked = false;
    this.host.onMusicDucked?.(false);
  }

  private nextMenuToken(): number {
    this.token += 1;
    this.clearMenu();
    return this.token;
  }

  /**
   * Pick the room behind the menu (pure rule in `core/view/menu-backdrop.ts`) and show it.
   * The adapter no-ops when the chapter is already drawn, so Title ↔ Character Select ↔ Chapter
   * Select keeps Chapter 1 Room 1 seamless without rebuilding.
   */
  private applyBackdrop(screen: MenuBackdropScreen, focusedChapter: number | null): void {
    const chapter = menuBackdropChapter({
      screen,
      focusedChapter,
      current: this.backdropChapter,
      hasData: (candidate) => this.host.chapterAvailable(candidate),
    });
    this.backdropChapter = chapter;
    this.host.showMenuBackdrop(chapter);
  }

  private clearBackdrop(): void {
    this.backdropChapter = null;
    this.host.clearMenuBackdrop();
  }

  async showTitle(initialFocus = 0): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    const selected = resolveSelectedCharacter(save);
    const available = getUnlockedCharacters(save);
    const activeRun = this.host.getActiveRunSave?.() ?? null;
    const continueOffset = activeRun !== null ? 1 : 0;

    const token = this.nextMenuToken();
    const built = await buildTitleScreen({
      parent: this.host.uiRoot(),
      gold: save.gold,
      best: save.best,
      activeRun,
      ...(this.host.onContinueRun !== undefined
        ? {
            onContinueRun: (run) => {
              this.selectedAscension = clampAscension(run.ascension);
              this.selectedChapterForAscension = run.chapter;
              this.host.onContinueRun?.(run);
            },
          }
        : {}),
      selectedCharacter: selected,
      availableCharacters: available,
      initialFocus,
      onSelectCharacter: (characterId) => {
        this.selectCharacter(characterId);
      },
      onOpenCharacterSelect: () => {
        void this.showCharacterSelect(() => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 1).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onPlay: () => {
        void this.showChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onShop: () => {
        void this.showShop(() => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 2).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onSettings: () => {
        void this.showSettings(() => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 3).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onCredits: () => {
        void this.showCredits(() => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 4).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.titleScreen = built;
    this.currentScreen = 'title';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    this.host.onCharacterChanged?.(selected);
    this.applyBackdrop('title', null);
    console.log(
      `[YokaiField] Title: gold ${save.gold}, unlocked ${save.chaptersUnlocked}/${CHAPTERS_PER_RUN}, ` +
        `character ${selected.id}${continueOffset > 0 ? ', activeRun resumable' : ''}.`,
    );
  }

  /**
   * Open the 4-class Character Select screen. Previews whichever class is highlighted in the
   * living room backdrop, preserves `this.selectedAscension`, and restores the saved character on `Back`.
   */
  async showCharacterSelect(
    backTo?: () => void,
    initialCharacterId?: CharacterId,
  ): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    const back =
      backTo ??
      ((): void => {
        const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
        void this.showTitle(offset + 1).catch((error: unknown) => this.host.fail(error));
      });
    const selected = resolveSelectedCharacter(save);
    const startId = initialCharacterId ?? selected.id;

    // Ensure the living room backdrop is visible so the highlighted class previews on the left stage.
    this.applyBackdrop('title', null);
    this.host.onCharacterChanged?.(CHARACTERS[startId]);

    const token = this.nextMenuToken();
    const built = await buildCharacterSelectScreen({
      parent: this.host.uiRoot(),
      save,
      initialCharacterId: startId,
      onHighlightCharacter: (character) => {
        if (token !== this.token) return;
        this.host.onCharacterChanged?.(character);
      },
      onSelectCharacter: (characterId) => {
        if (!this.selectCharacter(characterId)) return;
        const latest = this.host.save();
        if (latest !== null) this.characterSelectScreen?.setSave(latest);
      },
      onUnlockCharacter: (characterId) => {
        const next = this.tryBuyCharacter(characterId, true);
        if (next === null) return;
        playSfx('skill-acquired');
        this.characterSelectScreen?.setSave(next);
      },
      onBack: () => {
        // Restore backdrop actor to the saved selection if the player only previewed a locked hero.
        this.host.onCharacterChanged?.(this.selectedCharacter());
        back();
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.characterSelectScreen = built;
    this.currentScreen = 'character-select';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    console.log(
      `[YokaiField] Character select: gold ${save.gold}, selected ${selected.id}, ` +
        `unlocked [${getUnlockedCharacters(save).map((c) => c.id).join(', ')}].`,
    );
  }

  async showChapterSelect(): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    const token = this.nextMenuToken();
    const chapters: ChapterButton[] = [];
    for (let chapter = 1; chapter <= CHAPTERS_PER_RUN; chapter += 1) {
      const hasData = this.host.chapterAvailable(chapter);
      chapters.push({
        chapter,
        hasData,
        playable: chapterGate(save, chapter, hasData).allowed,
        maxAscension: unlockedAscensionForChapter(save, chapter),
      });
    }

    // Make sure backdrop displays the equipped character (never a transient preview).
    this.host.onCharacterChanged?.(resolveSelectedCharacter(save));

    const initialChapter = chapters.some(
      (c) => c.chapter === this.selectedChapterForAscension && c.playable,
    )
      ? this.selectedChapterForAscension
      : undefined;

    const built = await buildChapterSelect(this.host.uiRoot(), {
      chapters,
      best: save.best,
      save,
      ...(initialChapter !== undefined ? { initialChapter } : {}),
      initialAscension: this.selectedAscension,
      onAscensionChange: (ascension, chapter) => {
        this.selectedAscension = clampAscension(ascension);
        this.selectedChapterForAscension = chapter;
      },
      onStartChapter: (chapter, ascension) => {
        const latestSave = this.host.save() ?? save;
        const clampedAsc = Math.min(
          clampAscension(ascension ?? this.selectedAscension),
          unlockedAscensionForChapter(latestSave, chapter),
        );
        this.selectedAscension = clampedAsc;
        this.selectedChapterForAscension = chapter;
        if (this.host.onStartChapter !== undefined) {
          this.host.onStartChapter(chapter, clampedAsc);
        } else {
          this.host.startChapter(chapter, clampedAsc);
        }
      },
      onBack: () => {
        const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
        void this.showTitle(offset).catch((error: unknown) => this.host.fail(error));
      },
      onFocusChapter: (chapter) => {
        if (token !== this.token) return;
        this.applyBackdrop('chapter-select', chapter);
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.chapterSelectScreen = built;
    this.currentScreen = 'chapter-select';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    console.log(
      `[YokaiField] Chapter select: best chapter ${save.best.chapter} · room ${save.best.room}, ` +
        `unlocked ${save.chaptersUnlocked}/${CHAPTERS_PER_RUN}, ascension ${this.selectedAscension}.`,
    );
  }

  /** End the run: credit gold/unlocks once, tear the run down, open rich result screen. */
  finishRun(won: boolean, overrides?: Partial<RunResultData>): void {
    const run = this.host.runSnapshot();
    if (run === null && overrides === undefined) return;

    const chapter = overrides?.chapter ?? run?.chapter ?? 1;
    const roomReached = overrides?.roomReached ?? run?.room ?? 1;
    const roomsTotal = overrides?.roomsTotal ?? run?.roomsTotal ?? ROOMS_PER_CHAPTER;
    const goldEarned = overrides?.goldEarned ?? run?.goldEarned ?? 0;
    const durationMs = overrides?.durationMs ?? run?.durationMs ?? 0;
    const kills = overrides?.kills ?? run?.kills ?? 0;

    const roomsCleared = won ? roomsTotal : Math.max(0, roomReached - 1);
    const summary = summariseRun({
      roomsCleared,
      kills,
      goldEarned,
      durationMs,
      status: won ? 'won' : 'lost',
    });

    const seed = overrides?.seed ?? run?.seed;
    const ascension = overrides?.ascension ?? run?.ascension ?? this.selectedAscension;
    const endlessLoop = overrides?.endlessLoop ?? run?.endlessLoop ?? 0;
    const characterId = overrides?.characterId ?? run?.characterId;
    const deathCause = overrides?.deathCause ?? run?.deathCause;
    const ownedSkills = overrides?.ownedSkills ?? run?.ownedSkills;

    const save = this.host.save();
    const repo = this.host.repository();
    let goldTotal = overrides?.goldTotal ?? save?.gold ?? 0;
    let unlockedChapter = overrides?.unlockedChapter;
    let committedUnlocks: RunUnlocksSummary | undefined;

    if (overrides?.goldTotal === undefined && save !== null && repo !== null) {
      try {
        const commit = commitRunEnd(save, repo, {
          chapter,
          goldEarned,
          won,
          ascension,
          endlessLoop,
        });
        this.host.setSave(commit.save);
        goldTotal = commit.gold;
        committedUnlocks = commit.unlocks;
        if (commit.unlocked) {
          unlockedChapter = chapter + 1;
          console.log(
            `[YokaiField] Chapter ${chapter} clear → unlocked chapter ${commit.chaptersUnlocked}.`,
          );
        }
      } catch (error: unknown) {
        console.warn(`[YokaiField] Could not write the run result: ${errorMessage(error)}`);
      }
    }

    const unlocks = overrides?.unlocks ?? run?.unlocks ?? committedUnlocks;
    const canContinueEndless =
      overrides?.canContinueEndless ??
      run?.canContinueEndless ??
      (won &&
        (canStartEndless(chapter, won) || endlessLoop >= 1) &&
        this.host.onContinueEndless !== undefined);

    const data: RunResultData = {
      chapter,
      roomReached,
      roomsTotal,
      goldEarned,
      goldTotal,
      durationMs: summary.durationMs,
      kills,
      won,
      ...(unlockedChapter !== undefined ? { unlockedChapter } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(ascension > 0 ? { ascension } : {}),
      ...(endlessLoop > 0 ? { endlessLoop } : {}),
      ...(characterId !== undefined ? { characterId } : {}),
      ...(deathCause !== undefined ? { deathCause } : {}),
      ...(ownedSkills !== undefined ? { ownedSkills } : {}),
      ...(unlocks !== undefined ? { unlocks } : {}),
      ...(canContinueEndless ? { canContinueEndless: true } : {}),
    };

    console.log(
      `[YokaiField] ${won ? 'RUN WON' : 'RUN LOST'}: chapter ${data.chapter} · ` +
        `room ${data.roomReached}/${data.roomsTotal} · +${data.goldEarned} gold ` +
        `(total ${data.goldTotal}) · ${summary.durationSeconds}s · ${data.kills} kills.`,
    );

    this.currentScreen = 'result';
    this.host.setStatus(won ? 'won' : 'lost');
    this.host.teardownRun(true);
    void this.showResult(data).catch((error: unknown) => this.host.fail(error));
  }

  async showResult(data: RunResultData): Promise<void> {
    this.clearBackdrop();
    const token = this.nextMenuToken();
    const current: RunResultData = {
      ...data,
      goldTotal: this.host.save()?.gold ?? data.goldTotal,
    };

    const built = await buildResultScreen({
      parent: this.host.uiRoot(),
      result: current,
      ...(this.host.onContinueEndless !== undefined
        ? {
            onContinueEndless: () => {
              this.clearMenu();
              this.host.onContinueEndless?.();
            },
          }
        : {}),
      onShop: () => {
        void this.showShop(() => {
          void this.showResult(current).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onChapterSelect: () => {
        void this.returnToChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onTitle: () => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'result';
    this.host.setStatus(data.won ? 'won' : 'lost');
    this.host.setMusic(null);
  }

  private async showShop(backTo: () => void, initialFocus = 0): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    this.clearBackdrop();
    this.shopBack = backTo;
    const token = this.nextMenuToken();
    const built = await buildShopScreen({
      parent: this.host.uiRoot(),
      save,
      initialFocus,
      onBack: backTo,
      onBuy: (track) => {
        if (this.tryBuy(track) === null) return;
        // Rebuild so prices/levels/gold are correct; keep focus on the track just bought (0..5).
        void this.showShop(backTo, UPGRADE_TRACKS.indexOf(track)).catch((error: unknown) =>
          this.host.fail(error),
        );
      },
      onBuyCharacter: (characterId) => {
        if (this.tryBuyCharacter(characterId, false) === null) return;
        playSfx('skill-acquired');
        const charIdx = SHOP_UNLOCK_CHARACTER_IDS.indexOf(
          characterId as (typeof SHOP_UNLOCK_CHARACTER_IDS)[number],
        );
        const focusIdx =
          charIdx >= 0 ? SHOP_CHARACTER_START_INDEX + charIdx : SHOP_CHARACTER_START_INDEX;
        void this.showShop(backTo, focusIdx).catch((error: unknown) => this.host.fail(error));
      },
      onOpenCharacterSelect: () => {
        void this.showCharacterSelect(() => {
          void this.showShop(backTo, SHOP_CHAR_SELECT_BUTTON_INDEX).catch((error: unknown) =>
            this.host.fail(error),
          );
        }).catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'shop';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  /** Buy one stat or utility upgrade level; `null` when gold is short / maxed / saving fails. */
  private tryBuy(track: UpgradeTrack): SaveData | null {
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return null;

    if (!canBuy(save, track, save.gold)) {
      console.warn(`[YokaiField] Cannot buy '${track}': not enough gold or already maxed.`);
      return null;
    }

    try {
      const result = buy({ upgrades: save.upgrades }, track, save.gold);
      const next: SaveData = { ...save, gold: result.gold, upgrades: result.state.upgrades };
      repo.save(next);
      this.host.setSave(next);
      console.log(
        `[YokaiField] Bought '${track}' up to level ${next.upgrades[track]}, ${next.gold} gold left.`,
      );
      return next;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Upgrade purchase failed: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * Buy an early character unlock with Meta gold (`buyCharacter` in `core/save/save-data.ts`).
   * When `autoSelect` is true (Character Select screen), also equips `characterId` immediately.
   */
  private tryBuyCharacter(characterId: CharacterId, autoSelect: boolean): SaveData | null {
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return null;

    if (!canBuyCharacter(save, characterId)) {
      console.warn(
        `[YokaiField] Cannot buy character '${characterId}': already unlocked or not enough gold.`,
      );
      return null;
    }

    try {
      let next = buyCharacter(save, characterId);
      if (autoSelect) {
        next = withSelectedCharacter(next, characterId);
      }
      repo.save(next);
      this.host.setSave(next);
      if (autoSelect) {
        this.host.onCharacterChanged?.(CHARACTERS[characterId]);
      }
      console.log(
        `[YokaiField] Unlocked character '${characterId}' for ${CHARACTERS[characterId].unlockGoldCost} gold ` +
          `(${next.gold} gold left${autoSelect ? ', equipped' : ''}).`,
      );
      return next;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Character unlock purchase failed: ${errorMessage(error)}`);
      return null;
    }
  }

  private async showSettings(backTo: () => void, initialFocus?: number): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    setLocale(save.settings.locale);
    this.clearBackdrop();
    this.settingsBack = backTo;
    const token = this.nextMenuToken();
    const built = await buildSettingsScreen({
      parent: this.host.uiRoot(),
      settings: save.settings,
      ...(initialFocus !== undefined ? { initialFocus } : {}),
      onMusicVolume: (musicVolume) => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({
          ...current,
          musicVolume,
          volume: Math.max(musicVolume, current.sfxVolume),
        });
      },
      onSfxVolume: (sfxVolume) => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({
          ...current,
          sfxVolume,
          volume: Math.max(current.musicVolume, sfxVolume),
        });
      },
      onToggleFullscreen: () => {
        void this.toggleFullscreen().catch((error: unknown) => this.host.fail(error));
      },
      onToggleScreenShake: () => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({ ...current, screenShake: !current.screenShake });
      },
      onToggleDamageNumbers: () => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({ ...current, damageNumbers: !current.damageNumbers });
      },
      onToggleEffects: () => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({
          ...current,
          effects: current.effects === 'full' ? 'reduced' : 'full',
        });
      },
      onToggleLocale: (next) => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({ ...current, locale: next });
        setLocale(next);
        // Rebuild Settings live on the Language row so every visible label updates immediately.
        void this.showSettings(backTo, SETTINGS_LANGUAGE_ROW_INDEX).catch((error: unknown) =>
          this.host.fail(error),
        );
      },
      onBack: backTo,
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'settings';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  private async showCredits(backTo: () => void): Promise<void> {
    this.clearBackdrop();
    const token = this.nextMenuToken();
    const built = await buildCreditsScreen({ parent: this.host.uiRoot(), onBack: backTo });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'credits';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  async showPause(): Promise<void> {
    if (this.host.status() !== 'playing') return;

    this.clearBackdrop();
    // Set the status before building: update() stops immediately, so sim clock/enemies/bullets/
    // telegraph/shield/i-frames all stand still while the pause screen loads textures.
    this.host.setStatus('paused');
    this.currentScreen = 'paused';

    const save = this.host.save();
    const token = this.nextMenuToken();
    this.setPauseDucking(true);

    const built = await buildPauseScreen({
      parent: this.host.uiRoot(),
      musicVolume: save?.settings.musicVolume ?? 0.8,
      sfxVolume: save?.settings.sfxVolume ?? 0.8,
      volume: save?.settings.volume ?? 0.8,
      onResume: () => this.resumeRun(),
      onRestart: () => {
        void this.restartRun().catch((error: unknown) => this.host.fail(error));
      },
      onQuit: () => {
        void this.quitToTitle().catch((error: unknown) => this.host.fail(error));
      },
      onMusicVolume: (musicVolume) => this.persistMusicVolume(musicVolume),
      onSfxVolume: (sfxVolume) => this.persistSfxVolume(sfxVolume),
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'paused';
  }

  private resumeRun(): void {
    if (this.host.status() !== 'paused') return;
    this.releasePauseDucking();
    this.clearMenu();
    this.host.setStatus('playing');
    this.currentScreen = 'playing';
    console.log('[YokaiField] Resume.');
  }

  /** Restart: keep the gold earned, start a new run in the same chapter & Ascension. */
  private async restartRun(): Promise<void> {
    const snap = this.host.runSnapshot();
    const chapter = snap?.chapter ?? 1;
    const ascension = snap?.ascension ?? this.selectedAscension;
    this.releasePauseDucking();
    this.bankRunGold();
    this.clearMenu();
    this.host.teardownRun(true);
    this.host.setStatus('loading');
    await this.host.launchChapter(chapter, undefined, ascension);
    console.log(`[YokaiField] Restart chapter ${chapter} (ascension ${ascension}).`);
  }

  private async quitToTitle(): Promise<void> {
    this.releasePauseDucking();
    // Preserve the safe-boundary `runSave` (ADR-023) so Title shows `Continue Run` immediately
    // without double-banking gold already stored in `runSave.goldEarned`. Only bank immediately
    // when no resumable run save exists.
    const hasResumableRun = (this.host.getActiveRunSave?.() ?? null) !== null;
    if (!hasResumableRun) {
      this.bankRunGold();
    }
    this.clearMenu();
    this.host.teardownRun(false);
    this.host.setStatus('loading');
    await this.showTitle();
    console.log('[YokaiField] Quit to title.');
  }

  private async returnToChapterSelect(): Promise<void> {
    this.clearMenu();
    this.host.teardownRun();
    this.host.setStatus('loading');
    await this.showChapterSelect();
  }

  /** Quitting/restarting mid-run still keeps the gold (GDD §7: gold you picked up is yours). */
  private bankRunGold(): void {
    const save = this.host.save();
    const repo = this.host.repository();
    const goldEarned = this.host.runSnapshot()?.goldEarned ?? 0;
    if (save === null || repo === null || goldEarned <= 0) return;

    try {
      const next = applyGold(save, goldEarned).save;
      repo.save(next);
      this.host.setSave(next);
      console.log(`[YokaiField] Kept ${goldEarned} gold when leaving the run (total ${next.gold}).`);
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not write gold when leaving the run: ${errorMessage(error)}`);
    }
  }

  private persistMusicVolume(musicVolume: number): void {
    const save = this.host.save();
    if (save === null) return;
    const current = stepMusicVolume(save.settings, 0);
    this.persistSettings({
      ...current,
      musicVolume,
      volume: Math.max(musicVolume, current.sfxVolume),
    });
  }

  private persistSfxVolume(sfxVolume: number): void {
    const save = this.host.save();
    if (save === null) return;
    const current = stepSfxVolume(save.settings, 0);
    this.persistSettings({
      ...current,
      sfxVolume,
      volume: Math.max(current.musicVolume, sfxVolume),
    });
  }

  /**
   * The latest settings from the live save, not the copy taken when the screen opened — two
   * toggles pressed in a row must not overwrite each other.
   */
  private currentSettings(fallback: Settings): Settings {
    return this.host.save()?.settings ?? fallback;
  }

  private persistSettings(settings: Settings): void {
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return;

    const normalized = applySettings(settings);
    if (
      normalized.volume === save.settings.volume &&
      normalized.musicVolume === save.settings.musicVolume &&
      normalized.sfxVolume === save.settings.sfxVolume &&
      normalized.fullscreen === save.settings.fullscreen &&
      normalized.screenShake === save.settings.screenShake &&
      normalized.damageNumbers === save.settings.damageNumbers &&
      normalized.effects === save.settings.effects &&
      normalized.locale === save.settings.locale
    ) {
      return;
    }

    try {
      const prevCharacter = resolveSelectedCharacter(save);
      let next: SaveData = { ...save, settings: normalized };
      const nextCharacter = resolveSelectedCharacter(next);
      if (next.selectedCharacter !== nextCharacter.id) {
        next = withSelectedCharacter(next, nextCharacter.id);
      }
      repo.save(next);
      this.host.setSave(next);
      setLocale(normalized.locale);

      if (normalized.musicVolume !== save.settings.musicVolume) {
        if (this.host.onMusicVolume !== undefined) {
          this.host.onMusicVolume(normalized.musicVolume);
        } else {
          this.host.setVolume?.(normalized.musicVolume);
        }
      }
      if (normalized.sfxVolume !== save.settings.sfxVolume) {
        if (this.host.onSfxVolume !== undefined) {
          this.host.onSfxVolume(normalized.sfxVolume);
        } else {
          this.host.setVolume?.(normalized.sfxVolume);
        }
      }

      this.host.applyFeelSettings(normalized);
      if (nextCharacter.id !== prevCharacter.id) {
        this.host.onCharacterChanged?.(nextCharacter);
      }
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not write settings: ${errorMessage(error)}`);
    }
  }

  /** Resolved character for the next run (falls back to Ninja if locked). */
  selectedCharacter(): CharacterDef {
    const save = this.host.save();
    return save === null ? CHARACTERS[DEFAULT_CHARACTER_ID] : resolveSelectedCharacter(save);
  }

  /** Roster + unlock snapshot for `window.__yokai.character()`. */
  characterSnapshot(): DebugCharacterSnapshot {
    const save = this.host.save();
    const selected = this.selectedCharacter();
    return {
      id: selected.id,
      name: selected.name,
      available: getUnlockedCharacters(save ?? {}).map((entry) => entry.id),
    };
  }

  /**
   * Select a playable character for new runs (`withSelectedCharacter` + save + UI/backdrop refresh).
   * Refuses mid-run swaps (`runSnapshot() !== null` or active run status) and locked characters.
   */
  selectCharacter(id: string): boolean {
    const status = this.host.status();
    if (
      this.host.runSnapshot() !== null ||
      (status !== 'menu' && status !== 'won' && status !== 'lost')
    ) {
      console.warn(`[YokaiField] Cannot change character mid-run (status ${status}).`);
      return false;
    }
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return false;
    if (!isCharacterId(id) || !isCharacterUnlocked(id, save)) {
      console.warn(`[YokaiField] Character '${id}' is locked or unknown.`);
      return false;
    }

    try {
      const next = withSelectedCharacter(save, id);
      if (next !== save) {
        repo.save(next);
        this.host.setSave(next);
      }
      const character = CHARACTERS[id];
      const available = getUnlockedCharacters(next);
      if (this.currentScreen === 'title' && this.titleScreen !== null) {
        this.titleScreen.setCharacter(character, available);
      }
      if (this.currentScreen === 'character-select' && this.characterSelectScreen !== null) {
        this.characterSelectScreen.setSave(next);
      }
      this.host.onCharacterChanged?.(character);
      console.log(`[YokaiField] Selected character: ${character.id}.`);
      return true;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not select character '${id}': ${errorMessage(error)}`);
      return false;
    }
  }

  /** Real fullscreen through the DOM; headless/unsupported keeps the old state + warns. */
  private async toggleFullscreen(): Promise<void> {
    const save = this.host.save();
    if (save === null) return;
    const wanted = !save.settings.fullscreen;

    try {
      if (wanted) {
        await document.documentElement.requestFullscreen?.();
      } else if (document.fullscreenElement !== null) {
        await document.exitFullscreen?.();
      }
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not change fullscreen: ${errorMessage(error)}`);
    }

    this.syncFullscreen();
  }

  /** Save the real fullscreen state and redraw the label if the Settings screen is open. */
  syncFullscreen(): void {
    const save = this.host.save();
    if (save === null) return;

    const actual = document.fullscreenElement !== null;
    if (save.settings.fullscreen !== actual) {
      this.persistSettings({ ...save.settings, fullscreen: actual });
    }

    if (this.currentScreen === 'settings') {
      const back =
        this.settingsBack ??
        ((): void => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 3).catch((error: unknown) => this.host.fail(error));
        });
      void this.showSettings(back).catch((error: unknown) => this.host.fail(error));
    }
  }

  /**
   * Debug-only: credit a chapter clear exactly like finishing its boss (unlock the next chapter
   * + best record) and persist it. Also refreshes open Title / Character Select / Shop views.
   */
  markChapterCleared(chapter: number): boolean {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
      console.warn(`[YokaiField] debug markChapterCleared skipped: bad chapter ${chapter}`);
      return false;
    }
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return false;

    try {
      const next = withBest(unlockNextChapter(save, chapter), chapter, ROOMS_PER_CHAPTER);
      repo.save(next);
      this.host.setSave(next);
      this.refreshOpenSaveViews(next);
      console.log(
        `[YokaiField] debug markChapterCleared ${chapter} → unlocked ${next.chaptersUnlocked}` +
          ` (best ${next.best.chapter}/${next.best.room}).`,
      );
      return true;
    } catch (error: unknown) {
      console.warn(
        `[YokaiField] debug markChapterCleared could not write the save: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /** Debug-only: set gold (shop & character-select early-unlock testing). */
  setGold(gold: number): boolean {
    if (!Number.isInteger(gold) || gold < 0) {
      console.warn(`[YokaiField] debug setGold skipped: needs an integer >= 0, got ${gold}`);
      return false;
    }
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return false;

    try {
      const next: SaveData = { ...save, gold: Math.min(gold, MAX_GOLD) };
      repo.save(next);
      this.host.setSave(next);
      console.log(`[YokaiField] debug setGold → ${next.gold}.`);
      this.refreshOpenSaveViews(next);
      return true;
    } catch (error: unknown) {
      console.warn(`[YokaiField] debug setGold could not write the save: ${errorMessage(error)}`);
      return false;
    }
  }

  private refreshOpenSaveViews(next: SaveData): void {
    if (this.currentScreen === 'title' && this.titleScreen !== null) {
      this.titleScreen.setCharacter(resolveSelectedCharacter(next), getUnlockedCharacters(next));
    } else if (this.currentScreen === 'character-select' && this.characterSelectScreen !== null) {
      this.characterSelectScreen.setSave(next);
    } else if (this.currentScreen === 'shop') {
      const back =
        this.shopBack ??
        ((): void => {
          const offset = (this.host.getActiveRunSave?.() ?? null) !== null ? 1 : 0;
          void this.showTitle(offset + 2).catch((error: unknown) => this.host.fail(error));
        });
      void this.showShop(back).catch((error: unknown) => this.host.fail(error));
    } else if (this.currentScreen === 'chapter-select') {
      void this.showChapterSelect().catch((error: unknown) => this.host.fail(error));
    }
  }
}

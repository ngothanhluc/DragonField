/**
 * M5/M14 screen routing: title, character select, chapter select, shop, settings, credits,
 * pause, result. Split from `bootstrap.ts` so run-flow does not grow with UI.
 *
 * This file owns neither run nor combat. It takes a narrow `ScreenFlowHost`:
 * the UI canvas, save/repository, run state (`status`, snapshot) and run
 * actions (start/launch/teardown). That way every screen is still built in code under
 * `screens/`, while bootstrap keeps only boot + the run loop + rendering.
 *
 * All on-screen text is English (console logs included).
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
import { buy, canBuy, UPGRADE_TRACKS } from '../core/meta/upgrades';
import type { UpgradeTrack } from '../core/meta/upgrades';
import { applyGold, MAX_GOLD, summariseRun } from '../core/run/rewards';
import { CHAPTERS_PER_RUN, ROOMS_PER_CHAPTER } from '../core/run/run-state';
import { chapterGate } from '../core/save/chapter-gate';
import {
  buyCharacter,
  canBuyCharacter,
  unlockNextChapter,
  withBest,
  withSelectedCharacter,
  type SaveData,
} from '../core/save/save-data';
import { applySettings, type Settings } from '../core/save/settings';
import type { SaveRepository } from '../core/save/storage';
import { menuBackdropChapter, type MenuBackdropScreen } from '../core/view/menu-backdrop';
import type { MusicId } from './audio/audio-manager';
import { playSfx } from './audio/sfx';
import { buildChapterSelect, type ChapterButton } from './chapter-select';
import type { DebugCharacterSnapshot, DebugScreenId, DebugStatus } from './debug-api';
import { commitRunEnd } from './run-end';
import {
  buildCharacterSelectScreen,
  type CharacterSelectScreen,
} from './screens/character-select-screen';
import { buildCreditsScreen } from './screens/credits-screen';
import { buildPauseScreen } from './screens/pause-screen';
import { buildResultScreen, type RunResultData } from './screens/result-screen';
import { buildSettingsScreen } from './screens/settings-screen';
import { SHOP_UNLOCK_CHARACTER_IDS, buildShopScreen } from './screens/shop-screen';
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
  /** Start a run from chapter select (gate/status guard lives in bootstrap). */
  startChapter(chapter: number): void;
  /** Snapshot the current run; `null` when not in a run. */
  runSnapshot(): RunSnapshot | null;
  launchChapter(chapter: number): Promise<void>;
  teardownRun(): void;
  /** Background music per screen; `null` = stop (result/pause leave it alone). */
  setMusic(id: MusicId | null): void;
  /** Master volume applied right after saved settings change. */
  setVolume(volume: number): void;
  /** Accessibility flags (shake, damage numbers) applied immediately to the running game. */
  applyFeelSettings(settings: Settings): void;
  /** Optional M10/M14 callback when character selection or preview changes. */
  readonly onCharacterChanged?: (character: CharacterDef) => void;
  fail(error: unknown): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ScreenFlow {
  private menu: { readonly node: Node; destroy(): void } | null = null;
  private titleScreen: TitleScreen | null = null;
  private characterSelectScreen: CharacterSelectScreen | null = null;
  private token = 0;
  private currentScreen: ScreenFlowScreenId = 'title';
  private settingsBack: (() => void) | null = null;
  private shopBack: (() => void) | null = null;
  /** Chapter currently drawn behind title/character-select/chapter-select; `null` when cleared. */
  private backdropChapter: number | null = null;

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
    this.clearMenu();
    this.clearBackdrop();
  }

  /**
   * Current open screen id. Cast keeps `bootstrap.ts` compiling untouched before `debug-api.ts`
   * widens `DebugScreenId` with `'character-select'`, while returning `'character-select'` live.
   */
  get screenId(): DebugScreenId {
    return this.currentScreen as DebugScreenId;
  }

  /** Bootstrap reports the running screen (playing/skill-pick) — status is unchanged. */
  setScreen(id: ScreenFlowScreenId): void {
    this.currentScreen = id;
  }

  /** Tear down the open screen (used before entering a run or when the component is destroyed). */
  clearMenu(): void {
    this.titleScreen = null;
    this.characterSelectScreen = null;
    this.menu?.destroy();
    this.menu = null;
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
    const token = this.nextMenuToken();
    const built = await buildTitleScreen({
      parent: this.host.uiRoot(),
      gold: save.gold,
      best: save.best,
      selectedCharacter: selected,
      availableCharacters: available,
      initialFocus,
      onSelectCharacter: (characterId) => {
        this.selectCharacter(characterId);
      },
      onOpenCharacterSelect: () => {
        void this.showCharacterSelect(() => {
          void this.showTitle(1).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onPlay: () => {
        void this.showChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onShop: () => {
        void this.showShop(() => {
          void this.showTitle(2).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onSettings: () => {
        void this.showSettings(() => {
          void this.showTitle(3).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onCredits: () => {
        void this.showCredits(() => {
          void this.showTitle(4).catch((error: unknown) => this.host.fail(error));
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
        `character ${selected.id}.`,
    );
  }

  /**
   * Open the 4-class Character Select screen. Previews whichever class is highlighted in the
   * living room backdrop and restores the active saved character on `Back`.
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
        void this.showTitle(1).catch((error: unknown) => this.host.fail(error));
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
      });
    }

    // Make sure backdrop displays the equipped character (never a transient preview).
    this.host.onCharacterChanged?.(resolveSelectedCharacter(save));

    const built = await buildChapterSelect(this.host.uiRoot(), {
      chapters,
      best: save.best,
      onSelect: (chapter) => this.host.startChapter(chapter),
      onBack: () => {
        void this.showTitle(0).catch((error: unknown) => this.host.fail(error));
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
    this.currentScreen = 'chapter-select';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    console.log(
      `[YokaiField] Chapter select: best chapter ${save.best.chapter} · room ${save.best.room}, ` +
        `unlocked ${save.chaptersUnlocked}/${CHAPTERS_PER_RUN}.`,
    );
  }

  /** End the run: credit gold/unlocks once, tear the run down, open result. */
  finishRun(won: boolean): void {
    const run = this.host.runSnapshot();
    if (run === null) return;

    const roomsCleared = won ? run.roomsTotal : Math.max(0, run.room - 1);
    const summary = summariseRun({
      roomsCleared,
      kills: run.kills,
      goldEarned: run.goldEarned,
      durationMs: run.durationMs,
      status: won ? 'won' : 'lost',
    });

    const save = this.host.save();
    const repo = this.host.repository();
    let goldTotal = save?.gold ?? 0;
    let unlockedChapter: number | undefined;

    if (save !== null && repo !== null) {
      try {
        const commit = commitRunEnd(save, repo, {
          chapter: run.chapter,
          goldEarned: run.goldEarned,
          won,
        });
        this.host.setSave(commit.save);
        goldTotal = commit.gold;
        if (commit.unlocked) {
          unlockedChapter = run.chapter + 1;
          console.log(
            `[YokaiField] Chapter ${run.chapter} clear → unlocked chapter ${commit.chaptersUnlocked}.`,
          );
        }
      } catch (error: unknown) {
        console.warn(`[YokaiField] Could not write the run result: ${errorMessage(error)}`);
      }
    }

    const data: RunResultData = {
      chapter: run.chapter,
      roomReached: run.room,
      roomsTotal: run.roomsTotal,
      goldEarned: run.goldEarned,
      goldTotal,
      durationMs: summary.durationMs,
      kills: run.kills,
      won,
      ...(unlockedChapter !== undefined ? { unlockedChapter } : {}),
    };

    console.log(
      `[YokaiField] ${won ? 'RUN WON' : 'RUN LOST'}: chapter ${data.chapter} · ` +
        `room ${data.roomReached}/${data.roomsTotal} · +${data.goldEarned} gold ` +
        `(total ${data.goldTotal}) · ${summary.durationSeconds}s · ${data.kills} kills.`,
    );

    this.currentScreen = 'result';
    this.host.setStatus(won ? 'won' : 'lost');
    this.host.teardownRun();
    void this.showResult(data).catch((error: unknown) => this.host.fail(error));
  }

  private async showResult(data: RunResultData): Promise<void> {
    this.clearBackdrop();
    const token = this.nextMenuToken();
    const current: RunResultData = {
      ...data,
      goldTotal: this.host.save()?.gold ?? data.goldTotal,
    };

    const built = await buildResultScreen({
      parent: this.host.uiRoot(),
      result: current,
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
        // Rebuild so prices/levels/gold are correct; keep focus on the track just bought.
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
        const focusIdx = charIdx >= 0 ? 3 + charIdx : 3;
        void this.showShop(backTo, focusIdx).catch((error: unknown) => this.host.fail(error));
      },
      onOpenCharacterSelect: () => {
        void this.showCharacterSelect(() => {
          void this.showShop(backTo, 6).catch((error: unknown) => this.host.fail(error));
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

  /** Buy one stat upgrade level; `null` when gold is short / maxed / saving fails. */
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

  private async showSettings(backTo: () => void): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    this.clearBackdrop();
    this.settingsBack = backTo;
    const token = this.nextMenuToken();
    const built = await buildSettingsScreen({
      parent: this.host.uiRoot(),
      settings: save.settings,
      onVolume: (volume) => this.persistSettings({ ...this.currentSettings(save.settings), volume }),
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
    const built = await buildPauseScreen({
      parent: this.host.uiRoot(),
      volume: save?.settings.volume ?? 0.8,
      onResume: () => this.resumeRun(),
      onRestart: () => {
        void this.restartRun().catch((error: unknown) => this.host.fail(error));
      },
      onQuit: () => {
        void this.quitToTitle().catch((error: unknown) => this.host.fail(error));
      },
      onVolume: (volume) => this.persistVolume(volume),
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
    this.clearMenu();
    this.host.setStatus('playing');
    this.currentScreen = 'playing';
    console.log('[YokaiField] Resume.');
  }

  /** Restart: keep the gold earned, start a new run in the same chapter. */
  private async restartRun(): Promise<void> {
    const chapter = this.host.runSnapshot()?.chapter ?? 1;
    this.bankRunGold();
    this.clearMenu();
    this.host.teardownRun();
    this.host.setStatus('loading');
    await this.host.launchChapter(chapter);
    console.log(`[YokaiField] Restart chapter ${chapter}.`);
  }

  private async quitToTitle(): Promise<void> {
    this.bankRunGold();
    this.clearMenu();
    this.host.teardownRun();
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

  private persistVolume(volume: number): void {
    const save = this.host.save();
    if (save === null) return;
    this.persistSettings({ ...save.settings, volume });
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
      normalized.fullscreen === save.settings.fullscreen &&
      normalized.screenShake === save.settings.screenShake &&
      normalized.damageNumbers === save.settings.damageNumbers &&
      normalized.effects === save.settings.effects
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
      if (normalized.volume !== save.settings.volume) this.host.setVolume(normalized.volume);
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
          void this.showTitle(3).catch((error: unknown) => this.host.fail(error));
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
          void this.showTitle(2).catch((error: unknown) => this.host.fail(error));
        });
      void this.showShop(back).catch((error: unknown) => this.host.fail(error));
    }
  }
}

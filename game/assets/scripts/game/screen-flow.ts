/**
 * M5 screen routing: title, chapter select, shop, settings, credits,
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
import { chapterGate } from '../core/save/chapter-gate';
import { applyGold, MAX_GOLD, summariseRun } from '../core/run/rewards';
import { applySettings } from '../core/save/settings';
import type { Settings } from '../core/save/settings';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';
import { buy, canBuy, UPGRADE_TRACKS } from '../core/meta/upgrades';
import type { UpgradeTrack } from '../core/meta/upgrades';
import { menuBackdropChapter, type MenuBackdropScreen } from '../core/view/menu-backdrop';
import type { DebugScreenId, DebugStatus } from './debug-api';
import type { MusicId } from './audio/audio-manager';
import { commitRunEnd } from './run-end';
import { buildChapterSelect, type ChapterButton } from './chapter-select';
import { buildCreditsScreen } from './screens/credits-screen';
import { buildPauseScreen } from './screens/pause-screen';
import { buildResultScreen, type RunResultData } from './screens/result-screen';
import { buildSettingsScreen } from './screens/settings-screen';
import { buildShopScreen } from './screens/shop-screen';
import { buildTitleScreen } from './screens/title-screen';

type Node = InstanceType<typeof CocosNode>;

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
  fail(error: unknown): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ScreenFlow {
  private menu: { readonly node: Node; destroy(): void } | null = null;
  private token = 0;
  private currentScreen: DebugScreenId = 'title';
  private settingsBack: (() => void) | null = null;
  private shopBack: (() => void) | null = null;
  /** Chapter currently drawn behind title/chapter select; `null` when no backdrop is shown. */
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

  get screenId(): DebugScreenId {
    return this.currentScreen;
  }

  /** Bootstrap reports the running screen (playing/skill-pick) — status is unchanged. */
  setScreen(id: DebugScreenId): void {
    this.currentScreen = id;
  }

  /** Tear down the open screen (used before entering a run or when the component is destroyed). */
  clearMenu(): void {
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
   * The adapter no-ops when the chapter is already drawn, so title ↔ chapter select keeps it.
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

  async showTitle(): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    const token = this.nextMenuToken();
    const built = await buildTitleScreen({
      parent: this.host.uiRoot(),
      gold: save.gold,
      best: save.best,
      onPlay: () => {
        void this.showChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onShop: () => {
        void this.showShop(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onSettings: () => {
        void this.showSettings(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onCredits: () => {
        void this.showCredits(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'title';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    this.applyBackdrop('title', null);
    console.log(`[YokaiField] Title: gold ${save.gold}, unlocked ${save.chaptersUnlocked}/3.`);
  }

  async showChapterSelect(): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: save not loaded');

    const token = this.nextMenuToken();
    const chapters: ChapterButton[] = [];
    for (let chapter = 1; chapter <= 3; chapter += 1) {
      const hasData = this.host.chapterAvailable(chapter);
      chapters.push({
        chapter,
        hasData,
        playable: chapterGate(save, chapter, hasData).allowed,
      });
    }

    const built = await buildChapterSelect(this.host.uiRoot(), {
      chapters,
      best: save.best,
      onSelect: (chapter) => this.host.startChapter(chapter),
      onBack: () => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
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
        `unlocked ${save.chaptersUnlocked}/3.`,
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

  /** Buy one level; `null` when gold is short / the track is maxed / saving fails. Rules live in core. */
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
      console.log(`[YokaiField] Bought '${track}' up to level ${next.upgrades[track]}, ${next.gold} gold left.`);
      return next;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Upgrade purchase failed: ${errorMessage(error)}`);
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
      const next: SaveData = { ...save, settings: normalized };
      repo.save(next);
      this.host.setSave(next);
      if (normalized.volume !== save.settings.volume) this.host.setVolume(normalized.volume);
      this.host.applyFeelSettings(normalized);
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not write settings: ${errorMessage(error)}`);
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
      const back = this.settingsBack ?? (() => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
      });
      void this.showSettings(back).catch((error: unknown) => this.host.fail(error));
    }
  }

  /** Debug-only: set gold (shop testing). */
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
      // If the shop is open, redraw so prices/disabled buttons match the new gold.
      if (this.currentScreen === 'shop') {
        const back = this.shopBack ?? (() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        });
        void this.showShop(back).catch((error: unknown) => this.host.fail(error));
      }
      return true;
    } catch (error: unknown) {
      console.warn(`[YokaiField] debug setGold could not write the save: ${errorMessage(error)}`);
      return false;
    }
  }
}

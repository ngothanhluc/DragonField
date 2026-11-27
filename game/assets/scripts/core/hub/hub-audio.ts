/**
 * Village Hub music state (GDD M21 §4).
 *
 * Pure TS — zero `cc` imports. The audio adapter (`AudioManager`) plays the cue; this module only
 * decides track + ducking for the current hub scene and dialog state.
 */
import type { HubState } from './hub-state';

export interface HubMusicCue {
  readonly track: string;
  /** Soft level: inside the Shop interior, or while any dialog box is open. */
  readonly ducked: boolean;
}

export interface HubMusicOptions {
  readonly dialogOpen: boolean;
}

/** Track + ducking for the current hub state; the village track keeps playing everywhere in the hub. */
export function hubMusicCue(state: HubState, options: HubMusicOptions): HubMusicCue {
  return {
    track: state.musicTrack,
    ducked: state.musicDucked || options.dialogOpen,
  };
}

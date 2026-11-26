/** Number of chapters in a run (GDD §1, §13.2: chapter 4 — desert — landed with #45). */
export const CHAPTERS_PER_RUN = 4;
/** Number of regular rooms per chapter, before the boss room. */
export const NORMAL_ROOMS_PER_CHAPTER = 8;
/** Total rooms per chapter, boss included. */
export const ROOMS_PER_CHAPTER = NORMAL_ROOMS_PER_CHAPTER + 1;

export type RunStatus = 'playing' | 'room-cleared' | 'won' | 'lost';

/**
 * Run progress: which chapter, which room, which wave.
 *
 * This class **does not** know how many waves a room has (GDD §8: the wave count is
 * room data, not chapter data) — the caller passes the total in.
 * `nextWave()`.
 *
 * The chapter's total room count is **data** (`roomsInChapter`, from the `.tmx` file
 * count), not a constant: adding `room-10.tmx` makes the run know `10/10` by itself. The
 * `ROOMS_PER_CHAPTER` constant is only the default when the caller has no data (tests,
 * simulation).
 *
 * State transitions follow a fixed order: playing -> room-cleared -> playing (next room)
 * or -> won after the final boss. Every invalid transition throws so bugs surface in tests
 * instead of quietly pushing the run into an invalid state.
 */
export class RunState {
  private currentChapter: number;
  private currentRoom = 1;
  private currentWave = 1;
  private currentStatus: RunStatus = 'playing';
  private readonly roomsInChapter: number;

  constructor(chapter = 1, roomsInChapter: number = ROOMS_PER_CHAPTER) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
      throw new Error(
        `Chapter must be an integer in 1..${CHAPTERS_PER_RUN}, got ${chapter}`,
      );
    }
    if (!Number.isInteger(roomsInChapter) || roomsInChapter < 1) {
      throw new Error(
        `Rooms in chapter must be an integer >= 1, got ${roomsInChapter}`,
      );
    }
    this.currentChapter = chapter;
    this.roomsInChapter = roomsInChapter;
  }

  get chapter(): number {
    return this.currentChapter;
  }

  /** Current room, 1-based. Room `roomsTotal` is the boss. */
  get room(): number {
    return this.currentRoom;
  }

  /** Total rooms in the current chapter — derived from level data, never hardcoded. */
  get roomsTotal(): number {
    return this.roomsInChapter;
  }

  get isBossRoom(): boolean {
    return this.currentRoom === this.roomsInChapter;
  }

  get wave(): number {
    return this.currentWave;
  }

  get status(): RunStatus {
    return this.currentStatus;
  }

  /** HUD label, e.g. "3/9". */
  get roomLabel(): string {
    return `${this.currentRoom}/${this.roomsInChapter}`;
  }

  /** Fraction of rooms cleared across the whole run, 0..1. */
  get progress(): number {
    const clearedInChapter = this.currentRoom - 1;
    const cleared =
      (this.currentChapter - 1) * this.roomsInChapter +
      clearedInChapter +
      (this.currentStatus === 'room-cleared' || this.currentStatus === 'won' ? 1 : 0);
    return Math.min(1, cleared / (CHAPTERS_PER_RUN * this.roomsInChapter));
  }

  /** Mark the room cleared. Does not advance by itself — the caller picks a skill first. */
  onRoomCleared(): void {
    if (this.currentStatus !== 'playing') {
      throw new Error(
        `Cannot clear the room while the run is in status '${this.currentStatus}' (room ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'room-cleared';
  }

  /** Advance to the next room; after the chapter boss it moves to the next chapter; after the final boss the run is won. */
  advanceToNextRoom(): void {
    if (this.currentStatus !== 'room-cleared') {
      throw new Error(
        `Can only advance to the next room after clearing the room, current status is '${this.currentStatus}' (room ${this.roomLabel})`,
      );
    }

    if (this.isBossRoom) {
      if (this.currentChapter === CHAPTERS_PER_RUN) {
        this.currentStatus = 'won';
        return;
      }
      this.currentChapter += 1;
      this.currentRoom = 1;
    } else {
      this.currentRoom += 1;
    }

    this.currentWave = 1;
    this.currentStatus = 'playing';
  }

  /**
   * Advance to the next wave in the same room.
   *
   * The wave total is **room data** (GDD §8: `spawn` objects carry a `wave` property),
   * trong `assets/resources/data/levels/chapter-<n>/*.tmx`),
   * so the caller must pass it in — usually `level.waves.length`. `RunState` only
   * keeps the current wave and never derives the count from the chapter or room kind; that way
   * a 3-wave room and a 1-wave room share one state machine.
   */
  nextWave(wavesInRoom: number): void {
    if (!Number.isInteger(wavesInRoom) || wavesInRoom < 1) {
      throw new Error(`Waves in room must be an integer >= 1, got ${wavesInRoom}`);
    }
    if (this.currentStatus !== 'playing') {
      throw new Error(
        `Cannot advance the wave while the run is in status '${this.currentStatus}' (room ${this.roomLabel})`,
      );
    }
    if (this.currentWave >= wavesInRoom) {
      throw new Error(
        `Room ${this.roomLabel} only has ${wavesInRoom} wave(s), cannot advance to wave ${this.currentWave + 1}`,
      );
    }
    this.currentWave += 1;
  }

  /**
   * Jump directly to a 1-based room index within the current chapter (M15 safe-boundary resume).
   * Resets wave to 1 and status to `'playing'`. Throws if `room` is outside `1..roomsTotal`.
   */
  restoreRoom(room: number): void {
    if (!Number.isInteger(room) || room < 1 || room > this.roomsInChapter) {
      throw new Error(
        `restoreRoom: room must be an integer in 1..${this.roomsInChapter}, got ${room}`,
      );
    }
    this.currentRoom = room;
    this.currentWave = 1;
    this.currentStatus = 'playing';
  }

  markLost(): void {
    if (this.currentStatus === 'won' || this.currentStatus === 'lost') {
      throw new Error(
        `Cannot mark lost while the run is in status '${this.currentStatus}' (room ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'lost';
  }

  /**
   * End the run with a win.
   *
   * Used when a chapter is played as **its own run** (M2 chapter select):
   * clearing the boss ends the run instead of jumping to the next chapter like `advanceToNextRoom`.
   */
  markWon(): void {
    if (this.currentStatus === 'won' || this.currentStatus === 'lost') {
      throw new Error(
        `Cannot mark won while the run is in status '${this.currentStatus}' (room ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'won';
  }
}

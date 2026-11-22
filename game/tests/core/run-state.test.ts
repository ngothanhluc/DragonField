import { describe, expect, it } from 'vitest';
import {
  CHAPTERS_PER_RUN,
  NORMAL_ROOMS_PER_CHAPTER,
  ROOMS_PER_CHAPTER,
  RunState,
} from '../../assets/scripts/core/run/run-state';
import { loadChapterOne } from '../helpers/tmx-levels';

/** Clear the current room then advance to the next one. */
function clearAndAdvance(run: RunState): void {
  run.onRoomCleared();
  run.advanceToNextRoom();
}

describe('RunState — constants', () => {
  it('matches the GDD: 4 chapters, each 8 regular rooms + 1 boss', () => {
    expect(CHAPTERS_PER_RUN).toBe(4);
    expect(NORMAL_ROOMS_PER_CHAPTER).toBe(8);
    expect(ROOMS_PER_CHAPTER).toBe(9);
  });
});

describe('RunState — initial state', () => {
  it('starts at the chosen chapter, room 1, wave 1', () => {
    const run = new RunState();

    expect(run.chapter).toBe(1);
    expect(run.room).toBe(1);
    expect(run.wave).toBe(1);
    expect(run.isBossRoom).toBe(false);
    expect(run.status).toBe('playing');
  });

  it('accepts a valid starting chapter', () => {
    expect(new RunState(2).chapter).toBe(2);
    expect(new RunState(3).chapter).toBe(3);
  });

  it('rejects a chapter outside 1..4', () => {
    expect(() => new RunState(0)).toThrow(/1\.\.4/);
    expect(() => new RunState(5)).toThrow(/1\.\.4/);
    expect(() => new RunState(1.5)).toThrow(/1\.\.4/);
  });
});

describe('RunState — playing through a run', () => {
  it('goes from chapter 1 room 1 through the boss into chapter 2', () => {
    const run = new RunState();

    for (let room = 1; room <= NORMAL_ROOMS_PER_CHAPTER; room += 1) {
      expect(run.room).toBe(room);
      expect(run.isBossRoom).toBe(false);

      clearAndAdvance(run);

      expect(run.status).toBe('playing');
      expect(run.room).toBe(room + 1);
    }

    // Room 9 is the boss.
    expect(run.isBossRoom).toBe(true);
    expect(run.roomLabel).toBe('9/9');

    clearAndAdvance(run);

    expect(run.chapter).toBe(2);
    expect(run.room).toBe(1);
    expect(run.isBossRoom).toBe(false);
    expect(run.status).toBe('playing');
  });

  it('wins after clearing the final chapter boss', () => {
    const run = new RunState();

    while (run.status === 'playing' || run.status === 'room-cleared') {
      if (run.status === 'playing') {
        run.onRoomCleared();
      } else {
        run.advanceToNextRoom();
      }
    }

    expect(run.status).toBe('won');
    expect(run.chapter).toBe(CHAPTERS_PER_RUN);
    expect(run.room).toBe(ROOMS_PER_CHAPTER);
    expect(run.progress).toBe(1);
  });

  it('the chapter 2 boss moves to chapter 3 instead of ending the run', () => {
    const run = new RunState(2);

    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }

    expect(run.status).toBe('playing');
    expect(run.chapter).toBe(3);
    expect(run.room).toBe(1);
  });
});

describe('RunState — cleared rooms and waves', () => {
  it('onRoomCleared only changes status, never advances the room by itself', () => {
    const run = new RunState();

    run.onRoomCleared();

    expect(run.status).toBe('room-cleared');
    expect(run.room).toBe(1);
  });

  it('a new room starts at wave 1', () => {
    const run = new RunState(2);

    run.nextWave(2);
    expect(run.wave).toBe(2);

    clearAndAdvance(run);

    expect(run.room).toBe(2);
    expect(run.wave).toBe(1);
  });
});

/**
 * The wave count is room data (GDD §8), so the test takes room 1 of the real
 * chapter 1 (3 waves) instead of asserting "chapter 1 has 1 wave" as before.
 */
describe('RunState — waves come from level data', () => {
  const [roomOne] = loadChapterOne().rooms;

  if (roomOne === undefined) throw new Error('chapter 1 (.tmx) is missing room 1');

  it('room 1 has 3 waves in the level data', () => {
    expect(roomOne.waves.length).toBe(3);
  });

  it('a 3-wave room walks the state machine: 1 → 2 → 3, no earlier and no later', () => {
    const run = new RunState();
    const totalWaves = roomOne.waves.length;

    expect(run.wave).toBe(1);

    run.nextWave(totalWaves);
    expect(run.wave).toBe(2);

    run.nextWave(totalWaves);
    expect(run.wave).toBe(3);

    // Last wave done: cannot advance to wave 4.
    expect(() => run.nextWave(totalWaves)).toThrow(/3 wave/);
    expect(run.wave).toBe(3);

    // Clear the room after the last wave then advance: waves reset to 1.
    run.onRoomCleared();
    run.advanceToNextRoom();
    expect(run.room).toBe(2);
    expect(run.wave).toBe(1);
  });

  it('the same state machine handles a 1-wave room (boss) and a 2-wave room', () => {
    for (const totalWaves of [1, 2, 5]) {
      const run = new RunState();
      for (let wave = 1; wave < totalWaves; wave += 1) run.nextWave(totalWaves);
      expect(run.wave).toBe(totalWaves);
      expect(() => run.nextWave(totalWaves)).toThrow();
    }
  });
});

describe('RunState — label and progress', () => {
  it('roomLabel has the "room/total" form', () => {
    const run = new RunState();

    expect(run.roomLabel).toBe('1/9');

    run.onRoomCleared();
    run.advanceToNextRoom();
    run.onRoomCleared();
    run.advanceToNextRoom();

    expect(run.roomLabel).toBe('3/9');
  });

  it('progress rises with cleared rooms', () => {
    const run = new RunState();

    expect(run.progress).toBe(0);

    run.onRoomCleared();
    expect(run.progress).toBeCloseTo(1 / (CHAPTERS_PER_RUN * ROOMS_PER_CHAPTER), 10);

    run.advanceToNextRoom();
    expect(run.progress).toBeCloseTo(1 / (CHAPTERS_PER_RUN * ROOMS_PER_CHAPTER), 10);

    run.onRoomCleared();
    expect(run.progress).toBeCloseTo(2 / (CHAPTERS_PER_RUN * ROOMS_PER_CHAPTER), 10);
  });

  it('a lost run keeps the progress already reached', () => {
    const run = new RunState();
    clearAndAdvance(run);
    clearAndAdvance(run);

    run.markLost();

    expect(run.status).toBe('lost');
    expect(run.progress).toBeCloseTo(2 / (CHAPTERS_PER_RUN * ROOMS_PER_CHAPTER), 10);
  });
});

describe('RunState — room total comes from data', () => {
  it('accepts a room total other than 9 (adding room-10.tmx makes it x/10)', () => {
    const run = new RunState(1, 10);

    expect(run.roomsTotal).toBe(10);
    expect(run.roomLabel).toBe('1/10');

    for (let room = 1; room <= 10; room += 1) {
      expect(run.room).toBe(room);
      expect(run.isBossRoom).toBe(room === 10);
      if (room < 10) clearAndAdvance(run);
    }

    expect(run.roomLabel).toBe('10/10');
  });

  it('progress uses the chapter room total', () => {
    const run = new RunState(1, 10);

    run.onRoomCleared();

    expect(run.progress).toBeCloseTo(1 / (CHAPTERS_PER_RUN * 10), 10);
  });

  it('rejects an invalid room total', () => {
    expect(() => new RunState(1, 0)).toThrow(/integer >= 1/);
    expect(() => new RunState(1, 2.5)).toThrow(/integer >= 1/);
    expect(() => new RunState(1, Number.NaN)).toThrow(/integer >= 1/);
  });
});

describe('RunState — markWon (chapter played as its own run)', () => {
  it('clearing the boss then markWon → won, keeping the room', () => {
    const run = new RunState(1);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      if (room < ROOMS_PER_CHAPTER) {
        clearAndAdvance(run);
      } else {
        run.onRoomCleared();
      }
    }

    expect(run.isBossRoom).toBe(true);
    run.markWon();

    expect(run.status).toBe('won');
    expect(run.chapter).toBe(1);
    expect(run.room).toBe(ROOMS_PER_CHAPTER);
    // progress is computed over all chapters of the run (GDD §1), so finishing chapter 1 = 1/4.
    expect(run.progress).toBeCloseTo(1 / CHAPTERS_PER_RUN, 10);
  });

  it('markWon from the playing state is valid too', () => {
    const run = new RunState(1);

    run.markWon();

    expect(run.status).toBe('won');
  });

  it('cannot markWon twice, nor markLost after markWon', () => {
    const run = new RunState(1);
    run.markWon();

    expect(() => run.markWon()).toThrow(/won/);
    expect(() => run.markLost()).toThrow(/won/);
    expect(() => run.advanceToNextRoom()).toThrow(/won/);
  });
});

describe('RunState — invalid transitions all throw', () => {
  it('cannot advance the room before it is cleared', () => {
    const run = new RunState();

    expect(() => run.advanceToNextRoom()).toThrow(/clearing the room/);
    expect(run.room).toBe(1);
  });

  it('cannot clear the room twice', () => {
    const run = new RunState();
    run.onRoomCleared();

    expect(() => run.onRoomCleared()).toThrow(/room-cleared/);
  });

  it('cannot advance the room after winning', () => {
    const run = new RunState(CHAPTERS_PER_RUN);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }
    expect(run.status).toBe('won');

    expect(() => run.advanceToNextRoom()).toThrow(/won/);
  });

  it('cannot advance the room after losing', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.advanceToNextRoom()).toThrow(/lost/);
  });

  it('cannot clear the room after losing', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.onRoomCleared()).toThrow(/lost/);
  });

  it('cannot mark lost twice', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.markLost()).toThrow(/lost/);
  });

  it('cannot mark lost after winning', () => {
    const run = new RunState(CHAPTERS_PER_RUN);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }

    expect(() => run.markLost()).toThrow(/won/);
  });

  it('cannot advance the wave once the room is cleared', () => {
    const run = new RunState(2);
    run.onRoomCleared();

    expect(() => run.nextWave(1)).toThrow(/room-cleared/);
  });

  it('cannot advance past the room wave count', () => {
    const run = new RunState(1);

    expect(() => run.nextWave(1)).toThrow(/1 wave/);

    const run3 = new RunState(2);
    run3.nextWave(2);
    expect(() => run3.nextWave(2)).toThrow(/2 wave/);
  });

  it('rejects an invalid wave total instead of guessing', () => {
    const run = new RunState();

    expect(() => run.nextWave(0)).toThrow(/integer >= 1/);
    expect(() => run.nextWave(1.5)).toThrow(/integer >= 1/);
    expect(() => run.nextWave(Number.NaN)).toThrow(/integer >= 1/);
    expect(run.wave).toBe(1);
  });
});

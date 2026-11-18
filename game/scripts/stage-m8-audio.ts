/**
 * Stage the extra SFX variants + jingles for M8 (#9) from `art-source/ninja-adventure/`.
 *
 * Run: `bun run stage:audio`
 *
 * Idempotent: files already staged keep their `.meta` uuid, so the editor never loses references.
 * Do **not** run `stage-m6-assets.ts` instead — it rewrites every uuid.
 */
import { convertAudio, ensureDirMeta } from './lib/audio';

ensureDirMeta('audio/sfx');

// Variants of the four repeated events (the M6 file stays the first variant).
convertAudio('Audio/Sounds/Whoosh & Slash/Whoosh.wav', 'audio/sfx/shoot-2.mp3', '80k', 1);
convertAudio('Audio/Sounds/Whoosh & Slash/Whoosh2.wav', 'audio/sfx/shoot-3.mp3', '80k', 1);

convertAudio('Audio/Sounds/Hit & Impact/Hit1.wav', 'audio/sfx/enemy-hit-2.mp3', '80k', 1);
convertAudio('Audio/Sounds/Hit & Impact/Hit3.wav', 'audio/sfx/enemy-hit-3.mp3', '80k', 1);
convertAudio('Audio/Sounds/Hit & Impact/Hit5.wav', 'audio/sfx/enemy-hit-4.mp3', '80k', 1);

convertAudio('Audio/Sounds/Elemental/Explosion3.wav', 'audio/sfx/enemy-death-2.mp3', '80k', 1);
convertAudio('Audio/Sounds/Elemental/Explosion4.wav', 'audio/sfx/enemy-death-3.mp3', '80k', 1);

convertAudio('Audio/Sounds/Bonus/Coin2.wav', 'audio/sfx/gold-2.mp3', '80k', 1);
convertAudio('Audio/Sounds/Bonus/Coin3.wav', 'audio/sfx/gold-3.mp3', '80k', 1);

// Jingles for clearing a room and gaining a skill.
convertAudio('Audio/Jingles/Success2.wav', 'audio/sfx/room-clear.mp3', '80k', 1);
convertAudio('Audio/Jingles/LevelUp1.wav', 'audio/sfx/skill-acquired.mp3', '80k', 1);

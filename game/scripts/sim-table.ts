/**
 * `bun run sim:table` — the balance sim table (ADR-013, `docs/milestones.md` §M9 / §M12, ADR-021).
 *
 * Runs the real `simulateRun` over chapters 1–4, three seeds per boss of each chapter pool, twice
 * per seed (standing still, and dodging with XP-earned skills + typical door choice), then prints
 * the Markdown table the owner approves in the PR. The same rows are the integration test's
 * contract (`tests/integration/sim-table.acceptance.test.ts`).
 *
 * Slow on purpose: ~2–4 minutes of simulated chapters.
 */
import {
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  formatSimTable,
  simTableRows,
} from '../tests/helpers/sim-table';

const CHAPTERS = [1, 2, 3, 4] as const;
const SEEDS_PER_BOSS = 3;

const rows = simTableRows({ chapters: CHAPTERS, seedsPerBoss: SEEDS_PER_BOSS });

process.stdout.write(formatSimTable(rows));

const standStillLost = rows.filter(
  (row) => row.standStill.status === 'lost' && row.standStill.roomsCleared === 0,
).length;
const loadoutWon = rows.filter(
  (row) => row.loadout.status === 'won' && row.loadout.roomsCleared === 9,
).length;
const levelUpsInBand = rows.filter(
  (row) =>
    row.loadout.levelUps >= LEVEL_UP_TARGET_MIN && row.loadout.levelUps <= LEVEL_UP_TARGET_MAX,
).length;

const allLevelUps = rows.map((row) => row.loadout.levelUps);
const minLevelUps = Math.min(...allLevelUps);
const maxLevelUps = Math.max(...allLevelUps);
const avgLevelUps = allLevelUps.reduce((sum, n) => sum + n, 0) / Math.max(1, allLevelUps.length);

const perChapter = CHAPTERS.map((chapter) => {
  const levels = rows
    .filter((row) => row.chapter === chapter)
    .map((row) => row.loadout.levelUps);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  return `Ch${chapter} ${lo}–${hi}`;
}).join(' · ');

console.log(
  `Summary: ${rows.length} rows — stand still lost room 1 in ${standStillLost}/${rows.length}, ` +
    `dodge + XP skills won 9/9 in ${loadoutWon}/${rows.length}, ` +
    `level-ups in ${LEVEL_UP_TARGET_MIN}–${LEVEL_UP_TARGET_MAX} band in ${levelUpsInBand}/${rows.length} ` +
    `(range ${minLevelUps}–${maxLevelUps}, avg ${avgLevelUps.toFixed(1)}; ${perChapter}).`,
);

if (
  standStillLost !== rows.length ||
  loadoutWon !== rows.length ||
  levelUpsInBand !== rows.length
) {
  process.exit(1);
}

/**
 * `bun run sim:table` — the balance sim table (ADR-013, `docs/milestones.md` §M9 / §M12 / §M13,
 * ADR-021, ADR-022).
 *
 * Runs the real `simulateRun` over chapters 1–4, three seeds per boss of each chapter pool, twice
 * per seed (standing still, and dodging with the full M13 kit: Dash + Shadow Barrage + XP-earned
 * pure-combat skills & Evolutions + typical door choice), then prints the Markdown table the owner
 * approves in the PR. The same rows are the integration test's contract
 * (`tests/integration/sim-table.acceptance.test.ts`).
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
const rowsWithDash = rows.filter((row) => row.loadout.dashesUsed > 0).length;
const rowsWithActive = rows.filter((row) => row.loadout.activeSkillsUsed > 0).length;
const rowsWithEvo = rows.filter((row) => row.loadout.evolutions.length > 0).length;
const totalEvos = rows.reduce((sum, row) => sum + row.loadout.evolutions.length, 0);
const rowsHit = rows.filter((row) => row.loadout.hits > 0).length;
const totalHits = rows.reduce((sum, row) => sum + row.loadout.hits, 0);
const totalDashes = rows.reduce((sum, row) => sum + row.loadout.dashesUsed, 0);
const totalActives = rows.reduce((sum, row) => sum + row.loadout.activeSkillsUsed, 0);

const allLevelUps = rows.map((row) => row.loadout.levelUps);
const minLevelUps = Math.min(...allLevelUps);
const maxLevelUps = Math.max(...allLevelUps);
const avgLevelUps = allLevelUps.reduce((sum, n) => sum + n, 0) / Math.max(1, allLevelUps.length);
const avgDashes = totalDashes / Math.max(1, rows.length);
const avgActives = totalActives / Math.max(1, rows.length);

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
    `dodge + M13 kit won 9/9 in ${loadoutWon}/${rows.length} (${rowsHit}/${rows.length} rows hit, ${totalHits} total hits), ` +
    `level-ups in ${LEVEL_UP_TARGET_MIN}–${LEVEL_UP_TARGET_MAX} band in ${levelUpsInBand}/${rows.length} ` +
    `(range ${minLevelUps}–${maxLevelUps}, avg ${avgLevelUps.toFixed(1)}; ${perChapter}), ` +
    `dashes ${rowsWithDash}/${rows.length} (avg ${avgDashes.toFixed(1)}/run), ` +
    `actives ${rowsWithActive}/${rows.length} (avg ${avgActives.toFixed(1)}/run), ` +
    `evolutions ${rowsWithEvo}/${rows.length} (${totalEvos} unlocked).`,
);

if (
  standStillLost !== rows.length ||
  loadoutWon !== rows.length ||
  levelUpsInBand !== rows.length ||
  rowsWithDash !== rows.length ||
  rowsWithActive !== rows.length ||
  rowsWithEvo === 0
) {
  process.exit(1);
}

/**
 * `bun run sim:table` — the M9 balance sim table (ADR-013, `docs/milestones.md` §M9).
 *
 * Runs the real `simulateRun` over chapters 1–4, three seeds per boss of each chapter pool, twice
 * per seed (standing still, and dodging with a typical loadout + the typical door choice), then
 * prints the Markdown table the owner approves in the PR. The same rows are the integration
 * test's contract (`tests/integration/sim-table.acceptance.test.ts`).
 *
 * Slow on purpose: ~3–5 minutes of simulated chapters.
 */
import { formatSimTable, simTableRows } from '../tests/helpers/sim-table';

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

console.log(
  `Summary: ${rows.length} rows — stand still lost room 1 in ${standStillLost}/${rows.length}, ` +
    `dodge + typical loadout won 9/9 in ${loadoutWon}/${rows.length}.`,
);

if (standStillLost !== rows.length || loadoutWon !== rows.length) process.exit(1);

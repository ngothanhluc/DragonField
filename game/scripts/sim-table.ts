/**
 * `bun run sim:table` — the 4-class × 4-chapter balance sim table (ADR-013, `docs/milestones.md`
 * §M9 / §M12 / §M13 / §M14, GDD §15.4, ADR-021, ADR-022).
 *
 * Runs the real `simulateRun` over chapters 1–4 across all 4 playable classes:
 * - **Ninja**: full 24-row matrix (`4 chapters × 2 bosses × 3 seeds = 24 rows`, preserving M9–M13).
 * - **Archer, Mage, Cultivator**: `4 chapters × 2 bosses × 2 seeds = 16 rows` each (`48 rows`).
 * - Total: **72 rows** covering every `class × chapter × boss`, twice per row (standing still vs
 *   dodging with the full M14 kit: class Layer 1/2 stats + Dash + class Signature Active +
 *   XP-earned pure-combat skills & Legendary Evolutions + typical door choice).
 *
 * Prints the full Markdown table + per-class summary comparison. The same matrix contract is
 * verified in `tests/integration/sim-table.acceptance.test.ts`.
 */
import { CHARACTER_IDS, type CharacterId } from '../assets/scripts/core/characters/roster';
import {
  classEvolutionFor,
  classSkillsFor,
  findClassSkillOrEvolution,
} from '../assets/scripts/core/skills/class-skills';
import {
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  formatDuration,
  formatSimTable,
  simTableRows,
  type SimTableRow,
} from '../tests/helpers/sim-table';

const CHAPTERS = [1, 2, 3, 4] as const;
const NINJA_SEEDS_PER_BOSS = 3;
const OTHER_CLASS_SEEDS_PER_BOSS = 2;

const rows: SimTableRow[] = [
  ...simTableRows({
    chapters: CHAPTERS,
    seedsPerBoss: NINJA_SEEDS_PER_BOSS,
    characters: ['ninja'],
  }),
  ...simTableRows({
    chapters: CHAPTERS,
    seedsPerBoss: OTHER_CLASS_SEEDS_PER_BOSS,
    characters: ['archer', 'mage', 'cultivator'],
  }),
];

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
const lateRows = rows.filter((row) => row.chapter >= 2);
const lateRowsWithDash = lateRows.filter((row) => row.loadout.dashesUsed > 0).length;
const rowsWithActive = rows.filter((row) => row.loadout.activeSkillsUsed > 0).length;
const rowsWithEvo = rows.filter((row) => row.loadout.evolutions.length > 0).length;
const totalEvos = rows.reduce((sum, row) => sum + row.loadout.evolutions.length, 0);
const rowsHit = rows.filter((row) => row.loadout.hits > 0).length;
const totalHits = rows.reduce((sum, row) => sum + row.loadout.hits, 0);
const rowsWithClassSkill = rows.filter((row) => row.loadout.classSkills.length > 0).length;
const totalClassSkills = rows.reduce((sum, row) => sum + row.loadout.classSkills.length, 0);
const totalDashes = rows.reduce((sum, row) => sum + row.loadout.dashesUsed, 0);
const totalActives = rows.reduce((sum, row) => sum + row.loadout.activeSkillsUsed, 0);

const allLevelUps = rows.map((row) => row.loadout.levelUps);
const minLevelUps = Math.min(...allLevelUps);
const maxLevelUps = Math.max(...allLevelUps);
const avgLevelUps = allLevelUps.reduce((sum, n) => sum + n, 0) / Math.max(1, allLevelUps.length);
const avgDashes = totalDashes / Math.max(1, rows.length);
const avgActives = totalActives / Math.max(1, rows.length);

const perClassLines = [
  '',
  '| class | rows | stand still lost | wins (9/9) | clear time (avg / range) | level-ups | dashes/run | actives/run | hits (rows / total) | evolutions | class skills | class evolution |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

let anyClassMissingEvo = false;
let anyClassLowDash = false;
let anyClassMissingClassSkill = false;
let anyClassLeak = false;
for (const characterId of CHARACTER_IDS) {
  const classRows = rows.filter((row) => row.characterId === characterId);
  const count = Math.max(1, classRows.length);
  const classStandLost = classRows.filter(
    (row) => row.standStill.status === 'lost' && row.standStill.roomsCleared === 0,
  ).length;
  const classWins = classRows.filter(
    (row) => row.loadout.status === 'won' && row.loadout.roomsCleared === 9,
  ).length;
  const durations = classRows.map((row) => row.loadout.durationMs);
  const avgDurationMs = durations.reduce((sum, ms) => sum + ms, 0) / count;
  const minDurationMs = Math.min(...durations);
  const maxDurationMs = Math.max(...durations);
  const levels = classRows.map((row) => row.loadout.levelUps);
  const loLv = Math.min(...levels);
  const hiLv = Math.max(...levels);
  const avgLv = levels.reduce((sum, n) => sum + n, 0) / count;
  const classDashRows = classRows.filter((r) => r.loadout.dashesUsed > 0).length;
  const classAvgDashes = classRows.reduce((sum, r) => sum + r.loadout.dashesUsed, 0) / count;
  const classAvgActives = classRows.reduce((sum, r) => sum + r.loadout.activeSkillsUsed, 0) / count;
  const classHitRows = classRows.filter((r) => r.loadout.hits > 0).length;
  const classTotalHits = classRows.reduce((sum, r) => sum + r.loadout.hits, 0);
  const classEvoRows = classRows.filter((r) => r.loadout.evolutions.length > 0).length;
  const classTotalEvos = classRows.reduce((sum, r) => sum + r.loadout.evolutions.length, 0);
  const ownSkillIds = classSkillsFor(characterId).map((skill) => skill.id);
  const ownIds = new Set([...ownSkillIds, classEvolutionFor(characterId).id]);
  const classSkillRows = classRows.filter((r) =>
    r.loadout.classSkills.some((id) => ownSkillIds.includes(id)),
  );
  const classEvoOwnedRows = classRows.filter((r) =>
    r.loadout.classSkills.includes(classEvolutionFor(characterId).id),
  );
  const classLeakRows = classRows.filter((r) =>
    r.loadout.classSkills.some((id) => findClassSkillOrEvolution(id) !== undefined && !ownIds.has(id)),
  );
  if (classEvoRows === 0) anyClassMissingEvo = true;
  if (classEvoOwnedRows.length === 0) anyClassMissingEvo = true;
  if (classSkillRows.length < classRows.length) anyClassMissingClassSkill = true;
  if (classLeakRows.length > 0) anyClassLeak = true;
  if (classDashRows < classRows.length - 1) anyClassLowDash = true;

  perClassLines.push(
    `| ${characterId as CharacterId} | ${classRows.length} | ${classStandLost}/${classRows.length} | ` +
      `${classWins}/${classRows.length} | ${formatDuration(avgDurationMs)} (${formatDuration(minDurationMs)}–${formatDuration(maxDurationMs)}) | ` +
      `${loLv}–${hiLv} (avg ${avgLv.toFixed(1)}) | ${classAvgDashes.toFixed(1)} | ${classAvgActives.toFixed(1)} | ` +
      `${classHitRows}/${classRows.length} (${classTotalHits}) | ${classEvoRows}/${classRows.length} (${classTotalEvos}) | ` +
      `${classSkillRows.length}/${classRows.length} | ${classEvoOwnedRows.length}/${classRows.length} |`,
  );
}

console.log(perClassLines.join('\n'));
console.log(
  `\nSummary: ${rows.length} rows across ${CHARACTER_IDS.length} classes — stand still lost room 1 in ${standStillLost}/${rows.length}, ` +
    `dodge + M14 kit won 9/9 in ${loadoutWon}/${rows.length} (${rowsHit}/${rows.length} rows hit, ${totalHits} total hits), ` +
    `level-ups in ${LEVEL_UP_TARGET_MIN}–${LEVEL_UP_TARGET_MAX} band in ${levelUpsInBand}/${rows.length} ` +
    `(range ${minLevelUps}–${maxLevelUps}, avg ${avgLevelUps.toFixed(1)}), ` +
    `dashes ${rowsWithDash}/${rows.length} (Ch2–Ch4 ${lateRowsWithDash}/${lateRows.length}, avg ${avgDashes.toFixed(1)}/run), ` +
    `actives ${rowsWithActive}/${rows.length} (avg ${avgActives.toFixed(1)}/run), ` +
    `evolutions ${rowsWithEvo}/${rows.length} (${totalEvos} unlocked), ` +
    `class skills ${rowsWithClassSkill}/${rows.length} rows (${totalClassSkills} owned).`,
);

if (
  standStillLost !== rows.length ||
  loadoutWon !== rows.length ||
  levelUpsInBand !== rows.length ||
  lateRowsWithDash !== lateRows.length ||
  anyClassLowDash ||
  rowsWithActive !== rows.length ||
  rowsWithEvo === 0 ||
  anyClassMissingEvo ||
  anyClassMissingClassSkill ||
  anyClassLeak
) {
  process.exit(1);
}

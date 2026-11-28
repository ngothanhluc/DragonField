/**
 * #113 acceptance: the run/boss simulation and the tooling-only level helpers (autotile, tile-rows)
 * live outside `assets/`, because Cocos compiles every `.ts` under `assets/` into the web bundle.
 *
 * Agreed locations:
 * - `sim/run-simulation.ts`, `sim/boss-run.ts` (game root, next to `scripts/` and `tests/`)
 * - `scripts/lib/autotile.ts`, `scripts/lib/tile-rows.ts`
 *
 * The real proof for "the built index.js no longer contains simulateRun/parseTileRows" is a
 * web-desktop build (not runnable in CI); this test pins the source-level cause of it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GAME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS_DIR = join(GAME_DIR, "assets");

const MOVED = {
  runSimulation: "sim/run-simulation.ts",
  bossRun: "sim/boss-run.ts",
  autotile: "scripts/lib/autotile.ts",
  tileRows: "scripts/lib/tile-rows.ts",
} as const;

const OLD_PATHS = [
  "assets/scripts/core/sim",
  "assets/scripts/core/sim.meta",
  "assets/scripts/core/sim/run-simulation.ts",
  "assets/scripts/core/sim/run-simulation.ts.meta",
  "assets/scripts/core/sim/boss-run.ts",
  "assets/scripts/core/sim/boss-run.ts.meta",
  "assets/scripts/core/level/autotile.ts",
  "assets/scripts/core/level/autotile.ts.meta",
  "assets/scripts/core/level/tile-rows.ts",
  "assets/scripts/core/level/tile-rows.ts.meta",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function importIfPresent(
  rel: string,
): Promise<Record<string, unknown> | null> {
  const full = join(GAME_DIR, rel);
  if (!existsSync(full)) return null;
  return (await import(full)) as Record<string, unknown>;
}

describe("#113 simulation and tooling-only level helpers are out of the asset tree", () => {
  it("no script under assets/ defines the simulation or the tooling-only level helpers", () => {
    const offenders = walk(ASSETS_DIR)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        /export\s+(function|const)\s+(simulateRun|simulateBossRun|parseTileRows|pickBlobTile|floorBlockTiles)\b/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(GAME_DIR, file));
    expect(offenders).toEqual([]);
  });

  it("no script under assets/ imports from outside assets/ (Cocos would fail or bundle it)", () => {
    const importRe = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
    const escaping: string[] = [];
    for (const file of walk(ASSETS_DIR).filter((f) => f.endsWith(".ts"))) {
      for (const match of readFileSync(file, "utf8").matchAll(importRe)) {
        const target = resolve(dirname(file), match[1] ?? "");
        if (!target.startsWith(ASSETS_DIR + "/")) {
          escaping.push(`${relative(GAME_DIR, file)} -> ${match[1]}`);
        }
      }
    }
    expect(escaping).toEqual([]);
  });

  it("the moved modules exist at their new location and keep their exports", async () => {
    const runSimulation = await importIfPresent(MOVED.runSimulation);
    const bossRun = await importIfPresent(MOVED.bossRun);
    const autotile = await importIfPresent(MOVED.autotile);
    const tileRows = await importIfPresent(MOVED.tileRows);

    expect(runSimulation, `${MOVED.runSimulation} must exist`).not.toBeNull();
    expect(bossRun, `${MOVED.bossRun} must exist`).not.toBeNull();
    expect(autotile, `${MOVED.autotile} must exist`).not.toBeNull();
    expect(tileRows, `${MOVED.tileRows} must exist`).not.toBeNull();

    expect(typeof runSimulation?.simulateRun).toBe("function");
    expect(typeof runSimulation?.smartDashPolicy).toBe("function");
    expect(runSimulation?.SIM_STEP_MS).toBe(16);
    expect(typeof bossRun?.simulateBossRun).toBe("function");
    expect(typeof bossRun?.holdPosition).toBe("function");
    expect(typeof autotile?.pickBlobTile).toBe("function");
    expect(autotile?.TILEFLOOR_COLUMNS).toBe(22);
    expect(typeof tileRows?.parseTileRows).toBe("function");
  });

  it("the simulation still runs on the pure core in assets/scripts/core (no copy)", () => {
    const full = join(GAME_DIR, MOVED.runSimulation);
    expect(existsSync(full), `${MOVED.runSimulation} must exist`).toBe(true);
    const source = existsSync(full) ? readFileSync(full, "utf8") : "";
    expect(source).toMatch(
      /from '\.\.\/assets\/scripts\/core\/combat\/auto-fire'/,
    );
    expect(source).toMatch(/from '\.\/boss-run'/);
  });

  it("stale .meta files (and the old files) are gone, and nothing outside assets/ carries a .meta", () => {
    const stillThere = OLD_PATHS.filter((rel) =>
      existsSync(join(GAME_DIR, rel)),
    );
    expect(stillThere).toEqual([]);

    const metasOutside = [
      ...walk(join(GAME_DIR, "sim")),
      ...walk(join(GAME_DIR, "scripts", "lib")),
    ]
      .filter((file) => file.endsWith(".meta"))
      .map((file) => relative(GAME_DIR, file));
    expect(metasOutside).toEqual([]);

    const orphanMetas = walk(join(ASSETS_DIR, "scripts"))
      .filter((file) => file.endsWith(".ts.meta"))
      .filter((meta) => !existsSync(meta.slice(0, -".meta".length)))
      .map((file) => relative(GAME_DIR, file));
    expect(orphanMetas).toEqual([]);
  });

  it("typecheck (tsconfig.check.json) covers the new location", () => {
    const configPath = join(GAME_DIR, "tsconfig.check.json");
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    const files = (parsed?.fileNames ?? []).map((file) =>
      relative(GAME_DIR, file),
    );
    for (const rel of Object.values(MOVED)) {
      expect(files, `tsconfig.check.json must include ${rel}`).toContain(rel);
    }
  });

  it("the lint script globs the new location", () => {
    const pkg = JSON.parse(
      readFileSync(join(GAME_DIR, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.lint).toContain('"sim/**/*.ts"');
    expect(pkg.scripts.lint).toContain('"scripts/**/*.ts"');
  });

  it("eslint still forbids importing cc in the moved files", async () => {
    const eslint = new ESLint({ cwd: GAME_DIR });
    for (const rel of Object.values(MOVED)) {
      const [result] = await eslint.lintText(
        "import { Node } from 'cc';\nexport const n = Node;\n",
        {
          filePath: join(GAME_DIR, rel),
        },
      );
      const rules = (result?.messages ?? []).map((message) => message.ruleId);
      expect(rules, `${rel} must reject a cc import`).toContain(
        "no-restricted-imports",
      );
    }
  });
});

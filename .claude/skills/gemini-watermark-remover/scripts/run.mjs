#!/usr/bin/env node
/**
 * Run the Gemini watermark remover CLI for a local file.
 *
 * Vendored from GargantuaX/gemini-watermark-remover (MIT). Upstream:
 * https://github.com/GargantuaX/gemini-watermark-remover
 *
 * This copy differs from upstream only in how it finds the CLI: it tries a `gwr`
 * binary on PATH, then the project's package runners, instead of assuming pnpm.
 *
 * Usage: node scripts/run.mjs remove <input> --output <file>
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_PACKAGE = process.env.GWR_CLI_SPEC || '@pilio/gemini-watermark-remover';
const localBinPath = fileURLToPath(new URL('../../../bin/gwr.mjs', import.meta.url));

function hasPathCommand(command) {
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    stdio: 'ignore',
  });
  return lookup.status === 0;
}

/** Package runners in the order this repo family prefers. */
function runnerCandidates() {
  const runners = [
    ['bunx', () => ['bunx', [CLI_PACKAGE]]],
    ['pnpm', () => ['pnpm', ['dlx', CLI_PACKAGE]]],
    ['npx', () => ['npx', ['--yes', CLI_PACKAGE]]],
  ];
  const out = [];
  for (const [, build] of runners) {
    if (!hasPathCommand(build()[0])) continue;
    out.push(build());
  }
  return out;
}

/** A `gwr` binary installed in any `node_modules/.bin` between cwd and the root. */
function findProjectBin() {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, 'node_modules', '.bin', 'gwr');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function resolveCandidates(args) {
  if (existsSync(localBinPath)) {
    return [{ command: process.execPath, commandArgs: [localBinPath, ...args] }];
  }
  const candidates = [];
  if (hasPathCommand('gwr')) candidates.push({ command: 'gwr', commandArgs: args });
  const projectBin = findProjectBin();
  if (projectBin !== null) candidates.push({ command: projectBin, commandArgs: args });
  for (const [command, prefix] of runnerCandidates()) {
    candidates.push({ command, commandArgs: [...prefix, ...args] });
  }
  return candidates;
}

function spawnOnce(command, commandArgs) {
  return new Promise((done, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

async function main(argv) {
  const candidates = await resolveCandidates(argv);
  let lastSpawnError = null;

  for (const { command, commandArgs } of candidates) {
    try {
      const { code, stdout, stderr } = await spawnOnce(command, commandArgs);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      return typeof code === 'number' ? code : 1;
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EINVAL')) {
        lastSpawnError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastSpawnError) throw lastSpawnError;
  throw new Error('Unable to locate the gemini-watermark-remover CLI');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

export { main as runWatermarkRemover };

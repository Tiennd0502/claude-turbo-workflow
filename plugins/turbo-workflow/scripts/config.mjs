#!/usr/bin/env node
// The project's turbo-workflow config, .claude/workflow.json: the one place
// every script reads project values from (apps, branches, tracker, package
// manager). Hooks read the file themselves so they can fail open.
//
//   node <plugin>/scripts/config.mjs get <dotted.key>
//     Print one value: a string as is, anything else as JSON.
//
//   node <plugin>/scripts/config.mjs cmd run <script> | exec <bin> | lockfile | build-packages
//     Print the package manager's command, so no workflow text spells one out.
//
// Run from anywhere inside the project: the root is the git top level.
// A missing or invalid file prints one line naming the problem and exits 1.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_PATH = join('.claude', 'workflow.json');
const MISSING = 'No .claude/workflow.json: run /turbo-workflow:init';

export class ConfigError extends Error {}

// `lockfiles` lists every lockfile name the manager writes (the first is the
// current one); `workspace` runs a script in one workspace.
const PACKAGE_MANAGERS = {
  pnpm: {
    run: 'pnpm run',
    exec: 'pnpm exec',
    lockfiles: ['pnpm-lock.yaml'],
    workspace: (name, dir, script) => `pnpm --filter ${name} ${script}`,
  },
  npm: {
    run: 'npm run',
    exec: 'npx',
    lockfiles: ['package-lock.json'],
    workspace: (name, dir, script) => `npm run ${script} -w ${dir}`,
  },
  yarn: {
    run: 'yarn run',
    exec: 'yarn',
    lockfiles: ['yarn.lock'],
    workspace: (name, dir, script) => `yarn workspace ${name} ${script}`,
  },
  bun: {
    run: 'bun run',
    exec: 'bunx',
    lockfiles: ['bun.lock', 'bun.lockb'],
    workspace: (name, dir, script) => `bun run --filter ${name} ${script}`,
  },
};
const TRACKERS = ['trello', 'none'];
const AUTOFIX = ['lint-staged', 'none'];
const LISTS = ['todo', 'inProgress', 'review', 'done'];

export function commands(pm) {
  const entry = PACKAGE_MANAGERS[pm];
  if (!entry) throw new ConfigError(`Unknown package manager: ${pm}`);
  const exec = (bin) => `${entry.exec} ${bin}`;
  return {
    run: (script) => `${entry.run} ${script}`,
    exec,
    lockfile: entry.lockfiles[0],
    lockfiles: entry.lockfiles,
    workspaceRun: entry.workspace,
    // Every workspace under packages/, nested ones included, in dependency order.
    buildPackages: `${exec('turbo')} run build --filter='./packages/**'`,
  };
}

/** The lockfile names of every package manager, with the manager's name. */
export const LOCKFILES = Object.entries(PACKAGE_MANAGERS).flatMap(
  ([pm, entry]) => entry.lockfiles.map((file) => [file, pm]),
);

/**
 * The raw .claude/workflow.json at `root`, or null when it is missing or not
 * JSON. Never throws and never validates: for init, which reads an existing
 * setup to offer its values, and for hooks, which must fail open.
 */
export function readConfigFile(root) {
  try {
    return JSON.parse(readFileSync(join(root, CONFIG_PATH), 'utf8'));
  } catch {
    return null;
  }
}

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string' && value.length > 0;
const isStrings = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Every problem in `config`, as "<field> <problem>"; empty when valid. */
export function validateConfig(config) {
  const errors = [];
  const need = (ok, field, problem) => ok || errors.push(`${field} ${problem}`);
  if (!isObject(config)) return ['(root) must be an object'];

  need(config.version === 1, 'version', 'must be 1');
  need(
    Object.hasOwn(PACKAGE_MANAGERS, config.packageManager),
    'packageManager',
    `must be one of ${Object.keys(PACKAGE_MANAGERS).join(', ')}`,
  );

  const git = config.git;
  if (need(isObject(git), 'git', 'must be an object') === true) {
    need(isString(git.remote), 'git.remote', 'must be a non-empty string');
    need(
      isString(git.baseBranch),
      'git.baseBranch',
      'must be a non-empty string',
    );
    need(
      isStrings(git.protected),
      'git.protected',
      'must be a list of branch names',
    );
  }

  const tracker = config.tracker;
  if (need(isObject(tracker), 'tracker', 'must be an object') === true) {
    if (
      need(
        TRACKERS.includes(tracker.type),
        'tracker.type',
        `must be one of ${TRACKERS.join(', ')}`,
      ) === true &&
      tracker.type === 'trello'
    ) {
      need(
        isString(tracker.board),
        'tracker.board',
        'must be the Trello board URL',
      );
      need(
        isObject(tracker.lists) &&
          LISTS.every((key) => isString(tracker.lists[key])),
        'tracker.lists',
        `must name a list for each of ${LISTS.join(', ')}`,
      );
    }
  }

  need(
    AUTOFIX.includes(config.autofix),
    'autofix',
    `must be one of ${AUTOFIX.join(', ')}`,
  );
  need(isString(config.specsDir), 'specsDir', 'must be a non-empty string');
  need(isStrings(config.shared), 'shared', 'must be a list of paths');

  if (
    need(isObject(config.apps), 'apps', 'must be an object of apps') === true
  ) {
    for (const [name, app] of Object.entries(config.apps)) {
      const field = `apps.${name}`;
      if (need(isObject(app), field, 'must be an object') !== true) continue;
      need(isString(app.dir), `${field}.dir`, 'must be a non-empty string');
      need(
        isString(app.runner),
        `${field}.runner`,
        'must be a non-empty string',
      );
      need(
        isString(app.coverage),
        `${field}.coverage`,
        'must be a non-empty string',
      );
      need(
        typeof app.e2e === 'boolean',
        `${field}.e2e`,
        'must be true or false',
      );
      for (const list of ['planChanges', 'security', 'ui'])
        need(
          isStrings(app[list]),
          `${field}.${list}`,
          'must be a list of strings',
        );
      if (app.screenshot !== undefined) {
        const shot = app.screenshot;
        need(
          isObject(shot) && isString(shot.dir) && isString(shot.format),
          `${field}.screenshot`,
          'must have dir and format',
        );
      }
    }
  }

  if (config.uat !== undefined) validateUat(config.uat, need);
  return errors;
}

const UAT_KEYS = ['signIn'];
const UAT_API_KEYS = ['url', 'docs', 'token', 'devCommand'];

function validateUat(uat, need) {
  if (need(isObject(uat), 'uat', 'must be an object') !== true) return;
  for (const key of Object.keys(uat))
    need(
      key === 'api' || UAT_KEYS.includes(key),
      `uat.${key}`,
      'is not a known key',
    );
  if (uat.signIn !== undefined)
    need(isString(uat.signIn), 'uat.signIn', 'must be a non-empty string');
  if (uat.api === undefined) return;
  if (need(isObject(uat.api), 'uat.api', 'must be an object') !== true) return;
  for (const [key, value] of Object.entries(uat.api))
    need(
      UAT_API_KEYS.includes(key) && isString(value),
      `uat.api.${key}`,
      UAT_API_KEYS.includes(key)
        ? 'must be a non-empty string'
        : 'is not a known key',
    );
}

function gitRoot(cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** The validated config of the project at `root` (default: the git top level). */
export function loadConfig(root = gitRoot()) {
  let text;
  try {
    text = readFileSync(join(root, CONFIG_PATH), 'utf8');
  } catch {
    throw new ConfigError(MISSING);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(
      `.claude/workflow.json: invalid JSON (${error.message})`,
    );
  }
  const errors = validateConfig(config);
  if (errors.length)
    throw new ConfigError(`.claude/workflow.json: ${errors.join('; ')}`);
  return config;
}

const getPath = (object, dotted) =>
  dotted
    .split('.')
    .reduce((value, key) => (isObject(value) ? value[key] : undefined), object);

function main(args) {
  const config = loadConfig();
  const [command, ...rest] = args;
  if (command === 'get' && rest.length === 1) {
    const value = getPath(config, rest[0]);
    if (value === undefined)
      throw new ConfigError(`.claude/workflow.json: no ${rest[0]}`);
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (command === 'cmd') {
    const cmd = commands(config.packageManager);
    const [kind, arg] = rest;
    if (kind === 'run' && arg) return cmd.run(arg);
    if (kind === 'exec' && arg) return cmd.exec(arg);
    if (kind === 'lockfile') return cmd.lockfile;
    if (kind === 'build-packages') return cmd.buildPackages;
  }
  throw new ConfigError(
    'Usage: config.mjs get <dotted.key> | cmd run <script> | cmd exec <bin> | cmd lockfile | cmd build-packages',
  );
}

/**
 * True when the module at `url` is the script node was started with. Follows
 * symlinks (the plugin is often reached through one) and never throws: an
 * argv[1] that is not a file just means "not the entry point".
 */
export function isEntry(url) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

if (isEntry(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

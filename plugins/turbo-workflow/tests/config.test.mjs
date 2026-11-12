import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  commands,
  loadConfig,
  readConfigFile,
  validateConfig,
} from '../scripts/config.mjs';
import { validConfig } from './helpers.mjs';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'config.mjs');

function project(config) {
  const root = mkdtempSync(join(tmpdir(), 'tw-config-'));
  if (config !== undefined) {
    mkdirSync(join(root, '.claude'));
    writeFileSync(
      join(root, '.claude', 'workflow.json'),
      typeof config === 'string' ? config : JSON.stringify(config),
    );
  }
  return root;
}

const messageOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};

test('loads a valid config', () => {
  const config = validConfig();
  assert.deepEqual(loadConfig(project(config)), config);
});

test('missing file', () => {
  assert.equal(
    messageOf(() => loadConfig(project())),
    'No .claude/workflow.json: run /turbo-workflow:init',
  );
});

test('reports the bad field', () => {
  const badJson = messageOf(() => loadConfig(project('{ nope')));
  assert.match(badJson, /^\.claude\/workflow\.json: /);

  const noApps = validConfig();
  delete noApps.apps;
  assert.match(
    messageOf(() => loadConfig(project(noApps))),
    /apps/,
  );

  const jira = validConfig();
  jira.tracker = { type: 'jira' };
  assert.match(
    messageOf(() => loadConfig(project(jira))),
    /tracker\.type/,
  );

  const trello = validConfig();
  trello.tracker = { type: 'trello' };
  assert.match(
    messageOf(() => loadConfig(project(trello))),
    /tracker\.board/,
  );

  assert.deepEqual(validateConfig(validConfig()), []);
});

test('config without uat is valid', () => {
  assert.deepEqual(validateConfig(validConfig()), []);
});

test('uat keys are all optional', () => {
  assert.deepEqual(
    validateConfig({
      ...validConfig(),
      uat: { api: { devCommand: 'pnpm dev:api' } },
    }),
    [],
  );
  assert.deepEqual(validateConfig({ ...validConfig(), uat: {} }), []);
});

test('uat rejects bad types', () => {
  const errorsOf = (uat) => validateConfig({ ...validConfig(), uat }).join(';');
  assert.match(errorsOf({ signIn: 1 }), /uat\.signIn/);
  assert.match(errorsOf({ api: { token: [] } }), /uat\.api\.token/);
  assert.match(errorsOf({ extra: 'x' }), /uat\.extra/);
  assert.match(errorsOf({ api: { extra: 'x' } }), /uat\.api\.extra/);
  assert.match(errorsOf('x'), /uat/);
});

test('commands per package manager', () => {
  const expected = {
    pnpm: ['pnpm run build', 'pnpm exec lint-staged', 'pnpm-lock.yaml'],
    npm: ['npm run build', 'npx lint-staged', 'package-lock.json'],
    yarn: ['yarn run build', 'yarn lint-staged', 'yarn.lock'],
    bun: ['bun run build', 'bunx lint-staged', 'bun.lock'],
  };
  for (const [pm, [run, exec, lockfile]] of Object.entries(expected)) {
    const cmd = commands(pm);
    assert.equal(cmd.run('build'), run);
    assert.equal(cmd.exec('lint-staged'), exec);
    assert.equal(cmd.lockfile, lockfile);
    assert.equal(
      cmd.buildPackages,
      `${cmd.exec('turbo')} run build --filter='./packages/**'`,
    );
    assert.ok(cmd.lockfiles.includes(lockfile));
  }
  assert.deepEqual(commands('bun').lockfiles, ['bun.lock', 'bun.lockb']);
});

test('run a script in one workspace', () => {
  assert.equal(
    commands('pnpm').workspaceRun('web', 'apps/web', 'dev'),
    'pnpm --filter web dev',
  );
  assert.equal(
    commands('npm').workspaceRun('web', 'apps/web', 'dev'),
    'npm run dev -w apps/web',
  );
  assert.equal(
    commands('yarn').workspaceRun('web', 'apps/web', 'dev'),
    'yarn workspace web dev',
  );
  assert.equal(
    commands('bun').workspaceRun('web', 'apps/web', 'dev'),
    'bun run --filter web dev',
  );
});

test('readConfigFile never throws', () => {
  assert.equal(readConfigFile(project()), null);
  assert.equal(readConfigFile(project('{ nope')), null);
  assert.deepEqual(readConfigFile(project(validConfig())), validConfig());
});

test('CLI get and cmd', () => {
  const cwd = project(validConfig());
  execFileSync('git', ['init', '-q'], { cwd });
  const run = (...args) =>
    execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' }).trim();
  assert.equal(run('get', 'git.baseBranch'), 'main');
  assert.equal(run('cmd', 'lockfile'), 'package-lock.json');
  assert.equal(run('cmd', 'run', 'test'), 'npm run test');
  assert.deepEqual(JSON.parse(run('get', 'tracker')), { type: 'none' });
});

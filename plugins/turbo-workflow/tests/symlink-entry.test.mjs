// The plugin is often reached through a symlink (a linked ~/.claude, --plugin-dir
// through a link, macOS /tmp → /private/tmp): every entry point must still run.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { validConfig } from './helpers.mjs';

const PLUGIN = join(import.meta.dirname, '..');
const linkDir = realpathSync(mkdtempSync(join(tmpdir(), 'tw-link-')));
const LINK = join(linkDir, 'turbo-workflow');
symlinkSync(PLUGIN, LINK);

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-link-p-')));
  execFileSync('git', ['init', '-q', '-b', 'feat/demo'], { cwd: root });
  mkdirSync(join(root, '.claude'));
  writeFileSync(
    join(root, '.claude', 'workflow.json'),
    JSON.stringify({
      ...validConfig(),
      git: { remote: 'origin', baseBranch: 'main', protected: ['main'] },
    }),
  );
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'init'],
    { cwd: root },
  );
  return root;
}

test('ticket-state runs through a symlinked plugin path', () => {
  const root = project();
  const spec = join(root, 'docs', 'specs', '2026-11-06', 'demo');
  mkdirSync(spec, { recursive: true });
  const out = spawnSync(
    'node',
    [
      join(LINK, 'scripts', 'ticket-state.mjs'),
      'init',
      spec,
      'none:demo',
      'feat/demo',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(out.status, 0, out.stderr);
  assert.ok(existsSync(join(spec, 'state.json')));
});

test('init-detect runs through a symlinked plugin path', () => {
  const out = execFileSync(
    'node',
    [
      join(LINK, 'scripts', 'init-detect.mjs'),
      join(PLUGIN, 'tests', 'fixtures', 'npm-turbo'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(JSON.parse(out).packageManager.value, 'npm');
});

test('the guard hook runs through a symlinked plugin path', () => {
  const root = project();
  const out = spawnSync(
    'node',
    [join(LINK, 'hooks', 'block-forbidden-command.mjs')],
    {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
        cwd: root,
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    },
  );
  assert.match(out.stdout, /protected-push/);
});

test('config.mjs CLI runs through a symlinked plugin path', () => {
  const root = project();
  const out = execFileSync(
    'node',
    [join(LINK, 'scripts', 'config.mjs'), 'cmd', 'build-packages'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(out.trim(), "npx turbo run build --filter='./packages/**'");
});

test('importing a script never crashes on an argv[1] that is not a file', () => {
  for (const file of [
    'scripts/config.mjs',
    'scripts/ticket-state.mjs',
    'scripts/init-detect.mjs',
    'scripts/changed-apps.mjs',
    'hooks/block-forbidden-command.mjs',
  ]) {
    const out = spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(join(PLUGIN, file))})`,
        'not-a-file',
      ],
      { encoding: 'utf8', input: '' },
    );
    assert.equal(out.status, 0, `${file}: ${out.stderr}`);
  }
});

test('changed-apps and coverage-diff run through a symlinked plugin path', () => {
  const root = project();
  const apps = execFileSync(
    'node',
    [join(LINK, 'scripts', 'changed-apps.mjs'), '--files', 'apps/web/src/a.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(apps).apps, ['web']);
  const usage = spawnSync(
    'node',
    [join(LINK, 'scripts', 'coverage-diff.mjs')],
    {
      encoding: 'utf8',
    },
  );
  assert.match(usage.stderr, /Usage: coverage-diff\.mjs/);
});

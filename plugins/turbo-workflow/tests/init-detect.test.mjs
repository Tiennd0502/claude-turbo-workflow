import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'init-detect.mjs');
const FIXTURES = join(import.meta.dirname, 'fixtures');

const detect = (name) =>
  JSON.parse(
    execFileSync('node', [SCRIPT, join(FIXTURES, name)], { encoding: 'utf8' }),
  );

function tree(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort()
    .map((path) => [path, readFileSync(join(dir, path), 'utf8')]);
}

test('npm fixture', () => {
  const result = detect('npm-turbo');
  assert.deepEqual(result.packageManager, {
    value: 'npm',
    source: 'package-lock.json',
  });
  // `./apps/*` and `packages/*/` are normalised, so dirs match git's paths.
  assert.deepEqual(result.workspaces, [
    'apps/*',
    'packages/*',
    'libs/*',
    'services/*',
  ]);
  assert.deepEqual(result.packages, ['packages/shared', 'libs/ui']);
  const byName = Object.fromEntries(result.apps.map((app) => [app.name, app]));
  assert.deepEqual(Object.keys(byName).sort(), ['server', 'site', 'worker']);
  assert.equal(byName.server.dir, 'apps/server');
  assert.equal(byName.server.runner, 'Vitest');
  assert.equal(byName.server.e2e, true);
  assert.equal(byName.server.ui, false);
  assert.equal(byName.site.runner, 'Jest');
  assert.equal(byName.site.e2e, false);
  assert.equal(byName.site.ui, true);
  assert.equal(byName.site.url, 'http://localhost:3001');
  assert.equal(byName.site.devCommand, 'npm run dev -w apps/site');
  assert.equal(byName.site.scripts['test:cov'], 'jest --coverage');
  assert.equal(result.lintStaged, false);
  assert.deepEqual(result.git, {
    remote: null,
    url: null,
    remotes: [],
    defaultBranch: null,
  });
  assert.equal(result.existing.workflowJson, null);
  assert.deepEqual(result.existing.perApp['apps/site'], {
    coding: false,
    testing: false,
    verify: false,
  });
});

test('pnpm fixture', () => {
  const result = detect('pnpm-turbo');
  assert.deepEqual(result.packageManager, {
    value: 'pnpm',
    source: 'packageManager',
  });
  assert.deepEqual(result.workspaces, [
    'apps/*',
    'packages/**',
    '!**/fixtures/**',
  ]);
  const byDir = Object.fromEntries(result.apps.map((app) => [app.dir, app]));
  assert.deepEqual(Object.keys(byDir).sort(), ['apps/admin', 'apps/web']);
  assert.equal(byDir['apps/web'].url, 'http://localhost:3000');
  assert.equal(byDir['apps/web'].devCommand, 'pnpm --filter web dev');
  // No package name: the filter cannot name it, so run it from its dir.
  assert.equal(byDir['apps/admin'].devCommand, 'cd apps/admin && pnpm run dev');
  // Not dist/cjs (build output) and not fixtures/demo (excluded by `!**/fixtures/**`).
  assert.deepEqual(result.packages, ['packages/config/eslint']);
});

test('outside apps/ and packages/, a start script makes an app, a dev script or a dev dependency does not', () => {
  const byDir = Object.fromEntries(
    detect('npm-turbo').apps.map((app) => [app.dir, app]),
  );
  assert.ok(byDir['services/worker'], 'services/worker has a start script');
  assert.ok(
    !byDir['libs/ui'],
    'libs/ui has only a watch-mode dev script and react as a devDependency',
  );
});

test('reports existing files and current config', () => {
  const result = detect('pnpm-turbo');
  const file = JSON.parse(
    readFileSync(
      join(FIXTURES, 'pnpm-turbo', '.claude', 'workflow.json'),
      'utf8',
    ),
  );
  assert.deepEqual(result.existing.workflowJson, file);
  assert.equal(result.existing.settings, false);
  assert.equal(result.existing.claudeMd, false);
  assert.equal(result.existing.gitignoreHasSpecs, false);
});

test('reports whether .gitignore covers the specs dir and .superpowers/', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-ignore-')));
  writeFileSync(join(root, 'package.json'), '{"name":"r","workspaces":[]}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  const run = () =>
    JSON.parse(execFileSync('node', [SCRIPT, root], { encoding: 'utf8' }))
      .existing;
  assert.equal(run().gitignoreHasSuperpowers, false);
  writeFileSync(join(root, '.gitignore'), 'node_modules\n/.superpowers/\n');
  assert.equal(run().gitignoreHasSuperpowers, true);
  assert.equal(run().gitignoreHasSpecs, false);
  writeFileSync(join(root, '.gitignore'), '.superpowers\ndocs/specs/\n');
  assert.deepEqual(
    [run().gitignoreHasSuperpowers, run().gitignoreHasSpecs],
    [true, true],
  );
});

test('uses turbo ls when turbo is installed, globs otherwise', () => {
  // A repo whose workspaces the globs cannot see: `tooling` is the base of
  // `tooling/**` and `apps/web-a` needs a mid-segment wildcard.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-turbo-')));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    'package.json',
    JSON.stringify({ name: 'r', packageManager: 'pnpm@10.0.0' }),
  );
  write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'tooling/**'\n  - 'apps/web-*'\n",
  );
  write('tooling/package.json', JSON.stringify({ name: 'tooling' }));
  write(
    'apps/web-a/package.json',
    JSON.stringify({ name: 'web-a', scripts: { dev: 'next dev -p 3005' } }),
  );
  assert.equal(
    JSON.parse(execFileSync('node', [SCRIPT, root], { encoding: 'utf8' }))
      .workspaceSource,
    'globs',
  );

  write(
    'node_modules/.bin/turbo',
    `#!/usr/bin/env node\nif (process.argv.slice(2).join(' ') !== 'ls --output=json') process.exit(1);\nconsole.log(JSON.stringify({ packages: { count: 2, items: [{ name: 'tooling', path: 'tooling' }, { name: 'web-a', path: 'apps/web-a' }] } }));\n`,
  );
  chmodSync(join(root, 'node_modules', '.bin', 'turbo'), 0o755);
  const result = JSON.parse(
    execFileSync('node', [SCRIPT, root], { encoding: 'utf8' }),
  );
  assert.equal(result.workspaceSource, 'turbo');
  assert.deepEqual(
    result.apps.map((app) => app.dir),
    ['apps/web-a'],
  );
  assert.equal(result.apps[0].url, 'http://localhost:3005');
  assert.deepEqual(result.packages, ['tooling']);
});

test('writes nothing', () => {
  const before = tree(FIXTURES);
  detect('npm-turbo');
  detect('pnpm-turbo');
  assert.deepEqual(tree(FIXTURES), before);
});

test('git: the remote is a name, origin first, else the only remote', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-remote-')));
  writeFileSync(join(root, 'package.json'), '{"name":"r","workspaces":[]}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'upstream', 'https://example.com/up.git');
  git(
    'symbolic-ref',
    'refs/remotes/upstream/HEAD',
    'refs/remotes/upstream/trunk',
  );
  const run = () =>
    JSON.parse(execFileSync('node', [SCRIPT, root], { encoding: 'utf8' })).git;
  assert.deepEqual(run(), {
    remote: 'upstream',
    url: 'https://example.com/up.git',
    remotes: ['upstream'],
    defaultBranch: 'trunk',
  });
  git('remote', 'add', 'origin', 'https://example.com/o.git');
  const both = run();
  assert.equal(both.remote, 'origin');
  assert.deepEqual(both.remotes, ['origin', 'upstream']);
  assert.equal(both.defaultBranch, null);
});

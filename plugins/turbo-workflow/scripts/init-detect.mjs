#!/usr/bin/env node
// Read-only scan of a Turborepo for /turbo-workflow:init: what the project
// already has, so init can offer each detected value as the recommended
// answer. It never writes anything and never decides: init asks every value.
//
//   node <plugin>/scripts/init-detect.mjs [root]     (default: the current dir)
//
// Workspaces come from `turbo ls` when turbo is installed (workspaceSource
// "turbo"), else from the workspace globs ("globs": `dir/*`, `dir/**`, plain
// dirs and `!` exclusions only).
// Prints one JSON object: packageManager, workspaces, apps (with scripts,
// test runner, e2e, ui, dev command and URL), packages, lintStaged, git
// (remote name and URL, all remote names, default branch, only when root is
// a git top level) and existing
// (current workflow.json, settings, CLAUDE.md, .gitignore, per-app files).
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { commands, isEntry, LOCKFILES, readConfigFile } from './config.mjs';

const UI_DEPS = ['next', 'react', 'vue', 'svelte', 'vite'];

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

function detectPackageManager(root, pkg) {
  const field = pkg?.packageManager?.match(/^(pnpm|npm|yarn|bun)@/)?.[1];
  if (field) return { value: field, source: 'packageManager' };
  const lock = LOCKFILES.find(([file]) => existsSync(join(root, file)));
  return lock
    ? { value: lock[1], source: lock[0] }
    : { value: null, source: null };
}

// `packages:` list items of pnpm-workspace.yaml, read line by line.
function pnpmWorkspaces(root) {
  const path = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(path)) return null;
  const globs = [];
  let inPackages = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^packages:\s*$/.test(line)) inPackages = true;
    else if (/^\S/.test(line)) inPackages = false;
    else if (inPackages) {
      const item = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
      if (item) globs.push(item[1]);
    }
  }
  return globs;
}

// `./apps/*` → `apps/*`, `packages/*/` → `packages/*`, `!./x` → `!x`, so the
// dirs found match the repo-relative paths git prints.
const normaliseGlob = (glob) => {
  const negated = glob.startsWith('!');
  const body = (negated ? glob.slice(1) : glob)
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  return negated ? `!${body}` : body;
};

function workspaceGlobs(root, pkg) {
  const pnpm = pnpmWorkspaces(root);
  const field = pkg?.workspaces;
  const globs =
    pnpm ??
    (Array.isArray(field)
      ? field
      : Array.isArray(field?.packages)
        ? field.packages
        : []);
  return globs.map(normaliseGlob);
}

// A workspace glob as a regex over repo-relative dirs: `**` any depth, `*` one segment.
const globRegex = (glob) =>
  new RegExp(
    `^${glob
      .split('/')
      .map((part) =>
        part === '**'
          ? '.*'
          : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'),
      )
      .join('/')
      .replace(/\.\*\//g, '(?:.*/)?')}$`,
  );

// Dirs that hold dependencies or build output, never workspaces of their own
// (a dual-format build writes dist/cjs/package.json).
const NOT_WORKSPACES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
]);

// Every dir under `dir` (not NOT_WORKSPACES or dot dirs) that holds a package.json.
function nested(root, dir, depth = 0) {
  if (depth > 5 || !isDir(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .sort()
    .filter((name) => !NOT_WORKSPACES.has(name) && !name.startsWith('.'))
    .flatMap((name) => {
      const child = `${dir}/${name}`;
      if (!isDir(join(root, child))) return [];
      const here = existsSync(join(root, child, 'package.json')) ? [child] : [];
      return [...here, ...nested(root, child, depth + 1)];
    });
}

// `dir/*` and `dir/**` globs and plain dirs; every dir that holds a package.json
// and that no `!` glob excludes.
function expand(root, globs) {
  const dirs = [];
  const excluded = globs
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => globRegex(glob.slice(1)));
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    if (glob.endsWith('/**')) dirs.push(...nested(root, glob.slice(0, -3)));
    else if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      if (!isDir(join(root, base))) continue;
      for (const name of readdirSync(join(root, base)).sort())
        if (existsSync(join(root, base, name, 'package.json')))
          dirs.push(`${base}/${name}`);
    } else if (existsSync(join(root, glob, 'package.json'))) dirs.push(glob);
  }
  return [...new Set(dirs)].filter(
    (dir) => !excluded.some((re) => re.test(dir)),
  );
}

const depsOf = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });

// Turborepo's layout: apps/ holds apps and packages/ holds packages. Elsewhere,
// a workspace that starts a server or has a runtime UI dependency is an app. A `dev`
// script alone says nothing: packages often have a watch-mode one. Init asks
// anyway; this only picks the recommended answer.
function isApp({ dir, pkg }) {
  const top = dir.split('/')[0];
  if (top === 'apps') return true;
  if (top === 'packages') return false;
  // Runtime dependencies only: a library dev-depends on react for its tests.
  const deps = pkg.dependencies ?? {};
  return (
    Boolean(pkg.scripts?.start) ||
    UI_DEPS.some((dep) => Object.hasOwn(deps, dep))
  );
}

function devCommandOf(pm, pkg, dir) {
  if (!pkg.scripts?.dev || !pm) return null;
  const cmd = commands(pm);
  // Without a package name the workspace filter has nothing to match.
  return pkg.name
    ? cmd.workspaceRun(pkg.name, dir, 'dev')
    : `cd ${dir} && ${cmd.run('dev')}`;
}

function describeApp({ dir, pkg }, pm) {
  const deps = depsOf(pkg);
  const scripts = pkg.scripts ?? {};
  const port = scripts.dev?.match(/(?:-p|--port)[ =](\d+)/)?.[1];
  const name = pkg.name ?? dir.split('/').pop();
  return {
    name,
    dir,
    scripts,
    runner: deps.vitest ? 'Vitest' : deps.jest ? 'Jest' : null,
    e2e: Object.hasOwn(scripts, 'test:e2e'),
    ui: UI_DEPS.some((dep) => Object.hasOwn(deps, dep)),
    devCommand: devCommandOf(pm, pkg, dir),
    url: port ? `http://localhost:${port}` : null,
  };
}

const gitOut = (root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

// `remote` is the remote's name (what `git.remote` holds): `origin` when it
// exists, else the first one; `url` is that remote's URL.
function detectGit(root) {
  const none = { remote: null, url: null, remotes: [], defaultBranch: null };
  const top = gitOut(root, ['rev-parse', '--show-toplevel']);
  if (!top || realpathSync(top) !== realpathSync(root)) return none;
  const remotes = (gitOut(root, ['remote']) ?? '').split('\n').filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);
  if (!remote) return none;
  const head = gitOut(root, ['symbolic-ref', `refs/remotes/${remote}/HEAD`]);
  return {
    remote,
    url: gitOut(root, ['remote', 'get-url', remote]),
    remotes,
    defaultBranch: head ? head.slice(`refs/remotes/${remote}/`.length) : null,
  };
}

function detectLintStaged(root, pkg) {
  if (pkg?.['lint-staged'] || pkg?.devDependencies?.['lint-staged'])
    return true;
  return readdirSync(root).some((file) =>
    /^\.lintstagedrc|^lint-staged\.config\./.test(file),
  );
}

// The workspace dirs exactly as Turborepo (and so the package manager) sees
// them, from the project's own turbo binary: no glob emulation, no network.
// null when turbo is not installed or fails.
function turboWorkspaces(root) {
  const turbo = join(root, 'node_modules', '.bin', 'turbo');
  if (!existsSync(turbo)) return null;
  try {
    const out = execFileSync(turbo, ['ls', '--output=json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
    });
    const items = JSON.parse(out)?.packages?.items;
    return Array.isArray(items)
      ? items
          .map((item) => item.path)
          .filter((path) => typeof path === 'string')
          .sort()
      : null;
  } catch {
    return null;
  }
}

export function detect(root) {
  const pkg = readJson(join(root, 'package.json'));
  const pm = detectPackageManager(root, pkg);
  const workspaces = workspaceGlobs(root, pkg);
  const fromTurbo = turboWorkspaces(root);
  // The globs are only a fallback for a repo whose dependencies are not installed.
  const dirs = fromTurbo ?? expand(root, workspaces);
  const manifests = dirs.map((dir) => ({
    dir,
    pkg: readJson(join(root, dir, 'package.json')) ?? {},
  }));
  const packages = manifests.filter((w) => !isApp(w)).map((w) => w.dir);
  const apps = manifests
    .filter(isApp)
    .map((workspace) => describeApp(workspace, pm.value));
  const workflowJson = readConfigFile(root);
  const specsDir = workflowJson?.specsDir ?? 'docs/specs';
  const gitignore = existsSync(join(root, '.gitignore'))
    ? readFileSync(join(root, '.gitignore'), 'utf8')
        .split('\n')
        .map((line) => line.trim())
    : [];
  const perApp = Object.fromEntries(
    apps.map(({ dir }) => [
      dir,
      {
        coding: existsSync(join(root, dir, '.claude', 'rules', 'coding.md')),
        testing: existsSync(join(root, dir, '.claude', 'rules', 'testing.md')),
        verify: existsSync(
          join(root, dir, '.claude', 'skills', 'verify', 'SKILL.md'),
        ),
      },
    ]),
  );
  return {
    packageManager: pm,
    workspaces,
    workspaceSource: fromTurbo ? 'turbo' : 'globs',
    apps,
    packages,
    lintStaged: detectLintStaged(root, pkg),
    git: detectGit(root),
    existing: {
      workflowJson,
      settings: existsSync(join(root, '.claude', 'settings.json')),
      claudeMd: existsSync(join(root, 'CLAUDE.md')),
      gitignoreHasSpecs: [
        specsDir,
        `${specsDir}/`,
        `/${specsDir}`,
        `/${specsDir}/`,
      ].some((entry) => gitignore.includes(entry)),
      // superpowers' plan ledgers (and a PR draft made with no spec dir);
      // step 9 commits with `git add -A`, so they must be ignored.
      gitignoreHasSuperpowers: [
        '.superpowers',
        '.superpowers/',
        '/.superpowers',
        '/.superpowers/',
      ].some((entry) => gitignore.includes(entry)),
      perApp,
    },
  };
}

if (isEntry(import.meta.url)) {
  console.log(JSON.stringify(detect(resolve(process.argv[2] ?? '.')), null, 2));
}

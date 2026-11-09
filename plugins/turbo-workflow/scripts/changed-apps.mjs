#!/usr/bin/env node
// Which apps a change touches, for the workflow's per-app rules, verify and coverage.
//
//   node <plugin>/scripts/changed-apps.mjs <base ref>
//     Classify `git diff --name-only --no-renames $(git merge-base <base ref> HEAD)`
//     plus the untracked files. A branch name such as origin/<base branch> works:
//     commits the base gained after the merge-base are not counted.
//
//   node <plugin>/scripts/changed-apps.mjs --files <path ...>
//     Classify the given repo-relative paths.
//
// Prints one JSON line: {"apps":[...],"rebuild":true|false,"noApp":true|false}.
// The apps and shared paths come from .claude/workflow.json. An app counts when
// a code or app-config file under its dir changed: anything except
// <dir>/.claude/** and *.md. A shared path (a package every app uses, or a file
// such as the workspace catalog) counts as every app and sets `rebuild`: the
// packages' dist is rebuilt first, all at once, in dependency order. Anything
// else counts as no app.
import { execFileSync } from 'node:child_process';

import { isEntry, loadConfig } from './config.mjs';

const under = (path, dir) => path.startsWith(`${dir}/`);
const matches = (path, shared) => path === shared || under(path, shared);

export function classify(paths, manifest = loadConfig()) {
  const names = Object.keys(manifest.apps);
  const apps = new Set();
  let rebuild = false;
  for (const path of paths) {
    if (path.endsWith('.md')) continue;
    const app = names.find((name) => under(path, manifest.apps[name].dir));
    const shared = manifest.shared.some((entry) => matches(path, entry));
    if (app) {
      if (!under(path, `${manifest.apps[app].dir}/.claude`)) apps.add(app);
    } else if (shared) {
      names.forEach((name) => apps.add(name));
      rebuild = true;
    }
  }
  return {
    apps: [...apps].sort(),
    rebuild,
    noApp: apps.size === 0,
  };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter(Boolean);
}

export function changedPaths(base, cwd) {
  const root = git(['rev-parse', '--show-toplevel'], cwd)[0];
  try {
    git(['rev-parse', '--verify', `${base}^{commit}`], root);
  } catch {
    throw new Error(
      `Unknown base ${base}: fetch it (git fetch origin) or pass a commit.`,
    );
  }
  const mergeBase = git(['merge-base', base, 'HEAD'], root)[0];
  return [
    ...git(['diff', '--name-only', '--no-renames', mergeBase], root),
    ...git(['ls-files', '--others', '--exclude-standard', '--full-name'], root),
  ];
}

if (isEntry(import.meta.url)) {
  const args = process.argv.slice(2);
  let paths;
  if (args[0] === '--files') {
    paths = args.slice(1);
  } else if (args.length === 1) {
    try {
      paths = changedPaths(args[0]);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  } else {
    console.error('Usage: changed-apps.mjs <base ref> | --files <path ...>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(classify(paths)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

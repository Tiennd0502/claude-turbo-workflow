// Shared fixtures for the plugin's tests (not a test file).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const validConfig = () => ({
  version: 1,
  packageManager: 'npm',
  git: { remote: 'origin', baseBranch: 'main', protected: ['main'] },
  tracker: { type: 'none' },
  autofix: 'none',
  specsDir: 'docs/specs',
  apps: {
    web: {
      dir: 'apps/web',
      runner: 'Jest',
      coverage: 'npm run test:cov',
      e2e: false,
      planChanges: [],
      security: [],
      ui: ['src/**'],
    },
  },
  shared: ['packages/ui'],
});

export const trelloConfig = () => ({
  ...validConfig(),
  tracker: {
    type: 'trello',
    board: 'https://trello.com/b/abc12345/demo',
    lists: { todo: 'TODO', inProgress: 'DOING', review: 'REVIEW', done: 'DONE' },
  },
});

// A git repo (on main, one commit) holding `.claude/workflow.json`, under a
// temp dir whose path has a space.
export function gitProject(config = validConfig()) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw project-')));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'workflow.json'), JSON.stringify(config));
  git('add', '-A');
  git('-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'init');
  return root;
}

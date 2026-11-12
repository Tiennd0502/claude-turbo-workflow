import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { exemptPatterns, nextAction } from '../scripts/ticket-state.mjs';
import { validConfig } from './helpers.mjs';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'ticket-state.mjs');
const PLAN =
  '# Demo plan\n\n### Task 1: One\n\n**Files:**\n- Create: `src/a.ts`\n\n- [ ] **Step 1:** do it\n';

function repo(overrides = {}, specsDir = 'docs/specs') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tw-state-')));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'feat/demo');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  mkdirSync(join(root, '.claude'));
  const config = {
    ...validConfig(),
    packageManager: 'pnpm',
    git: { remote: 'origin', baseBranch: 'develop', protected: ['develop'] },
    specsDir,
    ...overrides,
  };
  writeFileSync(join(root, '.claude', 'workflow.json'), JSON.stringify(config));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const spec = join(root, specsDir, '2026-11-06', 'demo');
  mkdirSync(spec, { recursive: true });
  writeFileSync(join(spec, 'plan.md'), PLAN);
  const run = (...args) =>
    spawnSync('node', [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  return {
    root,
    spec,
    run,
    head: () =>
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
  };
}

const stateOf = (spec) =>
  JSON.parse(readFileSync(join(spec, 'state.json'), 'utf8'));

test('init then status', () => {
  const { spec, run } = repo();
  assert.equal(run('init', spec, 'none:demo', 'feat/demo').status, 0);
  assert.equal(stateOf(spec).ticket, 'none:demo');
  const out = run('status', spec, '--no-brief');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Ticket: none:demo \(demo\)$/m);
  assert.match(out.stdout, /^Next: /m);
  assert.doesNotMatch(out.stdout, /Card/);
});

test('reads a legacy card field', () => {
  const { spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  const state = stateOf(spec);
  delete state.ticket;
  state.card = 'https://trello.com/c/abc/42-x';
  writeFileSync(join(spec, 'state.json'), JSON.stringify(state));
  const out = run('status', spec, '--no-brief');
  assert.match(
    out.stdout,
    /^Ticket: https:\/\/trello\.com\/c\/abc\/42-x \(#42\)$/m,
  );
});

test('base defaults to config', () => {
  const develop = repo();
  develop.run('init', develop.spec, 'none:demo', 'feat/demo');
  develop.run('base', develop.spec, develop.head());
  assert.equal(stateOf(develop.spec).baseBranch, 'develop');

  const main = repo({
    git: { remote: 'origin', baseBranch: 'main', protected: [] },
  });
  main.run('init', main.spec, 'none:demo', 'feat/demo');
  main.run('base', main.spec, main.head());
  assert.equal(stateOf(main.spec).baseBranch, 'main');
});

test('exempt lockfile follows package manager', () => {
  const npm = exemptPatterns(
    { ...validConfig(), packageManager: 'npm' },
    'feat/demo',
  );
  assert.ok(npm.includes('package-lock.json'));
  assert.ok(!npm.includes('pnpm-lock.yaml'));
  const pnpm = exemptPatterns(
    { ...validConfig(), packageManager: 'pnpm' },
    'feat/demo',
  );
  assert.ok(pnpm.includes('pnpm-lock.yaml'));
  const bun = exemptPatterns(
    { ...validConfig(), packageManager: 'bun' },
    'feat/demo',
  );
  assert.ok(bun.includes('bun.lock') && bun.includes('bun.lockb'));
});

test('uses specsDir', () => {
  const { spec, run } = repo({}, 'notes/specs');
  run('init', spec, 'none:demo', 'feat/other');
  const out = run('status', '--list');
  assert.match(out.stdout, /^demo feat\/other · Design$/m);
});

test('no state.json is a no-op', () => {
  const { spec, run } = repo();
  const out = run('flow', spec, '3');
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
});

test('flow takes step 13', () => {
  const { spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  assert.equal(run('flow', spec, '13').status, 0);
  assert.equal(stateOf(spec).flow, '13');
  assert.notEqual(run('flow', spec, '14').status, 0);
});

test('reads a v1 state', () => {
  const { root, spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  const state = stateOf(spec);
  state.version = 1;
  state.flow = '9';
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  state.awaiting = { gate: '11', payload: {}, tree };
  writeFileSync(join(spec, 'state.json'), JSON.stringify(state));
  const out = run('status', spec, '--no-brief');
  assert.match(out.stdout, /Commit/);
  assert.match(out.stdout, /^Waiting at: 12$/m);
});

test('UAT findings survive a code review', () => {
  const { spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  const feed = (args, json) =>
    spawnSync('node', [SCRIPT, 'findings', spec, ...args], {
      input: json,
      encoding: 'utf8',
    });
  assert.equal(feed(['--uat'], '[{"id":"UAT-AC1","summary":"x"}]').status, 0);
  assert.equal(feed([], '[{"id":"1","summary":"y"}]').status, 0);
  const ids = () => stateOf(spec).codeReview.findings.map((f) => f.id);
  assert.deepEqual(ids().sort(), ['1', 'UAT-AC1']);
  assert.equal(feed(['--uat'], '[]').status, 0);
  assert.deepEqual(ids(), ['1']);
  assert.equal(stateOf(spec).codeReview.done, true);
});

test('round limit is 3', () => {
  const { spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  assert.match(
    run('status', spec, '--no-brief').stdout,
    /Rounds: pre 0\/3, post 0\/3/,
  );
});

const FACTS = {
  currentBranch: 'feat/demo',
  dirty: false,
  commitsAfterBase: false,
  changedSinceAwaiting: [],
  changedSinceBoundary: [],
  plan: [],
  exempt: [],
};
const STATE = {
  branch: 'feat/demo',
  flow: '8',
  awaiting: null,
  current: null,
  codeReview: { done: true, findings: [] },
};

test('open UAT findings resume at step 9', () => {
  const state = {
    ...STATE,
    flow: '9',
    codeReview: { done: true, findings: [{ id: 'UAT-AC2', status: 'open' }] },
  };
  assert.equal(
    nextAction(state, FACTS),
    'fix UAT findings UAT-AC2, then code-review on the fix, step 8, then step 9',
  );
  assert.equal(nextAction({ ...STATE, flow: '9' }, FACTS), 'run step 9 (UAT)');
});

test('open UAT findings at the round limit ask the UAT gate; a pending one asks again', () => {
  const state = {
    ...STATE,
    flow: '9',
    rounds: { pre: 3, post: 0 },
    codeReview: { done: true, findings: [{ id: 'UAT-AC1', status: 'open' }] },
  };
  assert.equal(nextAction(state, FACTS), 'ask the UAT gate');
  assert.equal(
    nextAction({ ...state, rounds: { pre: 2, post: 0 } }, FACTS),
    'fix UAT findings UAT-AC1, then code-review on the fix, step 8, then step 9',
  );
  assert.equal(
    nextAction({ ...state, awaiting: { gate: 'uat' } }, FACTS),
    'ask again: uat',
  );
});

test('at step 9, open code-review findings of a UAT fix come first', () => {
  const state = {
    ...STATE,
    flow: '9',
    codeReview: {
      done: true,
      findings: [
        { id: 'UAT-AC1', status: 'open' },
        { id: '2', status: 'open' },
      ],
    },
  };
  assert.equal(
    nextAction(state, FACTS),
    'fix findings 2, then code-review on the fix',
  );
});

test('open code-review findings at step 9 at the round limit stop', () => {
  const state = {
    ...STATE,
    flow: '9',
    rounds: { pre: 3, post: 0 },
    codeReview: { done: true, findings: [{ id: '2', status: 'open' }] },
  };
  assert.equal(
    nextAction(state, FACTS),
    'stop: round limit reached; ask the user',
  );
});

test('findings checks the UAT- prefix against --uat', () => {
  const { spec, run } = repo();
  run('init', spec, 'none:demo', 'feat/demo');
  const feed = (args, json) =>
    spawnSync('node', [SCRIPT, 'findings', spec, ...args], {
      input: json,
      encoding: 'utf8',
    });
  const before = stateOf(spec);
  assert.notEqual(feed(['--uat'], '[{"id":"1","summary":"x"}]').status, 0);
  assert.notEqual(feed([], '[{"id":"UAT-AC1","summary":"y"}]').status, 0);
  assert.deepEqual(stateOf(spec), before);
});

test('after the commit, steps 7-10 resume as step 11', () => {
  for (const flow of ['7', '8', '9', '10']) {
    const state = { ...STATE, flow };
    assert.match(
      nextAction(state, { ...FACTS, commitsAfterBase: true, dirty: true }),
      /^finish the step 11 security fix/,
    );
    assert.equal(
      nextAction(state, { ...FACTS, commitsAfterBase: true }),
      'run step 11',
    );
  }
  assert.equal(
    nextAction({ ...STATE, flow: '10' }, FACTS),
    'run step 10 (commit)',
  );
});

test('step 12 checks the PR', () => {
  assert.equal(
    nextAction({ ...STATE, flow: '12' }, { ...FACTS, commitsAfterBase: true }),
    'check the PR (gh pr view); if there is none, run step 12',
  );
});

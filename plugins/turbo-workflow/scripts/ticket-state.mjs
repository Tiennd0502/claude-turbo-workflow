#!/usr/bin/env node
// The saved status of one /turbo-workflow:work-ticket ticket: where the flow
// stopped, so a new
// session continues at the exact task step instead of re-reading the spec.
//
//   node <plugin>/scripts/ticket-state.mjs <command> <spec dir> [args]
//
//   init <spec> <ticket> <branch>       create <spec>/state.json (flow 2);
//                                       <ticket> is a URL or none:<feature>
//   rename <spec> <new spec> <branch>   rewrite the spec dir and branch fields
//                                       (Gate 1 option C; move the dir after)
//   flow <spec> <step>                  2 3 gate1 5 6 7 8 9 (UAT) 10 (commit)
//                                       11 (security) 12 (push + PR)
//                                       13 (ticket to review) closed
//   base <spec> <commit> [<branch>]     the base commit and branch (step 5;
//                                       branch defaults to git.baseBranch)
//   at <spec> <task> <step>             steps before <step> are done, <step> is
//                                       in progress: fingerprint + tick boxes
//   boundary <spec>                     fingerprint only (after the autofix)
//   tests-pass <spec> <task>            the task's tests passed
//   review <spec> <task> pass|gap <text>  the task's plan review result
//   task-diff <spec> <task>             print every file the plan names and the
//                                       task's diff, for plan-reviewer
//   await <spec> <gate>                 the AskUserQuestion input about to be
//                                       asked, as JSON on stdin
//   answered <spec>                     the question was answered
//   findings <spec> [--uat] [file]      code review findings (or, with --uat,
//                                       the UAT-* ones only), JSON on stdin:
//                                       [{ "id", "summary" }]
//   finding <spec> fixed|left <id> [reason]
//   round <spec> pre|post               one workflow rule 8 round used
//   close <spec>                        the ticket is finished: drop its refs
//
//   status [<spec>] [--no-brief]        print the resume brief (unless
//                                       --no-brief), then the status, ending
//                                       with one `Next:` line. No spec: the
//                                       ticket of the current branch, else the
//                                       list. Exit 3 when there is no usable
//                                       saved status.
//
// Nothing but <spec>/state.json is written in the spec dir.
//   status --list                       one line per ticket in progress
//
// A fingerprint is a tree of the whole working tree, built with a temporary
// index outside .git/ (the real index, HEAD and branches are never touched),
// wrapped in a parentless commit and kept by refs/work-ticket/<feature>/*.
// Every command except init does nothing and exits 0 when <spec> has no
// state.json, so it can ride along with a test or autofix command.
// Offline: only local files and local git, never gh or the tracker.
// Project values (base branch, specs dir, lockfile) come from
// .claude/workflow.json through config.mjs.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import {
  ConfigError,
  isEntry,
  commands as pmCommands,
  loadConfig,
} from './config.mjs';

const STATE = 'state.json';
export const FLOW_STEPS = [
  '2',
  '3',
  'gate1',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  'closed',
];
const IDENTITY = {
  GIT_AUTHOR_NAME: 'work-ticket',
  GIT_AUTHOR_EMAIL: 'work-ticket@localhost',
  GIT_COMMITTER_NAME: 'work-ticket',
  GIT_COMMITTER_EMAIL: 'work-ticket@localhost',
};

export function git(args, cwd, env = process.env, { raw = false } = {}) {
  const out = execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return raw ? out : out.trim();
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

export function readState(specDir) {
  const path = join(specDir, STATE);
  if (!existsSync(path)) return null;
  return migrate(JSON.parse(readFileSync(path, 'utf8')));
}

// v1 had no UAT step: steps 9-12 are now 10-13. In memory only; the next
// write saves version 2.
const RENUMBERED = { 9: '10', 10: '11', 11: '12', 12: '13' };
function migrate(state) {
  if (state.version != null && state.version !== 1) return state;
  state.version = 2;
  if (RENUMBERED[state.flow]) state.flow = RENUMBERED[state.flow];
  const gate = state.awaiting?.gate;
  if (RENUMBERED[gate]) state.awaiting.gate = RENUMBERED[gate];
  return state;
}

export function writeState(specDir, state) {
  const path = join(specDir, STATE);
  const tmp = `${path}.tmp`;
  state.updatedAt = new Date().toISOString();
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}

export function featureOf(branch) {
  const slash = branch.indexOf('/');
  return slash === -1 ? branch : branch.slice(slash + 1);
}

export function snapshot(root) {
  const tmp = mkdtempSync(join(tmpdir(), 'ticket-state-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    git(['read-tree', 'HEAD'], root, env);
    git(['add', '-A'], root, env);
    const tree = git(['write-tree'], root, env);
    const commit = git(
      ['commit-tree', tree, '-m', 'work-ticket boundary'],
      root,
      {
        ...process.env,
        ...IDENTITY,
      },
    );
    return { tree, commit };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function saveRef(root, feature, name, commit) {
  git(['update-ref', `refs/work-ticket/${feature}/${name}`, commit], root);
}

// Walks a plan the way the plugin's task-brief does: `#… Task N` headings
// outside code fences start a task; a heading of the same or a higher level
// ends it.
function walkPlan(text, visit) {
  let fence = false;
  let task = null;
  let level = 0;
  let inFiles = false;
  text.split('\n').forEach((line, index) => {
    if (/^```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const heading = line.match(/^(#+)\s/);
    if (heading) {
      const named = line.match(/^#+\s+Task\s+(\d+)\b:?\s*(.*)$/);
      if (named) {
        task = { n: Number(named[1]), title: named[2].trim() };
        level = heading[1].length;
        inFiles = false;
        visit({ kind: 'task', task, index });
        return;
      }
      if (task && heading[1].length <= level) task = null;
      return;
    }
    if (!task) return;
    const step = line.match(/^\s*- \[( |x)\] \*\*Step (\d+)/);
    if (step) {
      inFiles = false;
      visit({
        kind: 'step',
        task,
        index,
        k: Number(step[2]),
        done: step[1] === 'x',
      });
      return;
    }
    if (/^\*\*Files:\*\*/.test(line)) {
      inFiles = true;
      return;
    }
    if (inFiles) {
      if (/^\s*-\s/.test(line)) {
        for (const match of line.matchAll(/`([^`]+)`/g)) {
          visit({
            kind: 'file',
            task,
            path: match[1].replace(/:\d+(-\d+)?$/, ''),
          });
        }
      } else if (line.trim() !== '') {
        inFiles = false;
      }
    }
  });
}

export function planTasks(text) {
  const tasks = new Map();
  walkPlan(text, (event) => {
    if (event.kind === 'task') {
      tasks.set(event.task.n, {
        n: event.task.n,
        title: event.task.title,
        steps: [],
        files: [],
      });
      return;
    }
    const task = tasks.get(event.task.n);
    if (event.kind === 'step')
      task.steps.push({ k: event.k, done: event.done });
    if (event.kind === 'file') task.files.push(event.path);
  });
  return [...tasks.values()];
}

// Ticks Steps 1..upTo-1 of one task. Never unticks a box.
export function tickSteps(text, taskNumber, upTo) {
  const lines = text.split('\n');
  walkPlan(text, (event) => {
    if (
      event.kind === 'step' &&
      event.task.n === taskNumber &&
      event.k < upTo
    ) {
      lines[event.index] = lines[event.index].replace('- [ ]', '- [x]');
    }
  });
  return lines.join('\n');
}

function newState(ticket, branch, specDir) {
  return {
    version: 2,
    ticket,
    branch,
    specDir,
    base: null,
    flow: '2',
    awaiting: null,
    current: null,
    tasks: {},
    boundary: null,
    codeReview: { done: false, findings: [] },
    rounds: { pre: 0, post: 0 },
  };
}

function setBoundary(root, state, label) {
  const { tree, commit } = snapshot(root);
  state.boundary = { tree, commit, label };
  saveRef(root, featureOf(state.branch), 'boundary', commit);
  return { tree, commit };
}

// The diff of one task (its base tree → the current working tree, new files
// included) and the list of every file the plan names, for plan-reviewer.
export function taskDiff(root, specDir, state, n) {
  const base = state.tasks[n]?.base;
  if (!base) throw new Error(`Task ${n} has no base yet: run \`at\` first`);
  const { tree } = snapshot(root);
  const diff = git(['diff', base, tree], root, process.env, { raw: true });
  const plan = readFileSync(join(specDir, 'plan.md'), 'utf8');
  const files = [...new Set(planTasks(plan).flatMap((task) => task.files))];
  return { diff, files };
}

// JSON from a file argument, or from stdin when there is none (or `-`).
const readInput = (arg) =>
  JSON.parse(readFileSync(arg && arg !== '-' ? arg : 0, 'utf8'));

// --- status ---

const FLOW_LABELS = {
  2: 'Design',
  3: 'Plan',
  gate1: 'Gate 1',
  5: 'Branch',
  6: 'Implement',
  7: 'Code review',
  8: 'Verify',
  9: 'UAT',
  10: 'Commit',
  11: 'Security review',
  12: 'Push + PR',
  13: 'Ticket to review',
  closed: 'Closed',
};
const TASK_WORDS = {
  pending: 'not started',
  in_progress: 'in progress',
  tests_pass: 'tests passed',
  review_gap: 'review gap',
  review_pass: 'review passed',
};
const ROUND_LIMIT = 3;
const isUat = (finding) => String(finding.id).startsWith('UAT-');
const flowAt = (step) => FLOW_STEPS.indexOf(step);

// Paths the workflow itself writes, never flagged as outside the plan
// (workflow rule 6 "not deviations"): screenshot dirs and the lockfiles.
export function exemptPatterns(config, branch) {
  const dirs = Object.values(config?.apps ?? {})
    .map((app) => app.screenshot?.dir)
    .filter(Boolean)
    .map((dir) => `${dir.replace('{feature}', featureOf(branch))}/`);
  const lockfiles = config ? pmCommands(config.packageManager).lockfiles : [];
  return [...new Set(dirs), ...lockfiles];
}

const toRegex = (path) =>
  new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '[^/]+')}$`,
  );

function outside(paths, allowed, exempt) {
  const patterns = allowed.map(toRegex);
  return paths.filter(
    (path) =>
      !patterns.some((re) => re.test(path)) &&
      !exempt.some(
        (entry) =>
          path === entry || (entry.endsWith('/') && path.startsWith(entry)),
      ),
  );
}

function nextTaskAction(state, facts) {
  const tasks = facts.plan;
  const current = state.current;
  if (!current)
    return tasks.length ? `start Task ${tasks[0].n} Step 1` : 'finish step 6';
  const { task: n, step: k } = current;
  const entry = state.tasks[n] ?? { status: 'pending' };
  switch (entry.status) {
    case 'tests_pass':
      return `run Task ${n}'s plan review`;
    case 'review_gap':
      return `fix Task ${n}'s review gap: ${entry.gap}`;
    case 'review_pass': {
      if (!facts.ledgerComplete.has(n)) return `run task-done for Task ${n}`;
      const next = tasks.find(
        (task) => task.n > n && !facts.ledgerComplete.has(task.n),
      );
      return next ? `start Task ${next.n} Step 1` : 'finish step 6';
    }
    default:
      return facts.treeEqualsBoundary
        ? `start Task ${n} Step ${k}`
        : `continue Task ${n} Step ${k}`;
  }
}

// The one action a resumed session takes next. Pure: `facts` are read from
// git and the files by status().
export function nextAction(state, facts) {
  // Once the ticket's commit exists, steps 7 to 10 come back only inside the
  // step 11 security fix.
  const flow =
    facts.commitsAfterBase && ['7', '8', '9', '10'].includes(state.flow)
      ? '11'
      : state.flow;
  if (flow === 'closed') return 'nothing: ticket closed';
  if (
    facts.currentBranch !== state.branch &&
    (facts.dirty || flowAt(flow) >= flowAt('6'))
  ) {
    if (!facts.dirty) return `check out ${state.branch}`;
    const where = facts.currentBranch ?? 'a detached HEAD';
    if (flowAt(flow) < flowAt('6')) {
      return `stop: on ${where} with uncommitted changes; commit or stash them before the ticket continues`;
    }
    return `stop: on ${where} with uncommitted changes; the ticket's branch is ${state.branch}`;
  }
  if (state.awaiting) {
    const changed = facts.changedSinceAwaiting;
    if (changed.length) {
      return `ask the user: files changed while waiting at ${state.awaiting.gate}: ${changed.join(', ')}`;
    }
    return `ask again: ${state.awaiting.gate}`;
  }
  if (flow === '6' && state.current) {
    const task = facts.plan.find((t) => t.n === state.current.task);
    const extra = outside(
      facts.changedSinceBoundary,
      task?.files ?? [],
      facts.exempt,
    );
    if (extra.length) {
      return `ask the user: files outside Task ${state.current.task} changed: ${extra.join(', ')}`;
    }
  }
  if (flowAt(flow) >= flowAt('7')) {
    const all = facts.plan.flatMap((t) => t.files);
    const extra = outside(facts.changedSinceBoundary, all, facts.exempt);
    if (extra.length)
      return `ask the user: files outside the plan changed: ${extra.join(', ')}`;
  }
  switch (flow) {
    case '2':
      return 'run step 2 (finish the design, ask for approval)';
    case '3':
      return 'run step 3 (write the plan)';
    case 'gate1':
      return 'ask Gate 1';
    case '5':
      return 'run step 5 (branch and baseline)';
    case '6':
      return nextTaskAction(state, facts);
    case '7': {
      if (!state.codeReview.done) return 'run code-review';
      const open = state.codeReview.findings.filter(
        (f) => f.status === 'open' && !isUat(f),
      );
      if (open.length) {
        return `fix findings ${open.map((f) => f.id).join(', ')}, then code-review on the fix`;
      }
      return 'run step 8';
    }
    case '8':
      return 'run step 8';
    case '9': {
      const anyOpen = state.codeReview.findings.filter(
        (f) => f.status === 'open',
      );
      if (anyOpen.length && (state.rounds?.pre ?? 0) >= ROUND_LIMIT) {
        return anyOpen.some(isUat)
          ? 'ask the UAT gate'
          : 'stop: round limit reached; ask the user';
      }
      // A code review of a UAT fix runs here too: its findings come first.
      const review = state.codeReview.findings.filter(
        (f) => f.status === 'open' && !isUat(f),
      );
      if (review.length) {
        return `fix findings ${review.map((f) => f.id).join(', ')}, then code-review on the fix`;
      }
      const open = state.codeReview.findings.filter(
        (f) => f.status === 'open' && isUat(f),
      );
      if (!open.length) return 'run step 9 (UAT)';
      return `fix UAT findings ${open.map((f) => f.id).join(', ')}, then code-review on the fix, step 8, then step 9`;
    }
    case '10':
      return 'run step 10 (commit)';
    case '11':
      return facts.dirty
        ? 'finish the step 11 security fix: code-review on it, step 8, step 9, amend, then security-review (same round)'
        : 'run step 11';
    case '12':
      return 'check the PR (gh pr view); if there is none, run step 12';
    default:
      return 'check the PR, then move the ticket and close';
  }
}

export function ledgerFor(root, planPath) {
  const result = { complete: new Set(), rulings: [] };
  const base = join(root, '.superpowers', 'sdd');
  if (!existsSync(base)) return result;
  for (const name of readdirSync(base)) {
    const marker = join(base, name, 'plan-path');
    const ledger = join(base, name, 'progress.md');
    if (!existsSync(marker) || !existsSync(ledger)) continue;
    if (readFileSync(marker, 'utf8').trim() !== planPath) continue;
    for (const line of readFileSync(ledger, 'utf8').split('\n')) {
      const done = line.match(/^Task (\d+): complete\b/);
      if (done) result.complete.add(Number(done[1]));
      if (line.includes('Ruling:')) result.rulings.push(line);
    }
  }
  return result;
}

// The ticket of a state; states written before tickets had a `card` field.
const ticketOf = (state) => state.ticket ?? state.card ?? null;

// A short label for a ticket ref: `#<n>` for a numbered Trello card URL, the
// feature for `none:<feature>`, else the ref itself.
export function ticketLabel(ref) {
  if (!ref) return '?';
  const trello = ref.match(/trello\.com\/c\/[^/]+\/(\d+)-/);
  if (trello) return `#${trello[1]}`;
  if (ref.startsWith('none:')) return ref.slice('none:'.length);
  return ref;
}

function flowLine(state, plan) {
  const label = FLOW_LABELS[state.flow] ?? state.flow;
  if (state.flow !== '6' || !state.current) return label;
  const { task, step } = state.current;
  const word = TASK_WORDS[state.tasks[task]?.status ?? 'pending'];
  return `${label} · Task ${task}/${plan.length}, Step ${step} ${word}`;
}

const specsGlob = (root) => {
  const base = join(root, loadConfig(root).specsDir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .flatMap((day) => {
      const dayDir = join(base, day);
      return statSync(dayDir).isDirectory()
        ? readdirSync(dayDir).map((name) => join(dayDir, name))
        : [];
    })
    .filter((dir) => existsSync(join(dir, STATE)))
    .sort()
    .reverse();
};

const readPlan = (spec) => {
  const path = join(spec, 'plan.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

export function findSpecByBranch(root, branch) {
  return specsGlob(root).find((spec) => {
    const state = readState(spec);
    return state.branch === branch && state.flow !== 'closed';
  });
}

function listTickets(root) {
  const lines = specsGlob(root)
    .map((spec) => [spec, readState(spec)])
    .filter(([, state]) => state.flow !== 'closed')
    .map(
      ([spec, state]) =>
        `${ticketLabel(ticketOf(state))} ${state.branch} · ${flowLine(state, planTasks(readPlan(spec)))}`,
    );
  return lines.length ? lines.join('\n') : 'No ticket in progress';
}

const exists = (root, object) => {
  try {
    git(['cat-file', '-e', object], root);
    return true;
  } catch {
    return false;
  }
};

const tryGit = (args, root) => {
  try {
    return git(args, root);
  } catch {
    return null;
  }
};

const names = (root, from, to) =>
  from === to
    ? []
    : git(['diff', '--name-only', from, to], root).split('\n').filter(Boolean);

// Commits made on the ticket's branch since the base: merges and commits that
// came from the base branch (a merge or rebase of it) do not count.
function branchCommits(root, base, baseBranch) {
  const upstream = [`origin/${baseBranch}`, baseBranch].filter((ref) =>
    tryGit(['rev-parse', '--verify', '-q', `${ref}^{commit}`], root),
  );
  const args = ['rev-list', '--count', '--no-merges', `${base}..HEAD`];
  if (upstream.length) args.push('--not', ...upstream);
  return git(args, root) !== '0';
}

function readFacts(root, spec, state, planText) {
  const { tree } = snapshot(root);
  const boundaryTree = state.boundary?.tree;
  const relPlan = relative(root, join(spec, 'plan.md'));
  const config = loadConfig(root);
  const base =
    state.base &&
    tryGit(['rev-parse', '--verify', `${state.base}^{commit}`], root);
  return {
    currentBranch: tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], root),
    dirty: git(['status', '--porcelain'], root) !== '',
    treeEqualsBoundary: !boundaryTree || boundaryTree === tree,
    changedSinceBoundary: boundaryTree ? names(root, boundaryTree, tree) : [],
    changedSinceAwaiting: state.awaiting?.tree
      ? names(root, state.awaiting.tree, tree)
      : [],
    commitsAfterBase:
      Boolean(base) &&
      branchCommits(root, base, state.baseBranch ?? config.git.baseBranch),
    ledger: ledgerFor(root, relPlan),
    plan: planTasks(planText),
    exempt: exemptPatterns(config, state.branch),
  };
}

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === heading);
  if (start === -1) return null;
  // A header section ends at the next heading or the `---` before the tasks.
  const end = lines.findIndex(
    (line, i) => i > start && (/^#+\s/.test(line) || line === '---'),
  );
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function taskSection(text, n) {
  const lines = text.split('\n');
  let start = -1;
  walkPlan(text, (event) => {
    if (event.kind === 'task' && event.task.n === n && start === -1)
      start = event.index;
  });
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let fence = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^```/.test(lines[i])) fence = !fence;
    if (
      !fence &&
      /^#+\s/.test(lines[i]) &&
      lines[i].match(/^#+/)[0].length <= level
    ) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function briefTask(state, next) {
  const named = next.match(/Task (\d+)/);
  if (named) return Number(named[1]);
  return state.current?.task ?? null;
}

function statusOf(root, spec, state, { brief }) {
  const fallback = 'No saved status: use the Resume table';
  const objects = [
    state.boundary?.commit,
    state.awaiting?.tree,
    ...Object.values(state.tasks).map((t) => t.base),
  ];
  const missing = objects
    .filter(Boolean)
    .find((object) => !exists(root, object));
  if (missing)
    return { code: 3, text: `${fallback} (object ${missing} is missing)` };
  const planText = readPlan(spec);
  const facts = readFacts(root, spec, state, planText);
  const next = nextAction(state, {
    ...facts,
    ledgerComplete: facts.ledger.complete,
  });
  const lines = [
    `Ticket: ${ticketOf(state)} (${ticketLabel(ticketOf(state))})`,
    `Spec: ${relative(root, spec)}`,
    `Branch: ${state.branch}`,
    `Flow: ${flowLine(state, facts.plan)}`,
  ];
  if (state.boundary) {
    const changed = facts.changedSinceBoundary;
    lines.push(
      `Changed since ${state.boundary.label}: ${changed.length} files`,
    );
    changed.forEach((path) => lines.push(`  ${path}`));
  }
  if (state.awaiting) lines.push(`Waiting at: ${state.awaiting.gate}`);
  if (state.codeReview.done) {
    const open = state.codeReview.findings.filter((f) => f.status === 'open');
    lines.push(
      `Open findings: ${open.length ? open.map((f) => f.id).join(', ') : 'none'}`,
    );
  }
  lines.push(
    `Rounds: pre ${state.rounds.pre}/${ROUND_LIMIT}, post ${state.rounds.post}/${ROUND_LIMIT}`,
  );
  lines.push(`Next: ${next}`);
  const text = lines.join('\n');
  if (brief) {
    const parts = ['# Resume brief'];
    const constraints = section(planText, '## Global Constraints');
    const deviations = section(planText, '## Deviations');
    if (constraints) parts.push('', constraints);
    if (deviations) parts.push('', deviations);
    if (facts.ledger.rulings.length)
      parts.push('', '## Rulings', '', ...facts.ledger.rulings);
    const line = (f) =>
      `- ${f.id} ${f.status}: ${f.summary}${f.reason ? ` — ${f.reason}` : ''}`;
    const closed = state.codeReview.closed ?? [];
    if (closed.length || state.codeReview.findings.length) {
      parts.push('', '## Code review findings');
      if (closed.length)
        parts.push('', 'Earlier reviews:', ...closed.map(line));
      if (state.codeReview.findings.length) {
        parts.push(
          '',
          'Current review (`finding` acts on these ids):',
          ...state.codeReview.findings.map(line),
        );
      }
    }
    const n = briefTask(state, next);
    const task = n && taskSection(planText, n);
    if (task) parts.push('', task);
    parts.push('', '## Status', '', text);
    return { code: 0, text: parts.join('\n') };
  }
  return { code: 0, text };
}

function statusCommand(args) {
  const list = args.includes('--list');
  const brief = !args.includes('--no-brief');
  const specArg = args.find((arg) => !arg.startsWith('--'));
  if (specArg && !existsSync(specArg)) {
    console.log(
      `No saved status: use the Resume table (no spec dir ${specArg})`,
    );
    return 3;
  }
  const root = repoRoot(specArg ? resolve(specArg) : process.cwd());
  if (list) {
    console.log(listTickets(root));
    return 0;
  }
  let spec = specArg && realpathSync(resolve(specArg));
  if (!spec) {
    const branch = tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], root);
    spec = branch && findSpecByBranch(root, branch);
    if (!spec) {
      console.log(listTickets(root));
      return 0;
    }
  }
  const state = readState(spec);
  if (!state) {
    console.log('No saved status: use the Resume table');
    return 3;
  }
  const { code, text } = statusOf(root, spec, state, { brief });
  console.log(text);
  return code;
}

function usage(message) {
  if (message) console.error(`ticket-state: ${message}`);
  console.error(
    'usage: ticket-state.mjs <command> <spec dir> [args] (see the header)',
  );
  return 2;
}

const commands = {
  init(spec, [ticket, branch]) {
    if (!ticket || !branch) return usage('init needs <ticket> <branch>');
    if (readState(spec)) {
      console.log(`ticket-state: ${spec}/${STATE} already exists`);
      return 0;
    }
    writeState(spec, newState(ticket, branch, spec));
    return 0;
  },
  rename(spec, [newSpec, branch], state) {
    if (!newSpec || !branch) return usage('rename needs <new spec> <branch>');
    state.specDir = newSpec;
    state.branch = branch;
    writeState(spec, state);
    return 0;
  },
  flow(spec, [step], state) {
    if (!FLOW_STEPS.includes(step)) return usage(`unknown flow step: ${step}`);
    state.flow = step;
    writeState(spec, state);
    return 0;
  },
  base(spec, [commit, baseBranch], state, root) {
    if (!commit) return usage('base needs <commit> [<base branch>]');
    state.base = commit;
    state.baseBranch =
      baseBranch ?? state.baseBranch ?? loadConfig(root).git.baseBranch;
    writeState(spec, state);
    return 0;
  },
  at(spec, [taskArg, stepArg], state, root) {
    const task = Number(taskArg);
    const step = Number(stepArg);
    if (
      !Number.isInteger(task) ||
      !Number.isInteger(step) ||
      task < 1 ||
      step < 1
    ) {
      return usage('at needs <task> <step>, both positive integers');
    }
    const label =
      step > 1
        ? `after Task ${task} Step ${step - 1}`
        : `start of Task ${task}`;
    const { tree, commit } = setBoundary(root, state, label);
    const entry = state.tasks[task] ?? {
      status: 'pending',
      base: null,
      gap: null,
    };
    if (!entry.base) {
      entry.base = tree;
      saveRef(root, featureOf(state.branch), `task-${task}-base`, commit);
    }
    if (entry.status === 'pending') entry.status = 'in_progress';
    state.tasks[task] = entry;
    state.current = { task, step };
    const planPath = join(spec, 'plan.md');
    if (existsSync(planPath)) {
      writeFileSync(
        planPath,
        tickSteps(readFileSync(planPath, 'utf8'), task, step),
      );
    }
    writeState(spec, state);
    return 0;
  },
  boundary(spec, args, state, root) {
    setBoundary(root, state, 'after autofix');
    writeState(spec, state);
    return 0;
  },
  'tests-pass'(spec, [n], state) {
    return setTask(spec, state, n, { status: 'tests_pass' });
  },
  review(spec, [n, verdict, ...text], state) {
    if (verdict === 'pass')
      return setTask(spec, state, n, { status: 'review_pass', gap: null });
    if (verdict === 'gap' && text.length) {
      return setTask(spec, state, n, {
        status: 'review_gap',
        gap: text.join(' '),
      });
    }
    return usage('review needs <task> pass | <task> gap <text>');
  },
  'task-diff'(spec, [n], state, root) {
    if (!state.tasks[n]) return usage(`Task ${n} has not started`);
    const { diff, files } = taskDiff(root, spec, state, n);
    process.stdout.write(
      `## Plan files\n\n${files.join('\n')}\n\n## Task ${n} diff\n\n${diff}`,
    );
    return 0;
  },
  await(spec, [gate, payloadFile], state, root) {
    if (!gate) return usage('await needs <gate> (payload JSON on stdin)');
    const payload = readInput(payloadFile);
    const { tree, commit } = snapshot(root);
    saveRef(root, featureOf(state.branch), 'awaiting', commit);
    state.awaiting = { gate, payload, tree };
    writeState(spec, state);
    return 0;
  },
  answered(spec, args, state) {
    state.awaiting = null;
    writeState(spec, state);
    return 0;
  },
  findings(spec, args, state) {
    const uat = args.includes('--uat');
    const [file] = args.filter((arg) => arg !== '--uat');
    const input = readInput(file);
    const wrong = input.filter((f) => isUat(f) !== uat).map((f) => f.id);
    if (wrong.length) {
      return usage(
        uat
          ? `findings --uat needs UAT- ids: ${wrong.join(', ')}`
          : `findings without --uat takes no UAT- ids: ${wrong.join(', ')}`,
      );
    }
    const fresh = input.map(({ id, summary }) => ({
      id,
      summary,
      status: 'open',
      reason: null,
    }));
    // Each kind replaces only its own open findings; the other kind stays.
    const own = (f) => isUat(f) === uat;
    const kept = state.codeReview.findings.filter((f) => !own(f));
    const replaced = state.codeReview.findings.filter(own);
    const closed = [
      ...(state.codeReview.closed ?? []),
      ...replaced.filter((f) => f.status !== 'open'),
    ];
    state.codeReview = {
      done: uat ? state.codeReview.done : true,
      findings: [...kept, ...fresh],
      closed,
    };
    writeState(spec, state);
    return 0;
  },
  finding(spec, [verdict, id, ...reason], state) {
    const finding = state.codeReview.findings.find((f) => String(f.id) === id);
    if (!['fixed', 'left'].includes(verdict) || !finding) {
      return usage('finding needs fixed <id> | left <id> <reason>');
    }
    finding.status = verdict;
    finding.reason = reason.length ? reason.join(' ') : null;
    writeState(spec, state);
    return 0;
  },
  round(spec, [when], state) {
    if (!['pre', 'post'].includes(when)) return usage('round needs pre | post');
    state.rounds[when] += 1;
    writeState(spec, state);
    return 0;
  },
  close(spec, args, state, root) {
    const prefix = `refs/work-ticket/${featureOf(state.branch)}/`;
    git(['for-each-ref', '--format=%(refname)', prefix], root)
      .split('\n')
      .filter(Boolean)
      .forEach((ref) => git(['update-ref', '-d', ref], root));
    state.flow = 'closed';
    writeState(spec, state);
    return 0;
  },
};

function setTask(spec, state, n, fields) {
  if (!state.tasks[n]) return usage(`Task ${n} has not started`);
  Object.assign(state.tasks[n], fields);
  writeState(spec, state);
  return 0;
}

export function main(argv) {
  const [name, specArg, ...args] = argv;
  if (name === 'status') return statusCommand(argv.slice(1));
  const command = commands[name];
  if (!command) return usage(name ? `unknown command: ${name}` : undefined);
  if (!specArg) return usage(`${name} needs <spec dir>`);
  const spec = existsSync(specArg)
    ? realpathSync(resolve(specArg))
    : resolve(specArg);
  if (name === 'init') return command(specArg, args);
  const state = readState(spec);
  if (!state) {
    console.error(`ticket-state: no ${STATE} in ${specArg}; nothing recorded`);
    return 0;
  }
  return command(spec, args, state, repoRoot(spec));
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

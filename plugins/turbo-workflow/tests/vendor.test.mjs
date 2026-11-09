// Copy mode: vendor.mjs copies the workflow into a project's .claude/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  PLUGIN_DIR,
  SOURCE,
  copyList,
  forPlugin,
  leftovers,
  planCopy,
  rewrite,
  writeCopy,
} from '../scripts/vendor.mjs';
import { gitProject, trelloConfig, validConfig } from './helpers.mjs';

const LOCK = join('.claude', 'turbo-workflow.lock');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function tree(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort()
    .map((path) => [path, readFileSync(join(dir, path), 'utf8')]);
}

test('copies the file list', () => {
  const none = copyList(validConfig()).map((entry) => entry.to);
  for (const path of [
    '.claude/rules/workflow.md',
    '.claude/skills/work-ticket/SKILL.md',
    '.claude/skills/ticket-status/SKILL.md',
    '.claude/skills/pr-description/SKILL.md',
    '.claude/skills/ui-screenshot/SKILL.md',
    '.claude/skills/turbo-workflow-sync/SKILL.md',
    '.claude/agents/plan-reviewer.md',
    '.claude/agents/pr-writer.md',
    '.claude/agents/ui-screenshotter.md',
    '.claude/scripts/config.mjs',
    '.claude/scripts/changed-apps.mjs',
    '.claude/scripts/coverage-diff.mjs',
    '.claude/scripts/ticket-state.mjs',
    '.claude/templates/test-report.md',
    '.claude/templates/pr-description.md',
    '.claude/trackers/none/adapter.md',
    '.claude/hooks/block-forbidden-command.mjs',
    '.claude/hooks/notify-on-finish.mjs',
  ]) {
    assert.ok(none.includes(path), path);
  }
  assert.ok(!none.includes('.claude/agents/trello-manager.md'));
  assert.ok(!none.some((path) => path.includes('init')));
  const trello = copyList(trelloConfig()).map((entry) => entry.to);
  assert.ok(trello.includes('.claude/agents/trello-manager.md'));
  assert.ok(trello.includes('.claude/trackers/trello/adapter.md'));
  assert.ok(!trello.includes('.claude/trackers/none/adapter.md'));
});

test('rewrites every plugin reference', () => {
  const cases = [
    [
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get x',
      'node "$(git rev-parse --show-toplevel)/.claude/scripts/config.mjs" get x',
    ],
    [
      'node "<plugin>/scripts/coverage-diff.mjs" diff',
      'node "$(git rev-parse --show-toplevel)/.claude/scripts/coverage-diff.mjs" diff',
    ],
    [
      '`${CLAUDE_PLUGIN_ROOT}/templates/pr-description.md`',
      '`.claude/templates/pr-description.md`',
    ],
    ['<plugin>/templates/test-report.md', '.claude/templates/test-report.md'],
    [
      '`${CLAUDE_PLUGIN_ROOT}/trackers/<tracker.type>/adapter.md`',
      '`.claude/trackers/<tracker.type>/adapter.md`',
    ],
    ['`${CLAUDE_SKILL_DIR}/workflow.md`', '`.claude/rules/workflow.md`'],
    [
      '`${CLAUDE_PLUGIN_ROOT}/skills/work-ticket/workflow.md`',
      '`.claude/rules/workflow.md`',
    ],
    [
      '(<plugin>/skills/work-ticket/workflow.md rule 0)',
      '(.claude/rules/workflow.md rule 0)',
    ],
    [
      '`${CLAUDE_PLUGIN_ROOT}/skills/ui-screenshot/SKILL.md`',
      '`.claude/skills/ui-screenshot/SKILL.md`',
    ],
    ['/turbo-workflow:work-ticket <ticket>', '/work-ticket <ticket>'],
    ['`/turbo-workflow:ticket-status`', '`/ticket-status`'],
    ['the `turbo-workflow:pr-writer` subagent', 'the `pr-writer` subagent'],
    [
      'mcp__plugin_turbo-workflow_playwright-screenshot__browser_navigate',
      'mcp__playwright-screenshot__browser_navigate',
    ],
    ['run /turbo-workflow:init', 'run /turbo-workflow:init'],
    [
      'a\n<!-- plugin-only -->\n- `<plugin>` is the plugin dir\n<!-- /plugin-only -->\nb\n',
      'a\nb\n',
    ],
    ['x<!-- plugin-only --> (`<plugin>`)<!-- /plugin-only -->; y', 'x; y'],
    [
      'a\n<!-- copy-only:\n- Scripts are in `.claude/scripts/`.\n-->\nb\n',
      'a\n- Scripts are in `.claude/scripts/`.\nb\n',
    ],
    ['x<!-- copy-only: (loaded automatically) --> y', 'x(loaded automatically) y'],
  ];
  for (const [input, output] of cases) assert.equal(rewrite(input), output, input);
});

test('fails on a leftover', () => {
  for (const { from } of copyList(trelloConfig())) {
    const text = readFileSync(join(PLUGIN_DIR, from), 'utf8');
    assert.deepEqual(leftovers(rewrite(text)), [], from);
  }
  const plugin = join(realpathSync(mkdtempSync(join(tmpdir(), 'tw-src-'))), 'p');
  cpSync(PLUGIN_DIR, plugin, { recursive: true });
  appendFileSync(
    join(plugin, 'skills', 'ticket-status', 'SKILL.md'),
    '\nSee `${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs`.\n',
  );
  const root = gitProject();
  assert.throws(
    () => writeCopy(root, validConfig(), { pluginDir: plugin }),
    /skills\/ticket-status\/SKILL\.md/,
  );
  assert.ok(!existsSync(join(root, '.claude', 'skills')));
  assert.ok(!existsSync(join(root, LOCK)));
});

test('copied scripts run', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const status = spawnSync(
    'node',
    [join('.claude', 'scripts', 'ticket-state.mjs'), 'status'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.match(status.stdout, /No ticket in progress/, status.stderr);
  const apps = spawnSync(
    'node',
    [
      join('.claude', 'scripts', 'changed-apps.mjs'),
      '--files',
      'apps/web/src/a.ts',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(apps.stdout).apps, ['web'], apps.stderr);
});

test('write is idempotent', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const first = tree(join(root, '.claude'));
  writeCopy(root, validConfig());
  assert.deepEqual(tree(join(root, '.claude')), first);
});

test('writes the lock', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const lock = JSON.parse(readFileSync(join(root, LOCK), 'utf8'));
  const { version } = JSON.parse(
    readFileSync(join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  assert.equal(lock.source, SOURCE);
  assert.equal(SOURCE, 'https://github.com/Tiennd0502/claude-turbo-workflow');
  assert.equal(lock.version, version);
  assert.equal(lock.mode, 'copy');
  assert.equal(lock.tracker, 'none');
  const targets = copyList(validConfig()).map((entry) => entry.to).sort();
  assert.deepEqual(Object.keys(lock.files).sort(), targets);
  for (const [path, hash] of Object.entries(lock.files)) {
    assert.equal(hash, sha(readFileSync(join(root, path))), path);
  }
});

test('merges settings and mcp', () => {
  const root = gitProject();
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      permissions: { allow: ['Bash(pnpm test:*)'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/db-guard.mjs"',
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-on-finish.mjs"',
                timeout: 5,
              },
            ],
          },
        ],
      },
    }),
  );
  writeFileSync(
    join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
  );
  writeCopy(root, validConfig());
  writeCopy(root, validConfig());
  const settings = JSON.parse(
    readFileSync(join(root, '.claude', 'settings.json'), 'utf8'),
  );
  const commandsOf = (event) =>
    (settings.hooks[event] ?? []).flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
  assert.deepEqual(settings.permissions, { allow: ['Bash(pnpm test:*)'] });
  assert.equal(settings.hooks.SessionStart, undefined);
  const pre = commandsOf('PreToolUse');
  assert.equal(pre.filter((c) => c.includes('db-guard.mjs')).length, 1);
  assert.equal(
    pre.filter((c) =>
      c === 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-forbidden-command.mjs"',
    ).length,
    1,
  );
  for (const event of ['UserPromptSubmit', 'Stop', 'Notification']) {
    assert.deepEqual(commandsOf(event), [
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-on-finish.mjs"',
    ]);
  }
  assert.equal(settings.enabledPlugins['superpowers@claude-plugins-official'], true);
  assert.equal(settings.enabledPlugins['turbo-workflow@claude-turbo-workflow'], false);
  const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.other, { command: 'x' });
  assert.deepEqual(
    mcp.mcpServers['playwright-screenshot'],
    JSON.parse(readFileSync(join(PLUGIN_DIR, '.mcp.json'), 'utf8')).mcpServers[
      'playwright-screenshot'
    ],
  );
  assert.ok(!JSON.stringify(settings).includes('CLAUDE_PLUGIN_ROOT'));
});

test('a settings.json that is not JSON stops the write', () => {
  const root = gitProject();
  writeFileSync(join(root, '.claude', 'settings.json'), '{ not json');
  assert.throws(() => writeCopy(root, validConfig()), /settings\.json: not valid JSON/);
  assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), '{ not json');
  assert.ok(!existsSync(join(root, '.claude', 'skills')));
});

// A temp copy of the plugin, so a test can change a source.
function pluginCopy() {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'tw-src-'))), 'p');
  cpSync(PLUGIN_DIR, dir, { recursive: true });
  return dir;
}

// Trello copy written, then: a source changed, a copied file edited, one
// deleted, and the tracker switched to none.
function driftedProject() {
  const pluginDir = pluginCopy();
  const root = gitProject(trelloConfig());
  writeCopy(root, trelloConfig(), { pluginDir });
  appendFileSync(join(pluginDir, 'templates', 'test-report.md'), '\nNew line.\n');
  appendFileSync(join(root, '.claude', 'skills', 'work-ticket', 'SKILL.md'), '\nMine.\n');
  rmSync(join(root, '.claude', 'agents', 'pr-writer.md'));
  return { root, pluginDir };
}

const SKILL = '.claude/skills/work-ticket/SKILL.md';
const lockOf = (root) => JSON.parse(readFileSync(join(root, LOCK), 'utf8'));

test('plan reports same, update, edited, new, dropped', () => {
  const { root, pluginDir } = driftedProject();
  const status = Object.fromEntries(
    planCopy(root, validConfig(), { pluginDir }).map((f) => [f.path, f.status]),
  );
  assert.equal(status['.claude/templates/test-report.md'], 'update');
  assert.equal(status[SKILL], 'edited');
  assert.equal(status['.claude/agents/pr-writer.md'], 'new');
  assert.equal(status['.claude/trackers/none/adapter.md'], 'new');
  assert.equal(status['.claude/agents/trello-manager.md'], 'dropped');
  assert.equal(status['.claude/trackers/trello/adapter.md'], 'dropped');
  assert.equal(status['.claude/scripts/config.mjs'], 'same');
});

test('write keeps and removes', () => {
  const { root, pluginDir } = driftedProject();
  const before = lockOf(root);
  const mine = readFileSync(join(root, SKILL), 'utf8');
  assert.throws(
    () => writeCopy(root, validConfig(), { pluginDir }),
    /edited.*work-ticket\/SKILL\.md/s,
  );
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), mine);
  writeCopy(root, validConfig(), {
    pluginDir,
    keep: [SKILL],
    remove: ['.claude/agents/trello-manager.md'],
  });
  const after = lockOf(root);
  assert.equal(readFileSync(join(root, SKILL), 'utf8'), mine);
  assert.equal(after.files[SKILL], before.files[SKILL]);
  assert.ok(!existsSync(join(root, '.claude', 'agents', 'trello-manager.md')));
  assert.equal(after.files['.claude/agents/trello-manager.md'], undefined);
  assert.ok(existsSync(join(root, '.claude', 'trackers', 'trello', 'adapter.md')));
  assert.ok(after.files['.claude/trackers/trello/adapter.md']);
  assert.match(
    readFileSync(join(root, '.claude', 'templates', 'test-report.md'), 'utf8'),
    /New line\./,
  );
  assert.ok(existsSync(join(root, '.claude', 'agents', 'pr-writer.md')));
  assert.equal(after.tracker, 'none');
  writeCopy(root, validConfig(), { pluginDir, take: [SKILL] });
  const status = Object.fromEntries(
    planCopy(root, validConfig(), { pluginDir }).map((f) => [f.path, f.status]),
  );
  assert.equal(status[SKILL], 'same');
});

test('show prints the new content of one copied file', () => {
  const root = gitProject();
  const out = spawnSync(
    'node',
    [join(PLUGIN_DIR, 'scripts', 'vendor.mjs'), 'show', root, '.claude/rules/workflow.md'],
    { encoding: 'utf8' },
  );
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout,
    rewrite(readFileSync(join(PLUGIN_DIR, 'skills', 'work-ticket', 'workflow.md'), 'utf8')),
  );
  const missing = spawnSync(
    'node',
    [join(PLUGIN_DIR, 'scripts', 'vendor.mjs'), 'show', root, '.claude/nope.md'],
    { encoding: 'utf8' },
  );
  assert.equal(missing.status, 1);
});

test('forPlugin drops copy-only blocks and keeps plugin-only text', () => {
  assert.equal(
    forPlugin('a\n<!-- copy-only:\n- copied\n-->\nb<!-- plugin-only --> (p)<!-- /plugin-only -->\n<!-- copy-only: x -->c\n'),
    'a\nb (p)\nc\n',
  );
});

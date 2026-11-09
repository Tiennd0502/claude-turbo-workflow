// Copy mode: vendor.mjs copies the workflow into a project's .claude/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
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
  SNIPPETS,
  SOURCE,
  copyList,
  forPlugin,
  leftovers,
  planCopy,
  removeCopy,
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
      'node "<repo root>/.claude/scripts/config.mjs" get x',
    ],
    [
      'node "<plugin>/scripts/coverage-diff.mjs" diff',
      'node "<repo root>/.claude/scripts/coverage-diff.mjs" diff',
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
    ['a\n<!-- copy: notation -->\nb\n', `a\n${SNIPPETS.notation}b\n`],
    ['x<!-- copy: rules-autoload --> y', `x${SNIPPETS['rules-autoload']} y`],
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
    forPlugin('a\n<!-- copy: notation -->\nb<!-- plugin-only --> (p)<!-- /plugin-only -->\n<!-- copy: rules-autoload -->c\n'),
    'a\nb (p)\nc\n',
  );
});

test('the copy-only text is not in the plugin sources', () => {
  for (const { from } of copyList(trelloConfig())) {
    const text = readFileSync(join(PLUGIN_DIR, from), 'utf8');
    assert.doesNotMatch(text, /\.claude\/scripts\//, from);
  }
  for (const text of Object.values(SNIPPETS)) {
    assert.match(text, /\S/);
    assert.deepEqual(leftovers(text), []);
  }
  assert.match(SNIPPETS.notation, /claude plugin enable turbo-workflow@claude-turbo-workflow --scope local/);
  assert.doesNotMatch(SNIPPETS.notation, /\$\(/);
});

test('no command substitution in the copy', () => {
  for (const { from } of copyList(trelloConfig())) {
    const text = rewrite(readFileSync(join(PLUGIN_DIR, from), 'utf8'));
    assert.doesNotMatch(text, /\$\(git rev-parse/, from);
  }
});

test('a file the copy did not write is unmanaged', () => {
  const root = gitProject();
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 'plan-reviewer.md'), 'my own agent\n');
  const status = Object.fromEntries(
    planCopy(root, validConfig()).map((f) => [f.path, f.status]),
  );
  assert.equal(status['.claude/agents/plan-reviewer.md'], 'unmanaged');
  assert.throws(() => writeCopy(root, validConfig()), /plan-reviewer\.md/);
  writeCopy(root, validConfig(), { keep: ['.claude/agents/plan-reviewer.md'] });
  assert.equal(
    readFileSync(join(root, '.claude', 'agents', 'plan-reviewer.md'), 'utf8'),
    'my own agent\n',
  );
});

test('a dropped file that was edited is flagged', () => {
  const { root, pluginDir } = driftedProject();
  appendFileSync(join(root, '.claude', 'agents', 'trello-manager.md'), '\nMine too.\n');
  const files = planCopy(root, validConfig(), { pluginDir });
  const manager = files.find((f) => f.path === '.claude/agents/trello-manager.md');
  assert.equal(manager.status, 'dropped');
  assert.equal(manager.edited, true);
  const adapter = files.find((f) => f.path === '.claude/trackers/trello/adapter.md');
  assert.equal(adapter.edited, false);
});

test('line endings changed by git do not count as edits', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const path = join(root, '.claude', 'rules', 'workflow.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  const status = Object.fromEntries(
    planCopy(root, validConfig()).map((f) => [f.path, f.status]),
  );
  assert.equal(status['.claude/rules/workflow.md'], 'same');
});

test('a bad plugin.json stops the write before any file', () => {
  const pluginDir = pluginCopy();
  writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{');
  const root = gitProject();
  assert.throws(() => writeCopy(root, validConfig(), { pluginDir }));
  assert.ok(!existsSync(join(root, '.claude', 'rules')));
});

test('remove undoes the copy', () => {
  const root = gitProject();
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { allow: ['x'] } }),
  );
  writeCopy(root, validConfig());
  appendFileSync(join(root, SKILL), '\nMine.\n');
  const result = removeCopy(root);
  assert.deepEqual(result.kept, [SKILL]);
  assert.ok(existsSync(join(root, SKILL)));
  assert.ok(!existsSync(join(root, '.claude', 'rules', 'workflow.md')));
  assert.ok(!existsSync(join(root, LOCK)));
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['x'] });
  assert.ok(!JSON.stringify(settings.hooks ?? {}).includes('.claude/hooks/'));
  assert.equal(settings.enabledPlugins?.['turbo-workflow@claude-turbo-workflow'], undefined);
  assert.throws(() => removeCopy(root), /missing/);
});

test('remove deletes an edited file only when named, and rejects unknown paths', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  appendFileSync(join(root, SKILL), '\nMine.\n');
  assert.throws(() => removeCopy(root, { remove: ['.claude/nope.md'] }), /not in the lock/);
  assert.ok(existsSync(join(root, LOCK)));
  removeCopy(root, { remove: [SKILL] });
  assert.ok(!existsSync(join(root, SKILL)));
});

test('remove takes out an older copied screenshot server, and only the copy plugin key', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const mcpPath = join(root, '.mcp.json');
  const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
  mcp.mcpServers['playwright-screenshot'].args[1] = '@playwright/mcp@0.0.1';
  writeFileSync(mcpPath, JSON.stringify(mcp));
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.enabledPlugins['turbo-workflow@claude-turbo-workflow'] = true;
  writeFileSync(settingsPath, JSON.stringify(settings));
  removeCopy(root);
  assert.ok(!existsSync(mcpPath)); // its only server was the copy's, so the file goes
  assert.equal(
    JSON.parse(readFileSync(settingsPath, 'utf8')).enabledPlugins['turbo-workflow@claude-turbo-workflow'],
    true,
  );
});

test('CRLF plugin sources give the same copy', () => {
  const pluginDir = pluginCopy();
  const root = gitProject();
  writeCopy(root, validConfig());
  for (const { from } of copyList(validConfig())) {
    const path = join(pluginDir, from);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  }
  const statuses = planCopy(root, validConfig(), { pluginDir }).map((f) => f.status);
  assert.deepEqual([...new Set(statuses)], ['same']);
});

test('the old copy-only marker is a leftover', () => {
  assert.deepEqual(leftovers('<!-- copy-only: x -->'), ['copy-only']);
});

test('a dropped lock path that is not a file is skipped', () => {
  const root = gitProject(trelloConfig());
  writeCopy(root, trelloConfig());
  const agent = join(root, '.claude', 'agents', 'trello-manager.md');
  rmSync(agent);
  mkdirSync(agent);
  const files = planCopy(root, validConfig());
  assert.ok(!files.some((f) => f.path === '.claude/agents/trello-manager.md'));
});

test('remove dry run lists what it would do and changes nothing', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  appendFileSync(join(root, SKILL), '\nMine.\n');
  const before = tree(join(root, '.claude'));
  const result = removeCopy(root, { dryRun: true });
  assert.deepEqual(result.kept, [SKILL]);
  assert.ok(result.removed.includes('.claude/rules/workflow.md'));
  assert.deepEqual(tree(join(root, '.claude')), before);
});

test('a lock without files is not a copy', () => {
  const root = gitProject();
  writeFileSync(join(root, LOCK), '{}');
  assert.throws(() => removeCopy(root), /not a copy/);
});

test('remove deletes an .mcp.json it leaves empty', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  removeCopy(root);
  assert.ok(!existsSync(join(root, '.mcp.json')));
  const other = gitProject();
  writeFileSync(join(other, '.mcp.json'), JSON.stringify({ mcpServers: { x: { command: 'x' } } }));
  writeCopy(other, validConfig());
  removeCopy(other);
  assert.deepEqual(JSON.parse(readFileSync(join(other, '.mcp.json'), 'utf8')), {
    mcpServers: { x: { command: 'x' } },
  });
});

test('lock paths outside .claude/ are refused', () => {
  const root = gitProject();
  writeCopy(root, validConfig());
  const lock = lockOf(root);
  for (const bad of ['../outside.txt', '.claude/../package.json', '/etc/hosts', 'README.md']) {
    writeFileSync(join(root, LOCK), JSON.stringify({ ...lock, files: { ...lock.files, [bad]: 'x' } }));
    assert.throws(() => removeCopy(root, { remove: [bad] }), /invalid path/, bad);
    assert.throws(() => planCopy(root, validConfig()), /invalid path/, bad);
  }
  writeFileSync(join(root, LOCK), JSON.stringify({ ...lock, files: ['abc'] }));
  assert.throws(() => removeCopy(root), /not a copy/);
});

test('flags that do not apply to the command are errors', () => {
  const root = gitProject();
  const run = (...args) =>
    spawnSync('node', [join(PLUGIN_DIR, 'scripts', 'vendor.mjs'), ...args], {
      encoding: 'utf8',
    });
  const write = run('write', root, '--dry-run');
  assert.equal(write.status, 1);
  assert.match(write.stderr, /--dry-run.*remove/);
  assert.ok(!existsSync(join(root, '.claude', 'rules')));
  writeCopy(root, validConfig());
  const remove = run('remove', root, '--keep', '.claude/rules/workflow.md');
  assert.equal(remove.status, 1);
  assert.ok(existsSync(join(root, LOCK)));
});

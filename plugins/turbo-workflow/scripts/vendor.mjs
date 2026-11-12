#!/usr/bin/env node
// Copy mode: copy the workflow into a project's .claude/ so it runs without
// the plugin (same names as before the plugin: /work-ticket, plan-reviewer…).
//
//   node <plugin>/scripts/vendor.mjs plan  <root> [--config <file>]
//   node <plugin>/scripts/vendor.mjs show  <root> <path> [--config <file>]
//   node <plugin>/scripts/vendor.mjs remove <root> [--remove <path>]… [--dry-run]
//   node <plugin>/scripts/vendor.mjs write <root> [--config <file>]
//                                        [--keep <path>]… [--take <path>]…
//                                        [--remove <path>]…
//
// `plan` prints JSON [{ path, status }]; `write` writes the files, merges the
// hooks into .claude/settings.json and the MCP server into .mcp.json, and
// writes .claude/turbo-workflow.lock. --config defaults to
// <root>/.claude/workflow.json. Nothing is written when any copied file still
// names the plugin (`leftovers`).

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { isEntry } from './config.mjs';

export const PLUGIN_DIR = join(import.meta.dirname, '..');
export const SOURCE = 'https://github.com/Tiennd0502/claude-turbo-workflow';
export const LOCK = '.claude/turbo-workflow.lock';

const SKILLS = ['work-ticket', 'ticket-status', 'pr-description', 'ui-screenshot', 'uat'];
const AGENTS = ['plan-reviewer', 'pr-writer', 'ui-screenshotter', 'uat-tester'];
const SCRIPTS = ['config', 'changed-apps', 'coverage-diff', 'ticket-state'];
const TEMPLATES = ['test-report', 'pr-description'];
export const HOOKS = ['block-forbidden-command', 'notify-on-finish'];

// Plugin file → project file, for one config (design D1).
export function copyList(config) {
  const tracker = config.tracker.type;
  const agents = tracker === 'trello' ? [...AGENTS, 'trello-manager'] : AGENTS;
  return [
    { from: 'skills/work-ticket/workflow.md', to: '.claude/rules/workflow.md' },
    ...SKILLS.map((name) => ({
      from: `skills/${name}/SKILL.md`,
      to: `.claude/skills/${name}/SKILL.md`,
    })),
    {
      from: 'copy/skills/turbo-workflow-sync/SKILL.md',
      to: '.claude/skills/turbo-workflow-sync/SKILL.md',
    },
    ...agents.map((name) => ({
      from: `agents/${name}.md`,
      to: `.claude/agents/${name}.md`,
    })),
    ...SCRIPTS.map((name) => ({
      from: `scripts/${name}.mjs`,
      to: `.claude/scripts/${name}.mjs`,
    })),
    ...TEMPLATES.map((name) => ({
      from: `templates/${name}.md`,
      to: `.claude/templates/${name}.md`,
    })),
    {
      from: `trackers/${tracker}/adapter.md`,
      to: `.claude/trackers/${tracker}/adapter.md`,
    },
    ...HOOKS.map((name) => ({
      from: `hooks/${name}.mjs`,
      to: `.claude/hooks/${name}.mjs`,
    })),
  ];
}

const NAMES =
  'work-ticket|ticket-status|pr-description|ui-screenshot|plan-reviewer|pr-writer|trello-manager|ui-screenshotter|uat-tester|uat';
const ROOT = '(?:\\$\\{CLAUDE_PLUGIN_ROOT\\}|<plugin>)/';

// Text only the copy has. The sources hold just `<!-- copy: <name> -->`, so a
// session reading them in plugin mode never sees copy-mode instructions.
export const SNIPPETS = {
  notation:
    "- `<repo root>` is the project's absolute path (the session's working directory; `git rev-parse --show-toplevel` prints it): write it out in each command, never as a command substitution, which makes Claude Code ask for permission on every call. The workflow's scripts are `node \"<repo root>/.claude/scripts/<name>.mjs\"`, so they work from any dir.\n" +
    '- This workflow is copied into `.claude/` (see `.claude/turbo-workflow.lock`) and `/turbo-workflow-sync` updates it. `/turbo-workflow:init` is the plugin\'s setup command, and the plugin is off in this project: run `claude plugin enable turbo-workflow@claude-turbo-workflow --scope local` before it and `claude plugin disable turbo-workflow@claude-turbo-workflow --scope local` after.\n',
  'rules-autoload': ', loaded automatically',
  'claude-md':
    '- The workflow is copied into `.claude/` (see `.claude/turbo-workflow.lock`): update it with `/turbo-workflow-sync`. `/turbo-workflow:init` needs the plugin enabled for this project first: `claude plugin enable turbo-workflow@claude-turbo-workflow --scope local`.\n',
};

const snippet = (_, name, newline) => {
  if (!Object.hasOwn(SNIPPETS, name)) throw new Error(`unknown copy snippet: ${name}`);
  const text = SNIPPETS[name];
  return text.endsWith('\n') ? text : text + newline;
};

// Design D2, most specific first.
const TABLE = [
  [/<!-- plugin-only -->\n[\s\S]*?\n<!-- \/plugin-only -->\n/g, ''],
  [/<!-- plugin-only -->[\s\S]*?<!-- \/plugin-only -->/g, ''],
  [/<!-- copy: ([\w-]+) -->(\n?)/g, snippet],
  [new RegExp(`${ROOT}skills/work-ticket/workflow\\.md`, 'g'), '.claude/rules/workflow.md'],
  [/\$\{CLAUDE_SKILL_DIR\}\/workflow\.md/g, '.claude/rules/workflow.md'],
  // Commands may run from an app's dir and in subagents, so a script path is
  // absolute: `<repo root>` is written out, never `$(...)` (SNIPPETS.notation).
  [new RegExp(`${ROOT}scripts/`, 'g'), '<repo root>/.claude/scripts/'],
  [new RegExp(`${ROOT}(templates|trackers|skills|agents)/`, 'g'), '.claude/$1/'],
  [new RegExp(`/turbo-workflow:(${NAMES})\\b`, 'g'), '/$1'],
  [new RegExp(`\\bturbo-workflow:(${NAMES})\\b`, 'g'), '$1'],
  [/mcp__plugin_turbo-workflow_playwright-screenshot__/g, 'mcp__playwright-screenshot__'],
];

export function rewrite(text) {
  return TABLE.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

// The same template text for plugin mode: copy markers dropped, the
// plugin-only markers removed (their text kept).
export function forPlugin(text) {
  return text
    .replace(/^<!-- copy: [\w-]+ -->\n/gm, '')
    .replace(/<!-- copy: [\w-]+ -->/g, '')
    .replace(/^<!-- \/?plugin-only -->\n/gm, '')
    .replace(/<!-- \/?plugin-only -->/g, '');
}

const LEFTOVER = new RegExp(
  `\\$\\{CLAUDE_PLUGIN_ROOT\\}|\\$\\{CLAUDE_SKILL_DIR\\}|<plugin>|mcp__plugin_turbo-workflow|turbo-workflow:(?:${NAMES})\\b|plugin-only|copy-only|<!-- copy:`,
  'g',
);

// The plugin references a copied text still has (design anti-goal 1).
export function leftovers(text) {
  return [...new Set(text.match(LEFTOVER) ?? [])];
}

const sha = (text) => createHash('sha256').update(text).digest('hex');
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
// Git may check text files out with CRLF; compare and hash with LF.
const lf = (text) => text.replace(/\r\n/g, '\n');

// A lock is a committed project file, so its paths are checked before any
// is read or deleted: relative, under .claude/, no `..`.
const SAFE_PATH = /^\.claude\/(?:[\w.-]+\/)*[\w.-]+$/;
function lockFiles(lock) {
  const files = lock?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  for (const path of Object.keys(files)) {
    if (!SAFE_PATH.test(path) || path.split('/').includes('..')) {
      throw new Error(`${LOCK}: invalid path in the lock: ${path}`);
    }
  }
  return files;
}

function readLock(root) {
  try {
    return JSON.parse(readFileSync(join(root, LOCK), 'utf8'));
  } catch {
    return null;
  }
}

// Every copied file with its new content and its status against the project
// and the lock: `same` (already the new content), `update` (untouched since
// the last copy), `edited` (changed by the user since the last copy),
// `unmanaged` (a project file the copy never wrote, at the same path), `new`
// (no file), and `dropped` (in the lock, no longer copied; content null;
// `edited` tells whether the user changed it).
export function planCopy(root, config, { pluginDir = PLUGIN_DIR } = {}) {
  const locked = lockFiles(readLock(root)) ?? {};
  const bad = [];
  const files = copyList(config).map(({ from, to }) => {
    const content = rewrite(lf(readFileSync(join(pluginDir, from), 'utf8')));
    const left = leftovers(content);
    if (left.length) bad.push(`${from}: ${left.join(', ')}`);
    const target = join(root, to);
    const current = existsSync(target) ? lf(readFileSync(target, 'utf8')) : null;
    let status = 'edited';
    if (current === null) status = 'new';
    else if (current === content) status = 'same';
    else if (!locked[to]) status = 'unmanaged';
    else if (locked[to] === sha(current)) status = 'update';
    return { path: to, status, content };
  });
  if (bad.length) {
    throw new Error(`plugin references left in the copy:\n${bad.join('\n')}`);
  }
  const listed = new Set(files.map((file) => file.path));
  const dropped = Object.keys(locked)
    .filter((path) => !listed.has(path) && isFile(join(root, path)))
    .map((path) => ({
      path,
      status: 'dropped',
      content: null,
      edited: locked[path] !== sha(lf(readFileSync(join(root, path), 'utf8'))),
    }));
  return [...files, ...dropped];
}

// null when the file is missing; a file that is not JSON is an error, so a
// merge never replaces what the project wrote.
const readJson = (path) => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
};

const hookCommand = (name) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.mjs"`;
const isOurHook = (command = '') =>
  HOOKS.some((name) => command.includes(`.claude/hooks/${name}.mjs`));

// .claude/settings.json: the plugin's hooks (not SessionStart: the rules load
// from .claude/rules/) pointed at the copied files, superpowers on, the
// plugin off in this project. Other keys and the project's own hooks stay.
export function mergeSettings(existing, { pluginDir = PLUGIN_DIR } = {}) {
  const plugin = readJson(join(pluginDir, 'hooks', 'hooks.json')).hooks;
  const settings = structuredClone(existing ?? {});
  settings.hooks ??= {};
  for (const [event, groups] of Object.entries(plugin)) {
    if (event === 'SessionStart') continue;
    const kept = (settings.hooks[event] ?? [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => !isOurHook(hook.command)),
      }))
      .filter((group) => group.hooks.length);
    const ours = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((hook) => ({
        ...hook,
        command: hookCommand(hook.command.match(/hooks\/([\w-]+)\.mjs/)[1]),
      })),
    }));
    settings.hooks[event] = [...kept, ...ours];
  }
  settings.enabledPlugins = {
    ...settings.enabledPlugins,
    'superpowers@claude-plugins-official': true,
    'turbo-workflow@claude-turbo-workflow': false,
  };
  return settings;
}

// .mcp.json: the plugin's screenshot server; other servers stay.
export function mergeMcp(existing, { pluginDir = PLUGIN_DIR } = {}) {
  const plugin = readJson(join(pluginDir, '.mcp.json')).mcpServers;
  const mcp = structuredClone(existing ?? {});
  mcp.mcpServers = { ...mcp.mcpServers, ...plugin };
  return mcp;
}

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function pluginVersion(pluginDir) {
  return JSON.parse(
    readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
  ).version;
}

// `keep`: edited, unmanaged or dropped files to leave as they are; `take`:
// edited or unmanaged files to replace with the new version; `remove`:
// dropped files to delete. An edited or unmanaged file in neither `keep` nor
// `take` stops the write. Everything that can fail (sources, JSON, the
// version) is read before the first write.
export function writeCopy(
  root,
  config,
  { pluginDir = PLUGIN_DIR, keep = [], take = [], remove = [] } = {},
) {
  const files = planCopy(root, config, { pluginDir });
  const open = files.filter(
    (f) =>
      ['edited', 'unmanaged'].includes(f.status) &&
      !keep.includes(f.path) &&
      !take.includes(f.path),
  );
  if (open.length) {
    throw new Error(
      `edited or unmanaged files need --keep or --take: ${open.map((f) => f.path).join(', ')}`,
    );
  }
  const version = pluginVersion(pluginDir);
  const old = lockFiles(readLock(root)) ?? {};
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = mergeSettings(readJson(settingsPath), { pluginDir });
  const mcpPath = join(root, '.mcp.json');
  const mcp = mergeMcp(readJson(mcpPath), { pluginDir });
  const written = [];
  const removed = [];
  const hashes = {};
  for (const { path, status, content } of files) {
    if (status === 'dropped') {
      if (remove.includes(path)) {
        rmSync(join(root, path));
        removed.push(path);
      } else if (old[path]) hashes[path] = old[path];
      continue;
    }
    if (['edited', 'unmanaged'].includes(status) && keep.includes(path)) {
      if (old[path]) hashes[path] = old[path];
      continue;
    }
    hashes[path] = sha(content);
    if (status === 'same') continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    written.push(path);
  }
  const lock = {
    source: SOURCE,
    version,
    mode: 'copy',
    tracker: config.tracker.type,
    files: Object.fromEntries(Object.entries(hashes).sort()),
  };
  writeJson(settingsPath, settings);
  writeJson(mcpPath, mcp);
  writeJson(join(root, LOCK), lock);
  return { written: [...written, '.claude/settings.json', '.mcp.json'], removed };
}

// Undo a copy (switching the project to plugin mode): delete every file in
// the lock that is unchanged since the copy (or named in `remove`), take the
// copied hooks out of settings.json, the screenshot server out of .mcp.json,
// and the copy's `enabledPlugins` false, and delete the lock. Edited files
// are kept and reported. Everything is read before the first change;
// `dryRun` only reports.
export function removeCopy(
  root,
  { remove = [], pluginDir = PLUGIN_DIR, dryRun = false } = {},
) {
  const lock = readLock(root);
  if (!lockFiles(lock)) {
    throw new Error(`${LOCK}: missing or invalid, so this project is not a copy`);
  }
  const unknown = remove.filter((path) => !Object.hasOwn(lock.files, path));
  if (unknown.length) throw new Error(`not in the lock: ${unknown.join(', ')}`);
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  const mcpPath = join(root, '.mcp.json');
  const mcp = readJson(mcpPath);
  const servers = Object.keys(readJson(join(pluginDir, '.mcp.json')).mcpServers);
  const plan = Object.entries(lock.files)
    .filter(([path]) => isFile(join(root, path)))
    .map(([path, hash]) => ({
      path,
      drop: remove.includes(path) || sha(lf(readFileSync(join(root, path), 'utf8'))) === hash,
    }));
  if (settings) {
    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      const left = groups
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurHook(h.command)) }))
        .filter((g) => g.hooks.length);
      if (left.length) settings.hooks[event] = left;
      else delete settings.hooks[event];
    }
    if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
    if (settings.enabledPlugins?.['turbo-workflow@claude-turbo-workflow'] === false) {
      delete settings.enabledPlugins['turbo-workflow@claude-turbo-workflow'];
    }
  }
  if (mcp?.mcpServers) for (const name of servers) delete mcp.mcpServers[name];
  const removed = plan.filter((f) => f.drop).map((f) => f.path);
  const kept = plan.filter((f) => !f.drop).map((f) => f.path);
  if (dryRun) return { removed, kept };
  for (const { path, drop } of plan) {
    if (drop) rmSync(join(root, path));
  }
  if (settings) {
    if (settings.enabledPlugins && !Object.keys(settings.enabledPlugins).length) {
      delete settings.enabledPlugins;
    }
    writeJson(settingsPath, settings);
  }
  if (mcp) {
    const empty =
      !Object.keys(mcp.mcpServers ?? {}).length &&
      Object.keys(mcp).every((key) => key === 'mcpServers');
    if (empty) rmSync(mcpPath);
    else writeJson(mcpPath, mcp);
  }
  rmSync(join(root, LOCK));
  return { removed, kept };
}

function parseArgs(argv) {
  const [command, root, ...rest] = argv;
  const opts = { command, root, path: null, config: null, keep: [], take: [], remove: [], dryRun: false };
  if (command === 'show') opts.path = rest.shift();
  const allowed = {
    plan: ['--config'],
    show: ['--config'],
    write: ['--config', '--keep', '--take', '--remove'],
    remove: ['--remove', '--dry-run'],
  }[command] ?? [];
  const dry = rest.indexOf('--dry-run');
  if (dry !== -1) {
    if (!allowed.includes('--dry-run')) throw new Error(`--dry-run: only for remove`);
    opts.dryRun = true;
    rest.splice(dry, 1);
  }
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.includes(rest[i])) {
      throw new Error(`${rest[i]}: not an option of ${command}`);
    }
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) throw new Error(`${flag}: missing value`);
    if (flag === '--config') opts.config = value;
    else if (flag === '--keep') opts.keep.push(value);
    else if (flag === '--take') opts.take.push(value);
    else if (flag === '--remove') opts.remove.push(value);
    else throw new Error(`unknown option ${flag}`);
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!['plan', 'show', 'write', 'remove'].includes(opts.command) || !opts.root) {
    process.stderr.write(
      'Usage: vendor.mjs plan|show|write|remove <root> [<path>] [--config <file>] [--keep <path>]… [--take <path>]… [--remove <path>]…\n',
    );
    return 1;
  }
  if (opts.command === 'remove') {
    process.stdout.write(`${JSON.stringify(removeCopy(opts.root, opts), null, 2)}\n`);
    return 0;
  }
  const config = JSON.parse(
    readFileSync(opts.config ?? join(opts.root, '.claude', 'workflow.json'), 'utf8'),
  );
  if (opts.command === 'show') {
    const file = planCopy(opts.root, config).find((f) => f.path === opts.path);
    if (!file?.content) throw new Error(`${opts.path}: not a copied file`);
    process.stdout.write(file.content);
    return 0;
  }
  if (opts.command === 'plan') {
    const files = planCopy(opts.root, config);
    process.stdout.write(
      `${JSON.stringify(
        files.map(({ path, status, edited }) => ({ path, status, ...(edited === undefined ? {} : { edited }) })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  const result = writeCopy(opts.root, config, opts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isEntry(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`vendor.mjs: ${error.message}\n`);
    process.exitCode = 1;
  }
}


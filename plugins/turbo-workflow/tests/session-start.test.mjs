import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const HOOK = join(import.meta.dirname, '..', 'hooks', 'session-start.mjs');

function project({ configured = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tw-start-')));
  if (configured) {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'workflow.json'), '{}');
  }
  return dir;
}

function run({
  pluginRoot = '/opt/plugins/turbo-workflow',
  projectDir = project(),
  input = '{"source":"startup"}',
} = {}) {
  const out = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PROJECT_DIR: projectDir,
    },
  });
  return {
    ...out,
    context: out.stdout ? JSON.parse(out.stdout).hookSpecificOutput : null,
  };
}

test('injects the absolute plugin dir', () => {
  const { context, status } = run();
  assert.equal(status, 0);
  assert.equal(context.hookEventName, 'SessionStart');
  assert.match(
    context.additionalContext,
    /<plugin> = "\/opt\/plugins\/turbo-workflow"/,
  );
  assert.match(
    context.additionalContext,
    /"\/opt\/plugins\/turbo-workflow\/skills\/work-ticket\/workflow\.md"/,
  );
  assert.match(context.additionalContext, /\/turbo-workflow:work-ticket/);
});

test('no config → init hint', () => {
  const { context } = run({ projectDir: project({ configured: false }) });
  assert.equal(
    context.additionalContext,
    'turbo-workflow is enabled but this project has no .claude/workflow.json: run /turbo-workflow:init.',
  );
});

test('stays under 10000 characters', () => {
  const { context } = run({ pluginRoot: `/${'x'.repeat(500)}` });
  assert.ok(context.additionalContext.length < 10000);
});

test('quotes a path with spaces', () => {
  const { context } = run({ pluginRoot: '/Users/a b/My Drive/turbo-workflow' });
  assert.match(
    context.additionalContext,
    /"\/Users\/a b\/My Drive\/turbo-workflow"/,
  );
  assert.match(
    context.additionalContext,
    /"\/Users\/a b\/My Drive\/turbo-workflow\/skills\/work-ticket\/workflow\.md"/,
  );
});

test('bad JSON on stdin → exit 0, no output', () => {
  const out = run({ input: '{ nope' });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
});

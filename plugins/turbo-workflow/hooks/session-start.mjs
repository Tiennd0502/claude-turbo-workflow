#!/usr/bin/env node
// SessionStart hook (startup, resume, clear, compact): tells Claude where the
// plugin lives and where the workflow rules are. A plugin cannot ship
// always-loaded rules, and ${CLAUDE_PLUGIN_ROOT} is not set for the commands
// Claude runs with Bash, so this context is what makes `<plugin>` in the rules
// and templates resolvable. Without .claude/workflow.json it only points at
// /turbo-workflow:init. Fails open: any error prints nothing, exit 0.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function context(pluginRoot, projectDir) {
  if (!existsSync(join(projectDir, '.claude', 'workflow.json')))
    return 'turbo-workflow is enabled but this project has no .claude/workflow.json: run /turbo-workflow:init.';
  const rules = join(pluginRoot, 'skills', 'work-ticket', 'workflow.md');
  return [
    `turbo-workflow is set up in this project (config: .claude/workflow.json). <plugin> = "${pluginRoot}".`,
    `A feature or bug task follows "${rules}": read it before starting.`,
    'Ticket flow: /turbo-workflow:work-ticket <ticket | task text | spec dir>.',
  ].join('\n');
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  if (!pluginRoot || !projectDir) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context(pluginRoot, projectDir),
      },
    }),
  );
}

try {
  main();
} catch {
  // fail open
}

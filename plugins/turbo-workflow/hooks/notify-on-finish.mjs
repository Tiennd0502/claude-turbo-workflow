#!/usr/bin/env node
// UserPromptSubmit, Stop and Notification hook: shows a macOS notification
// when Claude needs the user (a permission prompt or an elicitation dialog)
// or finishes a turn of at least 60 s with no background task left. A turn
// starts at UserPromptSubmit; its time is kept per session in the OS temp dir.
// CLAUDE_NOTIFY=0 turns it off; it does nothing off macOS or under CI.
// Fails open: any error prints nothing, exit 0.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const MIN_SECONDS = 60;

const hasBackgroundTasks = (tasks) =>
  Array.isArray(tasks)
    ? tasks.length > 0
    : Boolean(tasks) && Object.keys(tasks).length > 0;

// Arguments go through argv, never into a script string.
function notify(title, body) {
  execFile(
    'osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      title,
      body,
    ],
    () => {},
  );
}

function main() {
  if (process.platform !== 'darwin') return;
  if (process.env.CLAUDE_NOTIFY === '0') return;
  if (process.env.CI || process.env.GITHUB_ACTIONS) return;

  const input = JSON.parse(readFileSync(0, 'utf8'));
  const project = basename(
    process.env.CLAUDE_PROJECT_DIR || input.cwd || 'Claude Code',
  );
  const sessionId = String(input.session_id ?? '').replace(/[^\w-]/g, '');
  const startFile = join(tmpdir(), `claude-notify-${sessionId}.json`);

  switch (input.hook_event_name) {
    case 'Notification':
      notify(
        `${input.title || 'Claude needs you'} — ${project}`,
        input.message || 'Claude is waiting for you.',
      );
      return;

    case 'UserPromptSubmit':
      if (sessionId) writeFileSync(startFile, String(Date.now()));
      return;

    case 'Stop': {
      if (!sessionId || hasBackgroundTasks(input.background_tasks)) return;
      const startedAt = Number(readFileSync(startFile, 'utf8'));
      // NaN from a bad start file counts as too short.
      if (!((Date.now() - startedAt) / 1000 >= MIN_SECONDS)) return;
      notify(`Claude finished — ${project}`, 'Claude is waiting for you.');
      return;
    }
  }
}

// No process.exit: it would cut off the notifier child process.
try {
  main();
} catch {
  // fail open
}

---
name: ui-screenshot
description: Take before/after screenshots of a web app page or state under the same fixed conditions, so a PR can show a UI change. Use when a task needs a before shot (before any UI edit) or an after shot (once the change is verified), on /turbo-workflow:ui-screenshot, from a turbo-workflow:ui-screenshotter brief, or when the user asks to "chụp màn hình" or "chụp before/after".
---

# UI screenshots, before and after

Before and after must differ only by the change, so every shot uses the same fixed conditions. The project's values (URL, dev command, conditions) come from `.claude/workflow.json`, as **From the project config** at the end says.

- **File:** `<dir>/<screen>-<before|after>.<ext>`, in the project's screenshot folder and format.
- **Screen name:** kebab-case `<area>-<page>[-<state>]`, one per page or state the change alters.
- **When:** before = before any UI edit; after = once the change is verified, with the same path and steps.
- **Config:** never change the folder, format, viewport or conditions between a before and its after.

## Steps

1. **App:** check the web app answers; if not, start it in the background and wait (a first page can take 10 s or more to compile). Never start a second one.
2. **Browser:** use the project's screenshot browser (a Playwright MCP server with its own profile, so sign-in survives). Not available → ask the user to enable it. No user signed in → the user signs in once in that window; never type credentials.
3. **Fixed conditions:** on the first page of the app (`about:blank` has no `localStorage` or cookies), set the project's conditions, then reload. Never resize the viewport.
4. **Open** the path. Wait until the page is ready (data loaded, hydrated), and hide dev overlays (look at them first if they show an error).
5. **Steps**, if any, to reach the state. Ask before a step that writes data, and name test data as such.
6. **Shoot:** hover a neutral element (the page heading) so no button keeps its hover style, then take the screenshot straight into `<dir>/<screen>-<phase>.<ext>` (the filename resolves against the repo root).
7. **Check:** read the image. Does it show what it should? Show each after next to its before.
   - A try fails when the page or a step errors, the file is not saved, or the image does not show what it should. Retry from step 4 with the cause fixed (wait longer, reload, restart the dev server).
   - At most 3 tries per screen. After the 3rd failure, give up on that screen: delete `<dir>/<screen>-<phase>.<ext>` if it exists (saved by a try of this run or left by an earlier run), so no wrong or stale image is committed. Keep going with the others, and report the cause of each try (`FAILED`).
   - Something only the user can do (sign in, approve a data write) is not a try: stop and ask (`BLOCKED`).
8. **Clean up:** close the browser and stop every dev server you started by stopping its background task (TaskStop). Killing the port's process can leave a watcher and the task alive.

## Gotchas

- A before taken after the UI edit already shows the change: `git stash -u`, take it, then `git stash pop` (stop on a conflict). Pop before any stop: never report `BLOCKED` or `FAILED`, or return, while the work is stashed.
- The `turbo-workflow:ui-screenshotter` agent keeps the images out of your context. Brief it with the phase, each `<screen>=<path>` with its steps and what it must show, and whether data-writing steps are approved. It shares the browser, so don't drive it while the agent runs.

## From the project config

Read the app's `screenshot` block: `node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get apps.<app>.screenshot` (the app whose `ui` globs the change touches). Skip any field that is not set.

- **Folder and format:** `dir` and `format` (`{feature}` = branch name after `<type>/`; `jpeg` → `.jpg`).
- **App:** `url`; start it with `devCommand` from the repo root (and any other app's `devCommand` the page needs, such as an API). Restart it after a production build of the app.
- **Browser:** the plugin's MCP server `playwright-screenshot` (tools `mcp__plugin_turbo-workflow_playwright-screenshot__browser_*`); viewport = its `--viewport-size` (restart Claude Code after a change).
- **Conditions:** theme light when `themeStorageKey` is set — `localStorage.setItem('<themeStorageKey>', 'light')`; each of `cookies` — `document.cookie = '<name>=<value>; path=/'`.
- **Page ready:** when `readyCheck.absentSelector` is set, wait until no element matches it, then `readyCheck.settleMs` ms (hydration: a click before it can submit a form natively); remove every element matching `removeSelectors`.

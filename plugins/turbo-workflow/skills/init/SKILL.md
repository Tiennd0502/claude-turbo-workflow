---
name: init
description: Set up turbo-workflow in a Turborepo project — read the repo for suggested answers, ask every project value, show the files it will write, and write them only after the user confirms. Also edits an existing setup. Run only when the user invokes /turbo-workflow:init.
disable-model-invocation: true
---

# Set up turbo-workflow in this project

Run from the repo root. **Nothing is written before step 4's confirmation**, and nothing detected is used without being asked: a detected value is only the "(Recommended)" option.

## 1. Read (no writes)

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/init-detect.mjs" .` — package manager, workspaces, apps with their scripts, test runner, e2e, UI, dev command and URL, packages, lint-staged, git remote and default branch, and the existing files, including the current `.claude/workflow.json`.
- `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` when `gh` works; a failure is not an error.
- Read each adapter's `## init` in `${CLAUDE_PLUGIN_ROOT}/trackers/*/adapter.md`.
- No `turbo.json` at the root → say this plugin is for Turborepo projects and ask whether to go on anyway.

With an existing `workflow.json`, its values are the recommended answers (this is how a re-run edits the setup); otherwise the detected ones are.

## 2. Ask

AskUserQuestion, at most 4 questions per call, in this order. Every question has the recommended value as option A "(Recommended)"; Other is for anything typed.

1. **Tracker:** `trello` or `none`. Then the questions of that adapter's `## init` (for `trello`: the connector check, the board, one list per state).
2. **Git:** the remote (A: the current `git.remote`, else `git.remote` from `init-detect`, else `origin`; the other `git.remotes` as options), the one the workflow pushes to and opens PRs on; base branch (A: the current `git.baseBranch`, else the default branch from `gh` or `init-detect`); protected branches (A: the base branch plus `main` if it exists, multiSelect).
3. **Package manager** (A: `packageManager.value`) and **autofix** (A: `lint-staged` when `lintStaged` is true, else `none`); the specs dir (A: `docs/specs`).
4. **Apps:** first which of the detected apps the workflow covers (multiSelect). Then per app:
   - test runner (A: detected), and the coverage command (A: `<pm run test:cov>` when the app has a `test:cov` script, else ask for the app's coverage script) plus the runner's json-summary and text-summary reporters (`--coverage.reporter=json-summary --coverage.reporter=text-summary` for Vitest, `--coverageReporters=json-summary --coverageReporters=text-summary` for Jest);
   - e2e yes/no (A: detected);
   - security paths and UI globs: offer the paths that exist in the app among common ones (`src/middleware.ts`, `src/main.ts`, `src/app.module.ts`, `src/common/guards/`, `src/configs/`, `Dockerfile`, `next.config.*`, `vercel.json`; UI: `src/{app,components,pages,sections,layouts}/**`, `public/**`, `tailwind.config.*`), editable in Other;
   - plan changes that need approval (A: none; Other for a list such as "an endpoint or request/response shape");
   - with UI: screenshot dir (A: `docs/images/{feature}`), format (A: `png`), theme storage key (A: none), dev command (A: detected), URL (A: detected), cookies, ready check and selectors to remove (A: none).
5. **Shared paths:** every package under `packages/` plus the workspace file (multiSelect, A: all).

Then validate: write the answers as a config object and check it with `node -e` importing `validateConfig` from `${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs`; an error goes back to the matching question.

## 3. Plan the files

| File | When |
| --- | --- |
| `.claude/workflow.json` | always (`create` or `change`) |
| `apps/<app>/.claude/rules/coding.md`, `apps/<app>/.claude/rules/testing.md` | only when missing: from `${CLAUDE_PLUGIN_ROOT}/templates/init/coding.md` and `testing.md` |
| `apps/<app>/.claude/skills/verify/SKILL.md` | only when missing: from `${CLAUDE_PLUGIN_ROOT}/templates/init/verify-SKILL.md`, the `{{…}}` gates filled from the app's real scripts (below) |
| the tracker's files | from the adapter's `## init` (`create`, or `change` when the content differs) |
| `.claude/settings.json` | merge only: add `extraKnownMarketplaces["claude-turbo-workflow"]` = `{ "source": { "source": "github", "repo": "Tiennd0502/claude-turbo-workflow" } }` and `enabledPlugins["turbo-workflow@claude-turbo-workflow"]` = `true`; keep every other key |
| `CLAUDE.md` | add the block of `${CLAUDE_PLUGIN_ROOT}/templates/init/claude-md-block.md` (create the file if missing); skip if the block is already there |
| `.gitignore` | add `<specsDir>/` unless `existing.gitignoreHasSpecs`, and `/.superpowers/` unless `existing.gitignoreHasSuperpowers` (superpowers' plan ledgers, and a PR draft made with no spec dir; step 9 commits with `git add -A`) |

Filling `verify-SKILL.md`: `{{name}}` and `{{dir}}` are the app's, `{{root}}` is the relative path from the app's dir to the repo root (`../..` for `apps/site`, `..` for `site`); the gates come from the app's scripts, run from the app's dir: `{{lint}}` = the `lint` script made read-only: keep its own commands and arguments and make every rewriting step only check: remove `--fix` and `--fix-type …` for ESLint, and replace Prettier's `--write` / `-w` with `--check` (a bare `prettier .` checks nothing and always passes); e.g. `eslint --fix "src/**/*.ts" && prettier --write .` → `<pm exec eslint> "src/**/*.ts" && <pm exec prettier> --check .`. When the script is not a direct tool call (`turbo run lint`, `<pm run lint:all>`) or a flag's meaning is unclear, ask the user for the read-only lint command instead of guessing. `{{formatCheck}}` = `<pm run format:check>` if present, `{{build}}` = `<pm run build>`, `{{test}}` = `<pm run test>`, or the app's coverage command when it has no `test` script (the unit gate is never dropped), `{{e2e}}` = "Run `<pm run test:e2e>` when the change touches what the e2e suite covers." when e2e is on, else "No e2e suite: report E2E as n/a.". A missing lint, format or build script drops its line. Say which lines were dropped.

## 4. Confirm

Show the file list, each marked `create`, `change` or `skip (exists)`, and the full `workflow.json`. Ask: A "Write these files" (Recommended), B "Change something" (the change in Other; apply it, show the list again and ask again), C "Cancel" (nothing is written).

## 5. Write and report

On A, write exactly the listed files. Then report:
- what was written;
- what is left for the user: fill the `<TODO>`s in each app's `coding.md` and `testing.md`, the tracker's secrets or variables (from its `## init`), commit the files, and start a new session so the SessionStart context loads;
- how to start: `/turbo-workflow:work-ticket <ticket>`.

# turbo-workflow

A Claude Code plugin that takes one ticket from a tracker to an open GitHub PR in a Turborepo project: design → plan → TDD per task → code review → verify each changed app → commit → security review → draft PR → ticket update. Gate 1 (the plan) is the one planned question: once it is approved, the commit, a security amend, the push and the draft PR run without asking, and you mark the PR ready on GitHub. The run still stops to ask when something leaves the plan (a plan change, the round limit). A saved status lets a stopped run resume at the exact task step.

## Install

In Claude Code:

```text
/plugin marketplace add Tiennd0502/claude-turbo-workflow
/plugin install turbo-workflow@claude-turbo-workflow
```

Or let teammates get it automatically: `/turbo-workflow:init` writes these keys into the project's `.claude/settings.json`; commit them.

```json
{
  "extraKnownMarketplaces": {
    "claude-turbo-workflow": { "source": { "source": "github", "repo": "Tiennd0502/claude-turbo-workflow" } }
  },
  "enabledPlugins": { "turbo-workflow@claude-turbo-workflow": true }
}
```

They apply once a teammate trusts the project folder (the trust dialog on first open). Cloud sessions do not load marketplaces declared by a repo.

## Requirements

- Claude Code, Node.js ≥ 24, git, and `gh` signed in to GitHub.
- The `superpowers` plugin from `claude-plugins-official` (a declared dependency, installed with this plugin).
- A Turborepo with pnpm, npm, yarn or bun workspaces.
- Tracker `trello`: Claude Code signed in with a claude.ai account that has the Trello connector connected, and for moving cards to done on merge, the repository secrets `TRELLO_KEY`, `TRELLO_TOKEN` and the variable `TRELLO_DONE_LIST_ID`.

## Set up a project

Run `/turbo-workflow:init` in the project. It reads the repo for suggested answers and asks every value (tracker, branches, package manager, apps, shared paths), shows the files it will write, and writes them only after you confirm:

- `.claude/workflow.json`, the project config ([schema](schema/workflow.schema.json));
- per app, when missing: `apps/<app>/.claude/rules/coding.md` and `testing.md` (skeletons with TODOs to fill) and `apps/<app>/.claude/skills/verify/SKILL.md` (the app's gates);
- the tracker's files (for `trello`: `.github/workflows/trello.yml`);
- the settings keys above, a short block in `CLAUDE.md`, and the specs dir and `.superpowers/` in `.gitignore`.

Run it again to change the setup: it offers the current values.

## Use

| Command | What it does |
| --- | --- |
| `/turbo-workflow:work-ticket <ticket URL \| "task text" \| task.md>` | runs one ticket end to end |
| `/turbo-workflow:work-ticket <spec dir>` | resumes a stopped run |
| `/turbo-workflow:work-ticket <ticket> done` | after the PR merged: ticket to done, local branch deleted |
| `/turbo-workflow:ticket-status [spec dir]` | where a run stopped, without changing anything |
| `/turbo-workflow:pr-description` | drafts a PR description for the current branch |
| `/turbo-workflow:ui-screenshot` | before/after screenshots of a UI change |

Trackers: `trello` (a board with one list per state: todo, in progress, review, done) and `none` (the ticket is the task you type). Workflow files (design, plan, reports) stay local in the specs dir.

## Update

```text
claude plugin update turbo-workflow
```

Then `/reload-plugins` or restart Claude Code. Third-party marketplaces do not auto-update by default; turn it on for this marketplace in `/plugin` → Marketplaces.

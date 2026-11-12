# claude-turbo-workflow

A [Claude Code](https://code.claude.com) plugin marketplace with one plugin, **`turbo-workflow`**: it takes one ticket from your tracker to a draft GitHub PR in a Turborepo monorepo.

```text
design → plan → 🛑 Gate 1 → TDD per task → code review → verify each changed app → UAT
       → commit → security review → push + draft PR → ticket to review
```

You approve the design and the plan (Gate 1). Everything after that runs without a question unless something leaves the plan, and a stopped run resumes at the exact task step.

```mermaid
flowchart LR
    t(["ticket"]) --> d["design"] --> p["plan"] --> g{{"🛑 Gate 1"}}
    g --> i["implement<br/>TDD + per-task review"] --> r["code review"] --> v["verify<br/>changed apps"]
    v --> c["commit"] --> s["security<br/>review"] --> pr(["draft PR<br/>ticket → review"])
    classDef gate fill:#fde68a,stroke:#b45309,color:#111;
    class g gate;
```

The full chart, the questions it asks and what each run produces: [docs/workflow.md](docs/workflow.md).

## Install

In Claude Code:

```text
/plugin marketplace add Tiennd0502/claude-turbo-workflow
/plugin install turbo-workflow@claude-turbo-workflow
```

It needs Claude Code, Node.js ≥ 24, git, `gh` signed in to GitHub, and the `superpowers` plugin from `claude-plugins-official` (a declared dependency). For the `trello` tracker, Claude Code must be signed in with a claude.ai account that has the Trello connector.

## Quick start

1. Install the plugin (above), then in your Turborepo run `/turbo-workflow:init`. It asks the [install mode](#two-install-modes) (copy into `.claude/` by default), then every project value (tracker, branches, package manager, apps, shared paths) with the detected one as the recommended answer, shows the files it will write, and writes them only after you confirm.
2. Fill the `<TODO>`s in each app's `apps/<app>/.claude/rules/coding.md` and `testing.md`, commit the new files, and start a new session.
3. Run one ticket (copy mode; in plugin mode the commands start with `/turbo-workflow:`):

   ```text
   /work-ticket https://trello.com/c/<id>/...
   /work-ticket "Add a GET /health route that returns {ok:true}"   # tracker none
   ```

4. Review the draft PR on GitHub and mark it ready. After the merge, the ticket moves to done (or run `/work-ticket <ticket> done`).

## Two install modes

`/turbo-workflow:init` asks first how the project gets the workflow:

| | **Copy into `.claude/`** (default) | **Plugin** |
| --- | --- | --- |
| What the project holds | the whole workflow: `.claude/rules/workflow.md`, `skills/`, `agents/`, `scripts/`, `templates/`, `trackers/`, `hooks/`, the hooks in `settings.json`, `.mcp.json`, and `.claude/turbo-workflow.lock` | only the config and the per-app files |
| Commands | `/work-ticket`, `/ticket-status`, `/pr-description`, `/ui-screenshot`, `/uat` | `/turbo-workflow:work-ticket`, `/turbo-workflow:ticket-status`, … |
| Teammates need | the `superpowers` plugin (enabled in `settings.json`) | this plugin and superpowers |
| claude.ai/code cloud sessions | the copied `.claude/` carries over (superpowers still has to be available there) | repo-declared plugins are not installed |
| Edit per project | yes, edit the copied files | no |
| Update | `/turbo-workflow-sync [version]`: fetches the release, updates untouched files, asks for each file you edited | `claude plugin update turbo-workflow` |

In copy mode the plugin is turned off for the project (`enabledPlugins` false), so nothing runs twice. To run `/turbo-workflow:init` there again: `claude plugin enable turbo-workflow@claude-turbo-workflow --scope local`, then disable it after.

On a project that already has its own `.claude/` files at the same paths (for example an older hand-made copy of this workflow), init marks them `unmanaged` and asks for each one (keep yours, or replace it). Switching a copied project to plugin mode removes the copied files you did not change (`vendor.mjs remove`); edited ones are kept and listed.

## Commands

Copy mode names; in plugin mode add the `turbo-workflow:` prefix (`/turbo-workflow:work-ticket`).

| Command | What it does |
| --- | --- |
| `/turbo-workflow:init` | sets up or edits the project (always the plugin's command) |
| `/work-ticket <ticket \| "task" \| task.md>` | runs one ticket end to end |
| `/work-ticket <spec dir>` | resumes a stopped run |
| `/work-ticket <ticket> done` | after the merge: ticket to done, local branch deleted |
| `/ticket-status [spec dir]` | where a run stopped, read only |
| `/pr-description` | drafts a PR description for the current branch |
| `/ui-screenshot` | before / after screenshots of a UI change |
| `/uat <spec dir \| ticket>` | checks the change in the running app against the ticket, blind to the plan and code |
| `/turbo-workflow-sync [version]` | copy mode only: update the copied files to a release |

## Documentation

- [How the workflow runs](docs/workflow.md): the flow chart, gates, ticket states, files, changed apps, resume.
- [Project configuration](docs/configuration.md): `.claude/workflow.json` fields, per-app files, trackers.
- [Plugin internals](docs/architecture.md): what is in the plugin and how the pieces connect.
- [Plugin README](plugins/turbo-workflow/README.md): install for a team, update.

## Team setup

Copy mode: commit the copied `.claude/` (and `.mcp.json`); teammates need only superpowers, which `settings.json` enables.

Plugin mode: `/turbo-workflow:init` adds these keys to the project's `.claude/settings.json`. Commit them, and teammates get the plugin after they trust the folder:

```json
{
  "extraKnownMarketplaces": {
    "claude-turbo-workflow": { "source": { "source": "github", "repo": "Tiennd0502/claude-turbo-workflow" } }
  },
  "enabledPlugins": { "turbo-workflow@claude-turbo-workflow": true }
}
```

To use it in the claude.ai apps too, add this repo under claude.ai → Customize → Plugins → Add → Add marketplace. Cloud sessions on claude.ai/code do not install plugins a repository declares.

## Update

- Copy mode: `/turbo-workflow-sync` (or `/turbo-workflow-sync 0.1.0`), then review and commit the diff.
- Plugin mode: `claude plugin update turbo-workflow`, then `/reload-plugins`.

Releases are tagged `turbo-workflow--v<version>`.

## Develop

```bash
node --test "plugins/turbo-workflow/tests/*.test.mjs"   # script and hook tests
claude plugin validate . && claude plugin validate plugins/turbo-workflow
claude --plugin-dir "$PWD/plugins/turbo-workflow"        # load this checkout in a project
```

Release: bump `version` in `plugins/turbo-workflow/.claude-plugin/plugin.json`, commit, then `claude plugin tag plugins/turbo-workflow --push`.

## Limits

- Turborepo monorepos only (apps in sub-folders); a single-app repo is not supported yet.
- GitHub only for PRs (`gh`); trackers `trello` and `none`.
- Desktop notifications on macOS only.

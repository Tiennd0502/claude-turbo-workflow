# Project configuration

Every project value lives in one file, `.claude/workflow.json`, committed with the project. `/turbo-workflow:init` writes it; run init again to change it. The JSON schema is [`plugins/turbo-workflow/schema/workflow.schema.json`](../plugins/turbo-workflow/schema/workflow.schema.json). Every script validates the file and names the bad field; a missing file prints `No .claude/workflow.json: run /turbo-workflow:init`.

## Example

```json
{
  "version": 1,
  "packageManager": "pnpm",
  "git": { "remote": "origin", "baseBranch": "develop", "protected": ["develop", "main"] },
  "tracker": {
    "type": "trello",
    "board": "https://trello.com/b/<id>/<board>",
    "lists": { "todo": "TODO", "inProgress": "IN PROGRESS", "review": "REVIEW", "done": "DONE" }
  },
  "autofix": "lint-staged",
  "specsDir": "docs/specs",
  "apps": {
    "api": {
      "dir": "apps/api",
      "runner": "Vitest",
      "coverage": "pnpm run test:cov --coverage.reporter=json-summary --coverage.reporter=text-summary",
      "e2e": true,
      "planChanges": ["an endpoint or a request/response shape"],
      "security": ["src/common/guards/", "src/main.ts"],
      "ui": []
    },
    "web": {
      "dir": "apps/web",
      "runner": "Jest",
      "coverage": "pnpm run test:cov --coverageReporters=json-summary --coverageReporters=text-summary",
      "e2e": false,
      "planChanges": [],
      "security": ["src/middleware.ts", "next.config.ts"],
      "ui": ["src/app/**", "src/components/**"],
      "screenshot": {
        "dir": "docs/images/{feature}",
        "format": "png",
        "devCommand": "pnpm dev:web",
        "url": "http://localhost:3000",
        "cookies": [{ "name": "sidebar_state", "value": "true" }],
        "readyCheck": { "absentSelector": ".animate-pulse", "settleMs": 2000 },
        "removeSelectors": ["nextjs-portal"]
      }
    }
  },
  "shared": ["packages/eslint-config", "packages/typescript-config", "pnpm-workspace.yaml"]
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `packageManager` | `pnpm`, `npm`, `yarn` or `bun`. Every command the workflow writes comes from this (`node <plugin>/scripts/config.mjs cmd run\|exec\|lockfile\|build-packages`) |
| `git.remote` | The GitHub remote the workflow pushes to and opens PRs on |
| `git.baseBranch` | Feature branches start from it and PR into it |
| `git.protected` | Branches the guard hook will not let Claude push to |
| `tracker.type` | `trello` or `none` (see [Trackers](#trackers)) |
| `tracker.board`, `tracker.lists` | `trello` only: the board URL and the list for each workflow state |
| `autofix` | `lint-staged`: the pre-commit tasks run on the whole change before each review and verify. `none`: skipped |
| `specsDir` | Where designs, plans and reports go. Keep it gitignored |
| `apps.<name>.dir` | The app's folder, e.g. `apps/web` |
| `apps.<name>.runner` | The test runner, e.g. `Vitest` or `Jest` |
| `apps.<name>.coverage` | The coverage command with a json-summary and a text-summary reporter; it is also the unit gate of verify |
| `apps.<name>.e2e` | Whether the app has an e2e suite |
| `apps.<name>.planChanges` | Changes that must go back to Gate 1 if they appear mid-run (free text) |
| `apps.<name>.security` | Paths (relative to `dir`) that trigger the security review |
| `apps.<name>.ui` | Globs (relative to `dir`) that count as a UI change and need before / after screenshots |
| `apps.<name>.screenshot` | Screenshot settings: folder (`{feature}` = the branch name after `<type>/`), format, theme storage key, dev command, URL, cookies to set, a ready check and selectors to remove |
| `shared` | Paths every app depends on (shared config packages, the workspace file). A change there counts as every app and rebuilds the packages first |

## Copy mode: the lock

A project set up in copy mode has `.claude/turbo-workflow.lock`, committed:

```json
{
  "source": "https://github.com/Tiennd0502/claude-turbo-workflow",
  "version": "0.1.0",
  "mode": "copy",
  "tracker": "trello",
  "files": { ".claude/rules/workflow.md": "<sha256>", "…": "…" }
}
```

`/turbo-workflow-sync` reads it: `source` and the release tag `turbo-workflow--v<version>` say what to fetch, and each hash tells a file you have not touched (updated without a question) from one you edited (shown as a diff and asked: take the new version, or keep yours; a kept file stays `edited` next time). `settings.json` and `.mcp.json` are not hashed: their workflow entries are merged again on every sync, and your own keys and hooks stay.

## Per-app files

Each app keeps its own knowledge next to its code; init creates skeletons only when they are missing:

- `apps/<app>/.claude/rules/coding.md` and `testing.md`: the app's coding and testing rules. They become the plan's Global Constraints and the code review's rules. Fill the `<TODO>`s.
- `apps/<app>/.claude/skills/verify/SKILL.md`: the app's gates, in order (lint without `--fix`, format check, build, unit with coverage, e2e). Init fills it from the app's real scripts.

## Trackers

A tracker is an adapter under `plugins/turbo-workflow/trackers/<type>/adapter.md` with the operations `parse`, `read`, `move`, `prLine`, `done-on-merge` and `init`. The workflow core never names a tracker.

| | `trello` | `none` |
| --- | --- | --- |
| Ticket | A card URL `https://trello.com/c/<id>/…` | Free text or a path to a Markdown file |
| Read | Description and checklists, through the `trello-manager` agent | The text you gave |
| Moves | Card between the four lists | Skipped |
| PR line | `**Ticket:** <card URL>` | none |
| Done on merge | `.github/workflows/trello.yml` (init writes it) moves the card on merge | — |
| Needs | Claude Code signed in with a claude.ai account that has the Trello connector; repo secrets `TRELLO_KEY`, `TRELLO_TOKEN` and the variable `TRELLO_DONE_LIST_ID` | nothing |

A new tracker is a new folder with an `adapter.md` that implements the same sections, plus its value in the schema's `tracker.type`.

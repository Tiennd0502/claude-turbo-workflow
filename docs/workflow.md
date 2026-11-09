# How the workflow runs

`/turbo-workflow:work-ticket <ticket>` takes one ticket from the tracker to a draft GitHub PR. It drives the [superpowers](https://github.com/obra/superpowers) skills (brainstorming, writing-plans, executing-plans) and adds this plugin's own rules on top: reviews, verify per changed app, reports, saved status and tracker moves.

## The flow

```mermaid
flowchart TD
    start(["/turbo-workflow:work-ticket TICKET"]) --> s0{"0. Pre-flight:<br/>a spec for this ticket?"}
    s0 -- "yes" --> resume["Resume at the first unfinished step<br/>(state.json)"]
    s0 -- "no" --> s1["1. Read the ticket<br/>move: todo → inProgress"]
    s1 --> s2["2. Design (brainstorming)<br/>design.md · you approve it"]
    s2 --> s3["3. Plan (writing-plans)<br/>plan.md"]
    s3 --> g1{{"🛑 Gate 1<br/>approve the plan and the branch"}}
    g1 -- "Request changes" --> s3
    g1 -- "Stop here" --> paused(["Stopped · resume later"])
    g1 -- "Approve and start" --> s5["5. Branch + coverage baseline<br/>(+ before screenshots)"]
    s5 --> s6["6. Implement task by task<br/>TDD → plan-reviewer per task"]
    s6 -. "a deviation that changes the plan" .-> pg{{"🛑 Plan-change gate"}}
    pg -.-> s6
    s6 --> s7["7. Code review<br/>(autofix first)"]
    s7 -- "bug or rules violation: fix" --> s7
    s7 --> s8["8. Verify each changed app<br/>test-report.md · report.md<br/>(+ after screenshots)"]
    s8 -- "logic fix" --> s7
    s8 --> s9["9. Commit"]
    s9 --> s10["10. Security review"]
    s10 -- "finding: fix → review → verify → amend" --> s10
    s10 --> s11["11. Push + draft PR"]
    s11 --> s12["12. move: inProgress → review"]
    s12 --> s13(["13. Report + notification"])
    s13 -. "PR merged on GitHub" .-> done["done-on-merge, or<br/>/turbo-workflow:work-ticket TICKET done<br/>move: review → done · delete the branch"]

    classDef gate fill:#fde68a,stroke:#b45309,color:#111;
    classDef auto fill:#dbeafe,stroke:#1d4ed8,color:#111;
    class g1,pg gate;
    class s5,s6,s7,s8,s9,s10,s11,s12 auto;
```

- **Yellow**: a gate. The run stops and asks.
- **Blue**: runs without a question once Gate 1 is approved, including the commit, a security amend, the push and the draft PR.
- You mark the PR ready on GitHub yourself; the workflow never runs `gh pr ready`.

## When it asks you

| Moment | Question |
| --- | --- |
| Step 1 | The ticket is not in `todo` or `inProgress`: stop, or continue without moving it. A branch name that already exists: pick another |
| Step 2 | Clarifying questions while designing, then approval of `design.md` |
| Gate 1 | Approve and start · Stop here · Request changes |
| Step 6 | Plan-change gate: a deviation that changes an acceptance criterion, the scope, the changed apps, a dependency or an unlisted file |
| Steps 7, 8, 10 | Round limit: after 3 fix rounds before the commit (or 3 after it), the run stops and asks |
| Step 11 | A failed push or `gh pr create`: the run stops and notifies; a resume runs step 11 again |

Every question uses one format: option A is "(Recommended)", then B and C, and D ("Other") for your own answer. At each gate and on a failure, a desktop notification (macOS) says what is needed.

## Ticket states

```mermaid
stateDiagram-v2
    direction LR
    [*] --> todo
    todo --> inProgress: step 1
    inProgress --> review: step 12 (PR created)
    review --> done: PR merged (done-on-merge)<br/>or the done command
    done --> [*]
```

The tracker adapter makes these moves (`trello`: lists on a board). With tracker `none` the moves are skipped. Any other write to the tracker needs a gate.

## What a run produces

| File | Where | Committed |
| --- | --- | --- |
| `design.md`, `plan.md` | `<specsDir>/<date>/<feature>/` | no (specs dir is gitignored) |
| `state.json` (saved status) | same dir | no |
| `coverage-baseline-<app>.json` | same dir | no |
| `test-report.md` (each verify run), `report.md` | same dir | no |
| `pr-description.md` | same dir | no (it becomes the PR body) |
| Before / after screenshots (UI changes only) | the app's `screenshot.dir` | yes, with the code |
| Plan ledger | `.superpowers/sdd/` | no (gitignored) |
| The code, its tests | the repo | yes: one Conventional Commits commit |

## Changed apps decide the checks

`scripts/changed-apps.mjs` maps the changed files to apps in `.claude/workflow.json`:

```mermaid
flowchart LR
    files["changed files"] --> cls{"changed-apps.mjs"}
    cls -- "under an app's dir" --> app["that app:<br/>its rules, verify skill,<br/>coverage baseline"]
    cls -- "a shared path" --> all["every app<br/>+ rebuild packages"]
    cls -- "anything else: .claude/, *.md,<br/>docs/, .github/, root config" --> none["no changed app:<br/>the plan's Plan checks"]
```

Verify runs each changed app's own `apps/<app>/.claude/skills/verify/SKILL.md` (lint without `--fix`, format check, build, unit with coverage, e2e when on). Coverage is compared with the baseline taken before any code change; drops are warnings.

## Resume

A stopped run continues where it stopped: run `/turbo-workflow:work-ticket <ticket>` (or `<spec dir>`) again. `state.json` records the step, the task and its step, tests passed, review results, findings and rounds. Local git refs under `refs/work-ticket/<feature>/` fingerprint the work, so the resume can tell when files changed while it was away. `/turbo-workflow:ticket-status` shows where a run is without changing anything.

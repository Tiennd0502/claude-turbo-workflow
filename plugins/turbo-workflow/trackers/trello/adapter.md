# Tracker adapter: trello

The project's tickets are cards on one Trello board. Config (`node "<plugin>/scripts/config.mjs" get tracker`):

```json
{ "type": "trello", "board": "<board URL>", "lists": { "todo": "<list>", "inProgress": "<list>", "review": "<list>", "done": "<list>" } }
```

All Trello work goes through the `turbo-workflow:trello-manager` subagent: never call Trello tools in the main conversation. Every dispatch passes the board URL, the four list names from the config, the base branch (`git.baseBranch`) and, for a write, the exact approval. The subagent uses the claude.ai Trello connector (`mcp__claude_ai_Trello__*`); without it, this adapter cannot work (see `## init`).

## parse

The argument is a card URL `https://trello.com/c/<short link>[/<n>-<slug>]`. The id is `<short link>` (8 characters); the canonical ref is the URL as given. Anything else is not a Trello ticket: say so and stop.

## read

Dispatch `turbo-workflow:trello-manager`, read-only, to read one card: title, full description unchanged, every checklist with its items, its list, dependencies, and the current state of the related code. The card's state is the workflow state whose list name matches its list; a list that matches none is "other".

## move

`move(<id>, <from>, <to>)`: dispatch `turbo-workflow:trello-manager` with the card URL, the source list `lists[<from>]` and the target list `lists[<to>]`, and state that the move is the workflow's own, approved by invoking `/turbo-workflow:work-ticket` (or its `done`). It re-reads the card and moves it only if it is still in the source list; otherwise it makes no write and reports the current list. A move is done only when its report lists it as made.

## prLine

`**Ticket:** <card URL>`.

## done-on-merge

`.github/workflows/trello.yml` (from `<plugin>/trackers/trello/trello.yml`, with `__PR_TARGET__` replaced by `git.baseBranch`) moves the card on the PR description's `**Ticket:**` line to the done list when a PR into the base branch is merged. It needs the repository secrets `TRELLO_KEY` and `TRELLO_TOKEN` and the variable `TRELLO_DONE_LIST_ID` (the done list's id). If that run fails, `/turbo-workflow:work-ticket <card URL> done` is the fallback.

## init

1. Check that the `mcp__claude_ai_Trello__*` tools are available in this session. If they are not, say that the Trello adapter needs Claude Code signed in with a claude.ai account that has the Trello connector connected, and offer tracker `none` instead.
2. Ask for the board URL (option A: a board the user recently used, from `trelloReadMember`, if it can be read; Other for a pasted URL).
3. Read the board's lists (through `turbo-workflow:trello-manager`, read-only) and ask which list is each of `todo`, `inProgress`, `review`, `done`, offering the board's lists, in one AskUserQuestion call.
4. Files it writes, after the confirmation: `.github/workflows/trello.yml` from the template above (`create`, or `change` if it differs from the existing file). Report the two secrets and the variable the user must set, with the done list's id.

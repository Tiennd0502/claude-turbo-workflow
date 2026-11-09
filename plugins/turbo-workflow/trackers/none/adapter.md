# Tracker adapter: none

The project has no tracker. A ticket is a task the user writes, inline or in a Markdown file. Config: `{ "type": "none" }`.

## parse

- A path to an existing `.md` file: the task is that file's content.
- Any other text: the task is the text itself.

Pick the feature name `<feature-name>` from the task (kebab-case, the part after `<type>/` of the branch, workflow rule 4). The id is `<feature-name>`; the canonical ref is `none:<feature-name>`, which is what the design's `**Ticket:**` line and `ticket-state.mjs init` record. To resume, the user passes the spec dir (or `none:<feature-name>`, which the ticket lookup matches on the `**Ticket:**` line).

## read

Return the task text unchanged as the description; there are no checklists, links or dependencies. The state is always `todo` on the first run.

## move

Does nothing and reports success: there is nothing to move.

## prLine

Empty: the PR description has no `**Ticket:**` line.

## done-on-merge

Nothing.

## init

No questions and no files.

---
name: pr-description
description: Draft a GitHub PR title and description for the current branch from the turbo-workflow PR template, using only facts from the diff, the spec files and the verify result. Use when the user asks for a PR description or wants to open a PR, and at step 11 of /turbo-workflow:work-ticket.
argument-hint: [base branch, default git.baseBranch]
---

# Draft a PR description

Arguments: `$ARGUMENTS` — optionally a base branch (default `git.baseBranch`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get git.baseBranch`). Run from the repo root.

1. **Collect the inputs.**
   - Branch: `git branch --show-current`.
   - Base branch and PR target: inside `/turbo-workflow:work-ticket`, the plan's Git section; otherwise the argument or `git.baseBranch`.
   - Base commit: `git fetch <git.remote> <base>`, then `git merge-base HEAD <git.remote>/<base>` (`git.remote` from `config.mjs get git.remote`).
   - Spec dir: the directory that holds `<specsDir>/*/<feature-name>/plan.md` (`config.mjs get specsDir`), where `<feature-name>` is the part of the branch after `<type>/`. Several → the newest date. None → no spec dir.
   - Ticket line: the tracker adapter's `prLine` (`${CLAUDE_PLUGIN_ROOT}/trackers/<tracker.type>/adapter.md`) for the ticket on the design's `**Ticket:**` line; empty for tracker `none` or with no design.
   - `git status --short`: uncommitted changes are not part of the PR; tell the user if there are any.
2. **Draft.** Dispatch the `turbo-workflow:pr-writer` subagent with the branch, base commit, PR target, spec dir (or "none"), the ticket line (or "none") and the template path `${CLAUDE_PLUGIN_ROOT}/templates/pr-description.md`.
3. **Save.** Write the body it returns to `<spec dir>/pr-description.md`, or to `.superpowers/pr-description.md` when there is no spec dir. Both paths are gitignored. Keep the title for `gh pr create --title`.
4. **Show.** Inside `/turbo-workflow:work-ticket`, do not show the draft. Otherwise show the title and the body.
5. **Next.** Inside `/turbo-workflow:work-ticket`, go back to step 11 (push and `gh pr create --draft`). Otherwise ask with AskUserQuestion: A "Push and create the PR with this description" (Recommended), B "Keep the draft only". On A:
   - `git push -u <git.remote> <branch>`, then `gh pr create --base <PR target> --head <branch> --title "<title>" --body-file <draft path>`;
   - report the PR URL.

To change the draft, edit the saved file, show it again and ask again. Outside `/turbo-workflow:work-ticket`, nothing is pushed and no PR is created without an approved answer.

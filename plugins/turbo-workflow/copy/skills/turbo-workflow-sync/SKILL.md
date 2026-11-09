---
name: turbo-workflow-sync
description: Update this project's copied turbo-workflow files in .claude/ to a newer release, asking before replacing any file edited here. Run only when the user invokes /turbo-workflow-sync.
argument-hint: [version, default the newest release]
disable-model-invocation: true
---

# Update the copied workflow

Arguments: `$ARGUMENTS` — optionally a version such as `0.2.0`. Run from the repo root. Nothing is written before the user has seen the file list and answered for every edited file.

1. **Read the lock.** `.claude/turbo-workflow.lock` gives `source` (the release repo), `version` (the copied release) and `files`. No lock → this project was not set up by copy, so say so (plugin mode updates with `claude plugin update turbo-workflow`) and stop.
2. **Pick the release.** The tag is `turbo-workflow--v<version>`: the argument's version, else the newest from `git ls-remote --tags <source> 'turbo-workflow--v*'` (highest semver). Check it against `^turbo-workflow--v\d+\.\d+\.\d+$`; anything else, stop. Same version as the lock → say the project is up to date, then still continue (a local file may have been lost).
3. **Fetch it.** `git clone --quiet --depth 1 --branch <tag> <source> <tmp>`, with `<tmp>` a new dir from `mktemp -d`.
4. **Plan.** `node <tmp>/plugins/turbo-workflow/scripts/vendor.mjs plan .` prints one entry per file: `same`, `update` (not edited here, new content), `edited` (changed here since the last copy), `new` (missing here), `dropped` (no longer part of the release). Show the counts and every path that is not `same`.
5. **Ask**, with AskUserQuestion (at most 4 questions per call):
   - each `edited` file: first show the diff: `node <tmp>/plugins/turbo-workflow/scripts/vendor.mjs show . <file> > <tmp>/new` then `git diff --no-index -- <file> <tmp>/new`. A "Take the new version" (Recommended), B "Keep mine";
   - each `dropped` file: A "Remove" (Recommended), B "Keep".
6. **Write.** `node <tmp>/plugins/turbo-workflow/scripts/vendor.mjs write . --take <A edited>… --keep <B edited>… --remove <A dropped>… --keep <B dropped>…`. It also re-merges the hooks into `.claude/settings.json` and the screenshot server into `.mcp.json`, and updates the lock. A kept file keeps its old hash, so it is asked about again next time.
7. **Report** the release (`<old version> → <new version>`), the files written, kept and removed, and `git status --short`. Remove `<tmp>`. The user reviews the diff and commits; do not commit.

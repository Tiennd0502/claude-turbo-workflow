# claude-turbo-workflow

Claude Code marketplace for [`turbo-workflow`](plugins/turbo-workflow/README.md): one ticket from tracker to a draft GitHub PR in a Turborepo: one plan approval (Gate 1), then reviews, commit, push and PR without asking unless something leaves the plan, with resume.

```text
/plugin marketplace add Tiennd0502/claude-turbo-workflow
/plugin install turbo-workflow@claude-turbo-workflow
```

Tests: `node --test "plugins/turbo-workflow/tests/*.test.mjs"`.

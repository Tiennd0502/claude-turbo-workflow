<!-- turbo-workflow -->
## Ticket workflow (turbo-workflow)

- Config: `.claude/workflow.json` (edit with `/turbo-workflow:init`). Per-app rules: `apps/<app>/.claude/rules/`, per-app gates: `apps/<app>/.claude/skills/verify/`.
- One ticket end to end: `/turbo-workflow:work-ticket <ticket | "task" | spec dir>`; where it stopped: `/turbo-workflow:ticket-status`.
<!-- copy-only:
- The workflow is copied into `.claude/` (rules, skills, agents, scripts, hooks; `.claude/turbo-workflow.lock`). Update it with `/turbo-workflow-sync`.
-->
<!-- /turbo-workflow -->

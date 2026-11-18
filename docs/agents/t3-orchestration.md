# T3 orchestration

The parent thread uses Codex (`gpt-6.2-sol`, `reasoningEffort: high`). It breaks down the work, makes decisions, and owns final review and verification.

1. Before the first delegation in a thread, call `orchestrator_capabilities` to confirm the configured provider, model, and options. Use `delegate_task` for child work with the explicit `target` below. If a route is unavailable, report it and get the user's choice before substituting.
2. Give each child a self-contained brief with the goal, scope, relevant files or diff, constraints, and acceptance criteria. Children receive no parent conversation history. Include a way to find the exact code under review when delegating a review.
3. Personally review each result and run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from `app/` before accepting it. Follow [repository verification](../../AGENTS.md#verification) for any additional checks. The parent runs the acceptance checks itself, even if the child ran checks during development.

| Work | `target.providerInstanceId` | `target.model` | `target.options` |
| --- | --- | --- | --- |
| Mechanical edits, formatting, simple tests, and straightforward documentation | `opencode` | `opencode/hy4-flash-free` | `{ "variant": "high" }` |
| Implementation, debugging, design tradeoffs, reviews, and work of ambiguous difficulty | `mistral_vibe` | `mistral-large-4-0-3` | `{ "thinking": "high", "mode": "accept-edits" }` |

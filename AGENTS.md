# Repository guidelines

## Working practices

- Work autonomously from investigation through implementation, verification, and PR preparation. Ask for clarification when the answer would materially change the solution.
- Prefer correct, simple, maintainable solutions. Follow existing conventions, fix root causes, and keep changes proportional to the task.
- Reuse existing code where practical. Avoid speculative abstractions, unnecessary dependencies, unrelated refactors, and premature optimization.
- For straightforward work, implement directly. For complex changes, plan briefly before implementation.
- Use skills and subagents when they add clear value. Avoid overlapping workflows, redundant reviews, and unnecessary documentation.
- Keep updates and final summaries concise. Report meaningful risks and verification that could not be completed.
- In a top-level T3 Code thread with access to T3's `delegate_task`, read [T3 orchestration](docs/agents/t3-orchestration.md) before starting project work.

## Project structure

- `app/src/domain/` contains CSV parsing, data contracts, review rules, and analytics. Keep these calculations independent of the UI.
- `app/src/data/` contains the Supabase adapter and persistence contracts. `app/src/components/` and `app/src/App.tsx` contain the interface.
- `app/tests/` contains database and browser tests. `app/scripts/` contains local verification tools.
- `supabase/` contains local configuration and database migrations. `.github/workflows/ci.yml` runs checks and deploys `main` to GitHub Pages.
- `README.md` and `docs/database.md` describe setup, verification, and database behavior.

## Data and security

- Preserve original CSV bytes, raw cells, shot order, and recorded club labels. Keep manual corrections and review decisions separate and reversible.
- Keep shot intent, contact quality, club-label review, and exclusions independent. Never silently reassign or exclude shots.
- Handle missing and malformed data explicitly. Keep measurement bases consistent and show sample sizes and uncertainty. Do not infer swing mechanics from ball-flight measurements.
- Preserve owner isolation, database-enforced access controls, import idempotency, review conflict handling, and backup/restore integrity.
- Never commit personal shot exports, credentials, service-role keys, or local environment files. Only publishable keys belong in frontend configuration.
- Treat hosted Supabase data as live user data. Do not reset or destroy databases, or apply unreviewed migrations. Test database changes locally and verify migration impact before applying them to a hosted project.

## Verification

Run commands from `app/` after `npm ci`:

- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` for relevant application changes.
- `npm run test:db` for database or persistence changes. It requires the local Supabase stack and `psql`.
- `npm run test:e2e` for relevant user-facing flows. It requires local Supabase and Playwright's Chromium and WebKit browsers.
- Use `npm run build -- --base=/shotwise/` when checking the GitHub Pages build.

Choose checks appropriate to the change. Add behavior-focused tests for calculations, data transformations, important edge cases, and regressions. Trivial presentation or documentation changes do not require exhaustive tests. Investigate failures introduced by the change; do not weaken tests merely to make them pass. Report checks that were not run.

## Git and pull requests

- Create a new branch for project work. Use lowercase, hyphen-separated names with `feat/`, `fix/`, `refactor/`, `perf/`, `test/`, `docs/`, or `chore/`. Never use the `codex/` prefix.
- Give each concurrent session its own worktree. Never run parallel agents in the same physical checkout: they share one working tree, so one session's uncommitted edits surface as another session's changes.
- Never switch branches with a dirty working tree. Commit or stash first — `git checkout` carries uncommitted changes across branches, which can make a stale `main` look like hand-written duplicate work.
- Fetch and fast-forward `main` before starting work. If `main` is behind `origin/main` with a dirty tree whose changes duplicate already-merged PRs, stash them, `git pull --ff-only`, and drop the stash once confirmed redundant.
- Keep commits focused and use descriptive messages, preferably Conventional Commits. Do not rewrite shared history or force-push without explicit authorization.
- Agents may implement, commit, push, open PRs, run checks, review results, and address feedback. Keep unrelated work out of the same PR.
- Review the final diff and explain the change and verification in the PR. Do not claim a PR is ready or checks passed without evidence.
- Only the repository owner may merge. Never merge a PR, enable auto-merge, or otherwise integrate into the target branch without the owner's explicit authorization. Do not close or abandon PRs without authorization.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues (`tristrange/shotwise`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, with label strings equal to their names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root and `docs/adr/`, both created lazily when terms or decisions are resolved. See `docs/agents/domain.md`.

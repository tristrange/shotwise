# Shotwise implementation plan

Goal: import once, preserve and review raw observations, produce qualified analytics and share saved history across devices.

Spec: ../specs/2026-11-16-shotwise-design.md. Work on codex/shotwise-mvp.

## Task 1: Domain and CSV
- [ ] Schema-derived domain contracts and validated external boundaries.
- [ ] CSV parser, raw preservation, hashes and import diagnostics (5 MB, 20k rows).
- [ ] Pure statistics, recent windows, filters, progress and anomaly rules.
- [ ] Unit fixtures: UTF8/BOM/CRLF/quotes/null/zero/malformed/unknown, quantiles, sample sizes, chronology, manual precedence and improvement.

## Task 2: Persistence
- [ ] Local Supabase schema, RLS/immutability and transaction RPCs.
- [ ] Atomic idempotent imports, optimistic review + undo, metadata/archive, backup/restore.
- [ ] Supabase adapter with validated pagination and dataset revisions.
- [ ] Database tests: isolation, direct write rejection, failed transaction, duplicate races, review conflicts, restore.

## Task 3: Review workflow
- [ ] Sign-in/setup, dated import previews, partial batch outcomes.
- [ ] Sessions, shot inspection, group edits, corrections/contact/exclusion and undo.
- [ ] Browser acceptance against real local Supabase.

## Task 4: Analytics UI
- [ ] Recent overview, club detail, Progress/All-time and consistent basis/intent/contact filters.
- [ ] Responsive charts, table equivalents, usable empty/error states and flag evidence.
- [ ] Counts, missingness, reviewed-subset reliability and date/session coverage.

## Task 5: Release verification
- [ ] Desktop/phone browser tests and cross-context persistence, expiry/failure/conflict/retry scenarios.
- [ ] Local acceptance of supplied 123-row CSV, never committed.
- [ ] CI, local/deployment/backup docs, full-branch independent review and fixes.

## Review focus
Same-day chronology, mixed measurement basis, partial wedges, stale pagination, malformed external input, multi-device correction conflicts, backup isolation, failed and concurrent imports. Never log credentials or put shot exports in source control.

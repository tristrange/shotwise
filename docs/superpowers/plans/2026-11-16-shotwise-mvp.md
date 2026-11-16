# Shotwise implementation plan

Goal: import once, preserve and review raw observations, produce qualified analytics and share saved history across devices.

Spec: ../specs/2026-11-16-shotwise-design.md. Work on codex/shotwise-mvp.

## Task 1: Domain and CSV

- [x] Schema-derived domain contracts and validated external boundaries.
- [x] CSV parser, raw preservation, hashes and import diagnostics (5 MB, 20k rows).
- [x] Pure statistics, recent windows, filters, progress and anomaly rules.
- [x] Unit fixtures: UTF8/BOM/CRLF/quotes/null/zero/malformed/unknown, quantiles, sample sizes, chronology, manual precedence and improvement.

## Task 2: Persistence

- [x] Local Supabase schema, RLS/immutability and transaction RPCs.
- [x] Atomic idempotent imports, optimistic review + undo, metadata/archive, backup/restore.
- [x] Supabase adapter with validated pagination and dataset revisions.
- [x] Database tests: isolation, direct write rejection, failed transaction, duplicate races, review conflicts, restore.

## Task 3: Review workflow

- [x] Sign-in/setup, dated import previews, partial batch outcomes.
- [x] Sessions, shot inspection, group edits, corrections/contact/exclusion and undo.
- [x] Browser acceptance against real local Supabase.

## Task 4: Analytics UI

- [x] Recent overview, club detail, Progress/All-time and consistent basis/intent/contact filters.
- [x] Responsive charts, table equivalents, usable empty/error states and flag evidence.
- [x] Counts, missingness, reviewed-subset reliability and date/session coverage.

## Task 5: Release verification

- [x] Desktop/phone browser tests and cross-context persistence, expiry/failure/conflict/retry scenarios.
- [x] Local acceptance of supplied 123-row CSV, never committed.
- [x] CI, local/deployment/backup docs, full-branch independent review and fixes.

## Review focus

Same-day chronology, mixed measurement basis, partial wedges, stale pagination, malformed external input, multi-device correction conflicts, backup isolation, failed and concurrent imports. Never log credentials or put shot exports in source control.

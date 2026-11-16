# Release verification — 16 November 2026

Verified locally with Node 26, PostgreSQL 17 and the real Supabase Auth/PostgREST services:

- 14 domain/data unit tests pass; typecheck, lint and production build pass.
- Database tests pass for ownership, raw-data immutability, malformed input, CSV provenance, duplicate imports, review conflicts, undo, backup restoration and competing transactions.
- Eight browser scenarios pass in desktop Chromium and phone-sized WebKit: imports, review and undo, independent browser sign-ins, backup round-trips, responsive layout, draft preservation through failed loads, conflict retry, metadata locking during saves and duplicate import retry.
- The supplied 123-shot CSV passes byte-preservation, order, missingness and trusted database validation. Its local database import was rolled back. Personal measurements were not uploaded to the hosted project or committed.
- The independent whole-implementation review found backup key-order and session draft-recovery defects. Regression tests reproduced these failures before the fixes. Server import/restore validation now binds measurements and raw rows to the original CSV. The date suggestion also handles four-digit years.
- The hosted schema was applied to a separate project. Personal account sign-in and authenticated RPC access were verified. Public signup and anonymous sign-in are disabled.

The hosted security advisor reports no database findings. Its remaining Auth warning is disabled leaked-password checking; the account uses a generated random password. Credentials are kept in an ignored local file and are not part of any source or deployment artifact.

Physical devices, screen readers, near-limit files and large histories were not profiled. Automated club-label suggestions are conservative starting rules, not a validated classifier. Hosting remains subject to free-tier limits. CI is configured; no GitHub-hosted run is claimed.

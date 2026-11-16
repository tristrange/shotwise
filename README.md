# Shotwise

Private golf practice analytics for Inrange CSV exports. Import dated sessions, review shot intent and contact, correct club labels, and compare current performance with historical sessions.

React, TypeScript and Vite run the interface and pure analytics. Supabase provides PostgreSQL and password authentication. The application has no Python service, AI interpretation, automatic contact classification or automatic club reassignment.

## Run locally

Install Node.js 22.12 or newer, Docker and a PostgreSQL client (`psql`). Development and CI are verified with Node 26.

```sh
npm ci
npx supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
cp .env.example .env.local
```

Set `.env.local` to the local API URL and **publishable** key reported by the CLI. Keep the service-role/secret key out of all `VITE_` variables. In an existing local database, apply pending migrations with `npx supabase migration up`. Do not reset a database containing data you want to keep.

Local and hosted signup should be disabled. Provision your personal email/password user using the Supabase Auth admin API or Studio's Authentication → Users screen. Never put a personal password in source or send it in chat.

```sh
npm run dev
```

Open the printed local URL and sign in. An unconfigured app shows setup instructions instead of storing data in a browser-only fallback. Saved history lives in PostgreSQL; authentication tokens are managed by Supabase in the browser.

## Import and review

Choose CSV files under **Sessions & import**. Confirm the practice date for each export; a suggested filename date is not proof. One export represents one session. Source row order is retained independently of the exported shot number.

The optional full-swing confirmation marks non-wedge shots as full. Wedges and unknown clubs retain unknown intent. Select source-row ranges to tag partial drills, contact quality, club corrections or exclusions. Every dimension is independent. Exclusions require a reason. Undo restores earlier manual decisions while retaining the audit history.

Duplicate complete exports return the existing session, including renamed files or changed line endings. Different exports on the same date need acknowledgement because overlapping exports cannot safely be merged automatically. Malformed measurements remain in the original file and appear as missing values with import warnings. Structurally invalid CSV files are rejected before saving.

## Read the analytics

- **Recent** targets 50 shots per effective club within 60 calendar days ending today. It keeps the full cutoff date, so actual counts can exceed 50. It does not fill sparse clubs with older history.
- **Progress** shows per-session summaries without claiming significance or inventing an order between untimed sessions on the same date.
- **All-time** includes all non-archived sessions.

Premium flat carry is the default and is labelled as an estimate. Measurement alternatives are explicit; a missing premium measurement is never replaced by a range-ball measurement. Each statistic shows measured and missing counts. Quantiles use R7 interpolation; sample SD requires two values, IQR four, and P10–P90 ten.

“Reviewed typical” includes only shots you marked typical. Review coverage and full-swing mishit counts describe the reviewed subset, which can be selective. They are not estimates of unreviewed shots. Intent filtering is separate.

Club-label flags use earlier range-flat carry and range ball speed: at least 30 shots across three sessions, both above median + 4 × scaled MAD. Zero-MAD, sparse, unknown-club and wedge cases abstain. Flags are review suggestions and never change inclusion or club assignment. The rule is deliberately conservative and has not been validated as a contact-quality classifier.

Inrange's Curve measures trajectory deviation from the launch-to-landing line, not landing dispersion. Lateral measurements follow the bay or selected-target aim line. The app does not infer club path or swing mechanics. See [Inrange's metric definitions](https://www.inrangegolf.com/players/faqs).

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:db
npx playwright install chromium webkit
npm run test:e2e
npm run verify:csv -- /absolute/path/to/session.csv
```

Database tests use local PostgreSQL only. SQL tests roll back; concurrent tests clean up their synthetic owners. Browser tests create synthetic local Auth users and use the real local API. Personal exports are never CI fixtures. A local sample-specific check is available with `--sample-acceptance` after the CSV path.

## Back up and deploy

Settings exports a versioned JSON backup containing original files, metadata and manual-review history. Store it privately. Restore validates original files and references and requires an empty account; it never silently overwrites existing history. Archive sessions when you want to hide them without deleting source data.

Use a dedicated Supabase project, enable its migrations, disable public/anonymous signup, and provision your account. Build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for that project. Deploy `dist/` to static hosting. The tracked Sites manifest supports a private hosted deployment; direct Cloudflare Pages deployment can use `npm run build` and `dist` as its output directory.

Free hosted projects can pause when inactive. Keep exported backups; a free tier is not a recovery plan. Never deploy test users, personal CSV files, service-role keys or local service credentials.

The approved [design](docs/superpowers/specs/2026-11-16-shotwise-design.md), [implementation plan](docs/superpowers/plans/2026-11-16-shotwise-mvp.md) and [database guide](docs/database.md) describe the boundaries. Gapping, practice advice, wedge distance-control analysis and automatic contact classification are later work.

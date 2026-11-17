# Shotwise

[Open Shotwise](https://tristrange.github.io/shotwise/)

Private golf practice analytics for Inrange CSV exports. Import dated sessions, review shot intent and contact, correct club labels, and compare current performance with historical sessions.

React, TypeScript and Vite run the interface and pure analytics. Supabase provides PostgreSQL and password authentication. The application has no Python service, AI interpretation, automatic contact classification or automatic club reassignment.

## Run locally

Install Node.js 22.12 or newer, Docker and a PostgreSQL client (`psql`). Development and CI are verified with Node 26.

```sh
cd app
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

Choose CSV files under **Sessions & import**. A valid date in the filename fills the practice date automatically; it remains editable. Enter a valid date when the filename has none. No confirmation checkbox is needed. One export represents one session. Source row order is retained independently of the exported shot number.

Import leaves intent unknown and requires no full-swing confirmation. If a different export conflicts with an existing session date, an explicit “Import as a separate session” retry preserves the same-day import safeguard without a checkbox. Select source-row ranges to tag partial drills, contact quality, club corrections or exclusions. Every dimension is independent. Exclusions require a reason. Undo restores earlier manual decisions while retaining the audit history.

Duplicate complete exports return the existing session, including renamed files or changed line endings. Different exports on the same date need acknowledgement because overlapping exports cannot safely be merged automatically. Malformed measurements remain in the original file and appear as missing values with import warnings. Structurally invalid CSV files are rejected before saving.

## Read the analytics

- **Recent** targets 50 shots per effective club within 60 calendar days ending today. It keeps the full cutoff date, so actual counts can exceed 50. It does not fill sparse clubs with older history.
- **Progress** shows separate per-club session charts for median carry and carry spread (the middle half, or IQR), with readable values and matching tables. Higher medians mean more distance; narrower spreads mean more consistent carry. Fewer than ten measurements are marked sample limited; spread needs four. Missing carry stays blank. Bars avoid suggesting a trajectory or order between untimed sessions on the same date. Differences alone do not establish improvement.
- **All-time** includes all non-archived sessions.

Overview, Gapping and Progress share the selected Recent/All-time window, measurement basis, intent and contact filters while you navigate. Recent is the default. Select All-time to see your full progression; changing a filter never changes saved shots. Filters reset when you reload or change accounts.

Gapping and practice insights apply those filters, then leave out shots marked partial or mishit and shots without a readable club or carry on the selected basis. Unreviewed shots remain included unless you select a review filter. Recent selection happens before these eligibility checks, so missing or unsuitable recent shots are never replaced with older history.

Premium flat carry is the default and is labelled as an estimate. Measurement alternatives are explicit; a missing premium measurement is never replaced by a range-ball measurement. Each statistic shows measured and missing counts. Quantiles use R7 interpolation; sample SD requires two values, IQR four, and P10–P90 ten.

“Reviewed typical” includes only shots you marked typical. Review coverage and full-swing mishit counts describe the reviewed subset, which can be selective. They are not estimates of unreviewed shots. Intent filtering is separate.

Club-label flags use earlier range-flat carry and range ball speed: at least 30 shots across three sessions, both above median + 4 × scaled MAD. Zero-MAD, sparse, unknown-club and wedge cases abstain. Flags are review suggestions and never change inclusion or club assignment. The rule is deliberately conservative and has not been validated as a contact-quality classifier.

Review also offers **experimental unusual-shot flags for irons**: both range-flat carry and range ball speed must be unusually low against at least 20 earlier paired shots for the same effective club. Each flag shows measurements, medians, cutoffs and sample size. Browse all shows abstention reasons. These shots could be mishits or intentional partial swings; leave contact uncertain if you cannot tell. Review decisions remain explicit and reversible. See the [rule and evaluation limits](docs/assisted-iron-review.md).

Inrange's Curve measures trajectory deviation from the launch-to-landing line, not landing dispersion. Lateral measurements follow the bay or selected-target aim line. The app does not infer club path or swing mechanics. See [Inrange's metric definitions](https://www.inrangegolf.com/players/faqs).

**Shot shape** plots recorded launch direction against recorded curve, separately for each club. Points can be selected with a pointer or keyboard to inspect the original measurements; expandable shot tables provide the same values, including missing measurements and separate From Centre values. Only shots with both direction and curve appear on the plot, with paired and omitted counts shown. The shared window and basis controls remain in the card; basis changes apply to carry values, while direction and curve remain as exported. This is a measurement view, with no landing-position reconstruction or swing diagnosis.

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

The public app is hosted on GitHub Pages. Its sign-in and shot history use a separate Supabase project; public account registration is disabled.

The verification workflow publishes `main` to Pages only after unit, database and browser checks pass. Set the repository Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the project URL and publishable key, and select GitHub Actions as the Pages publishing source. These values are intended for browser use; never substitute a service-role or secret key.

The Pages build runs `npm run build -- --base=/shotwise/` in `app/` and uploads `app/dist/`. For another deployment, use a dedicated Supabase project, apply the migrations, disable public/anonymous signup and provision your account. The tracked Sites manifest identifies the original private deployment.

Free hosted projects can pause when inactive. Keep exported backups; a free tier is not a recovery plan. Never deploy test users, personal CSV files, service-role keys or local service credentials.

The approved [design](docs/superpowers/specs/2026-11-16-shotwise-design.md), [implementation plan](docs/superpowers/plans/2026-11-16-shotwise-mvp.md) and [database guide](docs/database.md) describe the boundaries. Gapping, practice advice, wedge distance-control analysis and automatic contact classification are later work.

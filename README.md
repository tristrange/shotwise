# Shotwise

[Open Shotwise](https://tristrange.github.io/shotwise/)

Private golf practice analytics for Inrange CSV exports. Import dated sessions, review shot intent and contact, correct club labels, and compare current performance with historical sessions.

React, TypeScript and Vite run the interface and analytics. Supabase provides PostgreSQL and password authentication. Shotwise derives provisional intent, contact and club assessments while preserving the original measurements and recorded labels. Analytics are available after import. Manual review is optional.

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

## Find your way around

- **Home** shows the Overview and next-practice suggestions.
- **Clubs** opens club profiles, with Gapping, Wedge practice, Shot shape and the Ball-flight explorer nearby.
- **Progress** shows metrics visit by visit, with a session picker that links to the recap.
- **Sessions** contains CSV import, session recaps and side-by-side comparisons.
- **More** contains equipment, backups and optional Shot review. Personal carry and total-distance references live in each club profile.

## Import and review

Choose CSV files under **Sessions & import**. A valid date in the filename fills the practice date automatically; it remains editable. Enter a valid date when the filename has none. No confirmation checkbox is needed. One export represents one session. Source row order is retained independently of the exported shot number.

Import leaves manual intent unknown. Shotwise can infer intent or contact when there is enough evidence. Saved manual decisions take precedence and are reversible. If a different export conflicts with an existing session date, an explicit “Import as a separate session” retry preserves the same-day import safeguard without a checkbox. Select source-row ranges to tag partial drills, contact quality, club corrections or exclusions. Every dimension is independent. Exclusions require a reason. Undo restores earlier manual decisions while retaining the audit history.

Duplicate complete exports return the existing session, including renamed files or changed line endings. Different exports on the same date need acknowledgement because overlapping exports cannot safely be merged automatically. Malformed measurements remain in the original file and appear as missing values with import warnings. Structurally invalid CSV files are rejected before saving.

## Read the analytics

- **Recent** targets 50 shots per effective club within 60 calendar days ending today. It keeps the full cutoff date, so actual counts can exceed 50. It does not fill sparse clubs with older history.
- **Progress** lets you choose a club and a metric, including median carry, strong-strike potential and carry spread (IQR). Each measured point represents a visit. The picker and tables give access to the exact session and sample counts. Fewer than ten measurements are marked sample limited. IQR requires four measured carries. A session difference alone cannot establish improvement.
- **All-time** includes all non-archived sessions.

Overview, Gapping, Progress and Shot shape share the selected analysis settings while you navigate. The “Hide likely mishits” toggle starts off and optionally hides automatic flags and reviewed mishits from the current view; unassessed shots remain included. Saved shots and reviews are unchanged. Recent is the default. Select All-time to see your full progression; changing a filter never changes saved shots. Filters reset when you reload or change accounts.

Gapping compares neighbouring medians. A gap of 0–10 m or a reversed gap is flagged when both clubs have at least ten measured carries. The carry bands show consistency separately. Gapping excludes known partials and mishits and requires explicit full intent for wedges. Practice recommendations require a pattern on at least two comparable dates, using whole visits and the selected review filters.

**Wedge practice**, under Gapping, shows target coverage and groups shots by effective wedge and exact positive target distance. Missing and zero targets are grouped by saved intent. Each group shows measured carry and spread on the selected basis, with expandable shot rows and session links. Recorded directions are shown for target shots with proximity. Target and carry are displayed side by side because the CSV target's carry reference is unverified.

Premium flat carry is the default display basis and is labelled as an estimate. The selected basis determines which measurements a chart uses. Missing premium measurements stay missing. Quantiles use R7 interpolation. Sample SD requires two values, IQR four, and P10–P90 ten.

Strong-strike potential is the 80th percentile (P80) of eligible full-swing carries with at least ten usable carries. Club ratings use a fixed premium-flat basis and show their category coverage and evidence strength. They are a provisional personal performance index. Compatible personal references are optional. See [the rating methodology](docs/adr/0005-ratings-proposal.md).

Reviewed-only figures use your saved manual decisions. The main analytics use the resolved assessment, which may include automatic classifications when manual decisions are absent. Intent, contact, club and exclusions are tracked separately. See [assessment precedence and safeguards](docs/adr/0001-shot-assessment-precedence.md).

Sequence-aware assessments use the order of shots within a visit. They can suggest a missing club or flag a possible forgotten label change. A strong suspicion can withhold the shot from a club benchmark until there is clearer evidence. The original recorded club stays available for review.

Automatic intent and contact assessment uses a separate versioned rule with range-preferred measurements. It can abstain when the evidence is sparse. Classifier usefulness and rating anchors still need real-world evaluation.

Review also offers **unusual-shot flags** from a separate low-flight rule. A shot must be both unusually short and slow compared with earlier shots of the same club. The evidence shows the sample size and cutoffs. These provisional flags may include intentional partial swings. Contact remains uncertain until there is stronger evidence. See [the rule and evaluation limits](docs/assisted-iron-review.md).

Inrange's Curve measures trajectory deviation from the launch-to-landing line, not landing dispersion. Lateral measurements follow the bay or selected-target aim line. The app does not infer club path or swing mechanics. See [Inrange's metric definitions](https://www.inrangegolf.com/players/faqs).

**Shot shape** plots recorded launch direction against recorded curve, separately for each club. Points can be selected with a pointer or keyboard to inspect the original measurements; expandable shot tables provide the same values, including missing measurements and separate From Centre values. Only shots with both direction and curve appear on the plot, with paired and omitted counts shown. The shared window and basis controls remain in the card; basis changes apply to carry values, while direction and curve remain as exported. This is a measurement view, with no landing-position reconstruction or swing diagnosis.

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build -- --base=/shotwise/
npm run test:db
npx playwright install chromium webkit
npm run test:e2e
npm run verify:performance
npm run verify:classifier
npm run verify:csv -- /absolute/path/to/session.csv
```

Database tests use local PostgreSQL only. SQL tests roll back; concurrent tests clean up their synthetic owners. Browser tests create synthetic local Auth users and use the real local API. Personal exports are never CI fixtures. A local sample-specific check is available with `--sample-acceptance` after the CSV path.

## Back up and deploy

Settings exports a versioned JSON backup containing original files, session metadata, review history, equipment, assignments and personal references. Store it privately. Restore validates original files and references and requires an empty account. Archive sessions when you want to hide them without deleting source data.

The public app is hosted on GitHub Pages. Its sign-in and shot history use a separate Supabase project; public account registration is disabled.

Pull-request verification runs type checking, lint, unit tests, build, database tests and browser tests. On `main`, the same workflow runs application checks and builds Pages before deploying. Set the repository Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the project URL and publishable key, and select GitHub Actions as the Pages publishing source. These values are intended for browser use; never substitute a service-role or secret key.

The Pages build runs `npm run build -- --base=/shotwise/` in `app/` and uploads `app/dist/`. For another deployment, use a dedicated Supabase project, apply the migrations, disable public/anonymous signup and provision your account. The tracked Sites manifest identifies the original private deployment.

Free hosted projects can pause when inactive. Keep exported backups; a free tier is not a recovery plan. Never deploy test users, personal CSV files, service-role keys or local service credentials.

See the [design system](docs/DESIGN_SYSTEM.md), [roadmap and completion history](docs/ROADMAP.md), and [database guide](docs/database.md) for implementation details and current limitations.

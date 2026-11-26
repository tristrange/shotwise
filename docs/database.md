# Local database

From the `app/` directory, start the local stack with `npx supabase start`, apply pending migrations with `npx supabase migration up`, and run `npm run test:db`. The test runner uses `SHOTWISE_DB_URL` if supplied, otherwise it connects to local Postgres on port 54322. Tests use synthetic data; SQL tests roll back their transaction, and concurrency tests commit temporary records under random owner IDs and delete them afterward. The runner refuses non-local database hosts. `db reset` destroys local database data; it must never be pointed at a hosted project. Local signup is disabled; provision the intended account separately. The frontend only needs a publishable/anon key and a signed-in session, never a service-role key.

All rows are scoped to the authenticated owner. Clients can select only their own rows and cannot directly modify any table. Public invoker RPCs call private definer implementations that verify the authenticated identity. Writes serialize per owner; each successful mutation increments a dataset version exactly once. Readers compare versions before and after paging. Import retries match either file or content hash before the same-day check. File hashes are verified against stored original bytes; content hashes are recomputed from headers and raw cells using the parser’s canonical representation. The database parses the original UTF-8 CSV and checks its cells and measurements against each shot on import and restore. Only the current `inrange-1` parser version is accepted. Original files and shot payloads cannot be directly changed by clients.

Review and session updates require the previously read revision. A batch fails atomically on any conflict. Undo creates an audit event and a new revision; it walks backwards over previously applied review events. Restore is transactional and only accepts an empty account, preserving IDs and references scoped to that owner. The backup event field `undone` preserves undo eligibility across restores.

## Large import and restore verification

From `app/`, run `npm run verify:import-restore` against a disposable local stack with the current migrations. Set `SUPABASE_WORKDIR` to select a separate stack configuration. The script uses synthetic data and temporary local Auth accounts. It verifies a 3,000-shot import and retry, then restores the exported backup in a fresh account, including the original file bytes. The test history contains 106 visits and 15,600 shots. This is a verified test size. Throughput depends on the database and source files.

## Equipment persistence

Equipment and shot assignments live in `public.equipment` and `public.equipment_assignments`. Both tables enforce owner-scoped reads. Assignments use owner-qualified foreign keys to the shot and physical club. The authenticated write RPCs reuse the per-owner lock and bump the dataset version once per successful write.

`save_equipment` takes `{id,inrangeLabel,name,manufacturer,loft,status,acquiredOn,retiredOn,revision}`. Optional fields are nullable. Send a null revision to create or the previously read revision to update. Two clubs may share an Inrange label, and retired clubs remain available for historical use.

`assign_equipment` takes `{expectedVersion,sessionId,clubLabel,equipmentId,shotIds}`. The version pins the preview to the state the player confirmed. A null equipment ID clears the listed assignments. A conflicting club correction leaves the original assignment available for review.

`dataset_page` pages both `equipment` and `equipmentAssignments` inside the version-checked snapshot. Restore treats v1 backups as having empty equipment collections. V2 restores equipment and assignments alongside original CSV bytes, hashes, and reviews in one transaction, including assignments awaiting review. The empty-account check also covers equipment.

## Migration sequencing

From `app/`, run `npx supabase migration up` against the local stack, then run `npm run test:db`. Stage the reviewed migration on hosted Supabase **before** merging the Pages client that reads the new collections — the GitHub Pages deploy and the hosted migration are independent, so database-first release order is a hard rule, not a preference. `npm run test:db` exercises `dataset_page` for every collection and is the RPC-contract smoke test; run it against the target schema before each release.

Compatibility matrix:

| Client \ Database | Old schema | New schema |
| --- | --- | --- |
| Old client | works | works (never asks for new collections) |
| New client | works — `loadConsistent` treats collections the old RPC rejects with `Invalid table` as empty (`OPTIONAL_TABLES` in `app/src/data/snapshot.ts`) | works |

Newer clients must never *require* a new collection to load history. Writes to a new RPC from an old client fail loudly (e.g. the two-argument `delete_reference_value`), which is safe: no silent data loss. Backups taken from a tab opened before a schema change restore fine — restore treats missing collections as empty and validates present ones. Refresh open Shotwise tabs before downloading a backup that should include the new collections.

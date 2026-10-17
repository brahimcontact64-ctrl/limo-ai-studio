# Rollback scripts for pending migrations

These files are **not migrations** and are never applied automatically. Each one undoes one pending
migration from `supabase/migrations/`. Run them only in reverse order (newest first), only after taking
the backups listed in `docs/MIGRATION_REVIEW.md`, and only with the owner's approval.

| Rollback file | Undoes | Data removed by the rollback |
|---|---|---|
| `20261017200000_down.sql` | video rendering and MP4 export | render jobs and saved video settings (finished MP4 files stay in the library) |
| `20261017180000_down.sql` | Image Studio and social posts | image designs, revisions, export records, social post drafts (exported files stay in the library) |
| `20261017160000_down.sql` | Story Engine | Story Bible versions, seasons, episode endings and reviews, timeline (episode projects and scripts stay) |
| `20261017140000_down.sql` | character system | design specs, reference records and reviews, workspace character designs; stops if projects cast workspace characters |
| `20261017120000_down.sql` | script revisions and approval | all revision history and approval state |
| `20261017100000_down.sql` | universal creation, assets, brand kit | creation modes/briefs, narration, visual prompts, scene media links, brand kits, asset metadata; character-free projects must be handled first (see the pre-check in the file) |
| `20261017090000_down.sql` | admin hardening | feature flags table (subscription changes already made by admins stay) |
| `20261016150000_down.sql` | secure payment activation | none (restores the previous direct-insert policy) |
| `20261016140000_down.sql` | rate limits | rate-limit counters |

Every script was dry-run on the local replica inside a transaction that was rolled back
(`scripts/sql/rollback-dry-run.sh`), see `docs/TEST_REPORT.md`.

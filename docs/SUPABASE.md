# Local Supabase setup and migration

Course extension for an already initialized database: run [data/courses-supabase.sql](../data/courses-supabase.sql) in SQL Editor. Fresh exports include the extension automatically. See [COURSES.md](COURSES.md) for the course workflow, file limits and AI configuration.

The default storage backend is now Supabase PostgreSQL. The browser uses the same Next.js → Go API routes. The Go server connects directly to PostgreSQL using `DATABASE_URL`; no Supabase API URL, anon key, service-role key, or frontend secrets are required. Existing username/password accounts and role checks are preserved. This does not use Supabase Auth.

## Move the existing data

1. Stop the old app before the final export so no later CSV edits are missed.
2. From the project root, run:

   ```sh
   npm run db:export
   ```

   This reads `data/state.csv` and writes **`data/supabase-migration.sql`**. The file contains both schema creation and every business record, including account password hashes, goals, skill maps, activity history, requests, decisions, recommendations and audits. It is excluded from Git. Keep it private like a database backup. The source CSV is unchanged.

3. Copy `.env.example` to `.env` and fill in your actual local PostgreSQL connection string:

   ```dotenv
   STORAGE_BACKEND=supabase
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:YOUR_DB_PORT/postgres?sslmode=disable
   ```

   Use the **database port**, not the Studio or HTTP API port. Supabase CLI commonly uses 54322; self-hosted Docker setups may use a different port and username. Percent-encode reserved characters in the password. `sslmode=disable` is for local connections; use your deployment's TLS settings for network connections. Do not put this URL in a `NEXT_PUBLIC_` variable.

4. Open `data/supabase-migration.sql` in Supabase Studio's SQL editor and run the entire file as the database owner. Alternatively, with `.env` configured:

   ```sh
   npm run db:import
   ```

   A psql equivalent when `DATABASE_URL` is already set in your PowerShell session:

   ```powershell
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f data/supabase-migration.sql
   ```

5. Start the app:

   ```sh
   npm start
   ```

   `http://localhost:3000/api/health` must report `"storage":"supabase"`. Sign in with the existing credentials. Old in-memory login sessions cannot be exported, so users sign in once after cutover; new sessions survive API restarts. Account passwords do not change.

The initial export prepared in this workspace contains 203 employees, 40 events, 60 skills, 32 role profiles, 2,746 history records, 5 users, 1 request and 8 audits (no saved AI recommendations). Regenerate it after any further changes in CSV mode. The final query in the SQL file lists imported row counts.

## Files and tables

- `backend/migrations/001_supabase.sql`: reusable schema only.
- `data/supabase-migration.sql`: generated complete schema + private data export.
- `scripts/db.mjs`: export/import launcher; reads the same root `.env` as `npm start`.
- `career_quest` schema: `employees`, `events`, `skills`, `role_profiles`, `activity_history`, `app_users`, `requests`, `audit_log`, `recommendations`, `sessions`, `login_attempts`, `store_meta`, `imports`.

Select the `career_quest` schema in Studio's Table Editor to inspect the data. Nested skill maps, goals, event prerequisites and recommendation evidence retain their JSON structure; relational IDs have foreign keys. Date columns and request statuses have database types/constraints.

This schema is private: RLS is enabled on every table, and browser roles have no schema/table grants. Do not expose it through PostgREST. Use a database-owner connection for the Go server in this local setup. User authorization remains in Go, including employee privacy, direct-manager checks, HR-only actions and CSRF protection. This follows Supabase's [direct PostgreSQL connection](https://supabase.com/docs/guides/database/connecting-to-postgres) model for persistent backends.

## Persistence and migration behavior

Every read comes from PostgreSQL. Each mutation obtains a transaction-scoped database row lock, reloads current state, validates the action, and writes only changed/new rows before committing. Business changes and their audit entries commit together. This serializes competing app instances and prevents duplicate confirmations. Database outages return errors; the app never falls back to writing CSV.

The exporter includes an import checksum. Rerunning the **same file** is a no-op for data, even after new app activity. A **different export** is rejected when business data already exists; it cannot overwrite newer records. Import data is atomic; schema creation is a separate transaction. Startup checks the schema version and completed import marker and fails if either is missing. The schema is version 1; future schema changes require a new versioned migration, not edits applied over an old version 1 database.

Sessions store only a SHA-256 token digest, user ID, CSRF token and expiry; raw cookies are never stored. Expired sessions are removed when new sessions are issued. Login attempt counters are shared between servers. Successful login clears that host's counter and expired counters.

For this dataset-sized application the recommendation engine still loads the full business state per read/transaction. Database writes are incremental, but this is not yet optimized for millions of records. The app has no uploaded-file storage; textual evidence is persisted in the requests table. Gemini remains an optional external API with its existing opt-in gate.

## Fresh clone without state.csv

The normal export deliberately fails if `state.csv` is missing, rather than silently replacing existing accounts with new defaults. To initialize only the original dataset on a fresh clone, choose a new `DATA_DIR` with no credential file, then run:

```powershell
$env:DATA_DIR = 'data-fresh'
npm run db:export -- --from-dataset
```

This writes a new `state.csv`, a private `demo-accounts.txt`, and the SQL export under that directory. Existing runtime activity and additional fixtures are not part of the original dataset. Keep this new directory private; the root `data/` ignore rules do not automatically cover an arbitrary custom directory.

To export a different existing snapshot:

```sh
npm run db:export -- --source path/to/state.csv --export-sql data/custom-migration.sql
```

## Tests

```sh
npm test
```

Real database tests are enabled with `TEST_DATABASE_URL` pointing to a local PostgreSQL test server whose user may create databases:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/postgres?sslmode=disable'
npm test
```

Tests create a uniquely named temporary database, exercise lossless SQL import, preserved login, permissions, cross-instance sessions, the full approval workflow, concurrent completion, rollback, repeat imports, HR imports/account creation, shared rate limits and session expiry, then remove only that database. They never use `DATABASE_URL`. Without `TEST_DATABASE_URL`, the database integration test explicitly skips.

For legacy CSV-only development, explicitly set `STORAGE_BACKEND=csv`. Changes made in PostgreSQL are not copied back to the old CSV, so switching back after cutover is not a database rollback. Back up PostgreSQL with its normal backup tools.

# Deploy Career Quest with Supabase

Supabase hosts PostgreSQL. Deploy the Next.js frontend and Go API separately using the root Dockerfile, for example [on Dokploy](DOKPLOY.md). SQL alone does not host the application or an AI model.

The browser calls Next.js `/api/*`, which proxies to Go. Go connects with `DATABASE_URL` and enforces authorization. Existing username/password accounts, PBKDF2 hashes, sessions and CSRF checks are preserved. This app does **not** use Supabase Auth, Data API, Realtime or Storage buckets. No anon key or service-role API key is needed. Course assignment text is stored privately in PostgreSQL, up to 64 KiB per file.

Without a database URL, the app defaults to CSV. Explicitly set `STORAGE_BACKEND=supabase` so missing database configuration fails instead of starting CSV mode.

## SQL files

| Target | File | Contents |
|---|---|---|
| New database with this workspace's saved data | [`data/supabase-migration.sql`](../data/supabase-migration.sql) | All schema and business records, existing account hashes and three courses |
| Existing initialized Career Quest database | [`supabase/upgrade.sql`](../supabase/upgrade.sql) | Additive core/agent/course schema, missing example courses, private permissions and verification |
| Schema reference / separate provisioning | [`supabase/schema.sql`](../supabase/schema.sql) | All 19 tables, constraints, indexes and RLS; no accounts or data |
| Deployment verification | [`supabase/verify.sql`](../supabase/verify.sql) | Read-only readiness, required data, table/RLS/grant checks and row counts |

Choose **one** initialization path. Do not run the course seed before importing a complete snapshot: the initial import deliberately refuses a nonempty database. Creating the empty schema first is fine, but schema alone cannot start the app.

The complete export is private and ignored by Git because it contains account hashes. Public schema/upgrade bundles contain no account credentials. The Docker image does not include private exports.

## 1. Export your data

For an existing CSV app, stop writes before the final cutover export. From the repository root:

```sh
npm run db:export
```

This reads `data/state.csv`, preserves its business records and password hashes, includes any missing built-in courses, and writes `data/supabase-migration.sql`. The source CSV is unchanged. A running app may change its CSV after export, so regenerate after stopping writes for final cutover.

The snapshot regenerated during this review contains 203 employees, 43 events (including 3 courses), 60 skills, 32 role profiles, 2,746 history records, 5 accounts, 1 request, 9 audits, 1 agent run and 1 watch. Each export's SQL header lists its actual counts.

For a fresh clone without `state.csv`, use a fresh ignored subdirectory:

```powershell
$env:DATA_DIR = 'data/bootstrap'
npm run db:export -- --from-dataset
Remove-Item Env:DATA_DIR
```

This initializes the original dataset and creates `data/bootstrap/state.csv`, `demo-accounts.txt` and `supabase-migration.sql`. Accounts are `employee`, `manager`, `hr` and `colleague`; the generated password is in that directory's private `demo-accounts.txt`. You may set `DEMO_PASSWORD` before initialization; it never resets existing passwords. Import the bootstrap SQL file in the next step, not the default export.

For another existing snapshot:

```sh
npm run db:export -- --source path/to/state.csv --export-sql data/custom-migration.sql
```

## 2. Connect and initialize a new database

In Supabase, use **Connect** to copy the PostgreSQL URL. For this persistent server, use a direct connection when the network supports it, or the **Session pooler** on port 5432 for IPv4. Copy your project's exact host and username. Direct connections commonly require IPv6; pooler usernames include the project reference. See the [official connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Example hosted session-pooler URL; replace every placeholder:

```dotenv
STORAGE_BACKEND=supabase
DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

Use the database password, not an API key. Percent-encode reserved password characters (`@` → `%40`, `#` → `%23`). Never use `NEXT_PUBLIC_` for this URL. For self-hosted Supabase use its actual host, database port and TLS settings. Local CLI installations commonly use `127.0.0.1:54322` with `sslmode=disable`. Inside a deployed container, `localhost` refers to that container.

Choose either import method:

- **SQL Editor:** run the entire `data/supabase-migration.sql` as the database owner (`postgres`). For bootstrap, use `data/bootstrap/supabase-migration.sql`. The script finishes with row counts.
- **CLI:** put the connection URL in the root `.env`, then run:

  ```sh
  npm run db:import
  npm run db:verify
  ```

  For bootstrap use `npm run db:import -- --import-sql data/bootstrap/supabase-migration.sql`.

The Docker image also contains these commands: `/app/backend/careerquest --import-sql /path/to/mounted-export.sql` and `/app/backend/careerquest --verify-db`. Production reads runtime environment variables, not a local `.env` file.

Rerunning the identical export leaves business data unchanged, including newer app activity. A different snapshot is rejected on an initialized database. Schema creation commits separately; the data import is atomic. Do not delete live records to bypass the guard. For a deliberate replacement, initialize a separate database/project and switch connections after verification.

## 3. Upgrade an existing database

Back up PostgreSQL and stop app writes during the upgrade. Run [`supabase/upgrade.sql`](../supabase/upgrade.sql) in SQL Editor, or with the target URL in `.env`:

```sh
npm run db:migrate
npm run db:verify
```

This upgrade runs in one transaction. It refuses uninitialized databases or unsupported core versions, adds extensions, seeds only missing example events/courses, and reasserts private permissions. It preserves accounts, customized courses, progress and uploads on repeated runs. A verification failure rolls back the upgrade. It does not repair arbitrary manually changed column types or incompatible schemas.

Canonical SQL is in `backend/migrations/001_supabase.sql` through `004_course_examples.sql`, plus `verify.sql`. Regenerate the public bundles after changing those sources or `backend/course_examples.json`:

```sh
npm run db:sql
```

These are SQL Editor/psql bundles, not a Supabase CLI migration-history directory. Core `store_meta.schema_version` stays at 1; agent/course additions are additive extensions. Startup also applies those extensions idempotently and adds missing courses, so **runtime currently requires database-owner permissions**. Use the same owner for migration and runtime.

## 4. Deploy the application

Use the root Dockerfile and route HTTPS to container port **3000**. Set runtime variables as shown in [`.env.supabase.example`](../.env.supabase.example):

```dotenv
STORAGE_BACKEND=supabase
DATABASE_URL=YOUR_POSTGRESQL_CONNECTION_STRING
APP_ORIGIN=https://YOUR_APP_DOMAIN
COOKIE_SECURE=true
AGENT_PROVIDER=off
EXAM_AI_PROVIDER=off
ALLOW_EXTERNAL_AI=false
```

`APP_ORIGIN` must exactly match the browser origin, without a trailing slash. The application domain is separate from the Supabase project URL. No app data volume is needed in database mode; PostgreSQL needs persistent storage and backups. Start with one app replica; each Go process permits up to eight database connections.

Calculated recommendations, approvals, HR actions, courses and persisted uploads work with AI off. **Written-answer exam grading needs a reachable configured model.** The Docker image does not contain Ollama, and Go currently accepts only loopback Ollama URLs. See [Dokploy AI setup](DOKPLOY.md#ai-configuration) for a model sharing the app's network namespace, or [course configuration](COURSES.md) for an authorized external provider. Setting a provider variable does not install or start a model. No SQL migration supplies this service.

For local development use `APP_ORIGIN=http://localhost:3000`, `COOKIE_SECURE=false` and `npm start`.

## 5. Verify the deployment

Run `npm run db:verify` with the deployed database URL or execute [`supabase/verify.sql`](../supabase/verify.sql). The CLI also loads the full state through the Go model, catching missing columns or incompatible field types. It makes no seed or session writes and exits nonzero on failure.

Then verify:

- `https://YOUR_APP_DOMAIN/api/health` returns HTTP 200, `"ok": true` and `"storage": "supabase"`.
- Existing employee, manager and HR accounts can sign in. CSV passwords are preserved; old in-memory sessions need one new login. These accounts do not appear in Supabase Auth.
- Request → manager approval → evidence → HR confirmation persists across a restart.
- Course lessons and assignment uploads persist; test an exam with a configured model to verify grading.
- A PostgreSQL session remains signed in after an app restart, until its eight-hour expiry.

Select the `career_quest` schema in Studio's Table Editor. Its 19 tables are `skills`, `role_profiles`, `employees`, `events`, `activity_history`, `app_users`, `requests`, `audit_log`, `recommendations`, `agent_runs`, `agent_watches`, `courses`, `course_progress`, `course_uploads`, `exam_attempts`, `sessions`, `login_attempts`, `store_meta` and `imports`.

RLS is enabled on every table. `PUBLIC`, `anon`, `authenticated` and `service_role` receive no intended schema/table access. Do not expose `career_quest` through the Data API or add permissive browser policies. The owner bypasses RLS; Go enforces employee privacy, direct-manager access and HR permissions. This follows the [documented PostgreSQL RLS behavior](https://supabase.com/docs/guides/database/postgres/row-level-security).

Business transactions lock a metadata row, reload current state, validate actions and save changed rows with their audits. Sessions store token hashes, not raw cookies, and login counters are shared across instances. Reads still load the full business dataset; this design targets the current dataset scale.

## Troubleshooting and tests

| Symptom | Check |
|---|---|
| Connection failure | Exact Connect URL, encoded password, reachable host, TLS, owner role and session pooler for IPv4 |
| Schema/data not ready | Import the complete snapshot, not only schema SQL; run verification |
| Import refused | Existing data needs upgrade SQL, not another snapshot |
| Extension error | Apply upgrade SQL as owner; use that owner at runtime |
| 403 on login/writes | Exact `APP_ORIGIN`, including scheme and port |
| Missing login cookie | HTTPS with `COOKIE_SECURE=true`; false for local HTTP |
| Grading unavailable | Configure a reachable model; SQL cannot provide it |

Run `npm test`. Real database tests require `TEST_DATABASE_URL` pointing to a **test** server whose user can create databases. Tests create and remove uniquely named temporary databases. Coverage includes lossless imports, repeat imports, legacy upgrades, RLS, login, sessions, concurrent approvals, rollback, agent persistence, courses, uploads and exams. Grading tests use controlled model responses, not a live model.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/postgres?sslmode=disable'
npm test
```

Switching back to CSV after cutover does not copy PostgreSQL changes back. Use database backups for recovery.

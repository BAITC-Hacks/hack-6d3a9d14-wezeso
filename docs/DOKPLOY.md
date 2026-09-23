# Deploy on Dokploy

The root Dockerfile builds the Go API and the Next.js frontend into one image. Next.js listens on `0.0.0.0:3000` and proxies `/api/*` to Go on `127.0.0.1:8080`. The production launcher starts both built services and stops the container if either exits. No build commands run during startup.

## Application settings

1. Commit and push the application source and the deployment files to your Git repository. Include the current frontend/backend changes and `frontend/package-lock.json`. Local `.env`, runtime CSV data, credentials, and SQL exports are excluded from the Docker build context.
2. In Dokploy, create a project and an **Application**, then connect the repository and select the branch you pushed.
3. Select **Build Type: Dockerfile**. Set **Dockerfile Path** to `Dockerfile`, **Docker Context Path** to `.`, and leave **Docker Build Stage** and command/entrypoint overrides empty. The build context must be the repository root, not `frontend`.
4. In **Domains**, add your hostname, set **Container Port** to `3000`, **Path** to `/`, and enable HTTPS with Let's Encrypt. Point the hostname's DNS A record to the Dokploy server first; any AAAA record must also reach that server. There is no need to publish host ports `3000` or `8080`.
5. Add the environment variables below, choose storage, save, and deploy.

Dokploy references: [Dockerfile builds](https://docs.dokploy.com/docs/core/applications/build-type#dockerfile), [domains](https://docs.dokploy.com/docs/core/domains), [volumes and Swarm settings](https://docs.dokploy.com/docs/core/applications/advanced).

## Common environment

Set these in Dokploy's runtime **Environment** field. Replace the example origin with the exact public URL, including `https://` and without a trailing slash. This value controls the API's origin check for login and other writes.

```dotenv
APP_ORIGIN=https://career.example.com
COOKIE_SECURE=true
AGENT_PROVIDER=off
EXAM_AI_PROVIDER=off
ALLOW_EXTERNAL_AI=false
```

The image fixes frontend port `3000` and backend port `8080`; no port variables or build arguments are needed. Database credentials and AI keys belong in runtime environment variables, never build arguments or `NEXT_PUBLIC_*` variables.

## Option A: existing Supabase/PostgreSQL data

Add:

```dotenv
STORAGE_BACKEND=supabase
DATABASE_URL=postgresql://USER:ENCODED_PASSWORD@DB_HOST:5432/postgres?sslmode=require
```

Use the connection string and TLS settings for your actual database. `DB_HOST` must be reachable from the application container; `localhost` points back to the application itself. A database running on your laptop is not automatically accessible from Dokploy. A database deployed in Dokploy must share a Docker network with the application when you use its internal service hostname.

For a **new target database**, stop writes to the old CSV app, run `npm run db:export` locally, then import the generated private `data/supabase-migration.sql` into the target database using its SQL editor or the [import procedure](SUPABASE.md). This preserves existing account passwords and saved activity. An empty PostgreSQL database is insufficient: the app requires the schema and seeded records. If your target database already contains this application's initialized data, keep using it; do not import an older snapshot over it.

No app data volume is required in database mode. PostgreSQL needs its own persistent storage and backups. Start with one application replica.

## Option B: fresh CSV demo

Add:

```dotenv
STORAGE_BACKEND=csv
DATA_DIR=/app/data
DEMO_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
```

Before deploying, add a **Volume Mount** under **Advanced → Volumes/Mounts** with volume name `career-quest-data` and mount path `/app/data`. A fresh Docker volume inherits the image directory's ownership (Node UID 1000). An existing volume or bind mount must be writable by UID 1000.

Keep **Replicas = 1**, and set both update and rollback **Order = stop-first** so two containers never write the same CSV store. On a multi-node Swarm, pin the app to the node holding its local data volume. Expect brief downtime during deployments. Back up the volume.

The first startup seeds the supplied original dataset. Logins are `employee`, `manager`, `hr`, and `colleague`, all using your chosen `DEMO_PASSWORD`. This starts fresh; it does not include your laptop's saved changes. Changing `DEMO_PASSWORD` after initialization does not reset existing accounts. If you leave it unset, retrieve the generated password from `/app/data/demo-accounts.txt` using Dokploy's container terminal.

## AI configuration

The image defaults to calculated recommendations with AI providers off. Free-text exam grading needs an AI provider. For Ollama, run it separately on the server and configure a reachable service URL, for example:

```dotenv
AGENT_PROVIDER=ollama
EXAM_AI_PROVIDER=ollama
OLLAMA_URL=http://ollama:11434/api/chat
OLLAMA_MODEL=qwen3:4b
```

The `ollama` example hostname works only when the app and Ollama share a Docker network with that service name, and the model must be pulled into Ollama first. `127.0.0.1:11434` inside this app container cannot reach a separate Ollama service or your laptop. For external Gemini, follow [AGENT.md](AGENT.md) and [COURSES.md](COURSES.md); the supplied dataset's existing external-transmission restriction still applies.

## Verify and troubleshoot

- Open `https://YOUR_HOST/api/health`. Expect HTTP 200, `"ok": true`, and the selected `storage` value.
- Sign in, make a small change, and redeploy once to confirm persistence.
- **502:** check the deployment logs, domain container port `3000`, and database connectivity. Database initialization failures stop the whole container.
- **403 on login/writes:** make `APP_ORIGIN` match the browser's exact origin and redeploy.
- **Login cookie missing:** use HTTPS with `COOKIE_SECURE=true`. For a temporary HTTP-only test, use the HTTP origin and `COOKIE_SECURE=false`.
- **CSV store locked after a forced kill/server crash:** stop all app instances, confirm no writer remains, back up the volume, then remove only the stale `/app/data/state.lock` and start the single replica again. Never remove a live writer's lock.
- **Build killed for lack of memory:** increase build-server memory or use Dokploy's separate build server.

The local `npm start` remains a development launcher. Dokploy uses the Dockerfile's production command automatically.

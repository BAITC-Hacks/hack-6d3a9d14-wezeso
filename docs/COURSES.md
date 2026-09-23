# Courses, approval and AI exams

Three demonstration courses are added without replacing existing events or accounts:

| Course | Skill gains (capped at level 5) | Study time |
| --- | --- | --- |
| Ясная коммуникация в команде | Communication +1, Written communication +1 | 2 hours |
| SQL: от вопроса к проверенному отчёту | SQL +1, Critical thinking +1 | 3 hours |
| Документация, по которой можно действовать | Written communication +1, Teamwork +1 | 2 hours |

The application dialog shows the description and the employee's actual projected gains. The direct manager approves the request. The employee opens the course from **Мои шаги → Открыть курс**, studies both lessons, and marks each as studied. The exam unlocks after all lessons are complete. A lesson mark is self-reported, not proof of watching an entire video.

Each exam has four required questions: short answer (20 points), multiple choice (20), essay (30), and file assignment (30). The pass threshold is 70/100. The server scores multiple choice against its private answer key; the AI evaluates the written answers and actual file contents against private rubrics. Totals and pass/fail are calculated on the server. Passing completes the request and applies the capped gains exactly once. Failed exams retain feedback and allow another attempt. Existing activities without embedded courses continue to use HR verification.

## Supabase SQL

For an **existing Career Quest Supabase database**, paste the entire contents of [`../data/courses-supabase.sql`](../data/courses-supabase.sql) into Supabase Studio's SQL Editor and run it as the database owner. It creates four tables and seeds the three courses. Re-running it preserves existing courses, accounts, requests and results.

For a **fresh database**, first run:

```sh
npm run db:export
```

Apply the generated `data/supabase-migration.sql` in SQL Editor. This complete export includes the base schema, existing accounts, courses, answer keys and data. It contains private password hashes: do not publish it. Then configure server-only `.env`:

```dotenv
STORAGE_BACKEND=supabase
DATABASE_URL=postgresql://YOUR_DATABASE_USER:YOUR_ENCODED_PASSWORD@YOUR_DATABASE_HOST:5432/postgres?sslmode=require
```

Use your actual Supabase connection URL, including its username and port. Restart with `npm start`. No browser anon key or service-role key is needed: the existing Go API connects directly to PostgreSQL and enforces the app's cookie sessions, CSRF protection, ownership and manager permissions.

Tables in the private `career_quest` schema:

- `courses`: lessons, exam questions and private scoring keys.
- `course_progress`: completed lessons per approved request.
- `course_uploads`: bounded UTF-8 assignment content and metadata.
- `exam_attempts`: immutable submitted answers, grading state, feedback, scores and a short grading lease.

All four tables have RLS enabled and access revoked from browser roles, including `anon`, `authenticated` and `service_role`. The database owner connection is intentional; this is not a Supabase Auth / browser Data API integration. Files are stored privately in PostgreSQL, not a public Storage bucket. Supported files: TXT, MD, CSV, JSON and SQL, UTF-8, up to **64 KiB**, at most 20 files per request. PDF, Word, images and executable uploads are not supported in this demo. SQL uploads are evaluated as text and never executed.

The server also applies the additive schema and inserts missing demo courses at startup. To regenerate the standalone SQL after editing `backend/course_examples.json`:

```sh
node scripts/course-sql.mjs
```

## AI configuration

Gemini 3.8 Flash is the default exam model. Local Ollama remains an explicit option with no external transfer:

```dotenv
EXAM_AI_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434/api/chat
OLLAMA_MODEL=qwen3:4b
```

Run Ollama and install the selected model, for example `ollama pull qwen3:4b`. The endpoint must be loopback and the model cannot be a cloud model. A configured endpoint does not imply that a model is running. The grading deadline is 55 seconds; model size and hardware affect whether it can finish in time.

For the approved Gemini setup (default):

```dotenv
EXAM_AI_PROVIDER=gemini
EXAM_GEMINI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=YOUR_SERVER_KEY
ALLOW_EXTERNAL_AI=true
```

Gemini also requires an explicit checkbox before transmitting the employee's answers and file contents. Names, login credentials and employee profiles are omitted. Set `EXAM_AI_PROVIDER=off` to save attempts without contacting a model. No heuristic is presented as an AI grade when a model is unavailable.

Provider references: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

## Reliability and limitations

Submission is a separate transaction from grading, with an idempotency key. Closing a tab does not discard submitted answers. Provider failures and invalid responses leave the same attempt retryable. Concurrent grading is rejected; a lease older than two minutes can be reclaimed after a crashed worker. A cancelled request cannot receive gains from an in-flight result. AI outputs are validated for known question IDs, one grade per question and allowed point ranges. Essays and assignments still require an appropriate model; schema checks do not guarantee educational grading accuracy.

Lesson notes and exams are original demonstration material. Linked third-party videos are supplementary and in English; embedded playback depends on YouTube availability. The written lessons support completing the course if video is unavailable. Sources: [Google technical writing facilitator videos](https://developers.google.com/tech-writing/for-instructors), [Harvard CS50 SQL: Querying](https://cs50.harvard.edu/sql/weeks/0/). The example exams do not confer a Google, Harvard or Halyk certification.

## Verification

`npm test` checks the course workflow in CSV; with `TEST_DATABASE_URL` pointing at a disposable local test server it also checks real PostgreSQL migrations and persistence. Tests cover approvals, authorization, private keys, lesson gating, upload validation, actual file content sent to the provider, invalid/provider-failed grades, failed exams, resubmission, concurrent grading and exactly-once skill gains. The test AI is a local mock provider, not evidence of a live model's scoring quality.

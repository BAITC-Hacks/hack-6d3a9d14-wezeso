# Agentic Career Quest

The primary experience is proactive: no prompt is required. On the employee's first authenticated visit, the app subscribes their profile to the agent. A backend worker detects changes to their goal, verified skills, history, catalog and workload. It builds a new development plan, persists the result and shows the recommended next step on the home page. Unchanged inputs do not repeatedly call the model. The employee can pause the subscription or set its time/format constraints.

The worker continues while the Go server runs, even if the browser closes. Subscriptions and job leases survive a restart in both CSV and Supabase. Only users who have visited the app are subscribed. This is a development assistant, not an automatic enrolment or promotion system.

## What it actually does

1. Reads the employee's verified profile, goal, participation history and active workload.
2. Filters voluntary activities by audience, prerequisites, completed/active/declined events, sessions, preferred format and the available time budget.
3. Lets the model call `simulate_plan`, inspect its result, repair invalid choices and call `save_plan`. The model may also refresh `read_profile` and `search_activities`.
4. Calculates sequential skill gains on the server, respecting gain caps and avoiding overlapping credit. Produces 1–3 steps or an explicit no-match result.
5. Saves a development plan, an unfilled results workbook and an importable `.ics` file. Scheduled sessions are tentative date-only entries; self-paced work is a task without an invented start time.
6. After the employee confirms, atomically creates real manager-approval requests. Repeated clicks return the existing result. The existing manager → employee evidence → HR workflow is the only way to award skill gains.
7. Detects the resulting workload/progress change and reassesses the next steps automatically.

The optional prompt refines a plan; it is not the entry point for recommendations. The tool log records actual calls and results, never simulated reasoning.

## Run

```sh
npm start
```

With no storage configuration, the app uses local CSV. Setting `DATABASE_URL` selects Supabase; an explicit `STORAGE_BACKEND=supabase` requires a working database and never silently falls back. Existing Supabase installations receive the additive `002_agent.sql` extension at startup. All original data and accounts are retained.

The agent defaults to local Ollama. For the approved external Gemini setup, use the server-only `.env`:

```dotenv
AGENT_PROVIDER=gemini
ALLOW_EXTERNAL_AI=true
GEMINI_API_KEY=your-server-key
```

Restart `npm start` after changing environment variables. The project owner explicitly permitted Gemini for this implementation. Other deployments must independently determine whether their dataset may be transmitted. Automatic recommendations use that server permission; manual external requests also require the form's consent checkbox. The context excludes employee names, employee IDs, logins and raw history. Free-text instructions and previous model explanations are sent when using Gemini, so they must not contain personal data.

For local inference:

```dotenv
AGENT_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434/api/chat
OLLAMA_MODEL=qwen3:4b
ALLOW_EXTERNAL_AI=false
```

Install/run Ollama separately and pull a tool-capable model. The model must already be loaded and fast enough for the shared 8-second deadline. Loopback URLs only; redirects, inherited proxies and cloud model names are blocked. `AGENT_PROVIDER=off` selects the calculated planner explicitly.

Without a key, a model response, valid tools or a completed plan within 8 seconds, the server creates a useful **calculated plan**, visibly labeled **without LLM**. This fallback uses the structured goal and constraints, does not interpret free text and is not passed off as AI. Four model rounds and ten calls are the maximum; all rounds share the deadline. No fake model response is used in the application.

## Demonstration

- Log in as `employee`. A recommendation appears automatically on the home page; no chat prompt is needed.
- Open **Помощник**. Inspect the plan, verified facts, predicted progress, files and actual tool trace.
- Confirm **Согласовать план**. The manager receives real requests. Try submitting again: no duplicates.
- Use the manager and HR accounts to complete the existing workflow. Confirmed progress matches the simulated capped gains.
- Change the employee goal or confirm a result as HR. The backend detects the change and creates another plan without a new instruction.
- Pause automatic recommendations, change the profile and verify that no plan is generated. Resume to analyse the new state.
- Import the jury's JSON/CSV in HR, issue an account, and log in as that employee. There are no hard-coded jury IDs in the planner.

## Verification and boundaries

`npm test` covers real writes, downloads, CSV persistence, approval-to-progress, permissions, consent, stale plans, idempotent and concurrent submission, no-match cases, model tool repair, deadlines and calendar escaping. The evaluation runs on all 200 supplied profiles plus the three original-schema jury fixtures and their history. Counterexamples verify that the lowest skipped skill loses to a critical target gap, but hard time constraints can change that decision.

Set `TEST_DATABASE_URL` to a **local test PostgreSQL server** to include database persistence and restart tests. Tests create and remove isolated databases. Gemini and Ollama tool protocols are exercised using explicit HTTP test servers; those tests are not a claim that a live production model was used. A real Gemini key is required for live quality and latency evaluation. Passing the tests cannot guarantee a jury score.

Model tools cannot enroll someone, approve requests, award skills, change goals, access a colleague's private plan, execute code, send messages or browse arbitrary URLs. Batch submission checks the authoritative snapshot again. Generated workbooks are empty templates, not fabricated evidence. Calendar export is a file, not an external integration.

Provider references: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Ollama chat and tools](https://docs.ollama.com/api/chat).

# Agent verification — 23 September 2026

- `npm test` passed for the agent implementation and existing backend/frontend test suites, including real local PostgreSQL integration.
- Evaluated all 200 supplied profiles plus 3 jury-format profiles and their history: 166 valid plans and 37 explicit no-match results under an 8-hour/week, 8-week budget. This is a constraint-validity check, not a live-model quality score.
- End-to-end test: created three saved requests and three files; manager approved, employee submitted evidence, HR verified; actual progress matched the forecast, 62% → 70%.
- Proactive test: created a plan without any employee prompt, performed no new model work for unchanged inputs, reloaded the saved subscription, created exactly one replacement after a goal change under concurrent workers, and respected pause.
- Gemini and Ollama tool contracts: actual HTTP requests to test servers, model tool call → server simulation → model revision → persisted plan. Invalid completion tool was rejected and the model repaired its call. No production model response was fabricated.
- Persistence: plan, artifacts, subscription, and request links survive CSV reload and PostgreSQL/API-instance changes. Repeated or concurrent apply does not duplicate requests; stale plans cannot apply.
- Privacy: colleague, manager and HR cannot retrieve an employee's private plan or files. External requests require configured server permission. Model context is checked for names, employee IDs, credentials and raw profile identifiers.
- Browser: logged in with an isolated synthetic dataset at localhost:3003. The home page displayed a recommendation before any prompt was entered. Opened the automatically created plan, inspected its evidence and files, confirmed it and saw three real pending-manager requests with confirmed progress unchanged.
- A localization callback collision found in the browser was fixed without removing the concurrent localization work.
- Mobile viewport verification was interrupted by the browser debugger. Responsive styles are present; this turn does not claim a completed mobile browser check.
- Live Gemini remains unverified because GEMINI_API_KEY is absent. The running preview honestly used the calculated fallback. Add the key to the ignored server `.env` and restart for live evaluation.
- Final combined-code checks: production Next.js build passed in an isolated output directory; full Go suite with PostgreSQL passed in 37.353 seconds; `go vet` passed.

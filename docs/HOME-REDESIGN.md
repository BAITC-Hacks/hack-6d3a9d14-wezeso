# Home and activity redesign

Implemented with the installed @cloudflare/kumo components.

- Home: current/next activity, goal, focus skills, recent results, and compact character progress.
- Steps: compact expandable rows, Kumo status tabs, search, and role-specific actions.
- Shared navigation and spacing; existing character, badge, typography, loading, and catalogue work retained.
- Shorter labels and empty states; full submitted evidence remains available in the expanded row.
- Current section survives refresh; browser Back and Forward work.

Verified on 23 September 2026:

- Frontend TypeScript and production build passed.
- Browser checks with real local employee, manager, and HR sessions passed.
- Home, request filters, search, keyboard row expansion, goal/activity dialogs, skill expansion, sidebar collapse, catalogue, history, and route restoration checked.
- Widths 320, 390, 768, and 1440 checked; no page overflow on home or steps.
- No browser runtime errors in the recorded checks.
- Existing character and backend tests passed before unrelated backend changes were made in the shared workspace.

Local verification artifacts: artifacts/redesign-checks.json, artifacts/home-redesign-desktop.png, artifacts/steps-redesign-desktop.png, and responsive captures in artifacts/.

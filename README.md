# Halyk · Career Quest

**Supabase:** приложение теперь по умолчанию хранит данные в локальном Supabase PostgreSQL. Перед запуском выполните `npm run db:export`, примените `data/supabase-migration.sql` и задайте серверный `DATABASE_URL` в `.env`. Подробная инструкция: [docs/SUPABASE.md](docs/SUPABASE.md). Существующие логины и пароли сохраняются. Приведённые ниже сведения о CSV описывают прежний режим, доступный явно через `STORAGE_BACKEND=csv`.

Рабочий локальный прототип Case 1: профиль → объяснимый выбор активности → руководитель → результат сотрудника → проверка HR → рост навыков. Go + Next.js / TypeScript, Kumo UI, CSV, серверный Gemini 3.8 Flash, React-адаптация bloub.

```sh
npm start
```

Открыть **http://localhost:3000**. Требуются Node.js 22+ и Go 1.25+; в текущем workspace Go уже лежит в `.tools/go`. Зависимости frontend устанавливаются автоматически при первом запуске.

Логины: **employee**, **manager**, **hr**, **colleague**. Сгенерированный пароль находится в локальном `data/demo-accounts.txt`. HR выдаёт новые учётные записи через интерфейс. Пароли в CSV — PBKDF2-HMAC-SHA256 (600 000 итераций); сырой пароль и session token не попадают в клиентский код или Git.

| Что нужно | Где |
|---|---|
| Подробный запуск, роли, демонстрация | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| Цель, все критерии кейса, проверка и источники Halyk | [docs/CASE1.md](docs/CASE1.md) |
| Устройство и ограничения | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Результаты проверок | [docs/QA.md](docs/QA.md) |
| Исходная спецификация | [docs/TECHNICAL_SPECIFICATION.txt](docs/TECHNICAL_SPECIFICATION.txt) |
| Исходная схема датасета | [docs/DATASET.md](docs/DATASET.md), [README.ru.md](README.ru.md), [README.kz.md](README.kz.md) |
| Backend и тесты | [backend/](backend/) |
| Frontend | [frontend/](frontend/) |
| Пример переменных окружения | [.env.example](.env.example) |
| Демонстрационный CSV | [data/demo.csv](data/demo.csv) |
| Три дополнительных профиля и история | [fixtures/](fixtures/) |
| Лицензии и происхождение bloub | [third_party/NOTICE.md](third_party/NOTICE.md) |

```sh
npm test
npm run build
```

Первый запуск преобразует исходные 200 профилей, 40 активностей, 60 навыков, 32 профиля ролей и 2743 записи истории в CSV. Рабочий `data/state.csv` сохраняет также учётные записи, заявки, решения, рекомендации и аудит. Этот файл и локальные пароли исключены из Git. В текущем состоянии сохранены действия браузерной проверки, включая три импортированных профиля.

**ИИ:** без GEMINI_API_KEY недоступен. ALLOW_EXTERNAL_AI по умолчанию false: исходный датасет нельзя выносить за контур хакатона. Для разрешённых собственных данных задайте серверный ключ и разрешение в `.env`, затем перезапустите. Положительный контракт модели проверен локальным тестовым сервером; реальный успешный ответ Gemini без ключа не подтверждён.

**Границы:** один процесс CSV; сессии сбрасываются при перезапуске; журнал не защищён от администратора файловой системы. Нет MyHalyk/LMS/SSO, банковских операций, уведомлений, календаря, курса внутри приложения или внешней проверки сертификата. HR вручную оценивает текстовое доказательство. Это продуктовая модель, не утверждение об официальном процессе Halyk. Интерфейс русский, каталог исходно английский; полной казахской локализации нет.

---

## Original dataset reference

Synthetic data. No real people or companies.

**Snapshot date:** `2026-10-01`. Treat it as "today".
**History window:** `2024-10-01` – `2026-09-30`.

## Files

| File | Content | Size |
|---|---|---|
| `skills.json` | Skill catalog, proficiency scale, role requirements by grade | 60 skills, 8 roles × 4 grades |
| `employees.json` | Employee profiles | 200 |
| `events.json` | Development activities catalog | 40 |
| `activity_history.csv` | Participation log | 2,743 records |

## Relations

```
employees.skills ─────────────┐
role_profiles.required_skills ├──> skills.skill_id
events.develops_skills ───────┤
events.prerequisites ─────────┘
employees.(role, grade) ──────> role_profiles.(role, grade)
employees.manager_id ─────────> employees.employee_id
activity_history.employee_id ─> employees.employee_id
activity_history.event_id ────> events.event_id
```

All references are valid. IDs are unique.

## skills.json

`proficiency_scale` — meaning of levels 0–5. All skill levels in the dataset use this scale.

`skills[]`

| Field | Type | Notes |
|---|---|---|
| `skill_id` | string | e.g. `SK_SYSTEM_DESIGN` |
| `name` | string | |
| `type` | `hard` \| `soft` | |
| `category` | string | Grouping for reports |
| `description` | string | |

`role_profiles[]` — one entry per role and grade.

| Field | Type | Notes |
|---|---|---|
| `role` | string | 8 roles |
| `grade` | `Junior` \| `Middle` \| `Senior` \| `Lead` | In this order |
| `required_skills` | object | `skill_id → minimum level` for this grade |
| `critical_skills` | array | Skills that must meet the requirement to hold this grade. Key for promotion |

Requirements never decrease from grade to grade.

## employees.json

| Field | Type | Notes |
|---|---|---|
| `employee_id` | string | `E0001` … `E0200` |
| `full_name` | string | Synthetic |
| `department` | string | One department per role |
| `role`, `grade` | string | Match a `role_profiles` entry |
| `manager_id` | string \| null | A Lead of the same department. `null` for department heads |
| `hire_date` | date | |
| `tenure_months` | int | Full months from `hire_date` to snapshot date |
| `work_format` | `office` \| `hybrid` \| `remote` | |
| `preferred_language` | `kk` \| `ru` \| `en` | UI language preference |
| `career_goal` | object \| null | `{target_role, target_grade}`. `null` = no goal set |
| `skills` | object | `skill_id → level 0–5`. Missing skill = level 0 |
| `last_review_date` | date | Date of the last skill assessment |

Skill levels reflect the last assessment. Activities completed after `last_review_date` are not yet included.

## events.json

| Field | Type | Notes |
|---|---|---|
| `event_id` | string | `EV_001` … `EV_040` |
| `title`, `description` | string | |
| `type` | string | `compliance`, `onboarding`, `course`, `workshop`, `mentoring`, `certification`, `meetup` |
| `format` | `online` \| `offline` \| `self_paced` | |
| `duration_hours` | number | Total effort |
| `mandatory` | bool | Assigned by HR. Not a recommendation target |
| `target_roles`, `target_grades` | array | Who the event is for |
| `develops_skills` | array | `{skill_id, gain, max_level}`: completion raises the skill by `gain`, but not above `max_level`. Empty for compliance training |
| `prerequisites` | object | `skill_id → minimum level` needed to join |
| `upcoming_sessions` | array of dates | Future sessions. Empty for `self_paced` (available any time) |

## activity_history.csv

One row = one employee's participation in one event.

| Column | Type | Notes |
|---|---|---|
| `record_id` | string | `R000001` … |
| `employee_id`, `event_id` | string | |
| `date` | date | Session date; enrollment or assignment date for self-paced |
| `due_date` | date \| empty | Mandatory events only |
| `status` | string | See below |
| `completion_pct` | int 0–100 | |
| `score` | int 0–100 \| empty | Final assessment. Courses, certifications and compliance only |
| `feedback_rating` | int 1–5 \| empty | Employee's rating of the event. Optional |
| `assigned_by` | `self` \| `manager` \| `hr` | Who initiated participation |

**Statuses**

| Status | Meaning | `completion_pct` |
|---|---|---|
| `completed` | Finished | 100 |
| `in_progress` | Started, not finished yet | 0–95 |
| `dropped` | Started and abandoned | 5–95 |
| `no_show` | Registered for a session, did not attend. Scheduled events only | 0 |
| `declined` | Refused an assignment from manager or HR | 0 |
| `overdue` | Mandatory event not finished by `due_date` | 0–95 |

Rows are sorted by `date`, `employee_id`, `event_id`.

## Rules

- An event is not repeated after `completed`. Exception: `EV_036` (recurring club).
- Voluntary events in history always match the employee's role, grade (current or previous) and prerequisites.
- New employees complete `EV_004` in their first month.
- Evaluation uses additional employee profiles and history records in the same format. Your solution must be able to load them.

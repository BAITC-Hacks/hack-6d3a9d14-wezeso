-- Run as the database owner in Supabase Studio's SQL editor or with psql.
-- The Go API is the authorization boundary. This schema is NOT a public Data API.
BEGIN;
CREATE SCHEMA IF NOT EXISTS career_quest;
REVOKE ALL ON SCHEMA career_quest FROM PUBLIC;

CREATE TABLE IF NOT EXISTS career_quest.store_meta (
    id integer PRIMARY KEY CHECK (id = 1),
    schema_version integer NOT NULL,
    ready boolean NOT NULL DEFAULT false
);
INSERT INTO career_quest.store_meta (id, schema_version) VALUES (1, 1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS career_quest.imports (
    checksum text PRIMARY KEY,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_quest.skills (
    sort_order integer NOT NULL UNIQUE,
    skill_id text PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('hard', 'soft')),
    category text NOT NULL,
    description text NOT NULL
);
CREATE TABLE IF NOT EXISTS career_quest.role_profiles (
    sort_order integer NOT NULL UNIQUE,
    role text NOT NULL,
    grade text NOT NULL CHECK (grade IN ('Junior', 'Middle', 'Senior', 'Lead')),
    required_skills jsonb NOT NULL CHECK (jsonb_typeof(required_skills) = 'object'),
    critical_skills jsonb,
    PRIMARY KEY (role, grade)
);
CREATE TABLE IF NOT EXISTS career_quest.employees (
    sort_order integer NOT NULL UNIQUE,
    employee_id text PRIMARY KEY,
    full_name text NOT NULL,
    department text NOT NULL,
    role text NOT NULL,
    grade text NOT NULL,
    manager_id text REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    hire_date date NOT NULL,
    tenure_months integer NOT NULL CHECK (tenure_months >= 0),
    work_format text NOT NULL CHECK (work_format IN ('office', 'hybrid', 'remote')),
    preferred_language text NOT NULL CHECK (preferred_language IN ('kk', 'ru', 'en')),
    career_goal jsonb,
    skills jsonb NOT NULL CHECK (jsonb_typeof(skills) = 'object'),
    last_review_date date NOT NULL,
    FOREIGN KEY (role, grade) REFERENCES career_quest.role_profiles(role, grade) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS career_quest.events (
    sort_order integer NOT NULL UNIQUE,
    event_id text PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    type text NOT NULL,
    format text NOT NULL CHECK (format IN ('online', 'offline', 'self_paced')),
    duration_hours double precision NOT NULL CHECK (duration_hours >= 0),
    mandatory boolean NOT NULL,
    target_roles jsonb,
    target_grades jsonb,
    develops_skills jsonb,
    prerequisites jsonb,
    upcoming_sessions jsonb
);
CREATE TABLE IF NOT EXISTS career_quest.activity_history (
    -- Preserve input ordering for same-day skill gains with different caps.
    sort_order integer NOT NULL UNIQUE,
    record_id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    event_id text NOT NULL REFERENCES career_quest.events(event_id) DEFERRABLE INITIALLY DEFERRED,
    date date NOT NULL,
    due_date date,
    status text NOT NULL CHECK (status IN ('completed', 'in_progress', 'dropped', 'no_show', 'declined', 'overdue')),
    completion_pct integer NOT NULL CHECK (completion_pct BETWEEN 0 AND 100),
    -- Strings preserve the original CSV/API contract, including an empty score.
    score text NOT NULL CHECK (score = '' OR score ~ '^(100|[0-9]{1,2})$'),
    feedback_rating text NOT NULL CHECK (feedback_rating = '' OR feedback_rating ~ '^[1-5]$'),
    assigned_by text NOT NULL CHECK (assigned_by IN ('self', 'manager', 'hr'))
);
CREATE TABLE IF NOT EXISTS career_quest.app_users (
    sort_order integer NOT NULL UNIQUE,
    id text PRIMARY KEY,
    login text NOT NULL UNIQUE CHECK (login = lower(login)),
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('employee', 'manager', 'hr')),
    employee_id text UNIQUE REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (role = 'hr' OR employee_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS career_quest.requests (
    sort_order integer NOT NULL UNIQUE,
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    event_id text NOT NULL REFERENCES career_quest.events(event_id) DEFERRABLE INITIALLY DEFERRED,
    status text NOT NULL CHECK (status IN ('pending_manager', 'approved', 'pending_hr', 'completed', 'declined', 'rejected', 'cancelled')),
    session_date date,
    -- RFC3339 text preserves the API's exact timestamp precision and signatures.
    created_at text NOT NULL,
    updated_at text NOT NULL,
    evidence text NOT NULL,
    note text NOT NULL,
    gains jsonb,
    confirmed_by text REFERENCES career_quest.app_users(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS requests_one_active_event ON career_quest.requests(employee_id, event_id)
    WHERE status IN ('pending_manager', 'approved', 'pending_hr');
CREATE TABLE IF NOT EXISTS career_quest.audit_log (
    sort_order integer NOT NULL UNIQUE,
    id text PRIMARY KEY,
    actor text NOT NULL REFERENCES career_quest.app_users(id) DEFERRABLE INITIALLY DEFERRED,
    role text NOT NULL,
    employee_id text REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    entity_id text NOT NULL,
    action text NOT NULL,
    detail text NOT NULL,
    at text NOT NULL
);
CREATE TABLE IF NOT EXISTS career_quest.recommendations (
    sort_order integer NOT NULL UNIQUE,
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    model text NOT NULL,
    at text NOT NULL,
    choices jsonb,
    signature text NOT NULL,
    evidence jsonb
);
CREATE TABLE IF NOT EXISTS career_quest.sessions (
    token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
    user_id text NOT NULL REFERENCES career_quest.app_users(id) ON DELETE CASCADE,
    csrf text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS career_quest.login_attempts (
    host text PRIMARY KEY,
    count integer NOT NULL,
    until_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS employees_manager ON career_quest.employees(manager_id);
CREATE INDEX IF NOT EXISTS history_employee_date ON career_quest.activity_history(employee_id, date);
CREATE INDEX IF NOT EXISTS requests_employee_status ON career_quest.requests(employee_id, status);
CREATE INDEX IF NOT EXISTS audits_employee_at ON career_quest.audit_log(employee_id, at);
CREATE INDEX IF NOT EXISTS recommendations_employee_at ON career_quest.recommendations(employee_id, at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON career_quest.sessions(expires_at);

-- No browser role receives access to personnel, credentials, or sessions.
-- The connection owner bypasses RLS; all user-level checks remain in Go.
DO $security$
DECLARE t record; r text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'career_quest' LOOP
        EXECUTE format('ALTER TABLE career_quest.%I ENABLE ROW LEVEL SECURITY', t.tablename);
        EXECUTE format('REVOKE ALL ON career_quest.%I FROM PUBLIC', t.tablename);
    END LOOP;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA career_quest FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA career_quest FROM %I', r);
        END IF;
    END LOOP;
END
$security$;
COMMIT;

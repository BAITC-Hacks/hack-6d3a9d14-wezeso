BEGIN;
CREATE TABLE IF NOT EXISTS career_quest.agent_runs (
    sort_order integer NOT NULL UNIQUE,
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES career_quest.employees(employee_id) DEFERRABLE INITIALLY DEFERRED,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    status text NOT NULL CHECK (status IN ('draft', 'applied', 'cancelled', 'no_match')),
    trigger text NOT NULL DEFAULT 'manual',
    mode text NOT NULL CHECK (mode IN ('llm', 'planner')),
    model text NOT NULL,
    warning text NOT NULL,
    input jsonb NOT NULL,
    input_hash text NOT NULL,
    signature text NOT NULL,
    target jsonb NOT NULL,
    summary text NOT NULL,
    steps jsonb NOT NULL,
    progress_before integer NOT NULL CHECK (progress_before BETWEEN 0 AND 100),
    progress_after integer NOT NULL CHECK (progress_after BETWEEN 0 AND 100),
    projected_gaps jsonb NOT NULL,
    total_hours double precision NOT NULL,
    existing_hours double precision NOT NULL,
    trace jsonb NOT NULL,
    artifacts jsonb NOT NULL,
    duration_ms bigint NOT NULL
);
ALTER TABLE career_quest.agent_runs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual';
CREATE TABLE IF NOT EXISTS career_quest.agent_watches (
    sort_order integer NOT NULL UNIQUE,
    employee_id text PRIMARY KEY REFERENCES career_quest.employees(employee_id),
    enabled boolean NOT NULL,
    constraints jsonb NOT NULL,
    signature text NOT NULL,
    last_run_id text NOT NULL,
    status text NOT NULL,
    claim text NOT NULL,
    lease_until text NOT NULL,
    updated_at text NOT NULL,
    reason text NOT NULL
);
ALTER TABLE career_quest.agent_watches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON career_quest.agent_watches FROM PUBLIC;
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_idempotency ON career_quest.agent_runs(employee_id, (input->>'idempotency_key'));
CREATE INDEX IF NOT EXISTS agent_runs_employee_at ON career_quest.agent_runs(employee_id, created_at);
ALTER TABLE career_quest.agent_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON career_quest.agent_runs FROM PUBLIC;
DO $security$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON career_quest.agent_runs FROM %I', r);
            EXECUTE format('REVOKE ALL ON career_quest.agent_watches FROM %I', r);
        END IF;
    END LOOP;
END
$security$;
COMMIT;

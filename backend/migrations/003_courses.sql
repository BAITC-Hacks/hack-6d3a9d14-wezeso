-- Additive migration. Apply after 001_supabase.sql (or the complete initial export).
BEGIN;
CREATE TABLE IF NOT EXISTS career_quest.courses (
 sort_order integer NOT NULL UNIQUE,
 event_id text PRIMARY KEY REFERENCES career_quest.events(event_id) DEFERRABLE INITIALLY DEFERRED,
 pass_score integer NOT NULL CHECK (pass_score BETWEEN 1 AND 100),
 lessons jsonb NOT NULL CHECK (jsonb_typeof(lessons) = 'array'),
 questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array')
);
CREATE TABLE IF NOT EXISTS career_quest.course_progress (
 sort_order integer NOT NULL UNIQUE,
 id text PRIMARY KEY,
 request_id text NOT NULL UNIQUE REFERENCES career_quest.requests(id) DEFERRABLE INITIALLY DEFERRED,
 completed_lessons jsonb NOT NULL,
 updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS career_quest.course_uploads (
 sort_order integer NOT NULL UNIQUE,
 id text PRIMARY KEY,
 request_id text NOT NULL REFERENCES career_quest.requests(id) DEFERRABLE INITIALLY DEFERRED,
 question_id text NOT NULL,
 name text NOT NULL,
 content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 65536),
 size integer NOT NULL CHECK (size BETWEEN 1 AND 65536),
 created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS career_quest.exam_attempts (
 sort_order integer NOT NULL UNIQUE,
 id text PRIMARY KEY,
 request_id text NOT NULL REFERENCES career_quest.requests(id) DEFERRABLE INITIALLY DEFERRED,
 idempotency_key text NOT NULL,
 created_at text NOT NULL,
 updated_at text NOT NULL,
 status text NOT NULL CHECK (status IN ('submitted', 'grading', 'graded', 'grading_failed')),
 answers jsonb NOT NULL,
 grades jsonb,
 score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
 passed boolean NOT NULL,
 feedback text NOT NULL,
 model text NOT NULL,
 lease text NOT NULL,
 UNIQUE(request_id, idempotency_key),
 CHECK (NOT passed OR (status = 'graded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS exams_one_pending ON career_quest.exam_attempts(request_id) WHERE status <> 'graded';
CREATE UNIQUE INDEX IF NOT EXISTS exams_one_pass ON career_quest.exam_attempts(request_id) WHERE passed;
CREATE INDEX IF NOT EXISTS course_uploads_request ON career_quest.course_uploads(request_id);
CREATE INDEX IF NOT EXISTS exams_request ON career_quest.exam_attempts(request_id);
-- App sessions are server-owned; browser roles must never read answer keys or uploads.
DO $security$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['courses', 'course_progress', 'course_uploads', 'exam_attempts'] LOOP
  EXECUTE format('ALTER TABLE career_quest.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON career_quest.%I FROM PUBLIC', t);
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('REVOKE ALL ON career_quest.%I FROM %I', t, r);
   END IF;
  END LOOP;
 END LOOP;
END
$security$;
COMMIT;

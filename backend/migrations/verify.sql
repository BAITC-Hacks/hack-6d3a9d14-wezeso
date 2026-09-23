-- Read-only deployment checks. Run as the same database owner used by the Go API.
DO $verify$
DECLARE t text; r text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM career_quest.store_meta WHERE id = 1 AND schema_version = 1 AND ready) THEN
  RAISE EXCEPTION 'Career Quest is not initialized: import the complete data export first';
 END IF;
 IF EXISTS (
  SELECT 1 FROM pg_namespace n,
   LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
  WHERE n.nspname = 'career_quest' AND a.grantee = 0
 ) THEN
  RAISE EXCEPTION 'Unexpected PUBLIC access to career_quest schema';
 END IF;
 FOREACH t IN ARRAY ARRAY['store_meta', 'imports', 'skills', 'role_profiles', 'employees', 'events',
  'activity_history', 'app_users', 'requests', 'audit_log', 'recommendations', 'sessions',
  'login_attempts', 'agent_runs', 'agent_watches', 'courses', 'course_progress', 'course_uploads', 'exam_attempts'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'career_quest' AND tablename = t AND rowsecurity) THEN
   RAISE EXCEPTION 'Missing table or disabled RLS: career_quest.%', t;
  END IF;
  IF EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
    LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'career_quest' AND c.relname = t AND a.grantee = 0
  ) THEN
   RAISE EXCEPTION 'Unexpected PUBLIC access to career_quest.%', t;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    IF has_schema_privilege(r, 'career_quest', 'USAGE') OR
       has_table_privilege(r, 'career_quest.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
     RAISE EXCEPTION 'Unexpected API role access: % on career_quest.%', r, t;
    END IF;
   END IF;
  END LOOP;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM career_quest.app_users) THEN
  RAISE EXCEPTION 'No application accounts were imported';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM career_quest.employees) OR
    NOT EXISTS (SELECT 1 FROM career_quest.skills) OR
    NOT EXISTS (SELECT 1 FROM career_quest.role_profiles) OR
    NOT EXISTS (SELECT 1 FROM career_quest.events) THEN
  RAISE EXCEPTION 'Required Career Quest dataset is empty';
 END IF;
END
$verify$;

SELECT schema_version, ready FROM career_quest.store_meta WHERE id = 1;
SELECT 'skills' AS table_name, count(*) AS rows FROM career_quest.skills
UNION ALL SELECT 'role_profiles', count(*) FROM career_quest.role_profiles
UNION ALL SELECT 'employees', count(*) FROM career_quest.employees
UNION ALL SELECT 'events', count(*) FROM career_quest.events
UNION ALL SELECT 'activity_history', count(*) FROM career_quest.activity_history
UNION ALL SELECT 'app_users', count(*) FROM career_quest.app_users
UNION ALL SELECT 'requests', count(*) FROM career_quest.requests
UNION ALL SELECT 'audit_log', count(*) FROM career_quest.audit_log
UNION ALL SELECT 'recommendations', count(*) FROM career_quest.recommendations
UNION ALL SELECT 'agent_runs', count(*) FROM career_quest.agent_runs
UNION ALL SELECT 'agent_watches', count(*) FROM career_quest.agent_watches
UNION ALL SELECT 'courses', count(*) FROM career_quest.courses
UNION ALL SELECT 'course_progress', count(*) FROM career_quest.course_progress
UNION ALL SELECT 'course_uploads', count(*) FROM career_quest.course_uploads
UNION ALL SELECT 'exam_attempts', count(*) FROM career_quest.exam_attempts
UNION ALL SELECT 'sessions', count(*) FROM career_quest.sessions
UNION ALL SELECT 'login_attempts', count(*) FROM career_quest.login_attempts
UNION ALL SELECT 'imports', count(*) FROM career_quest.imports
ORDER BY table_name;

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = JSON.parse(readFileSync(resolve(root, 'backend/course_examples.json'), 'utf8'));
const quote = value => { const text = JSON.stringify(value); let tag = '$course$'; while (text.includes(tag)) tag = tag.slice(0, -1) + 'x$'; return tag + text + tag; };
let sql = `-- Generated from backend/course_examples.json. Safe to re-run; existing courses are preserved.
BEGIN;
DO $seed$
DECLARE item jsonb;
BEGIN
 PERFORM 1 FROM career_quest.store_meta WHERE id = 1 FOR UPDATE;
`;
for (const { event, course } of examples) {
  for (const [table, value] of [['events', event], ['courses', course]]) {
    sql += ` item := ${quote(value)}::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.${table} WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.${table}));
  INSERT INTO career_quest.${table} SELECT * FROM jsonb_populate_record(NULL::career_quest.${table}, item);
 END IF;
`;
  }
}
sql += 'END\n$seed$;\nCOMMIT;\n';
writeFileSync(resolve(root, 'backend/migrations/004_course_examples.sql'), sql);
const schema = readFileSync(resolve(root, 'backend/migrations/003_courses.sql'), 'utf8');
writeFileSync(resolve(root, 'data/courses-supabase.sql'), '-- Existing Career Quest database: run this entire file in Supabase SQL Editor.\n-- Fresh database: first apply the complete export from npm run db:export.\n' + schema + '\n' + sql);
console.log('Wrote data/courses-supabase.sql and backend/migrations/004_course_examples.sql');

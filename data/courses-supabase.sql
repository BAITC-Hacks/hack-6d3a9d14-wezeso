-- Existing Career Quest database: run this entire file in Supabase SQL Editor.
-- Fresh database: first apply the complete export from npm run db:export.
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

-- Generated from backend/course_examples.json. Safe to re-run; existing courses are preserved.
BEGIN;
DO $seed$
DECLARE item jsonb;
BEGIN
 PERFORM 1 FROM career_quest.store_meta WHERE id = 1 FOR UPDATE;
 item := $course${"event_id":"COURSE_COMMUNICATION","title":"Ясная коммуникация в команде","description":"Демонстрационный курс: научитесь писать понятные сообщения, фиксировать решения и согласовывать следующий шаг. Два урока с видео и конспектами, затем экзамен из четырёх заданий. Проходной балл — 70 из 100.","type":"course","format":"self_paced","duration_hours":2,"mandatory":false,"target_roles":["Backend Engineer","Frontend Engineer","Data Analyst","QA Engineer","Product Manager","HR Business Partner","Sales Manager","Customer Support Specialist"],"target_grades":["Junior","Middle","Senior","Lead"],"develops_skills":[{"skill_id":"SK_COMMUNICATION","gain":1,"max_level":5},{"skill_id":"SK_WRITTEN_COMMUNICATION","gain":1,"max_level":5}],"prerequisites":{},"upcoming_sessions":[]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.events WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.events));
  INSERT INTO career_quest.events SELECT * FROM jsonb_populate_record(NULL::career_quest.events, item);
 END IF;
 item := $course${"event_id":"COURSE_COMMUNICATION","pass_score":70,"lessons":[{"id":"audience","title":"1. Начните с читателя","content":"У рабочего сообщения есть адресат и ожидаемое действие. До написания определите, что человек уже знает, какое решение должен принять и какие данные ему нужны.\n\nПример: вместо «Опять ошибка, посмотрите» напишите: «В тестовой сборке 12 экспорт отчёта завершается ошибкой. Это блокирует проверку релиза. Логи приложены. Анна, проверьте причину до 15:00 и сообщите оценку исправления».\n\nСтруктура: контекст → наблюдаемый факт → влияние → просьба. Отделяйте факт от предположения: «три запроса завершились ошибкой» проверяемо, а «сервис нестабилен» требует определения.\n\nВидео Google на английском — дополнительный разбор аудитории. Задания проверяют этот конспект и практику.","video_id":"4XdbqTGgqss","source_url":"https://developers.google.com/tech-writing/for-instructors","source_label":"Google · Technical Writing One: Audience"},{"id":"action","title":"2. Решение, ответственный и срок","content":"В конце обсуждения зафиксируйте решение, ответственного и срок. Если срок неизвестен, укажите, когда появится оценка. Проверяйте понимание: попросите адресата подтвердить следующий шаг.\n\nЗаменяйте безличные формулировки конкретным действием: «Команда поддержки проверит обращения до среды». Удаляйте жаргон, который незнаком читателю. Для нескольких задач используйте отдельные пункты.\n\nПри несогласии сначала изложите общую цель, затем факты и варианты. Не приписывайте коллегам мотивы. При задержке сообщите об изменении срока заранее и предложите обходной путь.\n\nПрактика: составьте сообщение о переносе внутренней демонстрации. Укажите причину, влияние, новый срок и запрос подтверждения.","video_id":"ElkvdifyW0I","source_url":"https://developers.google.com/tech-writing/for-instructors","source_label":"Google · Technical Writing One: Active voice"}],"questions":[{"id":"short","type":"short","prompt":"Какие четыре части помогают сделать рабочую просьбу понятной? Объясните в 2–4 предложениях.","options":[],"points":20,"rubric":"По 5 баллов: контекст, проверяемый факт, влияние на работу, конкретная просьба. Допускаются синонимы и разумные примеры."},{"id":"choice","type":"multiple_choice","prompt":"Какое сообщение лучше всего фиксирует следующий шаг?","options":["Надо бы посмотреть отчёт.","Анна проверит три спорные строки отчёта до 15:00 и сообщит результат в чат.","Кажется, все понимают, что делать."],"correct":"Анна проверит три спорные строки отчёта до 15:00 и сообщит результат в чат.","points":20,"rubric":"Правильный вариант содержит действие, ответственного и срок."},{"id":"essay","type":"essay","prompt":"Напишите развёрнутый ответ (от 400 символов): два отдела по-разному понимают срок выпуска. Как вы выясните факты, согласуете решение и проверите понимание? Приведите пример итогового сообщения.","options":[],"points":30,"rubric":"По 10 баллов: выяснение фактов без обвинений; согласование вариантов с учётом влияния; конкретный пример с ответственным, сроком и подтверждением понимания."},{"id":"file","type":"file","prompt":"Загрузите TXT или Markdown с сообщением о переносе демонстрации: причина, влияние, новый срок, ответственный и просьба подтвердить. Можно приложить CSV или JSON с этими полями.","options":[],"points":30,"rubric":"Оцени содержание файла: причина и влияние 10; новый срок и ответственный 10; ясная просьба подтвердить и уважительный тон 10. Не оценивай одно лишь имя файла."}]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.courses WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.courses));
  INSERT INTO career_quest.courses SELECT * FROM jsonb_populate_record(NULL::career_quest.courses, item);
 END IF;
 item := $course${"event_id":"COURSE_SQL","title":"SQL: от вопроса к проверенному отчёту","description":"Демонстрационный курс по SELECT, WHERE, агрегатам и проверке данных. Видеолекция CS50, два практических конспекта и экзамен с SQL-файлом. Проходной балл — 70 из 100.","type":"course","format":"self_paced","duration_hours":3,"mandatory":false,"target_roles":["Backend Engineer","Frontend Engineer","Data Analyst","QA Engineer","Product Manager","HR Business Partner","Sales Manager","Customer Support Specialist"],"target_grades":["Junior","Middle","Senior","Lead"],"develops_skills":[{"skill_id":"SK_SQL","gain":1,"max_level":5},{"skill_id":"SK_CRITICAL_THINKING","gain":1,"max_level":5}],"prerequisites":{},"upcoming_sessions":[]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.events WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.events));
  INSERT INTO career_quest.events SELECT * FROM jsonb_populate_record(NULL::career_quest.events, item);
 END IF;
 item := $course${"event_id":"COURSE_SQL","pass_score":70,"lessons":[{"id":"query","title":"1. Выборка и фильтрация","content":"SQL описывает, какие данные вы хотите получить. SELECT выбирает столбцы, FROM — таблицу, WHERE — строки. ORDER BY задаёт порядок; без него порядок строк не гарантирован. LIMIT ограничивает размер результата.\n\nУчебная таблица orders: id (идентификатор), department (отдел), amount (сумма), status (статус). Пример: SELECT id, amount FROM orders WHERE status = 'paid' ORDER BY amount DESC LIMIT 10;\n\nNULL означает отсутствие значения. Используйте IS NULL вместо = NULL. Пользовательские значения передавайте параметрами, а не соединением SQL-строк. Не запускайте учебные запросы на рабочих данных.\n\nВидеолекция CS50 на английском покрывает основы запросов. Для экзамена достаточно учебной схемы и двух конспектов.","video_id":"vHYeChEf2lA","source_url":"https://cs50.harvard.edu/sql/weeks/0/","source_label":"Harvard CS50 · Introduction to Databases with SQL: Querying"},{"id":"validate","title":"2. Агрегация и проверка результата","content":"GROUP BY объединяет строки по ключу. SUM(amount) суммирует известные суммы, COUNT(*) считает строки, COUNT(amount) считает только непустые значения amount. WHERE фильтрует строки до агрегации, HAVING — группы после неё.\n\nОтчёт по оплаченным заказам: SELECT department, SUM(amount) AS revenue FROM orders WHERE status = 'paid' GROUP BY department ORDER BY revenue DESC;\n\nПеред отправкой отчёта проверьте период, валюту, единицу измерения и уникальность id. Сравните количество строк до и после фильтра. Сверьте общую сумму с независимым источником. JOIN с несколькими совпадениями может удвоить суммы.\n\nПрактика: добавьте тестовые строки с NULL, неоплаченным статусом и двумя отделами. Рассчитайте ожидаемую сумму вручную и сравните с запросом.","video_id":"","source_url":"","source_label":"Авторский учебный конспект Career Quest"}],"questions":[{"id":"short","type":"short","prompt":"Чем COUNT(*) отличается от COUNT(amount), когда в amount есть NULL?","options":[],"points":20,"rubric":"10 баллов за COUNT(*) как число всех строк; 10 за исключение NULL в COUNT(amount)."},{"id":"choice","type":"multiple_choice","prompt":"Что фильтрует строки до выполнения GROUP BY?","options":["HAVING","WHERE","ORDER BY"],"correct":"WHERE","points":20,"rubric":"WHERE фильтрует исходные строки."},{"id":"essay","type":"essay","prompt":"Напишите развёрнутый ответ (от 400 символов): после JOIN выручка удвоилась. Как вы найдёте причину, проверите кардинальность соединения и убедитесь, что исправленный отчёт корректен?","options":[],"points":30,"rubric":"По 10: гипотеза о множественных совпадениях; проверка уникальности ключей и количества строк до/после; проверка итогов и тестовые данные. Не награждай небезопасное удаление данных."},{"id":"file","type":"file","prompt":"Загрузите .sql или .txt: запрос к orders(id, department, amount, status), который считает SUM(amount) по отделам только для status = 'paid' и сортирует по убыванию суммы. Добавьте комментарий о проверке результата.","options":[],"points":30,"rubric":"По 6: SELECT department и SUM(amount); FROM orders; WHERE status = 'paid'; GROUP BY department; ORDER BY суммы DESC и осмысленная проверка. Код оценивается как текст, не исполняется."}]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.courses WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.courses));
  INSERT INTO career_quest.courses SELECT * FROM jsonb_populate_record(NULL::career_quest.courses, item);
 END IF;
 item := $course${"event_id":"COURSE_DOCUMENTATION","title":"Документация, по которой можно действовать","description":"Демонстрационный курс: создайте рабочую инструкцию для коллеги. Аудитория, последовательность действий, критерии успеха и проверка другим человеком. Два урока и экзамен с загрузкой инструкции.","type":"course","format":"self_paced","duration_hours":2,"mandatory":false,"target_roles":["Backend Engineer","Frontend Engineer","Data Analyst","QA Engineer","Product Manager","HR Business Partner","Sales Manager","Customer Support Specialist"],"target_grades":["Junior","Middle","Senior","Lead"],"develops_skills":[{"skill_id":"SK_WRITTEN_COMMUNICATION","gain":1,"max_level":5},{"skill_id":"SK_TEAMWORK","gain":1,"max_level":5}],"prerequisites":{},"upcoming_sessions":[]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.events WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.events));
  INSERT INTO career_quest.events SELECT * FROM jsonb_populate_record(NULL::career_quest.events, item);
 END IF;
 item := $course${"event_id":"COURSE_DOCUMENTATION","pass_score":70,"lessons":[{"id":"reader","title":"1. Цель и исходные условия","content":"Полезная инструкция помогает конкретному читателю выполнить задачу. В начале укажите ожидаемый результат, аудиторию, необходимые права и материалы. Не предполагайте, что новый коллега знает внутренние сокращения.\n\nДля инструкции «Подготовить еженедельный отчёт» определите источник данных, период, часовой пояс, место сохранения и получателя. Если доступ отсутствует, объясните, к кому обратиться. Не включайте пароли и реальные персональные данные в учебные примеры.\n\nВидео Google разбирает выбор аудитории. После просмотра сформулируйте: кто читатель, что он уже умеет, какое действие должен выполнить.","video_id":"4XdbqTGgqss","source_url":"https://developers.google.com/tech-writing/for-instructors","source_label":"Google · Technical Writing One: Audience"},{"id":"steps","title":"2. Действия и проверка","content":"Разбейте процесс на нумерованные действия. Один шаг — одна проверяемая операция. Начинайте с глагола: «Откройте», «Выберите», «Сохраните». После рискованного или сложного шага покажите ожидаемый результат.\n\nНапример: «Выберите период с понедельника по воскресенье. Проверьте, что в заголовке указан тот же период». Отдельно опишите типичные ошибки и путь восстановления.\n\nПопросите коллегу, который не участвовал в написании, пройти инструкцию. Зафиксируйте, где возникли вопросы, исправьте текст и повторите проверку. Добавьте владельца документа и дату проверки.\n\nПрактика: составьте инструкцию из 5–8 шагов по подготовке учебного отчёта. Укажите критерий готовности.","video_id":"ElkvdifyW0I","source_url":"https://developers.google.com/tech-writing/for-instructors","source_label":"Google · Technical Writing One: Active voice"}],"questions":[{"id":"short","type":"short","prompt":"Что нужно сообщить читателю до первого шага инструкции? Назовите четыре элемента.","options":[],"points":20,"rubric":"По 5 баллов за цель/результат, аудиторию/знания, необходимые права/доступ, материалы/инструменты."},{"id":"choice","type":"multiple_choice","prompt":"Как надёжнее проверить понятность инструкции?","options":["Увеличить число страниц.","Попросить нового читателя выполнить задачу по инструкции и записать затруднения.","Проверить только орфографию."],"correct":"Попросить нового читателя выполнить задачу по инструкции и записать затруднения.","points":20,"rubric":"Проверка реальным читателем обнаруживает пропущенные предпосылки и шаги."},{"id":"essay","type":"essay","prompt":"Напишите развёрнутый ответ (от 400 символов): новый сотрудник не может подготовить отчёт по инструкции. Как вы отличите проблему доступа от проблемы текста, улучшите инструкцию и проверите изменения?","options":[],"points":30,"rubric":"По 10: диагностика исходных условий/доступа; конкретные улучшения шагов и ожидаемых результатов; повторная проверка новым читателем и фиксация владельца."},{"id":"file","type":"file","prompt":"Загрузите TXT или Markdown с инструкцией подготовки учебного отчёта: цель, исходные условия, 5–8 шагов, критерий готовности и действия при ошибке.","options":[],"points":30,"rubric":"По 6: цель; исходные условия; 5–8 понятных последовательных шагов; критерий готовности; полезные действия при ошибке. Оцени реальное содержание."}]}$course$::jsonb;
 IF NOT EXISTS (SELECT 1 FROM career_quest.courses WHERE event_id = item->>'event_id') THEN
  item := item || jsonb_build_object('sort_order', (SELECT coalesce(max(sort_order), -1) + 1 FROM career_quest.courses));
  INSERT INTO career_quest.courses SELECT * FROM jsonb_populate_record(NULL::career_quest.courses, item);
 END IF;
END
$seed$;
COMMIT;

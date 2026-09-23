'use client';
import { useI18n } from '../lib/i18n';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle, FileArrowUp, PlayCircle, Sparkle } from '@phosphor-icons/react';
import { Btn, Progress } from './UI';
import { requestJSON } from '../lib/api';
import type { Workspace } from '../lib/types';
import styles from './CoursePlayer.module.css';

type Answer = { question_id: string; text: string; upload_id: string };
type Question = { id: string; type: 'short' | 'multiple_choice' | 'essay' | 'file'; prompt: string; options: string[]; points: number };
type Attempt = { id: string; status: string; answers: Answer[]; score: number; passed: boolean; model: string; feedback: string; grades: { question_id: string; points: number; feedback: string }[] };
type Upload = { id: string; question_id: string; name: string; size: number };
type CourseData = {
  course: { event_id: string; pass_score: number; lessons: { id: string; title: string; content: string; video_id: string; source_url: string; source_label: string }[]; questions: Question[] };
  request: { status: string };
  completed_lessons: string[]; attempts: Attempt[]; uploads: Upload[];
  ai: { provider: string; model: string; external: boolean; configured: boolean };
};
type Props = { requestId: string; workspace: Workspace; csrf: string; call: (path: string, payload?: unknown) => Promise<any>; onBack: () => void; onChange: () => void };
const questionNames = { short: 'Короткий ответ', multiple_choice: 'Один верный вариант', essay: 'Эссе', file: 'Практическая работа' };

export default function CoursePlayer({ requestId, workspace, csrf, call, onBack, onChange }: Props) {
 const { t, date, number, count, languageTag } = useI18n();

  const [data, setData] = useState<CourseData | null>(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [exam, setExam] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [consent, setConsent] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const sending = useRef(false);
  const submissionKey = useRef('');
  const load = useCallback(async () => {
    const next: CourseData = await call(`courses/view?request_id=${encodeURIComponent(requestId)}`);
    setData(next);
    return next;
  }, [call, requestId]);
  useEffect(() => {
    let live = true;
    call(`courses/view?request_id=${encodeURIComponent(requestId)}`).then((next: CourseData) => {
      if (!live) return;
      setData(next);
      const previous = next.attempts.at(-1);
      const initial: Record<string, Answer> = {};
      for (const q of next.course.questions) initial[q.id] = previous?.answers.find(a => a.question_id === q.id) || { question_id: q.id, text: '', upload_id: next.uploads.filter(f => f.question_id === q.id).at(-1)?.id || '' };
      setAnswers(initial);
      if (previous) setExam(true);
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [call, requestId]);
  async function run(label: string, work: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(label); setError('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { sending.current = false; setBusy(''); }
  }
  function change(id: string, values: Partial<Answer>) {
    submissionKey.current = '';
    setAnswers(old => ({ ...old, [id]: { ...(old[id] || { question_id: id, text: '', upload_id: '' }), ...values } }));
  }
  async function grade(attempt: Attempt) {
    await call('courses/grade', { attempt_id: attempt.id, external_consent: consent });
    await load(); onChange();
  }
  if (!data) return <section className={styles.player}><Btn onClick={onBack}><ArrowLeft/>{t("К заявкам")}</Btn>{error ? <div role="alert" className="error">{t(error)}<Btn onClick={() => void run(t("Загружаем…"), async () => { await load(); })}>{t("Повторить")}</Btn></div> : <p role="status">{t("Загружаем курс…")}</p>}</section>;
  const { course } = data;
  const event = workspace.events.find(e => e.event_id === course.event_id);
  const lesson = course.lessons[lessonIndex];
  const ready = course.lessons.every(l => data.completed_lessons.includes(l.id));
  const completed = data.request.status === 'completed';
  const pending = data.attempts.find(a => a.status !== 'graded');
  const latest = data.attempts.at(-1);
  return <section className={styles.player} aria-label={t("Учебный курс")} aria-busy={!!busy}>
    <Btn variant="ghost" onClick={onBack} disabled={!!busy}><ArrowLeft size={18}/>{t("К моим шагам")}</Btn>
    <header className={styles.header}><h2>{t(event?.title)}</h2><p>{t(event?.description)}</p><div className={styles.gains}>{event?.develops_skills.map(g => { const before = workspace.levels?.[g.skill_id] || 0; const gain = Math.max(0, Math.min(5, g.max_level, before + g.gain) - before); return <span key={g.skill_id}>{t(workspace.skills?.find(s => s.skill_id === g.skill_id)?.name || g.skill_id)} <b>{completed ? t("Освоено") : `+${gain}`}</b></span>; })}</div></header>
    <div className={styles.layout}>
      <aside className={styles.outline}><h3>{t("Ваш маршрут")}</h3><Progress value={data.completed_lessons.length / course.lessons.length * 100} label={t("Завершённые уроки")}/><p>{data.completed_lessons.length}  {t("из")} {course.lessons.length}  {t("уроков")}</p><nav aria-label={t("Уроки курса")}>{course.lessons.map((l, i) => <button key={l.id} type="button" className={!exam && lessonIndex === i ? styles.selected : ''} onClick={() => { setLessonIndex(i); setExam(false); setPlaying(null); }} disabled={!!busy}>{data.completed_lessons.includes(l.id) ? <CheckCircle size={20}/> : <BookOpen size={20}/>}<span>{t(l.title)}</span></button>)}<button type="button" className={exam ? styles.selected : ''} disabled={!ready || !!busy} onClick={() => setExam(true)}><Sparkle size={20}/><span>{t("Итоговый экзамен")}<small>{ready ? t("{0}/100 для зачёта", { 0: course.pass_score }) : t("Завершите все уроки")}</small></span></button></nav></aside>
      <div className={styles.content}>
        {error && <div className="error" role="alert">{t(error)}</div>}
        {busy && <p className={styles.busy} role="status">{busy}{busy.includes(t('ИИ')) && t(" Проверка может занять до минуты; ответы уже сохранены.")}</p>}
        {!exam ? <article className={styles.lesson}><h3>{t(lesson.title)}</h3>{lesson.video_id && <div className={styles.video}>{playing === lesson.id ? <iframe title={t(lesson.title)} src={`https://www.youtube-nocookie.com/embed/${lesson.video_id}`} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/> : <button type="button" onClick={() => setPlaying(lesson.id)}><PlayCircle size={56} weight="light"/><strong>{t("Смотреть видеоурок")}</strong><span>{t(lesson.source_label)}  {t("· на английском")}</span></button>}</div>}<div className={styles.source}>{lesson.source_url ? <a href={lesson.source_url} target="_blank" rel="noreferrer">{t(lesson.source_label)} ↗</a> : lesson.source_label}</div>{lesson.content.split('\n\n').map((p, i) => <p key={i}>{t(p)}</p>)}{lesson.video_id && <p className={styles.hint}>{t("Если видео недоступно, откройте источник или изучите конспект. Отметка ниже подтверждает, что вы изучили материал.")}</p>}<Btn variant="primary" disabled={!!busy || completed} onClick={() => void run(t("Сохраняем прогресс…"), async () => { await call('courses/lesson', { request_id: requestId, lesson_id: lesson.id }); await load(); if (lessonIndex + 1 < course.lessons.length) { setLessonIndex(lessonIndex + 1); setPlaying(null); } else setExam(true); })}>{data.completed_lessons.includes(lesson.id) ? t("Продолжить") : t("Материал изучен")}<ArrowRight size={17}/></Btn></article> : <div className={styles.exam}>
          <h3>{completed ? t("Курс завершён") : t("Итоговый экзамен")}</h3><p>{t("4 задания · 100 баллов · зачёт от")} {course.pass_score}{t(". Короткий ответ, выбор варианта, эссе и файл. После зачёта навыки обновятся автоматически.")}</p>
          {latest && <section className={`${styles.result} ${latest.passed ? styles.passed : ''}`} aria-label={t("Результат экзамена")}><strong>{latest.status === 'graded' ? `${latest.score}/100 · ${latest.passed ? t("Экзамен сдан") : t("Нужна ещё одна попытка")}` : latest.status === 'grading' ? t("ИИ проверяет ответы") : latest.status === 'grading_failed' ? t("Проверку нужно повторить") : t("Ответы сохранены")}</strong><p>{t(latest.feedback) || t("Попытка сохранена на сервере. Можно запустить или повторить проверку.")}</p>{latest.model && <small>{t("Модель:")} {latest.model}</small>}{latest.grades?.map(g => <div key={g.question_id}><b>{t(questionNames[course.questions.find(q => q.id === g.question_id)!.type])} · {g.points}/{course.questions.find(q => q.id === g.question_id)!.points}</b><p>{t(g.feedback)}</p></div>)}</section>}
          {!completed && <>
            {!data.ai.configured && <p className={styles.hint}>{t("ИИ пока не настроен на сервере. Вы можете сохранить ответы; проверка станет доступна после настройки модели.")}</p>}
            {data.ai.external && <label className={styles.consent}><input type="checkbox" checked={consent} disabled={!!busy} onChange={e => setConsent(e.target.checked)}/><span>{t("Разрешаю передать текст моих ответов и файлов в Gemini для проверки. Учебные файлы не содержат конфиденциальных данных.")}</span></label>}
            {pending ? <div className={styles.actions}><Btn variant="primary" disabled={!!busy || !data.ai.configured || (data.ai.external && !consent)} onClick={() => void run(t("Проверяем с ИИ…"), () => grade(pending))}>{t("Проверить сохранённую попытку")}</Btn><Btn disabled={!!busy} onClick={() => void run(t("Обновляем…"), async () => { await load(); onChange(); })}>{t("Обновить результат")}</Btn></div> : <form onSubmit={e => { e.preventDefault(); void run(t("Сохраняем ответы и проверяем с ИИ…"), async () => { submissionKey.current ||= crypto.randomUUID(); const attempt: Attempt = await call('courses/exam', { request_id: requestId, idempotency_key: submissionKey.current, answers: course.questions.map(q => answers[q.id] || { question_id: q.id, text: '', upload_id: '' }) }); await load(); if (data.ai.configured) await grade(attempt); submissionKey.current = ''; }); }}>
              {course.questions.map((q, index) => <fieldset className={styles.question} key={q.id} disabled={!!busy}><legend>{index + 1}. {t(questionNames[q.type])} <span>{count("point",q.points)}</span></legend><p id={`prompt-${q.id}`}>{t(q.prompt)}</p>{q.type === 'multiple_choice' ? q.options.map(option => <label className={styles.option} key={option}><input type="radio" name={q.id} value={option} checked={answers[q.id]?.text === option} required onChange={() => change(q.id, { text: option })}/><span>{t(option)}</span></label>) : q.type === 'file' ? <div><label className={styles.file}><FileArrowUp size={25}/><span>{t("Выбрать файл · UTF-8, до 64 КБ")}</span><input type="file" aria-label={t(q.prompt)} accept=".txt,.md,.csv,.json,.sql" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 65536) { setError('Файл должен быть не больше 64 КБ.'); e.target.value = ''; return; } void run(t("Загружаем файл…"), async () => { const form = new FormData(); form.set('request_id', requestId); form.set('question_id', q.id); form.set('file', file); const uploaded: Upload = await requestJSON('courses/upload', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: form }); change(q.id, { upload_id: uploaded.id }); await load(); }); }}/></label>{data.uploads.some(f => f.question_id === q.id) && <label className={styles.savedFile}>{t("Прикреплённый файл")}<select value={answers[q.id]?.upload_id || ''} required onChange={e => change(q.id, { upload_id: e.target.value })}><option value="">{t("Выберите файл")}</option>{data.uploads.filter(f => f.question_id === q.id).map(f => <option key={f.id} value={f.id}>{f.name} · {count("byte",f.size)}</option>)}</select></label>}{answers[q.id]?.upload_id && <a href={`/api/courses/file?id=${encodeURIComponent(answers[q.id].upload_id)}`}>{t("Скачать прикреплённый файл")}</a>}<p className={styles.hint}>{t("TXT, MD, CSV, JSON, SQL. ИИ читает содержимое; код не исполняется.")}</p></div> : <><textarea aria-labelledby={`prompt-${q.id}`} value={answers[q.id]?.text || ''} onChange={e => change(q.id, { text: e.target.value })} rows={q.type === 'essay' ? 9 : 4} required minLength={q.type === 'essay' ? 400 : 10} maxLength={12000}/><small>{answers[q.id]?.text.length || 0}  {t("символов · минимум")} {q.type === 'essay' ? 400 : 10}</small></>}</fieldset>)}
              <p className={styles.hint}>{t("Текст ответов сохраняется после отправки. Файлы и завершённые уроки уже сохранены.")}</p><Btn variant="primary" type="submit" disabled={!!busy || (data.ai.external && data.ai.configured && !consent)}><Sparkle size={18}/>{data.ai.configured ? t("Отправить на проверку ИИ") : t("Сохранить ответы")}</Btn>
            </form>}
          </>}
          {data.attempts.length > 1 && <details className={styles.history}><summary>{t("История попыток ·")} {data.attempts.length}</summary>{data.attempts.map((a, i) => <p key={a.id}>{t("Попытка")} {i + 1}: {a.status === 'graded' ? `${a.score}/100` : t("Ожидает проверки")}. {t(a.feedback)}</p>)}</details>}
        </div>}
      </div>
    </div>
  </section>;
}

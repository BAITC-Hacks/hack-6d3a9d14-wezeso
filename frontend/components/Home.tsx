'use client';
import { useI18n } from '../lib/i18n';

import { useId, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CaretDown, CaretUp, Check } from '@phosphor-icons/react';
import Avatar from './Avatar';
import CandidateCard from './CandidateCard';
import PixelArt from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { Btn, Progress, Status } from './UI';

import { characterAppearance, characterIdentity, characterProgress } from '../lib/character';
import { formatName, typeName, type Candidate, type Workspace } from '../lib/types';
import styles from './Home.module.css';

type Props = {
  data: Workspace;
  goalControl: ReactNode;
  onCatalog: () => void;
  onRequests: () => void;
  onHistory: () => void;
  onChoose: (candidate: Candidate) => void;
  onAgent: () => void;

};

export default function Home({ data, goalControl, onCatalog, onRequests, onHistory, onChoose, onAgent }: Props) {
 const { t, date, number, languageTag } = useI18n();

  const [allSkills, setAllSkills] = useState(false);
  const skillsListId = useId();
  const skillsSection = useRef<HTMLElement>(null);
  const profile = data.profile!;
  const identity = characterIdentity(data.user);
  const character = characterAppearance(identity);
  const progress = characterProgress(data.user.employee_id, data.history, data.requests);
  const own = data.requests.filter(q => q.employee_id === data.user.employee_id);
  const active = own.filter(q => ['pending_manager', 'approved', 'pending_hr'].includes(q.status));
  const current = active.find(q => q.status === 'approved') || active[0];
  const candidates = data.candidates?.filter(c => !c.blocked) || [];
  const suggested = candidates[0];
  const event = current ? data.events.find(e => e.event_id === current.event_id) : suggested?.event;
  const gaps = data.gaps || [];
  const focus = allSkills ? gaps : gaps.filter(g => g.current < g.required).slice(0, 4);
  const recent = own.filter(q => q.status === 'completed').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  const latest = data.recommendations?.at(-1);
	const agentPlan = data.agent_runs?.filter(r => r.trigger === 'autopilot').at(-1);
	const agentStep = agentPlan?.steps[0];

  return <div className={styles.home}><section className={styles.agentLaunch} aria-label={t("Рекомендация агента")}><div><span><b>{agentStep ? t("Следующий шаг: {0}", { 0: agentStep.title }) : data.agent_watch?.enabled ? t("Агент анализирует вашу траекторию") : t("Помощник развития")}</b><small>{agentStep ? agentStep.facts[0] : agentPlan?.summary || t("Автоматические рекомендации по цели, истории и нагрузке.")}</small>{agentPlan&&<small>{agentPlan.mode==='llm'?t("Рекомендовано ИИ"):t("Расчётный план · LLM недоступна")} · {agentPlan.progress_before}% → {agentPlan.progress_after}{t("% после проверки HR")}</small>}</span></div><Btn variant="primary" onClick={onAgent}>{agentPlan?t("Посмотреть план"):t("Открыть помощника")}<ArrowRight size={17}/></Btn></section>
    <section className={styles.hero} aria-label={t("Ваш персонаж и следующий шаг")}>
      <div className={styles.character}>
        <div className={styles.blobStage}><Avatar identity={identity} size={440} label={t("Ваш блоб {0}", { 0: character.name })}/></div>
        <div className={styles.characterCaption}><strong>{t(character.name)}</strong><span>{t("Уровень")} {progress.level}</span></div>
        <div className={styles.xp}><Progress value={progress.levelXP / progress.nextLevelXP * 100} label={t("Опыт до следующего уровня персонажа")}/><span>{progress.xp} XP</span></div>
      </div>
      <div className={styles.intro}>
        <h1>{t("Привет,")} {profile.full_name.split(' ')[0]}.</h1>
        <p className={styles.profileDetails}>{t(profile.grade)} · {t(profile.role)}</p>
        <div className={styles.next}>
          {event ? <><h2>{t(event.title)}</h2><p>{t(typeName[event.type])} · {number(event.duration_hours)}  {t("ч ·")} {t(formatName[event.format])}</p>{current && <Status status={current.status}/>}<Btn variant="primary" onClick={current ? onRequests : () => suggested && onChoose(suggested)}>{current?.status === 'approved' ? (data.courses?.some(c=>c.event_id===current.event_id)?t("Открыть курс"):t("Отправить результат")) : current ? t("Продолжить") : t("Выбрать активность")}<ArrowRight size={17}/></Btn></> : <><h2>{t("Что хотите освоить?")}</h2><Btn variant="primary" onClick={onCatalog}>{t("Посмотреть каталог")}<ArrowRight size={17}/></Btn></>}
        </div>
      </div>
    </section>

    <section className={styles.metrics} aria-label={t("Ваш прогресс")}>
      <Btn variant="ghost" className={styles.metric} onClick={onRequests} aria-label={t("В работе: {0}. Открыть мои шаги", { 0: active.length })}><span className={styles.metricCopy}><strong>{active.length}</strong><span>{t("В работе")}</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="green" wide/><PixelArt kind="hourglass" tone="green"/></span></Btn>
      <Btn variant="ghost" className={styles.metric} onClick={onHistory} aria-label={t("Завершено: {0}. Открыть историю", { 0: progress.completed })}><span className={styles.metricCopy}><strong>{progress.completed}</strong><span>{t("Завершено")}</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="coral" wide/><PixelArt kind="trophy" tone="coral"/></span></Btn>
      <Btn variant="ghost" className={styles.metric} onClick={() => { setAllSkills(true); skillsSection.current?.scrollIntoView({ block: 'start' }); }} aria-label={t("Показать все навыки")}><span className={styles.metricCopy}><strong>{gaps.filter(g => g.current >= g.required).length}<small> / {gaps.length}</small></strong><span>{t("Навыков на цели")}</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="blue" wide/><PixelArt kind="skills" tone="blue"/></span></Btn>
    </section>

    <div className={styles.development}>
      <section className={styles.goal} aria-label={t("Моя цель")}>
        <h2>{data.target ? `${t(data.target.grade)} · ${t(data.target.role)}` : t("Выберите роль и грейд")}</h2>
        {data.target && <><div className={styles.goalLabel}><span>{t("Соответствие навыков")}</span><b>{data.progress || 0}%</b></div><Progress value={data.progress || 0} label={t("Соответствие навыков цели")}/></>}
        {goalControl}
      </section>
      <section className={styles.skills} ref={skillsSection} aria-label={t("Навыки")}>
        <div className={styles.skillsHeader}>
          <div className={styles.skillsTitle}><h2>{allSkills ? t("Все навыки") : t("В фокусе")}</h2></div>
          <Btn variant="ghost" className={styles.skillsToggle} onClick={() => setAllSkills(value => !value)} aria-expanded={allSkills} aria-controls={skillsListId}>{allSkills ? t("Свернуть") : t("Все навыки")}{allSkills ? <CaretUp size={14} aria-hidden="true"/> : <CaretDown size={14} aria-hidden="true"/>}</Btn>
        </div>
        <p className={styles.skillsIntro}>{allSkills ? t("Ваш прогресс на пути к выбранной цели") : t("Навыки, которые приблизят вас к цели")}</p>
        <div id={skillsListId}>
          {focus.length > 0 ? <>
            <div className={styles.skillsColumns} aria-hidden="true"><span>{t("Навык")}</span><span>{t("Сейчас / цель")}</span></div>
            <ul className={styles.skillsList} aria-label={allSkills ? t("Все навыки") : t("Навыки для развития")}>
              {focus.map(g => <li className={styles.skill} key={g.id}>
                <div className={styles.skillHeading}>
                  <span className={styles.skillName}>{t(g.name)}{g.current >= g.required && <Check className={styles.skillCheck} size={15} aria-label={t("Цель достигнута")}/>}</span>
                  <span className={styles.skillLevel} aria-hidden="true"><strong>{g.current}</strong><span>/</span><span>{g.required}</span></span>
                </div>
                <div className={styles.skillTrack} role="meter" aria-label={t(g.name)} aria-valuemin={0} aria-valuemax={5} aria-valuenow={g.current} aria-valuetext={t("Текущий уровень {0} из 5. Целевой уровень {1}.{2}", { 0: g.current, 1: g.required, 2: g.current >= g.required ? ' Цель достигнута.' : '' })}>
                  {Array.from({ length: 5 }, (_, i) => <span key={i} aria-hidden="true" className={i < g.current ? styles.filled : i < g.required ? styles.needed : undefined}/>)}
                </div>
              </li>)}
            </ul>
            <div className={styles.skillsLegend}><span><i className={styles.filled} aria-hidden="true"/>{t("Освоено")}</span><span><i className={styles.needed} aria-hidden="true"/>{t("До цели")}</span><span className={styles.skillScale}>{t("Шкала от 0 до 5")}</span></div>
          </> : <div className={styles.skillsEmpty}>
            <h3>{gaps.length ? t("Все навыки на цели") : t("Навыки пока не добавлены")}</h3>
            <p className={styles.quiet}>{gaps.length ? t("Можно выбрать следующую цель развития.") : t("Уточните цель или попросите HR проверить профиль.")}</p>
            {goalControl}
          </div>}
        </div>
      </section>
    </div>

    <section className={styles.activities} aria-label={t("Подходящие активности")}>
      <div className={styles.sectionHeading}><h2>{t("Для вас")}</h2><Btn variant="ghost" onClick={onCatalog}>{t("Весь каталог")}<ArrowRight size={16}/></Btn></div>
      <div className={styles.activityGrid}>{candidates.slice(current ? 0 : 1, current ? 3 : 4).map(c => <CandidateCard key={c.event.event_id} c={c} onChoose={() => onChoose(c)}/>)}</div>
      {candidates.length <= (current ? 0 : 1) && <p className={styles.quiet}>{t("Другие активности можно найти в каталоге.")}</p>}
    </section>

    <section className={styles.results}>
      <div className={styles.sectionHeading}><h2>{t("Последние результаты")}</h2><Btn variant="ghost" onClick={onHistory}>{t("История")}<ArrowRight size={16}/></Btn></div>
      {recent.map(q => <div className={styles.result} key={q.id}><div><h3>{t(data.events.find(e => e.event_id === q.event_id)?.title || q.event_id)}</h3><p>{Object.entries(q.gains).map(([id, gain]) => `${t(gaps.find(g => g.id === id)?.name || id.replace('SK_', '').replaceAll('_', ' '))} +${gain}`).join(' · ') || t("Подтверждено")}</p></div><time>{date(q.updated_at)}</time></div>)}
      {!recent.length && <div><p className={styles.quiet}>{active.length ? t("Отправьте результат из активного шага. После проверки HR он появится здесь.") : t("Выберите активность и пройдите её. После успешного экзамена или проверки HR результаты появятся здесь.")}</p><Btn variant="ghost" onClick={active.length ? onRequests : onCatalog}>{active.length ? t("Открыть мои шаги") : t("Выбрать активность")}<ArrowRight size={16}/></Btn></div>}
    </section>
    {latest && <details className={styles.advice}><summary>{t("Совет по развитию ·")} {date(latest.at)}</summary>{latest.choices.map(c => <article key={c.event_id}><h3>{t(data.events.find(e => e.event_id === c.event_id)?.title)}</h3><p>{t(c.rationale)}</p><details><summary>{t("Основания и ограничения")}</summary><ul>{latest.evidence?.[c.event_id]?.map(f => <li key={f}>{t(f)}</li>)}</ul><p>{c.unknowns.join('; ')}</p></details>{candidates.find(x => x.event.event_id === c.event_id) && <Btn onClick={() => onChoose(candidates.find(x => x.event.event_id === c.event_id)!)}>{t("Выбрать")}</Btn>}</article>)}</details>}
  </div>;
}

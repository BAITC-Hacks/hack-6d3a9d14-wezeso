'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Sparkle } from '@phosphor-icons/react';
import Avatar from './Avatar';
import CandidateCard from './CandidateCard';
import PixelArt from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { Btn, Progress, Status } from './UI';
import { LoadingStatus } from './Feedback';
import { characterAppearance, characterIdentity, characterProgress } from '../lib/character';
import { date, formatName, typeName, type Candidate, type Workspace } from '../lib/types';
import styles from './Home.module.css';

type Props = {
  data: Workspace;
  goalControl: ReactNode;
  onCatalog: () => void;
  onRequests: () => void;
  onHistory: () => void;
  onChoose: (candidate: Candidate) => void;
  onAI: () => void;
  aiBusy: boolean;
};

export default function Home({ data, goalControl, onCatalog, onRequests, onHistory, onChoose, onAI, aiBusy }: Props) {
  const [allSkills, setAllSkills] = useState(false);
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

  return <div className={styles.home}>
    <section className={styles.hero} aria-label="Ваш персонаж и следующий шаг">
      <div className={styles.character}>
        <div className={styles.blobStage}><Avatar identity={identity} size={440} label={`Ваш блоб ${character.name}`}/></div>
        <div className={styles.characterCaption}><strong>{character.name}</strong><span>Уровень {progress.level}</span></div>
        <div className={styles.xp}><Progress value={progress.levelXP / progress.nextLevelXP * 100} label="Опыт до следующего уровня персонажа"/><span>{progress.xp} XP</span></div>
      </div>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{profile.grade} · {profile.role}</p>
        <h1>Привет, {profile.full_name.split(' ')[0]}.</h1>
        <div className={styles.next}>
          <span className={styles.nextLabel}>{current ? 'Ваш текущий шаг' : 'Попробуйте следующим'}</span>
          {event ? <><h2>{event.title}</h2><p>{typeName[event.type]} · {event.duration_hours} ч · {formatName[event.format]}</p>{current && <Status status={current.status}/>}<Btn variant="primary" onClick={current ? onRequests : () => suggested && onChoose(suggested)}>{current?.status === 'approved' ? 'Отправить результат' : current ? 'Продолжить' : 'Выбрать активность'}<ArrowRight size={17}/></Btn></> : <><h2>Что хотите освоить?</h2><Btn variant="primary" onClick={onCatalog}>Посмотреть каталог<ArrowRight size={17}/></Btn></>}
        </div>
      </div>
    </section>

    <section className={styles.metrics} aria-label="Ваш прогресс">
      <Btn variant="ghost" className={styles.metric} onClick={onRequests} aria-label={`В работе: ${active.length}. Открыть мои шаги`}><span className={styles.metricCopy}><strong>{active.length}</strong><span>В работе</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="green" wide/><PixelArt kind="hourglass" tone="green"/></span></Btn>
      <Btn variant="ghost" className={styles.metric} onClick={onHistory} aria-label={`Завершено: ${progress.completed}. Открыть историю`}><span className={styles.metricCopy}><strong>{progress.completed}</strong><span>Завершено</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="coral" wide/><PixelArt kind="trophy" tone="coral"/></span></Btn>
      <Btn variant="ghost" className={styles.metric} onClick={() => { setAllSkills(true); skillsSection.current?.scrollIntoView({ block: 'start' }); }} aria-label="Показать все навыки"><span className={styles.metricCopy}><strong>{gaps.filter(g => g.current >= g.required).length}<small> / {gaps.length}</small></strong><span>Навыков на цели</span></span><span className={styles.metricArt} aria-hidden="true"><PixelMosaic tone="blue" wide/><PixelArt kind="skills" tone="blue"/></span></Btn>
    </section>

    <div className={styles.development}>
      <section className={styles.goal} aria-label="Моя цель">
        <span className={styles.eyebrow}>Моя цель</span>
        <h2>{data.target ? `${data.target.grade} ${data.target.role}` : 'Выберите роль и грейд'}</h2>
        {data.target && <><div className={styles.goalLabel}><span>Соответствие навыков</span><b>{data.progress || 0}%</b></div><Progress value={data.progress || 0} label="Соответствие навыков цели"/></>}
        {goalControl}
      </section>
      <section className={styles.skills} ref={skillsSection} aria-label="Навыки">
        <div className={styles.sectionHeading}><h2>{allSkills ? 'Все навыки' : 'В фокусе'}</h2><Btn variant="ghost" onClick={() => setAllSkills(!allSkills)} aria-expanded={allSkills}>{allSkills ? 'Свернуть' : 'Все навыки'}</Btn></div>
        {focus.map(g => <div className={styles.skill} key={g.id}><div><span>{g.name}</span><small>{g.current} / {g.required}</small></div><div className={styles.skillPixels} role="img" aria-label={`${g.name}: ${g.current} из ${g.required}`}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < g.current ? styles.filled : i < g.required ? styles.needed : ''}/>)}</div></div>)}
        {!focus.length && <div><p className={styles.quiet}>{gaps.length ? 'Все навыки на цели. Можно выбрать следующую цель развития.' : 'Данных о навыках пока нет. Уточните цель или попросите HR проверить профиль.'}</p>{goalControl}</div>}
      </section>
    </div>

    <section className={styles.activities} aria-label="Подходящие активности">
      <div className={styles.sectionHeading}><h2>Для вас</h2><Btn variant="ghost" onClick={onCatalog}>Весь каталог<ArrowRight size={16}/></Btn></div>
      <div className={styles.activityGrid}>{candidates.slice(current ? 0 : 1, current ? 3 : 4).map(c => <CandidateCard key={c.event.event_id} c={c} onChoose={() => onChoose(c)}/>)}</div>
      {candidates.length <= (current ? 0 : 1) && <p className={styles.quiet}>Другие активности можно найти в каталоге.</p>}
    </section>

    <section className={styles.results}>
      <div className={styles.sectionHeading}><h2>Последние результаты</h2><Btn variant="ghost" onClick={onHistory}>История<ArrowRight size={16}/></Btn></div>
      {recent.map(q => <div className={styles.result} key={q.id}><div><h3>{data.events.find(e => e.event_id === q.event_id)?.title || q.event_id}</h3><p>{Object.entries(q.gains).map(([id, gain]) => `${gaps.find(g => g.id === id)?.name || id.replace('SK_', '').replaceAll('_', ' ')} +${gain}`).join(' · ') || 'Подтверждено'}</p></div><time>{date(q.updated_at)}</time></div>)}
      {!recent.length && <div><p className={styles.quiet}>{active.length ? 'Отправьте результат из активного шага. После проверки HR он появится здесь.' : 'Выберите активность и пройдите её. Подтверждённые HR результаты появятся здесь.'}</p><Btn variant="ghost" onClick={active.length ? onRequests : onCatalog}>{active.length ? 'Открыть мои шаги' : 'Выбрать активность'}<ArrowRight size={16}/></Btn></div>}
    </section>
    {data.ai.available && <Btn variant="ghost" className={styles.ai} onClick={onAI} loading={aiBusy} aria-label={aiBusy?'Подбираем активности…':undefined} disabled={aiBusy}><Sparkle size={16}/>{aiBusy ? 'Подбираем активности…' : 'Подобрать с ИИ'}</Btn>}
    {aiBusy && <LoadingStatus label="Подбираем активности…" detail="Подбор может занять до минуты." slowLabel="Продолжаем подбор. Ответ может занять до минуты."/>}
    {latest && <details className={styles.advice}><summary>Совет по развитию · {date(latest.at)}</summary>{latest.choices.map(c => <article key={c.event_id}><h3>{data.events.find(e => e.event_id === c.event_id)?.title}</h3><p>{c.rationale}</p><details><summary>Основания и ограничения</summary><ul>{latest.evidence?.[c.event_id]?.map(f => <li key={f}>{f}</li>)}</ul><p>{c.unknowns.join('; ')}</p></details>{candidates.find(x => x.event.event_id === c.event_id) && <Btn onClick={() => onChoose(candidates.find(x => x.event.event_id === c.event_id)!)}>Выбрать</Btn>}</article>)}</details>}
  </div>;
}

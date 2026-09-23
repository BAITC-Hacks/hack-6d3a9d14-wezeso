'use client';
import { useI18n } from '../lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { Input, InputArea } from '@cloudflare/kumo/components/input';
import { Checkbox } from '@cloudflare/kumo/components/checkbox';
import { ArrowRight, ArrowClockwise, CaretRight, CheckCircle, DownloadSimple, FileText, Lightning, ListChecks, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { Btn, Choice, Confirm, Progress, Status, type ModalConfig } from './UI';
import { AppBadge } from './AppBadge';
import { type AgentRun, type PlanConstraints, type Workspace } from '../lib/types';
import styles from './AgentPanel.module.css';

type Props = {data:Workspace;call:(path:string,payload?:unknown)=>Promise<unknown>;refresh:()=>Promise<void>;onRequests:()=>void};
const toolNames:Record<string,string>={observe_change:'Обнаружено изменение',read_profile:'Профиль и история',search_activities:'Проверка каталога',simulate_plan:'Расчёт прогресса',save_plan:'Подготовка плана',persist_plan:'Сохранение плана и файлов',submit_requests:'Отправка заявок',model:'Подключение модели'};
const runStatuses:Record<AgentRun['status'],string>={draft:'Готов к согласованию',applied:'Заявки созданы',cancelled:'План отменён',no_match:'Нужно изменить условия'};

export default function AgentPanel({data,call,refresh,onRequests}:Props) {
 const { t, date, number, count, languageTag } = useI18n();

 const [message,setMessage]=useState(t("Составь план к моей цели. Сначала закрой критичные навыки, учти прошлые пропуски и текущую нагрузку."));
 const [constraints,setConstraints]=useState<PlanConstraints>({hours_per_week:6,weeks:8,max_steps:3,format:'any'});
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [elapsed,setElapsed]=useState(0);
 const [error,setError]=useState('');
 const [selected,setSelected]=useState('');
 const [response,setResponse]=useState<AgentRun|null>(null);
 const [modal,setModal]=useState<ModalConfig|null>(null);
 const [refining,setRefining]=useState(false);
 const [settingsBusy,setSettingsBusy]=useState(false);
 const retry=useRef<{payload:string;key:string}|null>(null);
 const resultRef=useRef<HTMLElement>(null);
 const formRef=useRef<HTMLTextAreaElement>(null);
 const runs=data.agent_runs||[];
 const saved=runs.find(r=>r.id===(selected||response?.id)) || (!selected ? runs.at(-1) : undefined);
 const run=response && response.id===(selected||response.id) && (!saved || response.updated_at>=saved.updated_at) ? response : saved;
 const watch=data.agent_watch;
 useEffect(()=>{if(!busy)return;const start=Date.now();setElapsed(0);const id=setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(id);},[busy]);
 function change<K extends keyof PlanConstraints>(key:K,value:PlanConstraints[K]){setConstraints(c=>({...c,[key]:value}));}
 async function generate(){
  if(busy)return;
  setBusy(true);setError('');
  const payload={message,constraints,previous_run_id:run?.id||'',external_consent:consent};
  const fingerprint=JSON.stringify(payload);
  if(retry.current?.payload!==fingerprint)retry.current={payload:fingerprint,key:crypto.randomUUID()};
  try {
   const next=await call('agent/runs',{...payload,idempotency_key:retry.current.key}) as AgentRun;
   setResponse(next);setSelected(next.id);retry.current=null;
   await refresh();
   requestAnimationFrame(()=>resultRef.current?.scrollIntoView({block:'start',behavior:'smooth'}));
  } catch(e){setError((e as Error).message);} finally{setBusy(false);}
 }
 function apply(){
  if(!run)return;
  setModal({title:t("Отправить план руководителю?"),content:<><p>{t("Будут созданы")} {run.steps.length}  {t("заявки. Участие добровольное: каждый шаг можно отменить в разделе «Мои шаги».")}</p><ul>{run.steps.map(s=><li key={s.event_id}>{t(s.title)} · {number(s.hours)}  {t("ч ·")} {s.session_date?date(s.session_date):t("В своём темпе")}</li>)}</ul><p>{t("Это согласование участия. Навыки изменятся только после выполнения и проверки результата HR.")}</p></>,submitLabel:t("Создать заявки"),onConfirm:async()=>{const next=await call('agent/action',{id:run.id,action:'apply',confirmed:true}) as AgentRun;setResponse(next);await refresh();}});
 }
 function cancel(){if(!run)return;setModal({title:t("Отменить этот план?"),content:<p>{t("План останется в истории. Заявки созданы не будут.")}</p>,submitLabel:t("Отменить план"),onConfirm:async()=>{setResponse(await call('agent/action',{id:run.id,action:'cancel',confirmed:true}) as AgentRun);await refresh();}});}
 const ownProgress=data.target?.role===run?.target.target_role&&data.target?.grade===run?.target.target_grade?data.progress:undefined;
 return <div className={styles.layout}>
  <section className={styles.autopilot} aria-label={t("Проактивный агент")}><div><div className={styles.autopilotHeading}><h2>{t("Рекомендации без запроса")}</h2><AppBadge tone={watch?.enabled?'green':'neutral'} icon={Sparkle}>{watch?.enabled?t("Агент следит за траекторией"):t("Автоподбор приостановлен")}</AppBadge></div><p>{t("Агент сам анализирует цель, историю и нагрузку. После изменения цели или подтверждения HR пересчитывает следующий шаг и создаёт новый план.")}</p>{watch?.status==='running'&&<p role="status">{t("Сейчас анализирует изменения…")}</p>}</div><Btn variant="secondary" loading={settingsBusy} disabled={settingsBusy} onClick={async()=>{setSettingsBusy(true);setError('');try{await call('agent/autopilot',{enabled:!watch?.enabled});await refresh();}catch(e){setError((e as Error).message);}finally{setSettingsBusy(false);}}}>{watch?.enabled?t("Приостановить"):t("Включить")}</Btn></section>
  <details className={styles.composer} open={refining} onToggle={e=>setRefining(e.currentTarget.open)}><summary className={styles.refineSummary}><CaretRight size={16} aria-hidden="true"/><span>{t("Уточнить задачу или изменить ограничения")}</span><span>{t("Необязательно")}</span></summary>
  <section aria-label={t("Задача помощнику")}>
   <div className={styles.intro}><h2>{t("От цели к действию")}</h2><p>{t("План развития, прогноз навыков, заявки и файлы для работы.")}</p></div>
   <form onSubmit={e=>{e.preventDefault();void generate();}} aria-busy={busy}>
    <InputArea ref={formRef} label={t("Что нужно сделать?")} rows={4} value={message} onChange={e=>setMessage(e.target.value)} minLength={3} maxLength={1200} disabled={busy} required/>
    <div className={styles.presets} aria-label={t("Примеры задач")}>
     <Btn variant="ghost" disabled={busy} onClick={()=>{setMessage(t("Составь план к моей цели: выбери критичные навыки и объясни компромиссы с учётом истории участия."));change('format','any');}}>{t("К следующему грейду")}</Btn>
     <Btn variant="ghost" disabled={busy} onClick={()=>{setMessage(t("Подбери только онлайн или самостоятельные активности. Учти прошлые пропуски и объясни, что даст каждый шаг."));change('format','online');}}>{t("Учиться онлайн")}</Btn>
     <Btn variant="ghost" disabled={busy} onClick={()=>{setMessage(t("Пересмотри план: нужен один посильный следующий шаг без перегрузки. Приоритет: критичный для цели навык."));setConstraints({hours_per_week:3,weeks:8,max_steps:1,format:'any'});}}>{t("Один посильный шаг")}</Btn>
    </div>
    <fieldset disabled={busy} className={styles.constraints}><legend>{t("Ограничения плана")}</legend>
     <Input label={t("Часов в неделю")} type="number" min={1} max={20} required value={constraints.hours_per_week} onChange={e=>change('hours_per_week',Number(e.target.value))}/>
     <Input label={t("Недель")} type="number" min={1} max={12} required value={constraints.weeks} onChange={e=>change('weeks',Number(e.target.value))}/>
     <Choice label={t("Шагов")} value={String(constraints.max_steps)} disabled={busy} onValueChange={v=>change('max_steps',Number(v))} options={[1,2,3].map(n=>({value:String(n),label:t("До {0}", { 0: n })}))}/>
     <Choice label={t("Формат")} value={constraints.format} disabled={busy} onValueChange={v=>change('format',v)} options={[{value:'any',label:t("Любой")},{value:'online',label:t("Онлайн / самостоятельно")},{value:'self_paced',label:t("В своём темпе")},{value:'offline',label:t("Очно")}]}/>
    </fieldset>
    <p className={styles.hint}>{t("Текущие активности тоже занимают этот бюджет. Период считается от даты демо: 1 октября 2026.")}</p>
    {data.agent?.external&&<Checkbox label={t("Разрешаю передать текст задачи, навыки и обезличенный контекст в Gemini. Эти данные разрешены для внешней передачи.")} checked={consent} onCheckedChange={setConsent} disabled={busy}/>}
    <div className={styles.launch}><Btn variant="primary" type="submit" disabled={busy||message.trim().length<3} loading={busy} aria-label={busy?t("Агент выполняет задачу"):t("Создать план")}><Lightning size={18}/>{busy?t("Выполняем задачу…"):run?t("Перестроить план"):t("Создать план")}</Btn><span>{data.agent?.external?t("Gemini · по вашему согласию"):data.agent?.provider==='off'?t("Расчётный режим"):t("Локальная LLM · данные на сервере")}</span></div>
    <Btn className={styles.saveConstraints} disabled={busy||settingsBusy} onClick={async()=>{setSettingsBusy(true);try{await call('agent/autopilot',{enabled:true,constraints});await refresh();}catch(e){setError((e as Error).message);}finally{setSettingsBusy(false);}}}>{t("Использовать эти ограничения для автоподбора")}</Btn>
    <p className={styles.hint}>{t("Без ответа модели сохранится расчётный план по цели и ограничениям. Свободный текст в этом режиме не интерпретируется.")}</p>
    {busy&&<div className={styles.running} role="status"><span className="loading-spinner"><ArrowClockwise size={21}/></span><div><b>{t("Проверяем данные и создаём план ·")} {elapsed}  {t("с")}</b><p>{t("У модели общий лимит 8 секунд. Результат и выполненные инструменты появятся здесь.")}</p></div></div>}
    {error&&<p className="error" role="alert">{t(error)}</p>}
   </form>
  </section></details>
  {runs.length>1&&<div className={styles.history}><Choice label={t("Сохранённые планы")} value={run?.id||runs.at(-1)!.id} disabled={busy} onValueChange={id=>{setSelected(id);setResponse(null);}} options={[...runs].reverse().map(r=>({value:r.id,label:t("{0} · {1} · {2}", { 0: new Date(r.created_at).toLocaleTimeString(languageTag,{hour:'2-digit',minute:'2-digit',hour12:false}), 1: runStatuses[r.status], 2: count("step", r.steps.length) })}))}/></div>}
  {run?<section ref={resultRef} className={styles.result} aria-label={t("Результат работы агента")} tabIndex={-1}>
   <div className={styles.resultHeading}><div><h2>{t(run.target.target_grade)} {t(run.target.target_role)}</h2><AppBadge tone={run.mode==='llm'?'green':'orange'} icon={run.mode==='llm'?Sparkle:ListChecks}>{run.mode==='llm'?t("LLM + инструменты"):t("Расчётный план · без LLM")}</AppBadge></div><span className={styles.hint}>{t(runStatuses[run.status])} · {number(run.duration_ms/1000,{minimumFractionDigits:1,maximumFractionDigits:1})}  {t("с")}</span></div>
   <p>{t(run.summary)}</p>
   {run.trigger==='autopilot'&&<p className={styles.hint}>{t("Этот план создан автоматически по изменениям вашей траектории. Ваш запрос не требовался.")}</p>}
   {run.warning&&<div className={styles.warning} role="status"><WarningCircle size={18} aria-hidden="true"/><span>{t(run.warning)}</span></div>}
   {!!run.steps.length&&<><div className={styles.metrics}><div><span>{t("Прогноз после проверки HR")}</span><strong>{run.progress_before}% <ArrowRight size={23}/> {run.progress_after}%</strong><Progress value={run.progress_after} label={t("Прогноз соответствия навыков")}/></div><div><span>{t("Трудозатраты плана")}</span><strong>{number(run.total_hours)}  {t("ч")}</strong><small>+ {number(run.existing_hours)}  {t("ч текущих активностей")}</small></div><div><span>{t("Подтверждённый прогресс сейчас")}</span><strong>{ownProgress===undefined?t("Нет данных"):`${ownProgress}%`}</strong><small>{t("Грейд не меняется автоматически")}</small></div></div>
   <ol className={styles.steps}>{run.steps.map((s,i)=>{const request=data.requests.find(q=>q.id===s.request_id);return <li key={s.event_id}><div className={styles.stepTitle}><span className={styles.number}>{i+1}</span><div><h3>{t(s.title)}</h3><p>{number(s.hours)}  {t("ч ·")} {s.session_date?date(s.session_date):t("В своём темпе")}</p></div>{request&&<Status status={request.status}/>}</div><div className={styles.stepBody}><p>{t(s.rationale)}</p><details open={i===0}><summary><CaretRight size={16} aria-hidden="true"/>{t("Проверенные основания")}</summary><ul>{s.facts.map((f,j)=><li key={j}>{t(f)}</li>)}</ul></details><details><summary><CaretRight size={16} aria-hidden="true"/>{t("Что сделать и как подтвердить")}</summary><ul>{s.checklist.map((f,j)=><li key={j}>{t(f)}</li>)}</ul></details></div></li>;})}</ol>
   <div className={styles.artifacts} aria-label={t("Созданные файлы")}>{run.artifacts.map(f=><a key={f.kind} href={`/api/agent/run?id=${encodeURIComponent(run.id)}&artifact=${f.kind}`} download={f.filename}><FileText size={22}/><span><b>{f.kind==='plan'?t("План развития"):f.kind==='calendar'?t("Календарь .ics"):t("Тетрадь результатов")}</b><small>{f.kind==='calendar'?t("Черновые даты / задачи"):f.kind==='workbook'?t("Шаблон для заполнения"):t("Основания и прогноз")}</small></span><DownloadSimple size={18}/></a>)}</div>
   <p className={styles.hint}>{t("Календарь можно импортировать без бронирования. Заполните пустой шаблон тетради после выполнения.")}</p>
   </>}
   <details className={styles.trace}><summary><CaretRight size={16} aria-hidden="true"/>{t("Выполненные инструменты ·")} {run.trace.length}</summary><ol>{run.trace.map((trace,i)=><li key={i} data-status={trace.status}>{trace.status==='ok'?<CheckCircle size={18} aria-hidden="true"/>:<WarningCircle size={18} aria-hidden="true"/>}<div><b>{t(toolNames[trace.tool]||trace.tool)} {trace.status==='rejected'?t("· отклонено"):trace.status==='unavailable'?t("· недоступно"):''}</b><p>{t(trace.summary)}</p></div></li>)}</ol><small>{t("Источник:")} {run.model}{t(". Это журнал вызовов и результатов, а не скрытые рассуждения модели.")}</small></details>
   <div className={styles.actions}>{run.status==='draft'&&<><Btn variant="primary" onClick={apply} disabled={busy}>{t("Согласовать план")}<ArrowRight size={18}/></Btn><Btn variant="ghost" onClick={cancel} disabled={busy}>{t("Отменить план")}</Btn></>}{run.status==='applied'&&<Btn variant="primary" onClick={onRequests}>{t("Открыть мои шаги")}<ArrowRight size={18}/></Btn>}<Btn onClick={()=>{setRefining(true);setMessage(t("Пересмотри предыдущий план с учётом текущих навыков, завершённых активностей и этих ограничений."));requestAnimationFrame(()=>{formRef.current?.focus();formRef.current?.scrollIntoView({block:'center',behavior:'smooth'});});}} disabled={busy}><ArrowClockwise size={17}/>{t("Изменить условия")}</Btn></div>
  </section>:<section className={styles.empty} role="status"><ListChecks size={32}/><h2>{watch?.enabled?t("Агент готовит первый план"):t("Помощник создаёт результат")}</h2><p>{t("Проверяет историю и условия участия, рассчитывает прирост навыков и сохраняет до трёх шагов. После вашего подтверждения создаст заявки руководителю.")}</p><div><span>{t("01 · Проверить")}</span><span>{t("02 · Смоделировать")}</span><span>{t("03 · Создать")}</span></div></section>}
  {error&&!refining&&<p className="error" role="alert">{t(error)}</p>}
  {modal&&<Confirm config={modal} onClose={()=>setModal(null)}/>}
 </div>;
}




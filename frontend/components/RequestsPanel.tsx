'use client';
import { useI18n } from '../lib/i18n';

import { useState } from 'react';
import { Tabs } from '@cloudflare/kumo/components/tabs';
import { InputGroup } from '@cloudflare/kumo/components/input';
import { ArrowRight, Archive, BookOpen, CaretDown, CheckCircle, MagnifyingGlass, Tray, X } from '@phosphor-icons/react';
import { Btn, Status, Steps } from './UI';
import { EmptyState } from './Feedback';
import CalendarExport from './CalendarExport';
import { requestCalendarEntry } from '../lib/calendar';
import PixelArt, { activitySymbol } from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { formatName, typeName, type Request, type Workspace } from '../lib/types';

const activeStatuses = ['pending_manager', 'approved', 'pending_hr'];
export default function RequestsPanel({ data, onAction, onCatalog }: { data: Workspace; onAction: (q: Request, action: string) => void; onCatalog: () => void }) {
 const { t, date, number, languageTag } = useI18n();

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { user } = data;
  const query = search.trim().toLowerCase();
  const employee = user.role === 'employee';
  const counts = {
    all: data.requests.length,
    active: data.requests.filter(q => activeStatuses.includes(q.status)).length,
    completed: data.requests.filter(q => q.status === 'completed').length,
    archived: data.requests.filter(q => ![...activeStatuses, 'completed'].includes(q.status)).length,
  };
  const requests = [...data.requests].reverse().filter(q => {
    const event = data.events.find(e => e.event_id === q.event_id);
    const person = data.roster.find(e => e.employee_id === q.employee_id);
    return (filter === 'all' || (filter === 'active' ? activeStatuses.includes(q.status) : filter === 'completed' ? q.status === 'completed' : ![...activeStatuses, 'completed'].includes(q.status))) && `${event?.title || q.event_id} ${t(event?.title)} ${person?.full_name || ''}`.toLowerCase().includes(query);
  });
  const emptyCopy = query
    ? { title: t("Ничего не найдено"), description: t("Попробуйте другое название или сбросьте фильтры."), icon: MagnifyingGlass }
    : filter === 'completed'
      ? { title: t("Подтверждённых результатов пока нет"), description: employee ? t("Отправьте результат на проверку HR.") : t("Результаты появятся после проверки HR."), icon: CheckCircle }
      : filter === 'archived'
        ? { title: t("В архиве пока пусто"), description: t("Здесь будут отменённые и отклонённые заявки."), icon: Archive }
        : employee
          ? { title: filter === 'active' ? t("Сейчас нет шагов в работе") : t("Выберите первую активность"), description: t("Курсы, практикумы и менторство есть в каталоге."), icon: BookOpen }
          : { title: filter === 'active' ? t("Заявок в работе нет") : t("Заявки команды появятся здесь"), description: user.role === 'hr' ? t("Результаты появятся здесь после отправки сотрудником.") : t("Здесь можно будет согласовать участие."), icon: Tray };
  const reset = () => { setSearch(''); setFilter('all'); };
  return <section className="requests-panel" aria-label={user.role === 'employee' ? t("Мои шаги") : t("Заявки команды")}>
    <div className="requests-toolbar"><Tabs variant="underline" value={filter} onValueChange={setFilter} tabs={[
      { value: 'all', label: t("Все · {0}", { 0: counts.all }) },
      { value: 'active', label: t("В работе · {0}", { 0: counts.active }) },
      { value: 'completed', label: t("Завершено · {0}", { 0: counts.completed }) },
      { value: 'archived', label: t("Архив · {0}", { 0: counts.archived }) },
    ]}/><InputGroup className="request-search" size="sm"><InputGroup.Addon><MagnifyingGlass size={16}/></InputGroup.Addon><InputGroup.Input aria-label={t("Поиск по шагам")} placeholder={employee ? t("Найти активность") : t("Активность или сотрудник")} value={search} onChange={e => setSearch(e.target.value)}/></InputGroup></div>
    <div className="filter-summary"><span role="status">{query ? t("Найдено") : t("Заявок")}: {requests.length}</span>{(search || filter !== 'all') && <Btn variant="ghost" onClick={reset}><X size={14}/>{t("Сбросить фильтры")}</Btn>}</div>
    <div className="request-rows">
      {requests.map(q => {
        const event = data.events.find(e => e.event_id === q.event_id);
        const isOpen = expanded === q.id;
        const canApprove = user.role === 'manager' && q.status === 'pending_manager' && q.employee_id !== user.employee_id;
        const course = data.courses?.find(c => c.event_id === q.event_id);
        const canLearn = !!course && q.employee_id === user.employee_id && ['approved', 'completed'].includes(q.status);
        const canSubmit = !course && q.employee_id === user.employee_id && q.status === 'approved';
        const canComplete = user.role === 'hr' && q.status === 'pending_hr';
        const canCancel = q.employee_id === user.employee_id && activeStatuses.includes(q.status);
        const owner = data.roster.find(e => e.employee_id === q.employee_id)?.full_name || data.profile?.full_name;
        const calendarEntry = event ? requestCalendarEntry(event, q, employee ? undefined : owner) : null;
        const tone = q.status === 'completed' ? 'green' : activeStatuses.includes(q.status) ? 'coral' : 'blue';
        return <article className={`request-row${isOpen ? ' is-open' : ''}`} key={q.id}>
          <Btn variant="ghost" className="request-summary" onClick={() => setExpanded(isOpen ? null : q.id)} aria-expanded={isOpen} aria-controls={`request-${q.id}`}>
            <span className="request-title"><strong>{t(event?.title || q.event_id)}</strong><span>{user.role !== 'employee' && owner ? `${owner} · ` : ''}{event ? `${typeName[event.type] || event.type} · ` : ''}{date(q.session_date)}</span></span><Status status={q.status}/><CaretDown className="request-chevron" size={17}/>
          </Btn>
          {(canApprove || canSubmit || canComplete || canLearn) && <div className="request-quick-actions">{canApprove && <><Btn variant="primary" onClick={() => onAction(q, 'approve')}>{t("Согласовать")}</Btn><Btn variant="ghost" onClick={() => onAction(q, 'reject')}>{t("Отказать")}</Btn></>}{canLearn && <Btn variant="primary" onClick={() => onAction(q, 'learn')}>{q.status === 'completed' ? t("Результат экзамена") : t("Открыть курс")}<ArrowRight size={15}/></Btn>}{canSubmit && <Btn variant="primary" onClick={() => onAction(q, 'submit')}>{t("Отправить результат")}<ArrowRight size={15}/></Btn>}{canComplete && <><Btn variant="primary" onClick={() => onAction(q, 'complete')}>{t("Подтвердить результат")}</Btn><Btn onClick={() => onAction(q, 'return')}>{t("Вернуть")}</Btn></>}</div>}
          {isOpen && <div className="request-detail" id={`request-${q.id}`}>
            {course ? <p className="request-format">{t("Заявка → руководитель → уроки → экзамен ИИ → рост навыков")}</p> : [...activeStatuses, 'completed'].includes(q.status) && <Steps status={q.status}/>}{event && <><p>{t(event.description)}</p><div className="request-gains">{event.develops_skills.map(g=><span key={g.skill_id}>{t(data.skills?.find(s=>s.skill_id===g.skill_id)?.name||g.skill_id)} <b>+{g.gain}{t(", до")} {g.max_level}</b></span>)}</div></>}
            {event && <p className="request-format">{t(formatName[event.format])} · {number(event.duration_hours)}  {t("ч")}</p>}
            {calendarEntry && <CalendarExport entry={calendarEntry}/>}
            {q.evidence && <section className="request-note"><h4>{t("Результат")}</h4><p>{q.evidence}</p></section>}
            {q.note && q.note !== q.evidence && <section className="request-note"><h4>{t("Комментарий")}</h4><p>{q.note}</p></section>}
            {q.status === 'completed' && Object.keys(q.gains).length > 0 && <div className="request-gains">{Object.entries(q.gains).map(([id, gain]) => <span key={id}>{t(data.gaps?.find(g => g.id === id)?.name || id.replace('SK_', '').replaceAll('_', ' '))} <b>+{gain}</b></span>)}</div>}
            <div className="request-detail-footer"><span>{t("Заявка")} {q.id.slice(0, 9)}</span>{canCancel && <Btn variant="ghost" onClick={() => onAction(q, 'cancel')}>{t("Отменить участие")}</Btn>}</div>
          </div>}
          <div className="request-art" aria-hidden="true">
            <PixelMosaic tone={tone} wide/>
            <PixelArt kind={activitySymbol(event?.type || 'course',event?.title || '')} tone={tone}/>
          </div>
        </article>;
      })}
      {!requests.length && <EmptyState {...emptyCopy} action={query ? <Btn onClick={reset}>{t("Показать все заявки")}</Btn> : filter !== 'all' && counts.all > 0 ? <Btn onClick={reset}>{t("Все заявки")}<ArrowRight size={16}/></Btn> : employee ? <Btn variant="primary" onClick={onCatalog}>{t("Выбрать активность")}<ArrowRight size={16}/></Btn> : undefined}/>}
    </div>
  </section>;
}

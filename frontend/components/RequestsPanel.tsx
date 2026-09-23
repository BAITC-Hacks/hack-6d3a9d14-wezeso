'use client';

import { useState } from 'react';
import { Tabs } from '@cloudflare/kumo/components/tabs';
import { InputGroup } from '@cloudflare/kumo/components/input';
import { ArrowRight, Archive, BookOpen, CaretDown, CheckCircle, MagnifyingGlass, Tray, X } from '@phosphor-icons/react';
import { Btn, Status, Steps } from './UI';
import { EmptyState } from './Feedback';
import PixelArt, { activitySymbol } from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { date, formatName, typeName, type Request, type Workspace } from '../lib/types';

const activeStatuses = ['pending_manager', 'approved', 'pending_hr'];
export default function RequestsPanel({ data, onAction, onCatalog }: { data: Workspace; onAction: (q: Request, action: string) => void; onCatalog: () => void }) {
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
    return (filter === 'all' || (filter === 'active' ? activeStatuses.includes(q.status) : filter === 'completed' ? q.status === 'completed' : ![...activeStatuses, 'completed'].includes(q.status))) && `${event?.title || q.event_id} ${person?.full_name || ''}`.toLowerCase().includes(query);
  });
  const emptyCopy = query
    ? { title: 'Ничего не найдено', description: 'Попробуйте другое название или сбросьте фильтры.', icon: MagnifyingGlass }
    : filter === 'completed'
      ? { title: 'Подтверждённых результатов пока нет', description: employee ? 'Отправьте результат на проверку HR.' : 'Результаты появятся после проверки HR.', icon: CheckCircle }
      : filter === 'archived'
        ? { title: 'В архиве пока пусто', description: 'Здесь будут отменённые и отклонённые заявки.', icon: Archive }
        : employee
          ? { title: filter === 'active' ? 'Сейчас нет шагов в работе' : 'Выберите первую активность', description: 'Курсы, практикумы и менторство есть в каталоге.', icon: BookOpen }
          : { title: filter === 'active' ? 'Заявок в работе нет' : 'Заявки команды появятся здесь', description: user.role === 'hr' ? 'Результаты появятся здесь после отправки сотрудником.' : 'Здесь можно будет согласовать участие.', icon: Tray };
  const reset = () => { setSearch(''); setFilter('all'); };
  return <section className="requests-panel" aria-label={user.role === 'employee' ? 'Мои шаги' : 'Заявки команды'}>
    <div className="requests-toolbar"><Tabs variant="underline" value={filter} onValueChange={setFilter} tabs={[
      { value: 'all', label: `Все · ${counts.all}` },
      { value: 'active', label: `В работе · ${counts.active}` },
      { value: 'completed', label: `Завершено · ${counts.completed}` },
      { value: 'archived', label: `Архив · ${counts.archived}` },
    ]}/><InputGroup className="request-search" size="sm"><InputGroup.Addon><MagnifyingGlass size={16}/></InputGroup.Addon><InputGroup.Input aria-label="Поиск по шагам" placeholder={employee ? 'Найти активность' : 'Активность или сотрудник'} value={search} onChange={e => setSearch(e.target.value)}/></InputGroup></div>
    <div className="filter-summary"><span role="status">{query ? 'Найдено' : 'Заявок'}: {requests.length}</span>{(search || filter !== 'all') && <Btn variant="ghost" onClick={reset}><X size={14}/>Сбросить фильтры</Btn>}</div>
    <div className="request-rows">
      {requests.map(q => {
        const event = data.events.find(e => e.event_id === q.event_id);
        const isOpen = expanded === q.id;
        const canApprove = user.role === 'manager' && q.status === 'pending_manager' && q.employee_id !== user.employee_id;
        const canSubmit = q.employee_id === user.employee_id && q.status === 'approved';
        const canComplete = user.role === 'hr' && q.status === 'pending_hr';
        const canCancel = q.employee_id === user.employee_id && activeStatuses.includes(q.status);
        const owner = data.roster.find(e => e.employee_id === q.employee_id)?.full_name || data.profile?.full_name;
        const tone = q.status === 'completed' ? 'green' : activeStatuses.includes(q.status) ? 'coral' : 'blue';
        return <article className={`request-row${isOpen ? ' is-open' : ''}`} key={q.id}>
          <Btn variant="ghost" className="request-summary" onClick={() => setExpanded(isOpen ? null : q.id)} aria-expanded={isOpen} aria-controls={`request-${q.id}`}>
            <span className="request-title"><strong>{event?.title || q.event_id}</strong><span>{user.role !== 'employee' && owner ? `${owner} · ` : ''}{event ? `${typeName[event.type] || event.type} · ` : ''}{date(q.session_date)}</span></span><Status status={q.status}/><CaretDown className="request-chevron" size={17}/>
          </Btn>
          {(canApprove || canSubmit || canComplete) && <div className="request-quick-actions">{canApprove && <><Btn variant="primary" onClick={() => onAction(q, 'approve')}>Согласовать</Btn><Btn variant="ghost" onClick={() => onAction(q, 'reject')}>Отказать</Btn></>}{canSubmit && <Btn variant="primary" onClick={() => onAction(q, 'submit')}>Отправить результат<ArrowRight size={15}/></Btn>}{canComplete && <><Btn variant="primary" onClick={() => onAction(q, 'complete')}>Подтвердить результат</Btn><Btn onClick={() => onAction(q, 'return')}>Вернуть</Btn></>}</div>}
          {isOpen && <div className="request-detail" id={`request-${q.id}`}>
            {[...activeStatuses, 'completed'].includes(q.status) && <Steps status={q.status}/>}
            {event && <p className="request-format">{formatName[event.format]} · {event.duration_hours} ч</p>}
            {q.evidence && <section className="request-note"><h4>Результат</h4><p>{q.evidence}</p></section>}
            {q.note && q.note !== q.evidence && <section className="request-note"><h4>Комментарий</h4><p>{q.note}</p></section>}
            {q.status === 'completed' && Object.keys(q.gains).length > 0 && <div className="request-gains">{Object.entries(q.gains).map(([id, gain]) => <span key={id}>{data.gaps?.find(g => g.id === id)?.name || id.replace('SK_', '').replaceAll('_', ' ')} <b>+{gain}</b></span>)}</div>}
            <div className="request-detail-footer"><span>Заявка {q.id.slice(0, 9)}</span>{canCancel && <Btn variant="ghost" onClick={() => onAction(q, 'cancel')}>Отменить участие</Btn>}</div>
          </div>}
          <div className="request-art" aria-hidden="true">
            <PixelMosaic tone={tone} wide/>
            <PixelArt kind={activitySymbol(event?.type || 'course',event?.title || '')} tone={tone}/>
          </div>
        </article>;
      })}
      {!requests.length && <EmptyState {...emptyCopy} action={query ? <Btn onClick={reset}>Показать все заявки</Btn> : filter !== 'all' && counts.all > 0 ? <Btn onClick={reset}>Все заявки<ArrowRight size={16}/></Btn> : employee ? <Btn variant="primary" onClick={onCatalog}>Выбрать активность<ArrowRight size={16}/></Btn> : undefined}/>}
    </div>
  </section>;
}

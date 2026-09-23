'use client';
import { useI18n } from '../lib/i18n';
import { localizeCalendarEntry } from '../lib/calendar-locale';

import { useMemo, useState } from 'react';
import { Tabs } from '@cloudflare/kumo/components/tabs';
import { CalendarBlank, CaretLeft, CaretRight, DownloadSimple, ArrowRight, X } from '@phosphor-icons/react';
import { Btn, Status } from './UI';
import { EmptyState } from './Feedback';
import CalendarExport from './CalendarExport';
import { activeCalendarStatuses, buildCalendarEntries, downloadCalendar, monthDays, shiftCalendarDate, validCalendarDate } from '../lib/calendar';
import type { Candidate, Workspace } from '../lib/types';
import styles from './CalendarPanel.module.css';

export default function CalendarPanel({ data, onChoose, onRequests }: { data: Workspace; onChoose: (candidate: Candidate, date: string) => void; onRequests: () => void }) {
 const { t, date, number, languageTag, locale } = useI18n();
 const calendarDateLabel=(value:string, options?:Intl.DateTimeFormatOptions)=>date(value, options ?? {day:'numeric',month:'long',year:'numeric'});

  const [month, setMonth] = useState(data.snapshot.slice(0, 7));
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all');
  const entries = useMemo(() => buildCalendarEntries(data).map(entry=>localizeCalendarEntry(locale,entry)), [data,locale]);
  const visible = entries.filter(entry => filter === 'all' || (filter === 'catalog' ? entry.kind === 'catalog' : entry.kind !== 'catalog'));
  const inMonth = visible.filter(entry => entry.date.startsWith(month));
  const agenda = selected ? inMonth.filter(entry => entry.date === selected) : inMonth;
  const overdue = entries.filter(entry => entry.kind === 'deadline' && entry.date < data.snapshot);
  const undated = data.requests.filter(request => activeCalendarStatuses.includes(request.status) && !validCalendarDate(request.session_date));
  const days = monthDays(month);
  const monthLabel = calendarDateLabel(`${month}-01`, { month: 'long', year: 'numeric' });
  function changeMonth(value: string) {
    if (!validCalendarDate(`${value}-01`)) return;
    setMonth(value); setSelected('');
  }
  function moveMonth(direction: number) {
    changeMonth(shiftCalendarDate(`${month}-01`, direction < 0 ? -1 : 32).slice(0, 7));
  }
  return <section className={styles.panel} aria-label={t("Календарь развития")}>
    <div className={styles.intro}><p>{t("Сессии, ваши шаги и сроки обязательного обучения.")}</p><Btn disabled={!inMonth.length} onClick={() => downloadCalendar(inMonth, `career-quest-${month}.ics`)}><DownloadSimple size={18}/>{t("Скачать месяц .ics")}</Btn></div>
    <Tabs variant="underline" value={filter} onValueChange={setFilter} tabs={[{ value: 'all', label: t("Все события") }, { value: 'personal', label: data.user.role === 'employee' ? t("Мои события") : t("Заявки и сроки") }, { value: 'catalog', label: t("Сессии каталога") }]}/>
    <div className={styles.toolbar}>
      <div className={styles.monthNav}><Btn variant="ghost" shape="square" aria-label={t("Предыдущий месяц")} onClick={() => moveMonth(-1)}><CaretLeft size={20}/></Btn><h2 aria-live="polite">{monthLabel}</h2><Btn variant="ghost" shape="square" aria-label={t("Следующий месяц")} onClick={() => moveMonth(1)}><CaretRight size={20}/></Btn></div>
      <div className={styles.monthControls}><input type="month" aria-label={t("Выбрать месяц")} value={month} onChange={event => changeMonth(event.target.value)}/><Btn onClick={() => changeMonth(data.snapshot.slice(0, 7))}>{t("Текущий месяц")}</Btn></div>
    </div>
    <div className={styles.layout}>
      <div className={styles.calendar}>
        <div className={styles.weekdays} aria-hidden="true">{[t("Пн"), t("Вт"), t("Ср"), t("Чт"), t("Пт"), t("Сб"), t("Вс")].map(day => <span key={day}>{day}</span>)}</div>
        <div className={styles.grid}>
          {days.map(day => {
            const items = visible.filter(entry => entry.date === day);
            return <button type="button" key={day} className={`${styles.day} ${!day.startsWith(month) ? styles.outside : ''} ${selected === day ? styles.selected : ''} ${day === data.snapshot ? styles.today : ''}`} aria-label={t("{0}{1}, событий: {2}", { 0: calendarDateLabel(day), 1: day === data.snapshot ? ', сегодня в демо' : '', 2: items.length })} aria-pressed={selected === day} onClick={() => { if (!day.startsWith(month)) setMonth(day.slice(0, 7)); setSelected(selected === day ? '' : day); }}>
              <span className={styles.dayNumber}>{Number(day.slice(-2))}</span>
              <span className={styles.dayEntries} aria-hidden="true">{items.slice(0, 2).map(entry => <span key={entry.id} className={styles[entry.kind]}>{t(entry.title)}</span>)}{items.length > 2 && <small>+{items.length - 2}  {t("ещё")}</small>}</span>
              {!!items.length && <span className={styles.mobileCount} aria-hidden="true">{items.length}</span>}
            </button>;
          })}
        </div>
        <div className={styles.legend}><span><i className={styles.request}/>{t("Заявка")}</span><span><i className={styles.deadline}/>{t("Срок обучения")}</span><span><i className={styles.catalog}/>{t("Сессия каталога")}</span></div>
        <p className={styles.note}>{t("Даты показаны на весь день. Дата демо:")} {calendarDateLabel(data.snapshot)}.</p>
      </div>
      <aside className={styles.agenda} aria-label={t("Список событий")}>
        <div className={styles.agendaHeading}><h2>{selected ? calendarDateLabel(selected, { day: 'numeric', month: 'long' }) : t("В этом месяце")}</h2>{selected && <Btn variant="ghost" shape="square" aria-label={t("Показать весь месяц")} onClick={() => setSelected('')}><X size={17}/></Btn>}</div>
        <p className={styles.count} role="status">{t("Событий:")} {agenda.length}</p>
        {agenda.length ? <div className={styles.agendaList}>{agenda.map(entry => {
          const candidate = entry.kind === 'catalog' ? data.candidates?.find(item => item.event.event_id === entry.eventId && !item.blocked) : undefined;
          return <article className={styles.entry} key={entry.id}>
            <div className={styles.entryDate}><span className={styles[entry.kind]}>{entry.kind === 'deadline' ? t("Срок обучения") : entry.kind === 'catalog' ? t("Сессия каталога") : t("Заявка")}</span><time dateTime={entry.date}>{calendarDateLabel(entry.date, { day: 'numeric', month: 'short' })}</time></div>
            <h3>{t(entry.title)}</h3>{entry.owner && <p className={styles.owner}>{entry.owner}</p>}
            {entry.kind !== 'catalog' && <Status status={entry.kind === 'deadline' && entry.date < data.snapshot ? 'overdue' : entry.status}/>}
            <div className={styles.entryActions}><CalendarExport entry={entry}/>{candidate && <Btn variant="ghost" onClick={() => onChoose(candidate, entry.date)}>{t("Выбрать")}<ArrowRight size={15}/></Btn>}{entry.kind === 'request' && <Btn variant="ghost" onClick={onRequests}>{t("К заявке")}<ArrowRight size={15}/></Btn>}</div>
          </article>;
        })}</div> : <EmptyState icon={CalendarBlank} title={selected ? t("На этот день событий нет") : t("В этом месяце событий нет")} description={t("Выберите другую дату или посмотрите сессии каталога.")}/>}
      </aside>
    </div>
    {(overdue.length > 0 || undated.length > 0) && <div className={styles.additional}>
      {overdue.length > 0 && <section><h3>{t("Просроченные сроки ·")} {overdue.length}</h3><p>{t("По данным на")} {calendarDateLabel(data.snapshot)}.</p><ul>{overdue.map(entry => <li key={entry.id}><button type="button" onClick={() => { setFilter('personal'); setMonth(entry.date.slice(0, 7)); setSelected(entry.date); }}>{t(entry.title)}<time dateTime={entry.date}>{calendarDateLabel(entry.date)}</time></button></li>)}</ul></section>}
      {undated.length > 0 && <section><h3>{t("Без фиксированной даты ·")} {undated.length}</h3><p>{t("Активности в своём темпе остаются в ваших шагах.")}</p><Btn onClick={onRequests}>{t("Открыть шаги")}<ArrowRight size={16}/></Btn></section>}
    </div>}
  </section>;
}

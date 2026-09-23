'use client';
import { useI18n } from '../lib/i18n';

import { useState } from 'react';
import { Tabs } from '@cloudflare/kumo/components/tabs';
import { Table } from '@cloudflare/kumo/components/table';
import {
  ArrowRight, ArrowUUpLeft, BookOpen, CaretDown, ChatText, CheckCircle,
  ClockCounterClockwise, Flag, Hourglass, Info, MinusCircle, Prohibit,
  ShieldCheck, Sparkle, UploadSimple, XCircle, type Icon,
} from '@phosphor-icons/react';
import { AppBadge, type BadgeTone } from './AppBadge';
import { EmptyState } from './Feedback';
import { Btn, Status } from './UI';
import { roleName, type Audit, type Workspace } from '../lib/types';
import styles from './HistoryPanel.module.css';

type ActionAppearance = { label: string; title: string; icon: Icon; tone: BadgeTone };
const actions: Record<string, ActionAppearance> = {
  event_created: { label: 'Опубликовано', title: 'Событие создано', icon: CheckCircle, tone: 'green' },
  pending_manager: { label: 'Шаг выбран', title: 'Выбор активности', icon: Hourglass, tone: 'orange' },
  declined: { label: 'Пропущено', title: 'Предложение пропущено', icon: MinusCircle, tone: 'neutral' },
  approve: { label: 'Согласовано', title: 'Участие согласовано', icon: CheckCircle, tone: 'green' },
  reject: { label: 'Не согласовано', title: 'В участии отказано', icon: XCircle, tone: 'red' },
  submit: { label: 'На проверке HR', title: 'Результат передан HR', icon: UploadSimple, tone: 'blue' },
  complete: { label: 'Подтверждено', title: 'Результат подтверждён', icon: CheckCircle, tone: 'green' },
  return: { label: 'На доработку', title: 'Результат возвращён на доработку', icon: ArrowUUpLeft, tone: 'orange' },
  cancel: { label: 'Отменено', title: 'Участие отменено', icon: Prohibit, tone: 'neutral' },
  goal_changed: { label: 'Цель изменена', title: 'Карьерная цель', icon: Flag, tone: 'purple' },
  account_issued: { label: 'Доступ выдан', title: 'Доступ к пространству', icon: ShieldCheck, tone: 'blue' },
  dataset_imported: { label: 'Импортировано', title: 'Обновление данных', icon: UploadSimple, tone: 'cyan' },
  ai_recommendation: { label: 'Совет сохранён', title: 'Рекомендация Gemini', icon: Sparkle, tone: 'purple' },
  agent_proactive_plan: { label: 'Агент обновил план', title: 'Проактивная рекомендация', icon: Sparkle, tone: 'green' },
  agent_plan_created: { label: 'План создан', title: 'План развития', icon: Sparkle, tone: 'purple' },
  agent_plan_applied: { label: 'Заявки созданы', title: 'План отправлен руководителю', icon: Flag, tone: 'green' },
  agent_plan_cancelled: { label: 'План отменён', title: 'Добровольный отказ от плана', icon: Flag, tone: 'neutral' },
};
const fallback: ActionAppearance = { label: 'Записано', title: 'Действие записано', icon: Info, tone: 'neutral' };

function auditDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function AuditEntry({ entry, data, title }: { entry: Audit; data: Workspace; title?: string }) {
 const { t, date, number, languageTag } = useI18n();

  const appearance = actions[entry.action] || fallback;
  // The persisted audit detail contains the historical transition followed by an optional note.
  const transition = entry.detail.match(/^\s*([a-z_]+)\s*→\s*([a-z_]+)\.\s*([\s\S]*)$/);
  const note = transition ? transition[3].trim() : '';
  const timestamp = auditDate(entry.at);
  const actorRole = roleName[entry.role as keyof typeof roleName] || t("Пользователь");
  const subject = data.user.role !== 'employee'
    ? data.roster.find(person => person.employee_id === entry.employee_id)?.full_name || entry.employee_id
    : '';
  const selection = entry.action === 'pending_manager' || entry.action === 'declined';
  const heading = title || (selection && entry.detail) || (entry.action === 'goal_changed' && entry.detail) || t(appearance.title);
  const detail = !transition && !selection && entry.action !== 'goal_changed'
    ? entry.action === 'account_issued' ? roleName[entry.detail as keyof typeof roleName] || entry.detail : entry.detail
    : '';

  return <details className={styles.entry}>
    <summary className={styles.summary}>
      <time className={styles.time} dateTime={timestamp ? entry.at : undefined}>
        {timestamp ? timestamp.toLocaleTimeString(languageTag, { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
      </time>
      <span className={styles.content}>
        <strong className={styles.title}>{t(heading)}</strong>
        <span className={styles.meta}>
          {subject && <><span>{subject}</span><span aria-hidden="true">·</span></>}
          <span>{t(actorRole)}</span>
          {note && <span className={styles.comment}><ChatText size={14} aria-hidden="true"/>{t("Комментарий")}</span>}
        </span>
      </span>
      <AppBadge className={styles.outcome} icon={appearance.icon} tone={appearance.tone}>{t(appearance.label)}</AppBadge>
      <CaretDown className={styles.chevron} size={16} aria-hidden="true"/>
    </summary>
    <div className={styles.expanded}>
      {transition && <div className={styles.transition} aria-label={t("Изменение статуса")}>
        <Status status={transition[1]}/><ArrowRight size={15} aria-label={t("изменён на")}/><Status status={transition[2]}/>
      </div>}
      {(note || detail) && <div className={styles.note}>
        <span className={styles.detailLabel}>{note ? t("Комментарий") : t("Подробности")}</span>
        <p>{note || detail}</p>
      </div>}
      <dl className={styles.metadata}>
        <div><dt>{t("Автор")}</dt><dd>{t(actorRole)} · {entry.actor}</dd></div>
        <div><dt>{t("Время")}</dt><dd>{timestamp ? date(entry.at,{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : entry.at}</dd></div>
        {entry.entity_id && <div><dt>{t("Объект")}</dt><dd>{entry.entity_id}</dd></div>}
        <div><dt>{t("Запись")}</dt><dd>{entry.id}</dd></div>
        {!actions[entry.action] && <div><dt>{t("Действие")}</dt><dd>{entry.action}</dd></div>}
      </dl>
    </div>
  </details>;
}

export default function HistoryPanel({ data, onCatalog, onRequests }: {
  data: Workspace; onCatalog: () => void; onRequests: () => void;
}) {
 const { t, date, number, languageTag } = useI18n();

  const [tab, setTab] = useState('audit');
  const history = data.history || [];
  const employee = data.user.role === 'employee';
  const eventTitles = new Map(data.events.map(event => [event.event_id, event.title]));
  const requestTitles = new Map(data.requests.map(request => [request.id, eventTitles.get(request.event_id)]));
  // Keep activity names for historical entries even when their request is no longer available.
  for (const entry of data.audit) {
    if ((entry.action === 'pending_manager' || entry.action === 'declined') && entry.detail) {
      requestTitles.set(entry.entity_id, entry.detail);
    }
  }
  const groups = new Map<string, Audit[]>();
  const newestFirst = [...data.audit].reverse().sort((a, b) =>
    (auditDate(b.at)?.getTime() || 0) - (auditDate(a.at)?.getTime() || 0));
  for (const entry of newestFirst) {
    const day = (auditDate(entry.at) ? date(entry.at, { day: 'numeric', month: 'long', year: 'numeric' }) : '') || t("Дата не указана");
    const entries = groups.get(day) || [];
    entries.push(entry);
    groups.set(day, entries);
  }
  const tabLabel = (label: string, count: number) => <span className={styles.tabLabel}>{label}<span className={styles.count}>{count}</span></span>;

  return <div className={styles.panel}>
    <Tabs className="tabs" variant="underline" value={tab} onValueChange={setTab} tabs={[
      { value: 'audit', label: tabLabel(t("Решения"), data.audit.length) },
      ...(data.history ? [{ value: 'learning', label: tabLabel(t("Активности"), history.length) }] : []),
    ]}/>
    {tab === 'audit' ? data.audit.length ? <div className={styles.days}>
      {[...groups].map(([day, entries]) => <section className={styles.day} key={day} aria-label={day}>
        <div className={styles.dayHeading}><h2>{day}</h2><span>{t("Сначала новые")}</span></div>
        <div className={styles.entries}>{entries.map(entry =>
          <AuditEntry key={entry.id} entry={entry} data={data} title={requestTitles.get(entry.entity_id)}/>
        )}</div>
      </section>)}
    </div> : <EmptyState icon={ClockCounterClockwise} title={t("История решений начинается здесь")}
      description={employee ? t("Выбранные шаги, согласования и подтверждённые результаты сохранятся здесь. Начните с активности в каталоге.") : t("Согласования, комментарии и изменения появятся здесь после первых действий с заявками.")}
      action={<Btn onClick={employee ? onCatalog : onRequests}>{employee ? t("Выбрать активность") : t("Открыть заявки")}<ArrowRight size={16}/></Btn>}/>
    : history.length ? <div className="table-wrap"><Table>
      <Table.Header><Table.Row><Table.Head>{t("Дата")}</Table.Head><Table.Head>{t("Активность")}</Table.Head><Table.Head>{t("Статус")}</Table.Head><Table.Head>{t("Выполнение")}</Table.Head></Table.Row></Table.Header>
      <Table.Body>{[...history].reverse().map(item => <Table.Row key={item.record_id}>
        <Table.Cell>{date(item.date)}</Table.Cell><Table.Cell>{eventTitles.get(item.event_id) || item.event_id}</Table.Cell>
        <Table.Cell><Status status={item.status}/></Table.Cell><Table.Cell>{item.completion_pct}%</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table></div> : <EmptyState icon={BookOpen} title={t("История активностей пока пуста")}
      description={t("Здесь отображаются записи об участии из загруженной истории. Текущие заявки и новые результаты доступны в разделе шагов.")}
      action={<Btn onClick={onRequests}>{employee ? t("Мои шаги") : t("Заявки и решения")}<ArrowRight size={16}/></Btn>}/>}
  </div>;
}

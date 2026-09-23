import type { CalendarEntry } from './calendar';
import { formatDate, formatNumber, translate, type Locale } from './i18n-core';

/** Translate generated calendar copy while preserving dates, status, UID and participant names. */
export function localizeCalendarEntry(locale: Locale, entry: CalendarEntry): CalendarEntry {
  const t = (text: string, values?: Record<string, string | number>) => translate(locale, text, values);
  const title = entry.kind === 'deadline' && entry.title.startsWith('Срок: ')
    ? t('Срок: {0}', { 0: t(entry.title.slice(6)) }) : t(entry.title);
  const description = entry.description.split('\n').map(line => {
    const duration = line.match(/^(.+) · (\d+(?:\.\d+)?) ч\.$/);
    if (duration) return `${t(duration[1])} · ${formatNumber(locale, Number(duration[2]))} ${t('ч')}.`;
    if (line.startsWith('Участник: ')) return t('Участник: {0}', { 0: line.slice(10) });
    if (line.startsWith('Завершить обязательное обучение до ')) return t('Завершить обязательное обучение до {0}.', { 0: formatDate(locale, entry.date) });
    return t(line);
  }).join('\n');
  return { ...entry, title, description };
}

import { formatName, statusName, type Event, type Request, type Workspace } from './types';

export type CalendarEntry = {
  id: string;
  eventId: string;
  title: string;
  description: string;
  date: string;
  kind: 'request' | 'deadline' | 'catalog';
  status: string;
  owner?: string;
};

export const activeCalendarStatuses = ['pending_manager', 'approved', 'pending_hr'];

// Calendar dates are civil dates, not instants in the browser's time zone.
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftCalendarDate(value: string, days: number): string {
  if (!validCalendarDate(value)) throw new Error('Некорректная дата события');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDateLabel(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('ru-RU', { ...options, timeZone: 'UTC' });
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  if (!validCalendarDate(first)) return [];
  const start = shiftCalendarDate(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => shiftCalendarDate(start, index));
}

function eventDetails(event: Event): string {
  return `${event.description}\n${formatName[event.format] || event.format} · ${event.duration_hours} ч.\nВремя начала не задано; событие на весь день.`;
}

export function requestCalendarEntry(event: Event, request: Request, owner?: string): CalendarEntry | null {
  if (!validCalendarDate(request.session_date) || !activeCalendarStatuses.includes(request.status)) return null;
  return {
    id: `request-${request.id}`, eventId: event.event_id, title: event.title,
    date: request.session_date, kind: 'request', status: request.status, owner,
    description: `${eventDetails(event)}\n${statusName[request.status] || request.status}.${owner ? `\nУчастник: ${owner}.` : ''}`,
  };
}

export function buildCalendarEntries(data: Workspace): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  const events = new Map(data.events.map(event => [event.event_id, event]));
  const ownSessions = new Set<string>();
  // Requests have already been restricted to visible employees by the API.
  for (const request of data.requests) {
    const event = events.get(request.event_id);
    if (!event) continue;
    const owner = data.user.role === 'employee' ? undefined : data.roster.find(person => person.employee_id === request.employee_id)?.full_name || (request.employee_id === data.user.employee_id ? data.profile?.full_name : request.employee_id);
    const entry = requestCalendarEntry(event, request, owner);
    if (entry) entries.push(entry);
    if (request.employee_id === data.user.employee_id && !['cancelled', 'rejected', 'declined'].includes(request.status)) ownSessions.add(`${event.event_id}/${request.session_date}`);
  }
  for (const history of data.history || []) {
    const event = events.get(history.event_id);
    if (!event?.mandatory || !history.due_date || !validCalendarDate(history.due_date) || !['in_progress', 'overdue'].includes(history.status)) continue;
    entries.push({
      id: `deadline-${history.record_id}`, eventId: event.event_id, title: `Срок: ${event.title}`,
      date: history.due_date, kind: 'deadline', status: history.status,
      description: `${eventDetails(event)}\nЗавершить обязательное обучение до ${calendarDateLabel(history.due_date)}.`,
    });
  }
  const catalog = data.user.role === 'hr' ? data.events : (data.candidates || []).filter(candidate => !candidate.blocked).map(candidate => candidate.event);
  for (const event of catalog) {
    if (event.format === 'self_paced') continue;
    for (const date of new Set(event.upcoming_sessions)) {
      if (!validCalendarDate(date) || date < data.snapshot || ownSessions.has(`${event.event_id}/${date}`)) continue;
      entries.push({
        id: `catalog-${event.event_id}-${date}`, eventId: event.event_id, title: event.title,
        date, kind: 'catalog', status: 'available',
        description: `${eventDetails(event)}\nСессия из каталога. Для участия подайте заявку в Career Quest и дождитесь согласования.`,
      });
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id));
}

function escapeICS(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldICS(line: string): string {
  const encoder = new TextEncoder();
  let output = '', bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { output += '\r\n '; bytes = 1; }
    output += character;
    bytes += size;
  }
  return `${output}\r\n`;
}

export function calendarICS(entries: CalendarEntry[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Career Quest//Calendar//RU', 'CALSCALE:GREGORIAN'];
  const seen = new Set<string>();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  for (const entry of entries) {
    if (!validCalendarDate(entry.date) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    lines.push('BEGIN:VEVENT', `UID:${encodeURIComponent(entry.id)}@careerquest.local`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${entry.date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${shiftCalendarDate(entry.date, 1).replaceAll('-', '')}`,
      `SUMMARY:${escapeICS(entry.title)}`, `DESCRIPTION:${escapeICS(entry.description)}`,
      `STATUS:${entry.kind === 'catalog' || entry.status === 'pending_manager' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICS).join('');
}

export function calendarLinks(entry: CalendarEntry): { google: string; outlook: string } {
  const end = shiftCalendarDate(entry.date, 1);
  return {
    google: `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: entry.title, dates: `${entry.date.replaceAll('-', '')}/${end.replaceAll('-', '')}`, details: entry.description })}`,
    outlook: `https://outlook.office.com/calendar/0/deeplink/compose?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: entry.title, startdt: entry.date, enddt: end, allday: 'true', body: entry.description })}`,
  };
}

export function downloadCalendar(entries: CalendarEntry[], filename = 'career-quest.ics'): void {
  const url = URL.createObjectURL(new Blob([calendarICS(entries)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

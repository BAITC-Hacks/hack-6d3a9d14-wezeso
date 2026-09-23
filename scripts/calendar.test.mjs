import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const compile = name => ts.transpileModule(readFileSync(new URL(`../frontend/lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const calendar = await import(url(compile('calendar').replace("'./types'", JSON.stringify(url(compile('types'))))));
const { buildCalendarEntries, requestCalendarEntry, calendarICS, calendarLinks, monthDays, shiftCalendarDate, validCalendarDate } = calendar;
const event = (id, extra = {}) => ({ event_id: id, title: `Событие ${id}`, description: 'Описание', format: 'online', duration_hours: 3, upcoming_sessions: ['2026-10-07'], mandatory: false, ...extra });
const request = (id, status, extra = {}) => ({ id, employee_id: 'E1', event_id: 'EV1', session_date: '2026-10-07', status, ...extra });
const workspace = extra => ({ user: { role: 'employee', employee_id: 'E1' }, snapshot: '2026-10-01', events: [], requests: [], candidates: [], roster: [], history: [], ...extra });

test('calendar uses actual session dates and open mandatory deadlines; never invents dates for self-paced work', () => {
  const workshop = event('EV1');
  const required = event('EV2', { mandatory: true, format: 'self_paced', upcoming_sessions: [] });
  const entries = buildCalendarEntries(workspace({ events: [workshop, required], requests: [request('Q1', 'approved'), request('Q2', 'approved', { event_id: 'EV2', session_date: '' })], candidates: [{ event: workshop, blocked: '' }, { event: required, blocked: '' }], history: [
    { record_id: 'H1', event_id: 'EV2', date: '2026-09-01', due_date: '2026-09-30', status: 'overdue' },
    { record_id: 'H2', event_id: 'EV2', date: '2026-09-01', due_date: '2026-10-10', status: 'completed' },
    { record_id: 'H3', event_id: 'EV2', date: '2026-09-01', due_date: 'bad', status: 'in_progress' },
  ] }));
  assert.deepEqual(entries.map(entry => [entry.id, entry.date]), [['deadline-H1', '2026-09-30'], ['request-Q1', '2026-10-07']]);
});

test('cancelled and completed requests are not upcoming commitments; pending requests remain tentative', () => {
  for (const status of ['cancelled', 'rejected', 'declined', 'completed']) assert.equal(requestCalendarEntry(event('EV1'), request('Q', status)), null);
  const pending = requestCalendarEntry(event('EV1'), request('Q', 'pending_manager'));
  assert.match(calendarICS([pending]), /STATUS:TENTATIVE/);
  assert.match(calendarICS([requestCalendarEntry(event('EV1'), request('Q', 'approved'))]), /STATUS:CONFIRMED/);
});

test('catalog filters blocked, duplicate, invalid and old sessions', () => {
  const open = event('open', { upcoming_sessions: ['2026-09-30', '2026-10-01', '2026-10-01', '2026-10-02', '2026-02-30'] });
  const blocked = event('blocked');
  const entries = buildCalendarEntries(workspace({ events: [open, blocked], candidates: [{ event: open, blocked: '' }, { event: blocked, blocked: 'Нет доступа' }] }));
  assert.deepEqual(entries.map(entry => entry.date), ['2026-10-01', '2026-10-02']);
  assert.ok(entries.every(entry => entry.eventId === 'open'));
});

test('team calendar keeps separate participants and HR sees the catalog without candidate recommendations', () => {
  const entries = buildCalendarEntries(workspace({ user: { role: 'manager', employee_id: 'M1' }, events: [event('EV1')], requests: [request('Q1', 'approved'), request('Q2', 'approved', { employee_id: 'E2' })], roster: [{ employee_id: 'E1', full_name: 'Первый' }, { employee_id: 'E2', full_name: 'Второй' }] }));
  assert.deepEqual(entries.map(entry => entry.owner), ['Первый', 'Второй']);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 2);
  assert.equal(buildCalendarEntries(workspace({ user: { role: 'hr' }, events: [event('EV1')] })).length, 1);
});

test('month layout starts Monday and calendar arithmetic crosses leap days and year boundaries', () => {
  assert.equal(monthDays('2026-10')[0], '2026-09-28');
  assert.equal(monthDays('2026-10').length, 42);
  assert.equal(shiftCalendarDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftCalendarDate('2026-12-31', 1), '2027-01-01');
  assert.equal(validCalendarDate('2026-02-29'), false);
  assert.equal(validCalendarDate('2026-10-07T00:00:00Z'), false);
  assert.deepEqual(monthDays('invalid'), []);
});

test('ICS safely handles Russian text, exclusive end dates, stable IDs and content injection', () => {
  const entry = { ...requestCalendarEntry(event('EV1'), request('Q1', 'approved')), date: '2026-12-31', title: 'Русский текст '.repeat(20), description: 'Курс; заметки, путь\\файл\r\nATTENDEE:attacker@example.test' };
  const output = calendarICS([entry, entry], new Date('2026-09-23T09:00:00Z'));
  assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(output, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(output, /UID:request-Q1@careerquest.local/);
  assert.match(output, /DTSTAMP:20260923T090000Z/);
  assert.ok(output.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75));
  const unfolded = output.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${entry.title}\r\n`));
  assert.ok(unfolded.includes('Курс\\; заметки\\, путь\\\\файл\\nATTENDEE:'));
  assert.ok(!output.includes('\r\nATTENDEE:'));
  assert.ok(!output.includes('METHOD:REQUEST'));
});

test('Google and Outlook links preserve dates and encode titles and descriptions', () => {
  const entry = { ...requestCalendarEntry(event('EV1'), request('Q1', 'approved')), title: 'SQL & отчёты + практика?', date: '2028-02-29' };
  const links = calendarLinks(entry);
  const google = new URL(links.google), outlook = new URL(links.outlook);
  assert.equal(google.searchParams.get('text'), entry.title);
  assert.equal(google.searchParams.get('dates'), '20280229/20280301');
  assert.equal(outlook.searchParams.get('subject'), entry.title);
  assert.equal(outlook.searchParams.get('startdt'), '2028-02-29');
  assert.equal(outlook.searchParams.get('enddt'), '2028-03-01');
  assert.equal(outlook.searchParams.get('allday'), 'true');
});

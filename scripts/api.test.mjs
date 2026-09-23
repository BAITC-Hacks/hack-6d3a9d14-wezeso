import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = readFileSync(new URL('../frontend/lib/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { ApiError, requestJSON } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

test('requests carry the UI language without changing auth headers or answer values', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: 'kk' } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const answer = JSON.stringify({ target_role: 'Backend Engineer', target_grade: 'Senior', text: 'Исходный вариант ответа' });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Accept-Language'), 'kk-KZ');
    assert.equal(headers.get('X-CSRF-Token'), 'test-token');
    assert.equal(options.body, answer);
    return Response.json({ saved: true });
  });
  await requestJSON('courses/exam', { method: 'POST', headers: { 'X-CSRF-Token': 'test-token' }, body: answer });
});

test('successful requests preserve options and attach a bounded cancellation signal', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/goal');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-CSRF-Token'], 'test-token');
    assert.equal(options.body, '{"confirmed":true}');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ saved: true });
  });
  assert.deepEqual(await requestJSON('goal', { method: 'POST', headers: { 'X-CSRF-Token': 'test-token' }, body: '{"confirmed":true}' }), { saved: true });
});

test('an expired session preserves HTTP status so the UI can return to login', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Сессия завершилась' }, { status: 401 }));
  await assert.rejects(requestJSON('workspace'), error => error instanceof ApiError && error.status === 401 && error.message === 'Сессия завершилась');
});

test('HTML service failures and malformed success responses become readable errors', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('<html>Unavailable</html>', { status: 503 }));
  await assert.rejects(requestJSON('workspace'), error => error instanceof ApiError && error.status === 503 && !error.message.includes('JSON'));
  fetch.mock.mockImplementation(async () => new Response('invalid json'));
  await assert.rejects(requestJSON('workspace'), /Не удалось прочитать ответ сервера/);
});

test('offline failures explain how to recover instead of leaking native fetch errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(requestJSON('workspace'), /Проверьте соединение/);
});

test('cancelled session checks remain cancellations and cannot become login errors', async t => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted(); });
  await assert.rejects(requestJSON('session', { signal: controller.signal }), error => error.name === 'AbortError' && !(error instanceof ApiError));
});

test('timeouts stop endless loading and warn against resubmitting an uncertain save', async t => {
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', duration => {
    durations.push(duration);
    return AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted(); });
  await assert.rejects(requestJSON('workspace'), /Сервер отвечает дольше обычного/);
  await assert.rejects(requestJSON('requests', { method: 'POST' }), /проверьте результат перед повторной отправкой/);
  await assert.rejects(requestJSON('recommendations', { method: 'POST' }), ApiError);
  assert.deepEqual(durations, [15000, 15000, 60000]);
});

test('a timeout reading the response body is not mislabeled as invalid data', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    async json() { controller.abort(); throw new DOMException('Timed out', 'TimeoutError'); },
  }));
  await assert.rejects(requestJSON('workspace'), /Сервер отвечает дольше обычного/);
});

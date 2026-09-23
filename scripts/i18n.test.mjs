import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const corePath = new URL('frontend/lib/i18n-core.ts', root);
const source = readFileSync(corePath, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
const exports = {};
new Function('require', 'exports', compiled.outputText)(createRequire(corePath), exports);
const { translate, detectLocale, formatDate, formatNumber, formatCount } = exports;
const kk = { ...json('frontend/lib/locales/kk.json'), ...json('frontend/lib/locales/server-kk.json'), ...json('frontend/lib/locales/courses-kk.json'), ...json('frontend/lib/locales/catalog.json').kk };

test('explicit preference wins; unsupported and disabled language tags are ignored', () => {
  assert.equal(detectLocale('kk', 'ru-RU'), 'kk');
  assert.equal(detectLocale('ru', 'kk-KZ'), 'ru');
  assert.equal(detectLocale(null, 'en-US,kk-KZ;q=0.9,ru;q=0.5'), 'kk');
  assert.equal(detectLocale('invalid', 'kk;q=0,ru;q=0.8'), 'ru');
  assert.equal(detectLocale(null, 'en-US'), 'ru');
});

test('every literal translation call and visible Cyrillic JSX text is covered', () => {
  const paths = ['frontend/app/page.tsx', ...readdirSync(new URL('frontend/components', root)).filter(f => f.endsWith('.tsx') && f !== 'LanguageSwitcher.tsx').map(f => `frontend/components/${f}`)];
  const missing = [];
  for (const path of paths) {
    const file = ts.createSourceFile(path, readFileSync(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 't' && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (/[А-Яа-яЁё]/.test(key) && !kk[key]) missing.push(`${path}: ${key}`);
      }
      if (ts.isJsxText(node) && /[А-Яа-яЁё]/.test(node.text)) missing.push(`${path}: untranslated JSX ${node.text.trim()}`);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.deepEqual(missing, []);
});

test('translations preserve placeholders and printf parameter types', () => {
  for (const [source, target] of Object.entries(kk)) {
    assert.ok(target.trim(), source);
    const params = value => (value.match(/\{\w+\}|%\.0f|%[sdw]|%%/g) || []).sort();
    assert.deepEqual(params(target), params(source), source);
  }
});

test('both locales cover all catalog titles, descriptions and skill names', () => {
  const catalog = json('frontend/lib/locales/catalog.json');
  const events = json('events.json').events;
  const skills = json('skills.json').skills;
  for (const locale of ['ru', 'kk']) {
    for (const event of events) {
      assert.ok(catalog[locale][event.title], event.title);
      assert.ok(catalog[locale][event.description], event.description);
    }
    for (const skill of skills) assert.ok(catalog[locale][skill.name], skill.name);
  }
  for (const { event, course } of json('backend/course_examples.json')) {
    for (const text of [event.title, event.description, ...course.lessons.flatMap(l => [l.title, ...l.content.split('\n\n')]), ...course.questions.flatMap(q => [q.prompt, ...q.options.filter(x => /[А-Яа-я]/.test(x))])]) assert.ok(kk[text], text);
  }
});

test('server explanations localize embedded catalog names without changing IDs or unknown content', () => {
  assert.equal(translate('kk', 'Для участия нужен System Design: 3, сейчас 1'), 'Қатысу үшін Жүйелерді жобалау қажет: 3, қазір — 1');
  assert.equal(translate('ru', 'Для участия нужен System Design: 3, сейчас 1'), 'Для участия нужен Проектирование систем: 3, сейчас 1');
  assert.equal(translate('kk', 'Неверный логин или пароль'), 'Логин немесе құпиясөз қате');
  assert.equal(translate('kk', 'EV_001'), 'EV_001');
  assert.equal(translate('kk', 'Мой произвольный комментарий'), 'Мой произвольный комментарий');
  assert.equal(translate('kk', 'Персонаж {0}', { 0: 'Анна' }), 'Анна кейіпкері');
});

test('civil dates never move between time zones and invalid dates do not crash', () => {
  const original = process.env.TZ;
  for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Almaty']) {
    process.env.TZ = zone;
    assert.match(formatDate('kk', '2026-10-01', { day: 'numeric', month: 'long', year: 'numeric' }), /1 қазан/);
    assert.equal(formatDate('ru', '2026-10-01', { month: 'long', year: 'numeric' }).includes('1 '), false);
  }
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  assert.equal(formatDate('kk', '2026-02-30'), 'Күні көрсетілмеген');
  assert.equal(formatDate('ru', 'invalid'), 'Дата не указана');
  assert.equal(formatDate('kk', ''), 'Кез келген уақытта');
});

test('Russian inflection and Kazakh counters handle zero, teens, compound counts and fractions', () => {
  assert.equal(formatCount('ru', 'activity', 1), '1 активность');
  assert.equal(formatCount('ru', 'activity', 2), '2 активности');
  assert.equal(formatCount('ru', 'activity', 5), '5 активностей');
  assert.equal(formatCount('ru', 'activity', 11), '11 активностей');
  assert.equal(formatCount('ru', 'activity', 21), '21 активность');
  assert.equal(formatCount('kk', 'activity', 21), '21 іс-шара');
  assert.equal(formatNumber('kk', 1.5), '1,5');
  assert.equal(formatCount('ru', 'activity', 1.5), '1,5 активности');
});

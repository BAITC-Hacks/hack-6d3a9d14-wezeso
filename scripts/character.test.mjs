import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = readFileSync(new URL('../frontend/lib/character.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { characterAppearance, characterIdentity, characterProgress } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

test('character identity survives account changes and matches the roster', () => {
  const identity = characterIdentity({ employee_id: 'E0001', id: 'original-account' });
  const replacement = characterIdentity({ employee_id: 'E0001', id: 'replacement-account' });
  assert.equal(identity, 'E0001');
  assert.deepEqual(characterAppearance(identity), characterAppearance(replacement));
  assert.notDeepEqual(characterAppearance(identity), characterAppearance('E0002'));
});

test('accounts without an employee profile have separate stable characters', () => {
  const hr = characterIdentity({ employee_id: '', id: 'hr' });
  const another = characterIdentity({ employee_id: '', id: 'another-hr' });
  assert.notEqual(hr, another);
  assert.notDeepEqual(characterAppearance(hr), characterAppearance(another));
  assert.deepEqual(characterAppearance(hr), characterAppearance('account:hr'));
});

test('every seeded employee has a distinct visual appearance', () => {
  const { employees } = JSON.parse(readFileSync(new URL('../employees.json', import.meta.url), 'utf8'));
  const appearances = employees.map(employee => {
    const avatar = characterAppearance(employee.employee_id);
    return JSON.stringify([avatar.color, avatar.shape, avatar.expression, avatar.pattern, avatar.marks, avatar.markRotation]);
  });
  assert.equal(new Set(appearances).size, employees.length);
});

test('the roster spans visibly different palettes, silhouettes, faces and markings', () => {
  const { employees } = JSON.parse(readFileSync(new URL('../employees.json', import.meta.url), 'utf8'));
  const appearances = employees.map(employee => characterAppearance(employee.employee_id));
  assert.equal(new Set(appearances.map(avatar => avatar.palette)).size, 8);
  assert.equal(new Set(appearances.map(avatar => avatar.shape)).size, 8);
  assert.equal(new Set(appearances.map(avatar => avatar.expression)).size, 4);
  assert.equal(new Set(appearances.map(avatar => avatar.pattern)).size, 4);
  // The main demo account should visibly change from the former green pebble.
  assert.equal(characterAppearance('E0002').palette, 'nebula');
  assert.equal(characterAppearance('E0002').shape, 'nuage');
});

test('pending results and teammates never award the owner XP', () => {
  const history = [{ record_id: 'H1', status: 'completed' }, { record_id: 'H2', status: 'in_progress' }];
  const requests = [
    { id: 'R1', employee_id: 'E0001', status: 'completed' },
    { id: 'R2', employee_id: 'E0001', status: 'pending_hr' },
    { id: 'R3', employee_id: 'E0002', status: 'completed' },
    { id: 'R4', employee_id: 'E0001', status: 'approved' },
    { id: 'R5', employee_id: 'E0001', status: 'cancelled' },
  ];
  assert.equal(characterProgress('E0001', history, requests).xp, 200);
  assert.equal(characterProgress('', history, requests).xp, 0);
});

test('completion advances the level once, including at the exact threshold', () => {
  const history = Array.from({ length: 4 }, (_, i) => ({ record_id: `H${i}`, status: 'completed' }));
  const pending = { id: 'R1', employee_id: 'E0001', status: 'pending_hr' };
  assert.deepEqual(characterProgress('E0001', history, [pending]), { completed: 4, xp: 400, level: 1, levelXP: 400, nextLevelXP: 500 });
  const completed = { ...pending, status: 'completed' };
  const progress = characterProgress('E0001', history, [completed]);
  assert.deepEqual(progress, { completed: 5, xp: 500, level: 2, levelXP: 0, nextLevelXP: 500 });
  assert.deepEqual(characterProgress('E0001', [...history, history[0]], [completed, completed]), progress);
});

test('new users start at level one with no invented progress', () => {
  assert.deepEqual(characterProgress('new-user'), { completed: 0, xp: 0, level: 1, levelXP: 0, nextLevelXP: 500 });
});

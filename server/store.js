import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { AppError, initialState, requireThat, validateImport } from './domain.js';

export const catalog = JSON.parse(readFileSync(resolve('skills.json'),'utf8'));
export const events = JSON.parse(readFileSync(resolve('events.json'),'utf8')).events;
export const sourceEmployees = JSON.parse(readFileSync(resolve('employees.json'),'utf8')).employees;
export const sourceHistory = parse(readFileSync(resolve('activity_history.csv'),'utf8'), { columns: true, skip_empty_lines: true, bom: true }).map(h => ({ ...h, completion_pct: Number(h.completion_pct), score: h.score === '' ? null : Number(h.score), feedback_rating: h.feedback_rating === '' ? null : Number(h.feedback_rating) }));
export const isSupabase = process.env.APP_MODE === 'supabase';
requireThat(!process.env.APP_MODE || ['demo','supabase'].includes(process.env.APP_MODE), 'APP_MODE must be demo or supabase.');
if (isSupabase && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('Supabase mode requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. See .env.example.');
export const admin = isSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const dataPath = resolve(process.env.DATA_DIR || '.data', 'state.json');
let localRows = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath,'utf8')) : Object.fromEntries(sourceEmployees.map(e => [e.employee_id, { id: e.employee_id, profile: e, history: sourceHistory.filter(h => h.employee_id === e.employee_id), state: { ...initialState(), profile: { ...initialState().profile, seed: e.full_name } }, version: 0 }]));
let queue = Promise.resolve();
function serial(work) { const next = queue.then(work); queue = next.catch(() => {}); return next; }
function saveLocal(next) { mkdirSync(resolve(process.env.DATA_DIR || '.data'), { recursive: true }); writeFileSync(`${dataPath}.tmp`, JSON.stringify(next)); renameSync(`${dataPath}.tmp`, dataPath); localRows = next; }
async function checked(query) { const { data, error } = await query; if (error) throw new AppError('Database request failed. Check the local Supabase service and migration.',503); return data; }
export const store = {
  async list() { if (!admin) return Object.values(localRows); const rows = []; for(let from=0;;from+=1000) { const page = await checked(admin.from('cq_employees').select('*').order('id').range(from,from+999)); rows.push(...page); if(page.length<1000) break; } return rows; },
  async get(id) { const row = admin ? await checked(admin.from('cq_employees').select('*').eq('id',id).maybeSingle()) : localRows[id]; requireThat(row,'Employee not found. Seed the database or import a profile.',404); return row; },
  async mutate(id, reducer) {
    if (!admin) return serial(async () => { const row = await this.get(id); const output = reducer(structuredClone(row)); if (output.state.version !== row.state.version) saveLocal({ ...localRows, [id]: { ...row, state: output.state, version: row.version + 1 } }); return output.result; });
    for(let i=0;i<4;i++) { const row = await this.get(id); const output = reducer(row); if (output.state.version === row.state.version) return output.result; const updated = await checked(admin.from('cq_employees').update({ state: output.state, version: row.version + 1 }).eq('id',id).eq('version',row.version).select('id')); if (updated.length) return output.result; }
    throw new AppError('Another update arrived. Please try again.',409);
  },
  async import(employeeInput, historyInput) {
    return serial(async () => {
      const rows = await this.list();
      const data = validateImport(employeeInput,historyInput,rows.map(r=>r.profile),rows.flatMap(r=>r.history),events,catalog);
      const affected = new Set([...data.employees.map(e=>e.employee_id),...data.history.map(h=>h.employee_id)]);
      const changes = [];
      for (const id of affected) {
        const old = rows.find(r=>r.id===id);
        const history = new Map((old?.history || []).map(h=>[h.record_id,h]));
        for (const h of data.history.filter(h=>h.employee_id===id)) history.set(h.record_id,h);
        changes.push({ id, profile: data.employees.find(e=>e.employee_id===id) || old.profile, history: [...history.values()], state: old?.state || initialState(), version: (old?.version ?? -1) + 1, expected_version: old?.version ?? -1 });
      }
      if (admin) await checked(admin.rpc('cq_import_rows', { incoming: changes }));
      else saveLocal({ ...localRows, ...Object.fromEntries(changes.map(({ expected_version, ...row })=>[row.id,row])) });
      return { employees: data.employees.length, records: data.history.length };
    });
  },
};

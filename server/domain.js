import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const GRADES = ['Junior', 'Middle', 'Senior', 'Lead'];
export const AS_OF = process.env.AS_OF_DATE || '2026-10-01';
export const REWARDS = [
  { id: 'forest', name: 'Forest guardian', description: 'An emerald character frame.', price: 120, kind: 'frame', value: 'forest', icon: 'Leaf' },
  { id: 'solar', name: 'Solar explorer', description: 'A warm amber character frame.', price: 180, kind: 'frame', value: 'solar', icon: 'Sun' },
  { id: 'violet', name: 'Cosmic architect', description: 'A violet character frame.', price: 240, kind: 'frame', value: 'violet', icon: 'Orbit' },
  { id: 'trailblazer', name: 'Trailblazer', description: 'A title for making your own way.', price: 150, kind: 'title', value: 'Trailblazer', icon: 'Flag' },
  { id: 'scholar', name: 'Lifelong scholar', description: 'Wear your curiosity with pride.', price: 200, kind: 'title', value: 'Lifelong scholar', icon: 'BookOpen' },
  { id: 'legend', name: 'Qadam legend', description: 'A title earned through steady growth.', price: 500, kind: 'title', value: 'Qadam legend', icon: 'Crown' },
];
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function requireThat(condition, message, status = 400) { if (!condition) throw new AppError(message, status); }
export function initialState() { return { version: 0, history: [], profile: { nickname: '', seed: 'Akmaral', characterClass: 'Architect', frame: 'default', title: 'Curious explorer', gameEnabled: true, language: 'en', preferredFormat: 'any' }, goal: undefined, purchases: [], dismissed: [] }; }
export function effectiveEmployee(employee, state) { return { ...employee, career_goal: state.goal === undefined ? employee.career_goal : state.goal }; }
export function getHistory(employee, history, state) {
  const merged = new Map(history.filter(h => h.employee_id === employee.employee_id).map(h => [h.record_id, h]));
  for (const h of state.history) merged.set(h.record_id, h);
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.record_id.localeCompare(b.record_id));
}
export function applyGain(levels, event) {
  const result = { ...levels };
  for (const { skill_id, gain, max_level } of event.develops_skills) result[skill_id] = Math.max(result[skill_id] || 0, Math.min(max_level, (result[skill_id] || 0) + gain));
  return result;
}
export function currentSkills(employee, history, events) {
  let levels = { ...employee.skills };
  const completed = history.filter(h => h.status === 'completed' && (h.completed_at || h.date) > employee.last_review_date && (h.completed_at || h.date).slice(0, 10) <= AS_OF).sort((a,b) => (a.completed_at || a.date).localeCompare(b.completed_at || b.date));
  for (const h of completed) { const event = events.find(e => e.event_id === h.event_id); if (event) levels = applyGain(levels, event); }
  return levels;
}
export function targetFor(employee, catalog) {
  const goal = employee.career_goal || { target_role: employee.role, target_grade: GRADES[Math.min(3, GRADES.indexOf(employee.grade) + 1)] };
  const requirements = catalog.role_profiles.find(p => p.role === goal.target_role && p.grade === goal.target_grade);
  requireThat(requirements, 'This career target is not in the role catalog.');
  return { ...goal, suggested: !employee.career_goal, requirements };
}
export function getGaps(levels, target, catalog) {
  return Object.entries(target.requirements.required_skills).map(([id, required]) => ({ id, name: catalog.skills.find(s => s.skill_id === id)?.name || id, current: levels[id] || 0, required, gap: Math.max(0, required - (levels[id] || 0)), critical: target.requirements.critical_skills.includes(id), type: catalog.skills.find(s => s.skill_id === id)?.type || 'hard' })).sort((a,b) => Number(b.critical) - Number(a.critical) || b.gap - a.gap);
}
export function readiness(gaps) {
  const total = gaps.reduce((n,g) => n + g.required, 0);
  return total ? Math.round(100 * gaps.reduce((n,g) => n + Math.min(g.current, g.required), 0) / total) : 100;
}
export function eligibility(event, employee, levels, history) {
  const reasons = [];
  const rows = history.filter(h => h.event_id === event.event_id);
  const active = rows.findLast(h => h.status === 'in_progress');
  if (event.mandatory) reasons.push('Required training is kept separate from voluntary quests.');
  if (!event.target_roles.includes(employee.role)) reasons.push(`Available to ${event.target_roles.join(', ')}; your current role is ${employee.role}.`);
  if (!event.target_grades.includes(employee.grade)) reasons.push(`Requires ${event.target_grades.join(' / ')} grade.`);
  for (const [id, value] of Object.entries(event.prerequisites)) if ((levels[id] || 0) < value) reasons.push(`${id.replace('SK_', '').replaceAll('_', ' ')} prerequisite: ${levels[id] || 0}/${value}.`);
  if (rows.some(h => h.status === 'completed') && event.event_id !== 'EV_036') reasons.push('Already completed.');
  if (event.event_id === 'EV_036' && rows.some(h => h.status === 'completed' && (h.completed_at || h.date).slice(0,10) === AS_OF)) reasons.push('This recurring club can be completed once per day.');
  if (!active && event.format !== 'self_paced' && !event.upcoming_sessions.some(d => d >= AS_OF)) reasons.push('No upcoming session is available.');
  return { eligible: reasons.length === 0, reasons, active, nextSession: event.upcoming_sessions.find(d => d >= AS_OF) || null };
}
export function rewardFor(event) { return event.mandatory ? { xp: 0, coins: 0 } : { xp: Math.min(350, 60 + event.duration_hours * 10), coins: Math.min(100, 20 + event.duration_hours * 3) }; }
export function gameStats(history, events, state) {
  const done = history.filter(h => h.status === 'completed' && !events.find(e => e.event_id === h.event_id)?.mandatory);
  const xp = done.reduce((n,h) => n + rewardFor(events.find(e => e.event_id === h.event_id)).xp, 0);
  const earned = done.reduce((n,h) => n + rewardFor(events.find(e => e.event_id === h.event_id)).coins, 0);
  return { xp, level: Math.floor(xp / 500) + 1, levelXp: xp % 500, nextLevelXp: 500, coins: earned - state.purchases.reduce((n,p) => n + p.price, 0), completed: done.length, active: history.filter(h => h.status === 'in_progress').length, earned };
}
export function buildView(rawEmployee, baseHistory, events, catalog, state = initialState()) {
  const employee = effectiveEmployee(rawEmployee, state);
  const history = getHistory(employee, baseHistory, state);
  const levels = currentSkills(employee, history, events);
  const target = targetFor(employee, catalog);
  const gaps = getGaps(levels, target, catalog);
  const gapMap = Object.fromEntries(gaps.map(g => [g.id,g]));
  const options = events.map(event => {
    const access = eligibility(event, employee, levels, history);
    const after = applyGain(levels, event);
    const gains = event.develops_skills.map(s => ({ id: s.skill_id, name: catalog.skills.find(k => k.skill_id === s.skill_id)?.name || s.skill_id, before: levels[s.skill_id] || 0, after: after[s.skill_id], target: gapMap[s.skill_id]?.required || 0, critical: gapMap[s.skill_id]?.critical || false })).filter(g => g.after > g.before);
    const usefulGain = gains.reduce((n,g) => n + Math.max(0, Math.min(g.after, g.target) - Math.min(g.before, g.target)), 0);
    const criticalGain = gains.filter(g => g.critical).reduce((n,g) => n + Math.max(0, Math.min(g.after,g.target) - Math.min(g.before,g.target)), 0);
    const similar = history.filter(h => !events.find(e => e.event_id === h.event_id)?.mandatory && events.find(e => e.event_id === h.event_id)?.format === event.format);
    const completed = similar.filter(h => h.status === 'completed').length;
    const missed = similar.filter(h => ['no_show','dropped','declined'].includes(h.status)).length;
    const formatScore = similar.length ? (completed - missed) / similar.length * 4 : 0;
    const preference = state.profile.preferredFormat === event.format ? 3 : 0;
    const score = criticalGain * 8 + usefulGain * 4 + formatScore + preference + (access.active ? 3 : 0) - event.duration_hours / 24;
    const relevant = gains.filter(g => g.target > g.before);
    const evidence = [
      { label: 'Career direction', detail: `${employee.role} · ${employee.grade} → ${target.target_role} · ${target.target_grade}${target.suggested ? ' (suggested target)' : ''}.` },
      { label: 'Skill impact', detail: relevant.length ? relevant.map(g => `${g.name}: ${g.before} → ${g.after}, target ${g.target}/5${g.critical ? ' · critical' : ''}`).join('; ') : 'Builds supporting skills; no direct target gap is reduced.' },
      { label: 'Your experience', detail: `${completed} completed and ${missed} unfinished / missed / declined ${event.format.replace('_',' ')} activities. ${access.active ? 'You have already started this quest.' : 'Your participation history influences this recommendation.'}` },
      { label: 'Practical fit', detail: `${event.duration_hours} hours · ${event.format.replace('_',' ')} · ${access.nextSession || 'start any time'}${preference ? ' · your preferred format' : ''}. Current-role eligibility and prerequisites are checked.` },
    ];
    return { ...event, ...access, gains, usefulGain, criticalGain, score, evidence, reward: rewardFor(event), dismissed: state.dismissed.includes(event.event_id), readinessAfter: readiness(getGaps(after, target, catalog)) };
  });
  let candidates = options.filter(e => e.eligible && e.usefulGain > 0 && !e.dismissed).sort((a,b) => b.score - a.score);
  if (!candidates.length) {
    const blocked = options.filter(e => !e.mandatory && e.usefulGain > 0 && e.target_roles.includes(employee.role) && e.target_grades.includes(employee.grade) && !history.some(h => h.event_id === e.event_id && h.status === 'completed'));
    candidates = options.filter(e => e.eligible && !e.dismissed && e.gains.some(g => blocked.some(b => (b.prerequisites[g.id] || 0) > g.before))).map(e => ({ ...e, preparatory: true, evidence: [...e.evidence, { label: 'Preparation', detail: 'Builds a prerequisite for a catalog activity that addresses your target. More than one step may be needed.' }] })).sort((a,b) => b.score - a.score);
  }
  return { employee, state, history: [...history].reverse().map(h => ({ ...h, event: events.find(e => e.event_id === h.event_id) })), levels, target, gaps, readiness: readiness(gaps), options, recommendations: candidates.slice(0,3), candidates, stats: gameStats(history,events,state), rewards: REWARDS, asOf: AS_OF, replayNote: 'Skills replay completed activities after the last review. Legacy self-paced records use enrollment date as a completion-date proxy.' };
}

export function act(employee, history, events, catalog, previousState, action) {
  const state = structuredClone(previousState);
  const view = buildView(employee, history, events, catalog, state);
  let result = {};
  if (['enroll','complete','decline','dismiss'].includes(action.type)) {
    const event = view.options.find(e => e.event_id === action.eventId);
    requireThat(event, 'Activity not found.', 404);
    requireThat(!event.mandatory, 'Required training is not a voluntary quest.');
    if (action.type === 'dismiss') {
      state.dismissed = [...new Set([...state.dismissed, event.event_id])];
    } else if (action.type === 'decline') {
      requireThat(event.active, 'Only an active quest can be left.');
      state.history = state.history.filter(h => h.record_id !== event.active.record_id);
      state.history.push({ ...event.active, status: 'dropped' });
    } else {
      const allHistory = getHistory(employee, history, state);
      if (action.type === 'complete' && allHistory.some(h => h.status === 'completed' && h.event_id === event.event_id && (event.event_id !== 'EV_036' || (h.completed_at || h.date).slice(0,10) === AS_OF))) return { state: previousState, result: { alreadyCompleted: true } };
      requireThat(event.eligible, event.reasons.join(' '));
      if (action.type === 'enroll' && event.active) return { state: previousState, result: { alreadyEnrolled: true } };
      requireThat(action.type !== 'complete' || event.active, 'Start the quest before recording completion.');
      const record = event.active || { record_id: `R_${randomUUID()}`, employee_id: employee.employee_id, event_id: event.event_id, date: AS_OF, due_date: '', status: 'in_progress', completion_pct: 0, score: null, feedback_rating: null, assigned_by: 'self' };
      state.history = state.history.filter(h => h.record_id !== record.record_id);
      state.history.push({ ...record, status: action.type === 'complete' ? 'completed' : 'in_progress', completion_pct: action.type === 'complete' ? 100 : record.completion_pct, ...(action.type === 'complete' ? { completed_at: `${AS_OF}T12:00:00.000Z` } : {}) });
      result = action.type === 'complete' ? { gains: event.gains, reward: event.reward, title: event.title } : { enrolled: true, title: event.title };
    }
  } else if (action.type === 'profile') {
    const values = z.object({ nickname: z.string().trim().max(40), seed: z.string().max(50), characterClass: z.enum(['Architect','Explorer','Strategist','Guardian']), frame: z.enum(['default','forest','solar','violet']), title: z.string().max(40), gameEnabled: z.boolean(), language: z.enum(['en','ru','kk']), preferredFormat: z.enum(['any','online','offline','self_paced']) }).parse(action.profile);
    requireThat(values.frame === 'default' || state.purchases.some(p => p.id === values.frame), 'Unlock this frame in the rewards shop first.');
    requireThat(values.title === 'Curious explorer' || state.purchases.some(p => REWARDS.find(r => r.id === p.id)?.value === values.title), 'Unlock this title in the rewards shop first.');
    state.profile = values;
  } else if (action.type === 'goal') {
    if (action.goal === null) state.goal = null;
    else { requireThat(catalog.role_profiles.some(p => p.role === action.goal?.target_role && p.grade === action.goal?.target_grade), 'Choose a valid role and grade.'); state.goal = { target_role: action.goal.target_role, target_grade: action.goal.target_grade }; }
  } else if (action.type === 'purchase') {
    const item = REWARDS.find(r => r.id === action.rewardId);
    requireThat(item, 'Reward not found.', 404);
    if (state.purchases.some(p => p.id === item.id)) return { state: previousState, result: { alreadyOwned: true } };
    requireThat(state.profile.gameEnabled, 'Enable optional RPG features before claiming rewards.');
    requireThat(view.stats.coins >= item.price, 'You need more Qadam coins to unlock this reward.');
    state.purchases.push({ id: item.id, price: item.price, at: AS_OF });
    state.profile[item.kind] = item.value;
    result = { purchased: item.name };
  } else if (action.type === 'restore') state.dismissed = [];
  else throw new AppError('Unknown action.');
  state.version++;
  return { state, result };
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s, 'Invalid calendar date');
export const employeeSchema = z.object({ employee_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), full_name: z.string().min(1).max(120), department: z.string().min(1).max(120), role: z.string().max(80), grade: z.enum(GRADES), manager_id: z.string().nullable(), hire_date: dateSchema, tenure_months: z.number().int().nonnegative(), work_format: z.enum(['office','hybrid','remote']), preferred_language: z.enum(['en','kk','ru']), career_goal: z.object({ target_role: z.string(), target_grade: z.enum(GRADES) }).nullable(), skills: z.record(z.string(), z.number().int().min(0).max(5)), last_review_date: dateSchema });
export const historySchema = z.object({ record_id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), employee_id: z.string(), event_id: z.string(), date: dateSchema, due_date: z.union([dateSchema, z.literal('')]), status: z.enum(['completed','in_progress','dropped','no_show','declined','overdue']), completion_pct: z.coerce.number().int().min(0).max(100), score: z.union([z.literal(''), z.null(), z.coerce.number().min(0).max(100)]), feedback_rating: z.union([z.literal(''), z.null(), z.coerce.number().int().min(1).max(5)]), assigned_by: z.enum(['self','manager','hr']) });
export function validateImport(employeeInput, historyInput, existingEmployees, existingHistory, events, catalog) {
  const employees = z.array(employeeSchema).max(5000).parse(employeeInput);
  const history = z.array(historySchema).max(50000).parse(historyInput);
  requireThat(employees.length + history.length > 0, 'Select at least one non-empty dataset.');
  requireThat(new Set(employees.map(e => e.employee_id)).size === employees.length, 'Duplicate employee IDs in the upload.');
  requireThat(new Set(history.map(h => h.record_id)).size === history.length, 'Duplicate record IDs in the upload.');
  const ids = new Set([...existingEmployees, ...employees].map(e => e.employee_id));
  const skillIds = new Set(catalog.skills.map(s => s.skill_id));
  for (const e of employees) {
    requireThat(catalog.role_profiles.some(p => p.role === e.role && p.grade === e.grade), `${e.employee_id}: unknown role or grade.`);
    if (e.career_goal) targetFor(e,catalog);
    requireThat(Object.keys(e.skills).every(s => skillIds.has(s)), `${e.employee_id}: unknown skill ID.`);
    requireThat(!e.manager_id || ids.has(e.manager_id), `${e.employee_id}: unknown manager ID.`);
    requireThat(e.hire_date <= AS_OF && e.last_review_date <= AS_OF, `${e.employee_id}: date is after the dataset snapshot.`);
    requireThat(!['__proto__','constructor','prototype'].includes(e.employee_id), 'Reserved employee ID.');
  }
  for (const h of history) {
    const event = events.find(e => e.event_id === h.event_id);
    requireThat(ids.has(h.employee_id) && event, `${h.record_id}: unknown employee or event reference.`);
    requireThat(h.date <= AS_OF, `${h.record_id}: history date is after the dataset snapshot.`);
    requireThat(h.status !== 'completed' || h.completion_pct === 100, `${h.record_id}: completed activities must be at 100%.`);
    requireThat(!['in_progress','dropped','overdue'].includes(h.status) || h.completion_pct <= 95, `${h.record_id}: unfinished completion must be 0–95%.`);
    requireThat(h.status !== 'no_show' || (h.completion_pct === 0 && event.format !== 'self_paced'), `${h.record_id}: no-show requires a scheduled activity and 0% completion.`);
    requireThat(h.status !== 'overdue' || event.mandatory, `${h.record_id}: only required training can be overdue.`);
    const prior = existingHistory.find(r => r.record_id === h.record_id);
    requireThat(!prior || (prior.employee_id === h.employee_id && prior.event_id === h.event_id), `${h.record_id}: ID conflicts with a different participation record.`);
  }
  return { employees, history };
}

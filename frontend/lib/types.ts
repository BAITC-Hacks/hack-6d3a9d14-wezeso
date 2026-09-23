export type User = { id: string; login: string; role: 'employee'|'manager'|'hr'; employee_id: string };
export type Goal = { target_role: string; target_grade: string };
export type Profile = { employee_id: string; full_name: string; role: string; grade: string; department: string; tenure_months: number; manager_id: string|null; work_format: string; career_goal: Goal|null; last_review_date: string; skills: Record<string, number> };
export type Event = { event_id: string; title: string; description: string; type: string; format: string; duration_hours: number; mandatory: boolean; upcoming_sessions: string[]; develops_skills: {skill_id: string; gain: number; max_level: number}[] };
export type Gap = { id: string; name: string; current: number; required: number; critical: boolean };
export type Candidate = { event: Event; score: number; facts: string[]; gains: Record<string,number>; blocked: string; prior_skips: number };
export type Request = { id: string; employee_id: string; event_id: string; status: string; session_date: string; created_at: string; updated_at: string; evidence: string; note: string; gains: Record<string,number>; confirmed_by: string };
export type Audit = { id: string; actor: string; role: string; employee_id: string; entity_id: string; action: string; detail: string; at: string };
export type History = { record_id: string; event_id: string; date: string; status: string; completion_pct: number };
export type Recommendation = { id: string; model: string; at: string; evidence:Record<string,string[]>; choices: {event_id: string; rationale: string; unknowns: string[]}[] };
export type Roster = { employee_id: string; full_name: string; department: string; role: string; grade: string; progress: number; skips: number; recent: number; gaps: Gap[]; has_account: boolean };
export type Workspace = { user: User; snapshot: string; profile?: Profile; target?: {role: string;grade: string}; gaps?: Gap[]; progress?: number; levels?: Record<string,number>; candidates?: Candidate[]; history?: History[]; recommendations?: Recommendation[]; requests: Request[]; audit: Audit[]; events: Event[]; roster: Roster[]; roles: {role: string;grade: string}[]; counts: {employees:number;events:number;skills:number;history:number}; ai: {available:boolean;has_key:boolean;external_allowed:boolean;model:string} };
export const roleName = { employee: 'Сотрудник', manager: 'Руководитель', hr: 'HR-партнёр' };
export const statusName: Record<string,string> = { pending_manager:'На согласовании', approved:'Можно проходить', pending_hr:'Проверка результата', completed:'Подтверждено', declined:'Не подходит', rejected:'Не согласовано', cancelled:'Отменено', in_progress:'В процессе', dropped:'Прервано', no_show:'Неявка', overdue:'Просрочено' };
export const typeName: Record<string,string> = { course:'Курс', workshop:'Практикум', mentoring:'Менторство', certification:'Сертификация', meetup:'Встреча', compliance:'Обязательное', onboarding:'Адаптация' };
export const formatName: Record<string,string> = { online:'Онлайн', offline:'Очно', self_paced:'В своём темпе' };
export function date(v:string) { return v ? new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}) : 'В любое время'; }

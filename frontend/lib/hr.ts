import type { Event, Gap } from './types';

export type HRView = 'dashboard' | 'risk' | 'events' | 'simulation';
export type HREvent = Event & { target_roles: string[]; target_grades: string[]; prerequisites: Record<string, number> };
export type HRPerson = { employee_id: string; full_name: string; department: string; role: string; grade: string; progress: number; score: number; band: 'low'|'medium'|'high'|'unknown'; factors: {label: string; points: number; detail: string}[]; completed: number; activities: number; engagements: number; hours: number; last_activity: string; gaps: Gap[] };
export type HRInsights = { people: HRPerson[]; trend: {date:string; completed:number; activities:number}[]; days:number; snapshot:string };
export type Simulation = { before:number; after:number; hours:number; required_weeks:number; feasible:boolean; critical_gaps:number; skills:{id:string; name:string; before:number; after:number; required:number; critical:boolean}[]; options:{event:HREvent; blocked:string; gain:number}[] };
export type HRCall = (path:string, payload?:unknown)=>Promise<any>;
export const bands = { low:'Низкий', medium:'Умеренный', high:'Высокий', unknown:'Мало данных' };
export const grades = ['Junior','Middle','Senior','Lead'];
export function exportCSV(filename:string, rows:(string|number)[][]) {
  const content = '\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');
  download(filename,content,'text/csv;charset=utf-8');
}
export function download(filename:string, content:string, type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

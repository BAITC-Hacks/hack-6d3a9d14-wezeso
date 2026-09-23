'use client';
import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react';
import { Badge } from '@cloudflare/kumo/components/badge';
import { X, Check, ArrowRight } from '@phosphor-icons/react';
import { statusName } from '../lib/types';
type ButtonProps = ComponentPropsWithRef<'button'> & {
 variant?: 'primary' | 'secondary' | 'ghost';
};
export function Btn({ className='', variant='secondary', type='button', ...props }: ButtonProps) {
 return <button {...props} type={type} className={`btn ${variant} ${className}`} />;
}
export function Status({status}:{status:string}) {return <Badge className={`status ${status}`} variant={status==='completed'?'success':status==='rejected'?'error':status==='pending_hr'?'info':'outline'}>{statusName[status]||status}</Badge>;}
export function Empty({children}:{children:React.ReactNode}){return <div className="empty">{children}</div>;}
export function Progress({value,label}:{value:number;label:string}){return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{width:`${value}%`}} /></div>;}
export function Steps({status}:{status:string}) { const current=['pending_manager','approved','pending_hr','completed'].indexOf(status);return <ol className="steps">{['Выбор','Согласование','Результат','Подтверждение'].map((label,i)=><li key={label} className={i<=current?'done':''}><span>{i<current||current===3?<Check size={15}/>:i+1}</span>{label}{i<3&&<ArrowRight className="step-arrow" size={14}/>}</li>)}</ol>; }
export type ModalConfig = { title:string; content:React.ReactNode; submitLabel?:string; note?:{label:string;min:number}; sessions?:string[]; initialSession?:string; onConfirm:(note:string,session:string)=>Promise<void> };
export function Confirm({config,onClose}:{config:ModalConfig;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);const[note,setNote]=useState('');const[session,setSession]=useState(config.initialSession||config.sessions?.[0]||'');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
 return <dialog className="modal" ref={ref} onCancel={e=>{if(busy)e.preventDefault();else onClose();}} aria-labelledby="dialog-title"><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await config.onConfirm(note,session);onClose();}catch(e){setError((e as Error).message);setBusy(false);}}}>
 <div className="section-heading"><h2 id="dialog-title">{config.title}</h2><Btn variant="ghost" aria-label="Закрыть" onClick={onClose} disabled={busy}><X size={22}/></Btn></div><div className="modal-content">{config.content}</div>
 {config.sessions&&<label>Дата участия<select value={session} onChange={e=>setSession(e.target.value)} required>{config.sessions.map(s=><option key={s}>{s}</option>)}</select></label>}
 {config.note&&<label>{config.note.label}<textarea autoFocus value={note} onChange={e=>setNote(e.target.value)} required minLength={config.note.min} maxLength={4000} rows={4}/><small>Минимум {config.note.min} символов. Только вымышленные данные.</small></label>}
 <p className="muted">Подтверждая, вы разрешаете записать это действие в историю.</p>{error&&<div role="alert" className="error">{error}</div>}
 <div className="modal-actions"><Btn onClick={onClose} disabled={busy}>Вернуться</Btn><Btn type="submit" variant="primary" disabled={busy}>{busy?'Сохраняем…':config.submitLabel||'Подтвердить'}</Btn></div></form></dialog>;
}

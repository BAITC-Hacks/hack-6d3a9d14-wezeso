'use client';
import { useState, type ComponentPropsWithRef } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { InputArea } from '@cloudflare/kumo/components/input';
import { Select } from '@cloudflare/kumo/components/select';
import { X, Check, ArrowRight, CheckCircle, Clock, Hourglass, MagnifyingGlass, MinusCircle, PlayCircle, Prohibit, UserMinus, WarningCircle, XCircle, Info, type Icon } from '@phosphor-icons/react';
import { AppBadge, type BadgeTone } from './AppBadge';
import { statusName } from '../lib/types';
import { LoadingStatus } from './Feedback';
type ButtonProps = ComponentPropsWithRef<typeof Button>;
export function Btn({ className='', variant='secondary', type='button', ...props }: ButtonProps) {
 return <Button {...props} type={type} variant={variant} className={`btn ${variant} ${className}`} />;
}
export function Choice({label,value,onValueChange,options,required=false,disabled=false}:{label:string;value:string;onValueChange:(value:string)=>void;options:{value:string;label:string}[];required?:boolean;disabled?:boolean}) {
 return <Select label={label} value={value} disabled={disabled} onValueChange={next=>{if(next!==null)onValueChange(next);}} items={options} required={required} size="lg" className="choice-control" alignItemWithTrigger={false}>{options.map(option=><Select.Option key={option.value} value={option.value}>{option.label}</Select.Option>)}</Select>;
}
const statusAppearance: Record<string, { icon: Icon; tone: BadgeTone }> = {
 pending_manager: { icon: Hourglass, tone: 'orange' },
 approved: { icon: CheckCircle, tone: 'green' },
 pending_hr: { icon: MagnifyingGlass, tone: 'blue' },
 completed: { icon: CheckCircle, tone: 'green' },
 declined: { icon: MinusCircle, tone: 'neutral' },
 rejected: { icon: XCircle, tone: 'red' },
 cancelled: { icon: Prohibit, tone: 'neutral' },
 in_progress: { icon: PlayCircle, tone: 'purple' },
 dropped: { icon: WarningCircle, tone: 'orange' },
 no_show: { icon: UserMinus, tone: 'red' },
 overdue: { icon: Clock, tone: 'red' },
};
export function Status({status}:{status:string}) {
 const appearance = statusAppearance[status] || { icon: Info, tone: 'neutral' as const };
 return <AppBadge {...appearance} className="status">{statusName[status]||status}</AppBadge>;
}
export function Empty({children}:{children:React.ReactNode}){return <div className="empty">{children}</div>;}
export function Progress({value,label}:{value:number;label:string}){return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{width:`${value}%`}} /></div>;}
export function Steps({status}:{status:string}) { const current=['pending_manager','approved','pending_hr','completed'].indexOf(status);return <ol className="steps">{['Выбор','Согласование','Результат','Подтверждение'].map((label,i)=><li key={label} className={i<=current?'done':''}><span>{i<current||current===3?<Check size={15}/>:i+1}</span>{label}{i<3&&<ArrowRight className="step-arrow" size={14}/>}</li>)}</ol>; }
export type ModalConfig = { title:string; content:React.ReactNode; submitLabel?:string; busyLabel?:string; busyDetail?:string; note?:{label:string;min:number}; sessions?:string[]; initialSession?:string; onConfirm:(note:string,session:string)=>Promise<void> };
export function Confirm({config,onClose}:{config:ModalConfig;onClose:()=>void}){
 const[note,setNote]=useState('');const[session,setSession]=useState(config.initialSession||config.sessions?.[0]||'');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog size="lg" className="modal"><form aria-busy={busy} onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await config.onConfirm(note,session);onClose();}catch(e){setError((e as Error).message);setBusy(false);}}}>
 <div className="section-heading"><Dialog.Title>{config.title}</Dialog.Title><Btn variant="ghost" shape="square" aria-label="Закрыть" onClick={onClose} disabled={busy}><X size={22}/></Btn></div><div className="modal-content" inert={busy}>{config.content}</div>
 {config.sessions&&<Choice label="Дата участия" value={session} onValueChange={setSession} required disabled={busy} options={config.sessions.map(s=>({value:s,label:s}))}/>}
 {config.note&&<InputArea label={config.note.label} autoFocus value={note} disabled={busy} onChange={e=>setNote(e.target.value)} required minLength={config.note.min} maxLength={4000} rows={4} description={`Минимум ${config.note.min} символов.`}/>}
 {error&&<div role="alert" className="error">{error}</div>}
 {busy&&<div className="pending-note"><LoadingStatus label={config.busyLabel||'Сохраняем изменения…'} detail={config.busyDetail} slowLabel={config.busyDetail||'Ожидаем ответ сервера. Не отправляйте форму повторно.'}/></div>}
 <div className="modal-actions"><Btn onClick={onClose} disabled={busy}>Вернуться</Btn><Btn type="submit" variant="primary" loading={busy} aria-label={busy?config.busyLabel||'Сохраняем…':undefined} disabled={busy||!!(config.sessions&&!session)}>{busy?config.busyLabel||'Сохраняем…':config.submitLabel||'Подтвердить'}</Btn></div></form></Dialog></Dialog.Root>;
}

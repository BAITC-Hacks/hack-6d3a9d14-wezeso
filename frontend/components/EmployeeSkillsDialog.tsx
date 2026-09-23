'use client';

import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { Tabs } from '@cloudflare/kumo/components/tabs';
import { Check, WarningCircle, X } from '@phosphor-icons/react';
import { AppBadge } from './AppBadge';
import type { Roster } from '../lib/types';
import Avatar from './Avatar';
import { EmptyState } from './Feedback';

export default function EmployeeSkillsDialog({ employee, onClose }: { employee: Roster; onClose: () => void }) {
  const [filter, setFilter] = useState('all');
  const needsGrowth = employee.gaps.filter(skill => skill.current < skill.required);
  const achieved = employee.gaps.length - needsGrowth.length;
  const visible = [...employee.gaps]
    .filter(skill => filter === 'all' || (filter === 'growth' ? skill.current < skill.required : skill.current >= skill.required))
    .sort((a, b) => Number(b.critical && b.current < b.required) - Number(a.critical && a.current < a.required) || (b.required - b.current) - (a.required - a.current));

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog size="xl" className="employee-dialog">
        <header className="employee-dialog-header">
          <Avatar key={employee.employee_id} identity={employee.employee_id} label={`Персонаж ${employee.full_name}`} size={68}/>
          <div className="employee-heading">
            <Dialog.Title>{employee.full_name}</Dialog.Title>
            <Dialog.Description>{employee.role} <span aria-hidden="true">·</span> {employee.grade}</Dialog.Description>
            <span className="employee-department">{employee.department}</span>
          </div>
          <Button variant="ghost" shape="square" className="employee-close" aria-label="Закрыть профиль" onClick={onClose}><X size={20} /></Button>
        </header>

        <div className="employee-dialog-body">
          <section className="employee-context" aria-label="Участие за последние 90 дней">
            <p>За 90 дней: <b>{employee.recent}</b> активностей · <b>{employee.skips}</b> отказов, пропусков или прерываний.</p>
          </section>

          <section className="employee-skills" aria-labelledby="employee-skills-title">
            <div className="employee-skills-heading"><h3 id="employee-skills-title">Навыки</h3><span>Уровень / цель</span></div>
            <Tabs className="employee-filters" variant="underline" value={filter} onValueChange={setFilter}
              tabs={[{value:'all',label:`Все навыки · ${employee.gaps.length}`},{value:'growth',label:`Развить · ${needsGrowth.length}`},{value:'achieved',label:`На цели · ${achieved}`}]}/>
            <div className="employee-skill-list" aria-live="polite">
              {visible.length === 0 && <EmptyState compact icon={employee.gaps.length && filter === 'growth' ? Check : WarningCircle} tone={employee.gaps.length && filter === 'growth' ? 'success' : 'neutral'} title={!employee.gaps.length ? 'Навыки пока не добавлены' : filter === 'growth' ? 'Все навыки на цели' : 'Навыков на цели пока нет'} description={!employee.gaps.length ? 'Для сравнения с целью нужны данные о навыках. Попросите HR проверить профиль сотрудника.' : filter === 'growth' ? 'Требования текущей цели выполнены по всем навыкам.' : 'Откройте все навыки, чтобы увидеть текущие уровни и приоритеты развития.'} action={filter !== 'all' && employee.gaps.length > 0 ? <Button onClick={() => setFilter('all')}>Показать все навыки</Button> : undefined}/>}
              {visible.map(skill => {
                const met = skill.current >= skill.required;
                const priority = skill.critical && !met;
                return <div key={skill.id} className={`employee-skill-row${priority ? ' is-priority' : ''}${met ? ' is-achieved' : ''}`}>
                  <div className="employee-skill-name"><span>{skill.name}</span>{priority && <AppBadge icon={WarningCircle} tone="orange">Критичен</AppBadge>}</div>
                  <div className="employee-skill-level" role="img" aria-label={`${skill.name}: текущий уровень ${skill.current}, целевой ${skill.required}`}>
                    <span><b>{skill.current}</b> / {skill.required}</span>
                    <span className="employee-level-status">{met && <Check size={16} aria-label="Цель достигнута" />}</span>
                  </div>
                </div>;
              })}
            </div>
          </section>
        </div>
        <footer className="employee-dialog-footer"><Button variant="primary" className="employee-done" onClick={onClose}>Понятно</Button></footer>
      </Dialog>
    </Dialog.Root>
  );
}

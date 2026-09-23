'use client';

import { useState } from 'react';
import { Button } from '@cloudflare/kumo/components/button';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { Check, X } from '@phosphor-icons/react';
import type { Roster } from '../lib/types';

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
            <p className="employee-context-note">{employee.recent === 0 || employee.skips > 0 ? 'Причины неизвестны. Обсудите контекст с сотрудником.' : 'Обсудите, какие навыки сотрудник хочет развивать дальше.'}</p>
          </section>

          <section className="employee-skills" aria-labelledby="employee-skills-title">
            <div className="employee-skills-heading"><h3 id="employee-skills-title">Навыки</h3><span>Уровень / цель</span></div>
            <div className="employee-filters" role="group" aria-label="Фильтр навыков">
              {[['all', 'Все навыки', employee.gaps.length], ['growth', 'Развить', needsGrowth.length], ['achieved', 'На цели', achieved]].map(([value, label, count]) => (
                <Button key={value} variant="ghost" aria-pressed={filter === value} onClick={() => setFilter(String(value))}>{label}<span>{count}</span></Button>
              ))}
            </div>
            <div className="employee-skill-list" aria-live="polite">
              {visible.length === 0 && <p className="employee-skills-empty">{filter === 'growth' ? 'Все навыки достигли целевого уровня.' : 'В этой группе пока нет навыков.'}</p>}
              {visible.map(skill => {
                const met = skill.current >= skill.required;
                const priority = skill.critical && !met;
                return <div key={skill.id} className={`employee-skill-row${priority ? ' is-priority' : ''}${met ? ' is-achieved' : ''}`}>
                  <div className="employee-skill-name"><span>{skill.name}</span>{priority && <span className="employee-critical-label">Критичен</span>}</div>
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

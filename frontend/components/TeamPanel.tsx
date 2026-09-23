'use client';
import { useI18n } from '../lib/i18n';

import { useState } from 'react';
import { InputGroup } from '@cloudflare/kumo/components/input';
import { Select } from '@cloudflare/kumo/components/select';
import { Table } from '@cloudflare/kumo/components/table';
import { ArrowRight, ArrowUpRight, CheckCircle, Flag, MagnifyingGlass, UsersThree, X } from '@phosphor-icons/react';
import Avatar from './Avatar';
import EmployeeSkillsDialog from './EmployeeSkillsDialog';
import TeamPixelArt from './TeamPixelArt';
import { EmptyState } from './Feedback';
import { Btn, Progress } from './UI';
import type { Roster, Workspace } from '../lib/types';
import styles from './TeamPanel.module.css';

type TeamPanelProps = {
  data: Workspace;
  dept: string;
  setDept: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  onQueue: () => void;
  onAccess: () => void;
};

export default function TeamPanel({ data, dept, setDept, search, setSearch, onQueue, onAccess }: TeamPanelProps) {
 const { t, date, number, count, languageTag } = useI18n();

  const [focus, setFocus] = useState<Roster | null>(null);
  const roster = data.roster.filter(person =>
    (!dept || person.department === dept) &&
    `${person.full_name} ${person.role} ${t(person.role)}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const gaps = new Map<string, { id: string; name: string; people: number; gap: number }>();
  roster.forEach(person => person.gaps.forEach(skill => {
    if (skill.current >= skill.required) return;
    const gap = gaps.get(skill.id) || { id: skill.id, name: skill.name, people: 0, gap: 0 };
    gap.people++;
    gap.gap += skill.required - skill.current;
    gaps.set(skill.id, gap);
  }));
  const top = [...gaps.values()].sort((a, b) => b.gap - a.gap).slice(0, 5);
  const departments = ['', ...new Set(data.roster.map(person => person.department).filter(Boolean))]
    .map(value => ({ value, label: t(value) || t("Все подразделения") }));
  const pending = data.requests.filter(request => request.status === (data.user.role === 'hr' ? 'pending_hr' : 'pending_manager')).length;

  if (!data.roster.length) return <EmptyState icon={UsersThree} title={t("В команде пока нет сотрудников")} description={data.user.role === 'hr' ? t("Добавьте профили сотрудников, чтобы увидеть команду и навыки для развития.") : t("Здесь появятся сотрудники, закреплённые за вами. Обратитесь к HR, если состав команды нужно уточнить.")} action={data.user.role === 'hr' ? <Btn onClick={onAccess}>{t("Доступ и данные")}<ArrowRight size={16} /></Btn> : undefined} />;

  return <div className={styles.panel}>
    <section className={styles.stats} aria-label={t("Обзор команды")}>
      <div className={styles.stat}>
        <div className={styles.statHeading}>{t("Сотрудники")}</div>
        <TeamPixelArt kind="people" className={styles.pixelArt}/>
        <b className={styles.value}>{roster.length}</b>
        <p className={styles.statNote}>{dept || search ? t("С учётом выбранных фильтров") : t("В вашей команде")}</p>
      </div>
      <div className={styles.stat}>
        <div className={styles.statHeading}>{t("Обсудить развитие")}</div>
        <TeamPixelArt kind="conversation" className={styles.pixelArt}/>
        <b className={styles.value}>{roster.filter(person => person.recent === 0 || person.skips >= 2).length}</b>
        <p className={styles.statNote}>{t("За 90 дней: нет участия или 2+ пропуска/отказа")}</p>
      </div>
      <div className={styles.stat}>
        <div className={styles.statHeading}>{t("Ожидают решения")}</div>
        <TeamPixelArt kind="decisions" className={styles.pixelArt}/>
        <b className={styles.value}>{pending}</b>
        <Btn variant="ghost" className={styles.queueLink} onClick={onQueue}>{t("Открыть заявки")} <ArrowRight size={16} /></Btn>
      </div>
    </section>

    <div className={styles.filters} role="search" aria-label={t("Фильтры команды")}>
      <div className={styles.searchField}>
        <label htmlFor="team-search">{t("Поиск сотрудника")}</label>
        <InputGroup className={styles.searchControl} size="lg">
          <InputGroup.Addon><MagnifyingGlass size={18} /></InputGroup.Addon>
          <InputGroup.Input id="team-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Имя или роль")} />
        </InputGroup>
      </div>
      <div className={styles.departmentField}>
        <Select label={t("Подразделение")} value={dept} onValueChange={value => { if (value !== null) setDept(value); }} items={departments} size="lg" className={styles.departmentControl} alignItemWithTrigger={false}>
          {departments.map(option => <Select.Option key={option.value} value={option.value}>{t(option.label)}</Select.Option>)}
        </Select>
      </div>
    </div>

    <div className={`filter-summary ${styles.filterSummary}`}><span role="status">{t("Сотрудников:")} {roster.length}</span>{(search || dept) && <Btn variant="ghost" onClick={() => { setSearch(''); setDept(''); }}><X size={14}/>{t("Сбросить фильтры")}</Btn>}</div>
    {roster.length > 0 && <section className={styles.skills} aria-labelledby="team-skills-heading">
      <div className={styles.skillsHeading}>
        <h2 id="team-skills-heading">{t("Навыки для развития")}</h2>
        <p>{t("Приоритеты по суммарному дефициту уровней")}</p>
      </div>
      {top.length > 0 ? <div className={styles.skillList}>
        <div className={styles.columnHeadings} aria-hidden="true"><span>{t("Навык")}</span><span>{t("Сотрудники")}</span><span>{t("Дефицит уровней")}</span></div>
        {top.map(skill => <div className={styles.skillRow} key={skill.id}>
          <span className={styles.skillName}>{t(skill.name)}</span>
          <div className={styles.skillBar}><Progress value={Math.round(100 * skill.gap / top[0].gap)} label={t("{0}: дефицит {1} уровней", { 0: skill.name, 1: skill.gap })} /></div>
          <b className={styles.people}>{skill.people}<span className={styles.mobileUnit}>  {t("чел.")}</span><span className={styles.srOnly}>  {t("сотрудников")}</span></b>
          <span className={styles.gap}>{skill.gap}<span className={styles.mobileUnit}>  {t("ур.")}</span><span className={styles.srOnly}>  {t("уровней дефицита")}</span></span>
        </div>)}
      </div> : <EmptyState compact icon={roster.some(r => r.gaps.length) ? CheckCircle : Flag} tone={roster.some(r => r.gaps.length) ? 'success' : 'neutral'} title={roster.some(r => r.gaps.length) ? t("Навыки соответствуют целям") : t("Данные о навыках пока не добавлены")} description={roster.some(r => r.gaps.length) ? t("По заполненным профилям выбранных сотрудников нет дефицита навыков.") : t("Здесь появятся приоритеты развития после заполнения профилей.")}/>}
    </section>}

    {roster.length > 0 ? <div className={`table-wrap ${styles.roster}`}>
      <Table>
        <Table.Header><Table.Row><Table.Head>{t("Сотрудник")}</Table.Head><Table.Head>{t("Роль и грейд")}</Table.Head><Table.Head>{t("Участие за 90 дней")}</Table.Head><Table.Head>{t("Профиль")}</Table.Head></Table.Row></Table.Header>
        <Table.Body>{roster.map(person => <Table.Row key={person.employee_id}>
          <Table.Cell><div className="roster-person"><Avatar identity={person.employee_id} label={t("Персонаж {0}", { 0: person.full_name })} size={46} animated={false} /><div><b>{person.full_name}</b><small>{t(person.department)}</small></div></div></Table.Cell>
          <Table.Cell data-label={t("Роль и грейд")}>{t(person.role)}<small>{t(person.grade)}</small></Table.Cell>
          <Table.Cell data-label={t("Участие за 90 дней")}>{count("activity",person.recent)}<small>{person.skips}  {t("отказов / пропусков")}</small></Table.Cell>
          <Table.Cell><Btn variant="ghost" className="text-link" onClick={() => setFocus(person)}>{t("Навыки")}<ArrowUpRight size={17} /></Btn></Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table>
    </div> : <EmptyState icon={search.trim() || dept ? MagnifyingGlass : UsersThree} title={data.roster.length ? t("Сотрудники не найдены") : t("Команда пока не добавлена")} description={data.roster.length ? t("Измените имя, роль или подразделение. Сброс фильтров покажет всех доступных сотрудников.") : data.user.role === 'hr' ? t("Импортируйте профили сотрудников в разделе «Доступ и данные», чтобы видеть развитие команды.") : t("Здесь появятся сотрудники, закреплённые за вами. Попросите HR проверить состав команды.")} action={data.roster.length ? <Btn onClick={() => { setSearch(''); setDept(''); }}>{t("Сбросить фильтры")}</Btn> : data.user.role === 'hr' ? <Btn onClick={onAccess}>{t("Добавить профили")}<ArrowRight size={16}/></Btn> : undefined}/>}
    {focus && <EmployeeSkillsDialog employee={focus} onClose={() => setFocus(null)} />}
  </div>;
}

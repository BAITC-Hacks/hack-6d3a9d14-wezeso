'use client';
import { useI18n } from '../lib/i18n';
import { Btn, Status } from './UI';
import { AppBadge } from './AppBadge';

import type { CSSProperties } from 'react';
import { ArrowRight, CheckCircle, Sparkle, Star } from '@phosphor-icons/react';
import Avatar from './Avatar';
import { characterAppearance, characterIdentity, characterProgress } from '../lib/character';
import { roleName, type Workspace } from '../lib/types';

export default function CharacterCard({ data, onQuest }: { data: Workspace; onQuest: () => void }) {
 const { t, date, number, languageTag } = useI18n();

  const identity = characterIdentity(data.user);
  const character = characterAppearance(identity);
  const progress = characterProgress(data.user.employee_id, data.history, data.requests);
  const active = data.requests.find(item => item.employee_id === data.user.employee_id && ['pending_manager', 'approved', 'pending_hr'].includes(item.status));
  const event = active && data.events.find(item => item.event_id === active.event_id);
  const candidate = data.candidates?.find(item => !item.blocked);
  const quest = event?.title || candidate?.event.title;
  const firstName = data.profile?.full_name.split(' ')[0] || data.user.login;
  const style = { '--character-color': character.color, '--character-tint': character.tint } as CSSProperties;

  return <section className="character-card" style={style} aria-label={t("Ваш RPG-персонаж")}>
    <div className="character-stage">
      <span className="character-orbit" aria-hidden="true"/>
      <Sparkle className="character-spark" size={22} weight="fill" aria-hidden="true"/>
      <Avatar key={identity} identity={identity} size={204} label={t("Персонаж {0}: {1}", { 0: firstName, 1: character.name })}/>
      <AppBadge className="character-level" icon={Star} tone="purple">{t("Уровень")} {progress.level}</AppBadge>
    </div>
    <div className="character-story">
      <h2>{t(character.name)}<span>{t("Блоб")} {firstName}</span></h2>
      <p className="character-class">{t(data.profile?.role || roleName[data.user.role])}</p>
      <div className="character-xp-label"><b>{number(progress.xp)} XP</b><span>{progress.levelXP} / {progress.nextLevelXP}  {t("до уровня")} {progress.level + 1}</span></div>
      <div className="character-xp" role="progressbar" aria-label={t("Опыт до следующего уровня персонажа")} aria-valuemin={0} aria-valuemax={progress.nextLevelXP} aria-valuenow={progress.levelXP}><span style={{ width: `${progress.levelXP / progress.nextLevelXP * 100}%` }}/></div>
      <p className="character-xp-note"><CheckCircle size={15}/>{progress.completed}  {t("завершено")}</p>
    </div>
    <div className="character-quest">
      <h3>{t(quest) || (data.user.role === 'hr' ? t("Заявки команды") : t("Выберите активность"))}</h3>
      {active && <Status status={active.status}/>}
      <Btn variant="ghost" type="button" className="text-link" onClick={onQuest}>{active ? t("Открыть мои шаги") : data.user.role === 'hr' ? t("К заявкам команды") : t("Выбрать квест")}<ArrowRight size={17}/></Btn>
    </div>
  </section>;
}

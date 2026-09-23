'use client';
import { Btn, Status } from './UI';
import { AppBadge } from './AppBadge';

import type { CSSProperties } from 'react';
import { ArrowRight, CheckCircle, Flag, Sparkle, Star } from '@phosphor-icons/react';
import Avatar from './Avatar';
import { characterAppearance, characterIdentity, characterProgress } from '../lib/character';
import { roleName, type Workspace } from '../lib/types';

export default function CharacterCard({ data, onQuest }: { data: Workspace; onQuest: () => void }) {
  const identity = characterIdentity(data.user);
  const character = characterAppearance(identity);
  const progress = characterProgress(data.user.employee_id, data.history, data.requests);
  const active = data.requests.find(item => item.employee_id === data.user.employee_id && ['pending_manager', 'approved', 'pending_hr'].includes(item.status));
  const event = active && data.events.find(item => item.event_id === active.event_id);
  const candidate = data.candidates?.find(item => !item.blocked);
  const quest = event?.title || candidate?.event.title;
  const firstName = data.profile?.full_name.split(' ')[0] || data.user.login;
  const style = { '--character-color': character.color, '--character-tint': character.tint } as CSSProperties;

  return <section className="character-card" style={style} aria-label="Ваш RPG-персонаж">
    <div className="character-stage">
      <span className="character-orbit" aria-hidden="true"/>
      <Sparkle className="character-spark" size={22} weight="fill" aria-hidden="true"/>
      <Avatar key={identity} identity={identity} size={204} label={`Персонаж ${firstName}: ${character.name}`}/>
      <AppBadge className="character-level" icon={Star} tone="purple">Уровень {progress.level}</AppBadge>
    </div>
    <div className="character-story">
      <span className="character-eyebrow">Ваш персонаж</span>
      <h2>{character.name}<span>Блоб {firstName}</span></h2>
      <p className="character-class">{data.profile?.role || roleName[data.user.role]}</p>
      <div className="character-xp-label"><b>{progress.xp} XP</b><span>{progress.levelXP} / {progress.nextLevelXP} до уровня {progress.level + 1}</span></div>
      <div className="character-xp" role="progressbar" aria-label="Опыт до следующего уровня персонажа" aria-valuemin={0} aria-valuemax={progress.nextLevelXP} aria-valuenow={progress.levelXP}><span style={{ width: `${progress.levelXP / progress.nextLevelXP * 100}%` }}/></div>
      <p className="character-xp-note"><CheckCircle size={15}/>{progress.completed} завершено</p>
    </div>
    <div className="character-quest">
      <span className="character-eyebrow"><Flag size={15}/>{active ? 'Текущий квест' : 'Следующий квест'}</span>
      <h3>{quest || (data.user.role === 'hr' ? 'Заявки команды' : 'Выберите активность')}</h3>
      {active && <Status status={active.status}/>}
      <Btn variant="ghost" type="button" className="text-link" onClick={onQuest}>{active ? 'Открыть мои шаги' : data.user.role === 'hr' ? 'К заявкам команды' : 'Выбрать квест'}<ArrowRight size={17}/></Btn>
    </div>
  </section>;
}

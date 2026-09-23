'use client';
import { useI18n } from '../lib/i18n';

import { ArrowUpRight, CaretDown } from '@phosphor-icons/react';
import { Btn } from './UI';
import { ActivityBadges } from './AppBadge';
import PixelArt, { activitySymbol, type PixelTone } from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { type Candidate } from '../lib/types';
import styles from './CandidateCard.module.css';

const tones: Record<string, PixelTone> = { course: 'blue', workshop: 'green', mentoring: 'coral', meetup: 'coral', certification: 'blue', compliance: 'green', onboarding: 'green' };

export default function CandidateCard({ c, onChoose, onDecline }: {
  c: Candidate;
  onChoose: () => void;
  onDecline?: () => void;
}) {
 const { t, date, number, languageTag } = useI18n();

  const { event, blocked } = c;
  const tone = tones[event.type] || 'green';
  return <article className={`${styles.card} ${blocked ? styles.blocked : ''}`} aria-labelledby={`activity-${event.event_id}`}>
    <div className={styles.body}>
      <h3 className={styles.title} id={`activity-${event.event_id}`}>{t(event.title)}</h3>
      <ActivityBadges event={event}/>
      <details className={styles.details}>
        <summary>{t("Подробнее")}<CaretDown size={14} aria-hidden="true"/></summary>
        <div className={styles.description}><p>{t(event.description)}</p><ul>{c.facts.map(fact => <li key={fact}>{t(fact)}</li>)}</ul></div>
      </details>
      {blocked ? <p className={styles.blockedReason}>{t(blocked)}</p> : <div className={styles.actions}><Btn onClick={onChoose}>{t("Выбрать")}<ArrowUpRight size={15} aria-hidden="true"/></Btn>{onDecline && <Btn variant="ghost" onClick={onDecline}>{t("Пропустить")}</Btn>}</div>}
    </div>
    <div className={styles.art} aria-hidden="true">
      <PixelMosaic tone={tone} wide/>
      <PixelArt kind={activitySymbol(event.type,event.title)} tone={tone}/>
    </div>
  </article>;
}

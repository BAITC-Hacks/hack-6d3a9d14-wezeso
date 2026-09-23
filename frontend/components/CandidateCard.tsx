'use client';

import { ArrowUpRight, CaretDown } from '@phosphor-icons/react';
import { Btn } from './UI';
import PixelArt, { activitySymbol, type PixelTone } from './PixelArt';
import PixelMosaic from './PixelMosaic';
import { formatName, typeName, type Candidate } from '../lib/types';
import styles from './CandidateCard.module.css';

const tones: Record<string, PixelTone> = { course: 'blue', workshop: 'green', mentoring: 'coral', meetup: 'coral', certification: 'blue', compliance: 'green', onboarding: 'green' };

export default function CandidateCard({ c, onChoose, onDecline }: {
  c: Candidate;
  onChoose: () => void;
  onDecline?: () => void;
}) {
  const { event, blocked } = c;
  const tone = tones[event.type] || 'green';
  return <article className={`${styles.card} ${blocked ? styles.blocked : ''}`} aria-labelledby={`activity-${event.event_id}`}>
    <div className={styles.body}>
      <span className={styles.type}>{typeName[event.type] || event.type}</span>
      <h3 className={styles.title} id={`activity-${event.event_id}`}>{event.title}</h3>
      <p className={styles.metadata}>{event.duration_hours} ч · {formatName[event.format] || event.format}</p>
      <details className={styles.details}>
        <summary>Подробнее<CaretDown size={14} aria-hidden="true"/></summary>
        <div className={styles.description}><p>{event.description}</p><ul>{c.facts.map(fact => <li key={fact}>{fact}</li>)}</ul></div>
      </details>
      {blocked ? <p className={styles.blockedReason}>{blocked}</p> : <div className={styles.actions}><Btn onClick={onChoose}>Выбрать<ArrowUpRight size={15} aria-hidden="true"/></Btn>{onDecline && <Btn variant="ghost" onClick={onDecline}>Пропустить</Btn>}</div>}
    </div>
    <div className={styles.art} aria-hidden="true">
      <PixelMosaic tone={tone} wide/>
      <PixelArt kind={activitySymbol(event.type,event.title)} tone={tone}/>
    </div>
  </article>;
}

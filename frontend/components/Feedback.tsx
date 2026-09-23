'use client';
import { useI18n } from '../lib/i18n';

import { useEffect, useState, type ReactNode } from 'react';
import Avatar from './Avatar';
import { CircleNotch, type Icon } from '@phosphor-icons/react';

export function EmptyState({ title, description, action, compact = false, tone = 'neutral' }: {
  icon?: Icon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  tone?: 'neutral' | 'success' | 'error';
}) {
  const {t}=useI18n();
  return <div className={`empty-state${compact ? ' empty-state--compact' : ''} empty-state--${tone}`}>
    <div className="empty-state-blob" aria-hidden="true"><Avatar identity="career-quest:empty" size={compact ? 90 : 120} animated={false}/></div>
    <h3>{t(title)}</h3>
    <p>{typeof description === "string" ? t(description) : description}</p>
    {action && <div className="empty-state-actions">{action}</div>}
  </div>;
}

export function LoadingStatus({ label, detail, slowLabel = 'Это занимает чуть больше времени. Продолжаем загрузку…' }: { label: string; detail?: string; slowLabel?: string }) {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return <div className="loading-status" role="status" aria-live="polite">
    <CircleNotch className="loading-spinner" size={19} aria-hidden="true"/>
    <div><span>{t(label)}</span>{(slow || detail) && <p>{t(slow ? slowLabel : detail)}</p>}</div>
  </div>;
}

export function StartupLoading() {
 const { t, date, number, languageTag } = useI18n();

  return <main className="startup-state" aria-busy="true">
    <div className="startup-card"><img src="/halyk.svg" alt="Halyk" width={113} height={40}/><span className="startup-caption">Career Quest</span>
      <LoadingStatus label={t("Открываем ваше пространство")} detail={t("Проверяем вход, чтобы продолжить с вашего места.")}/>
      <div className="startup-track" aria-hidden="true"/>
    </div>
  </main>;
}

export function WorkspaceLoading({ view }: { view: string }) {
 const { t, date, number, languageTag } = useI18n();

  const home = view === 'trajectory';
  const cards = home || view === 'catalog' || view === 'team' || view === 'access';
  return <section className="workspace-loading" aria-busy="true" aria-label={t("Загрузка раздела")}>
    <LoadingStatus label={home ? t("Собираем ваш план развития") : view === 'team' ? t("Загружаем команду") : view === 'catalog' ? t("Подбираем активности") : t("Загружаем данные раздела")} detail={t("Профиль, активности и последние изменения скоро появятся здесь.")}/>
    <div className="skeleton-layout" aria-hidden="true">
      {home ? <div className="skeleton-hero"><div className="skeleton-character"><span className="skeleton skeleton-avatar"/><span className="skeleton skeleton-label"/></div><div><span className="skeleton skeleton-heading"/><span className="skeleton skeleton-title"/><span className="skeleton skeleton-line"/><span className="skeleton skeleton-button"/></div></div> : <><div className="skeleton skeleton-heading"/><div className="skeleton skeleton-subheading"/></>}
      {home && <div className="skeleton-stats">{[0, 1, 2].map(i => <div key={i}><span className="skeleton skeleton-label"/><span className="skeleton skeleton-value"/></div>)}</div>}
      <div className={cards ? `skeleton-cards${home ? ' skeleton-cards--home' : ''}` : 'skeleton-rows'}>
        {Array.from({ length: cards ? (home ? 2 : 3) : 4 }, (_, i) => <div className="skeleton-card" key={i}>
          <span className="skeleton skeleton-title"/><span className="skeleton skeleton-line"/><span className="skeleton skeleton-line skeleton-line--short"/>{cards && <span className="skeleton skeleton-button"/>}
        </div>)}
      </div>
    </div>
  </section>;
}

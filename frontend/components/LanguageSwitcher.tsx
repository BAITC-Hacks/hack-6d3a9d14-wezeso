'use client';

import { useI18n } from '../lib/i18n';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return <div className="language-switcher" role="group" aria-label={locale === 'kk' ? 'Интерфейс тілі' : 'Язык интерфейса'}>
    <button type="button" lang="kk" aria-label="Қазақша" aria-pressed={locale === 'kk'} onClick={() => setLocale('kk')}>ҚАЗ</button>
    <button type="button" lang="ru" aria-label="Русский" aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>РУС</button>
  </div>;
}

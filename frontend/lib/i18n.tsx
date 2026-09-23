'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatCount, formatDate, formatNumber, isLocale, localeCookie, localeTag, translate, type Locale, type CountNoun } from './i18n-core';

function makeFormatters(locale: Locale) {
  return {
    locale, languageTag: localeTag[locale],
    t: (source: string | null | undefined, parameters?: Record<string, string | number | undefined>) => translate(locale, source, parameters),
    date: (value: string | undefined, options?: Intl.DateTimeFormatOptions) => formatDate(locale, value, options),
    number: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(locale, value, options),
    count: (noun: CountNoun, value: number) => formatCount(locale, noun, value),
  };
}
const LanguageContext = createContext({ ...makeFormatters('ru'), setLocale: (_locale: Locale) => {} });

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try { localStorage.setItem(localeCookie, next); } catch { /* Storage can be disabled. */ }
    document.cookie = `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute('content', locale === 'kk' ? 'Halyk-тегі мансап жолыңыз.' : 'Карьерный маршрут в Halyk.');
  }, [locale]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === localeCookie && isLocale(event.newValue)) updateLocale(event.newValue); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const value = useMemo(() => ({ ...makeFormatters(locale), setLocale }), [locale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useI18n = () => useContext(LanguageContext);

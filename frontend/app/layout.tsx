import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { LanguageProvider } from '../lib/i18n';
import { detectLocale, localeCookie } from '../lib/i18n-core';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './globals.css';
import './workspace.css';
import './states.css';
import './pixel-workspace.css';
import './responsive.css';
async function requestLocale() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  return detectLocale(cookieStore.get(localeCookie)?.value, requestHeaders.get('accept-language') || '');
}
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return { title: 'Halyk · Career Quest', description: locale === 'kk' ? 'Halyk-тегі мансап жолыңыз.' : 'Карьерный маршрут в Halyk.' };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return <html lang={locale}><body><LanguageProvider initialLocale={locale}>{children}</LanguageProvider></body></html>;
}

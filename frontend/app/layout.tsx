import type { Metadata } from 'next';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './globals.css';
export const metadata: Metadata = { title: 'Halyk · Career Quest', description: 'Личный маршрут развития. Объяснимые шаги, подтверждённый прогресс.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body>{children}</body></html>; }

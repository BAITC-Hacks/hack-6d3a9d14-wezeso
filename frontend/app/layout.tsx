import type { Metadata } from 'next';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './globals.css';
import './workspace.css';
import './states.css';
import './pixel-workspace.css';
export const metadata: Metadata = { title: 'Halyk · Career Quest', description: 'Карьерный маршрут в Halyk.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body>{children}</body></html>; }

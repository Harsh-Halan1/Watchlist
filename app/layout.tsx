import type { ReactNode } from 'react';
import Script from 'next/script';
import './globals.css';
export const metadata = { title: 'Anime Tracker', description: 'Your watchlist and episode progress' };
const themeScript = `(() => {
  let theme;
  try { theme = localStorage.getItem('watchlist-theme'); } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();`;

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body>
    {children}
    <Script id="watchlist-theme" strategy="beforeInteractive">{themeScript}</Script>
  </body></html>;
}

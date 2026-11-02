import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LocaleProvider } from './locale-provider';
import { ResearchShellBoundary } from '@/components/ResearchApplicationShell';
import { acceptedLanguages, localePreference, resolveLocale } from '@/lib/locale';
import './globals.css';
import './workspace-feedback.css';
import './studio-ui.css';
import './navigation-ui.css';
import './pilot-design.css';
import './device-preferences.css';
import '@/components/UiSelect.css';
import { DevicePreferences } from '@/components/DevicePreferences';

export const metadata: Metadata = { title: 'Phynite Lab', description: 'Local computational materials-science workspace', robots: { index: false, follow: false } };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const request = await headers();
  const preference = localePreference(request.get('cookie')?.match(/(?:^|;\s*)phynite-language=(en|id|auto)(?:;|$)/)?.[1]);
  const locale = resolveLocale(preference, acceptedLanguages(request.get('accept-language') ?? ''));
  return <html lang={locale} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `(function(){var r=document.documentElement,t='light';try{t=localStorage.getItem('phynite-calculation-theme')==='dark'?'dark':'light'}catch(e){}r.dataset.siteTheme=t;r.dataset.workspaceTheme=t;r.classList.toggle('site-dark',t==='dark');r.style.colorScheme=t})();` }} /></head><body><LocaleProvider initialLocale={locale} initialPreference={preference} initialCountry={undefined}><DevicePreferences><ResearchShellBoundary>{children}</ResearchShellBoundary></DevicePreferences></LocaleProvider></body></html>;
}

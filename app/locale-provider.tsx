'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Globe2, X } from 'lucide-react';
import { LOCALE_STORAGE_KEY, localePreference, resolveLocale, type Locale, type LocalePreference } from '@/lib/locale';
import { guidePath, guideRoute } from '@/lib/guide-routing';

type LocaleContextValue = { locale: Locale; preference: LocalePreference; setPreference: (value: LocalePreference) => void };
const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', preference: 'auto', setPreference: () => {} });

export function LocaleProvider({ children, initialLocale = 'en', initialPreference = 'auto', initialCountry, forcedDocumentLocale }: { children: React.ReactNode; initialLocale?: Locale; initialPreference?: LocalePreference; initialCountry?: string; forcedDocumentLocale?: Locale }) {
  const [locale, setLocale] = useState(initialLocale);
  const [preference, setPreferenceState] = useState(initialPreference);
  const [suggestion, setSuggestion] = useState<Locale | null>(null);
  const apply = useCallback((next: LocalePreference) => {
    const resolved = forcedDocumentLocale ?? resolveLocale(next, navigator.languages, initialCountry);
    setPreferenceState(next);
    setLocale(resolved);
    document.documentElement.lang = resolved;
  }, [initialCountry, forcedDocumentLocale]);
  const setPreference = useCallback((next: LocalePreference) => {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Keep language selection usable without storage. */ }
    document.cookie = `phynite-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    const route = guideRoute(location.pathname);
    if (forcedDocumentLocale && route) {
      const targetLocale = resolveLocale(next, navigator.languages, initialCountry);
      setPreferenceState(next);
      setSuggestion(null);
      if (targetLocale !== route.locale) location.assign(`${guidePath(targetLocale, route.topic)}${location.search}${location.hash}`);
      return;
    }
    apply(next);
    setSuggestion(null);
    if (document.querySelector('[data-public-locale]')) window.location.reload();
  }, [apply, initialCountry, forcedDocumentLocale]);
  useEffect(() => {
    const sync = () => {
      let next = initialPreference;
      const cookie = document.cookie.match(/(?:^|;\s*)phynite-language=(en|id|auto)(?:;|$)/);
      if (cookie) next = localePreference(cookie[1]);
      else try { const stored = localStorage.getItem(LOCALE_STORAGE_KEY); if (stored) next = localePreference(stored); } catch {}
      if (forcedDocumentLocale) { apply(next); return; }
      const publicLocale = document.querySelector<HTMLElement>('[data-public-locale]')?.dataset.publicLocale;
      const resolved = resolveLocale(next, navigator.languages, initialCountry);
      if (publicLocale && publicLocale !== resolved) {
        document.cookie = `phynite-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
        window.location.reload();
        return;
      }
      apply(next);
    };
    queueMicrotask(sync);
    const onStorage = (event: StorageEvent) => { if (event.key === LOCALE_STORAGE_KEY || event.key === null) sync(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('languagechange', sync);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('languagechange', sync); };
  }, [apply, initialCountry, initialPreference, forcedDocumentLocale]);
  useEffect(() => {
    if (forcedDocumentLocale || preference !== 'auto' || !initialCountry || !/^[A-Z]{2}$/.test(initialCountry) || initialCountry === 'XX') return;
    const regional: Locale = initialCountry === 'ID' ? 'id' : 'en';
    if (regional === locale) return;
    try { if (localStorage.getItem(`phynite:locale-dismissed:${initialCountry}`)) return; } catch {}
    const timer = setTimeout(() => setSuggestion(regional), 1400);
    return () => clearTimeout(timer);
  }, [initialCountry, locale, preference, forcedDocumentLocale]);
  const dismiss = () => { setSuggestion(null); try { localStorage.setItem(`phynite:locale-dismissed:${initialCountry}`, 'true'); } catch {} };
  return <LocaleContext.Provider value={{ locale, preference, setPreference }}>{children}{suggestion && <aside className="locale-suggestion" role="region" aria-labelledby="locale-suggestion-title"><button className="locale-dismiss" onClick={dismiss} aria-label={locale === 'id' ? 'Tutup saran bahasa' : 'Dismiss language suggestion'}><X size={17} /></button><LanguageFlag locale={suggestion} /><div><h2 id="locale-suggestion-title">{suggestion === 'id' ? 'Gunakan Bahasa Indonesia?' : 'Use English here?'}</h2><p>{locale === 'id' ? 'Bahasa wilayah Anda berbeda dari bahasa perangkat. Pilihan selalu dapat diubah melalui menu bahasa.' : 'Your region and device language differ. You can always change your preference from the language menu.'}</p><div><button onClick={() => setPreference(suggestion)}>{suggestion === 'id' ? 'Bahasa Indonesia' : 'English (US)'}</button><button onClick={dismiss}>{locale === 'id' ? 'Tetap Bahasa Indonesia' : 'Keep English'}</button></div></div></aside>}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  const t = useCallback((english: string, indonesian: string) => context.locale === 'id' ? indonesian : english, [context.locale]);
  return { ...context, t, intlLocale: context.locale === 'id' ? 'id-ID' : 'en-US' };
}

export function LanguageControl() {
  return <RegionMenu placement="footer" />;
}

export function RegionMenu({ placement = 'header' }: { placement?: 'header' | 'footer' }) {
  const { locale, setPreference, t } = useLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="region-menu" data-placement={placement} ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" className="region-trigger" aria-label={t('Region and language', 'Wilayah dan bahasa')} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{placement === 'header' ? <Globe2 size={20} /> : <><LanguageFlag locale={locale} /><span>{locale === 'id' ? 'Bahasa Indonesia' : 'English (US)'}</span><ChevronDown size={14} /></>}</button>
    {open && <section id={panelId} className="region-panel" aria-label={t('Region and language', 'Wilayah dan bahasa')}><header><strong>{t('Language', 'Bahasa')}</strong><span>{t('Choose the language for this browser.', 'Pilih bahasa untuk browser ini.')}</span></header>{(['en', 'id'] as const).map(value => <button key={value} type="button" aria-pressed={locale === value} onClick={() => { setPreference(value); setOpen(false); trigger.current?.focus(); }}><LanguageFlag locale={value} /><span>{value === 'id' ? 'Bahasa Indonesia' : 'English (US)'}<small>{value === 'id' ? 'Indonesia' : t('United States', 'Amerika Serikat')}</small></span>{locale === value && <Check size={16} />}</button>)}</section>}
  </div>;
}

function LanguageFlag({ locale }: { locale: Locale }) {
  return <svg className="language-flag" viewBox="0 0 38 26" aria-hidden="true"><path fill="#fff" d="M0 0h38v26H0z" />{locale === 'id' ? <path fill="#e70011" d="M0 0h38v13H0z" /> : <><path stroke="#b22234" strokeWidth="2" d="M0 1h38M0 5h38M0 9h38M0 13h38M0 17h38M0 21h38M0 25h38" /><path fill="#3c3b6e" d="M0 0h16v14H0z" />{Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, col) => <path key={`${row}-${col}`} fill="#fff" transform={`translate(${1.35 + col * 2.65 + (row % 2) * 1.325} ${1.1 + row * 1.475}) scale(.6)`} d="m0-1 .3.7.8.1-.6.5.2.8-.7-.4-.7.4.2-.8-.6-.5.8-.1z" />))}</>}</svg>;
}

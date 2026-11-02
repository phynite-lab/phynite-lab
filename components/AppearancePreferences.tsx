'use client';

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Copy, Download, ChevronDown, Check } from 'lucide-react';
import { useLocale, LanguageControl } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';
import { applySiteTheme } from '@/lib/site-theme';
import { activeAppearance, applyDevicePreferences, colorContrast, defaultDevicePreferences, devicePreferencesSnapshot, parseDevicePreferences, readDevicePreferences, separateAppearanceModes, subscribeToDevicePreferences, themePreset, updateAppearance, type AccentColor, type AppearanceValues, type DevicePreferences, type ThemePreset, type UiDensity } from '@/lib/device-preferences';
import { SettingsRow } from './SettingsPage';
import { UiSelect } from './UiSelect';

function ModePreview({ mode }: { mode: 'system' | 'light' | 'dark' }) {
  return <span className={`appearance-mode-preview appearance-mode-preview--${mode}`} aria-hidden="true">{(mode === 'system' ? ['light', 'dark'] : [mode]).map(value => <span className="appearance-mini-window" data-mode={value} key={value}><span className="appearance-mini-sidebar"><span /></span><span className="appearance-mini-content"><i /><i /><i /><i /><i /><span /></span></span>)}</span>;
}

export function AppearancePreferences() {
  const { t } = useLocale();
  const { theme, preference } = useSiteTheme();
  const snapshot = useSyncExternalStore(subscribeToDevicePreferences, devicePreferencesSnapshot, () => JSON.stringify(defaultDevicePreferences));
  const preferences = parseDevicePreferences(snapshot);
  const appearance = activeAppearance(preferences, theme);
  const [notice, setNotice] = useState('');
  const [fontDraft, setFontDraft] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const [draft, setDraft] = useState<{ base: string; background: string; foreground: string } | null>(null);
  const base = snapshot + theme;
  const colors = draft?.base === base ? draft : appearance;
  const invalidColors = colorContrast(colors.background, colors.foreground) < 4.5;
  const update = (patch: Partial<AppearanceValues>) => { setFontDraft(''); setCodeDraft(''); applyDevicePreferences(updateAppearance(readDevicePreferences(), theme, patch)); };
  const globalUpdate = (patch: Partial<DevicePreferences>) => applyDevicePreferences({ ...readDevicePreferences(), ...patch });
  const changeColor = (key: 'background' | 'foreground', color: string) => {
    const next = { background: colors.background, foreground: colors.foreground, [key]: color };
    setDraft({ base, ...next });
    if (colorContrast(next.background, next.foreground) >= 4.5) update({ ...next, customColors: true, preset: 'custom' });
  };
  const themeDocument = () => JSON.stringify({ format: 'phynite-appearance', version: 1, mode: preference, preferences: readDevicePreferences() }, null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([themeDocument()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'phynite-appearance.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(t('Appearance downloaded.', 'Tampilan diunduh.'));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(themeDocument()); setNotice(t('Appearance copied.', 'Tampilan disalin.')); }
    catch { setNotice(t('Clipboard unavailable. Use Download theme to save your choices.', 'Clipboard tidak tersedia. Gunakan Unduh tema untuk menyimpan pilihan Anda.')); }
  };
  const accents: { value: AccentColor; label: string; color: string }[] = [ { value: 'neutral', label: t('Default', 'Default'), color: 'var(--ink)' }, { value: 'blue', label: t('Blue', 'Biru'), color: '#386cef' }, { value: 'violet', label: t('Violet', 'Ungu'), color: '#9161cb' }, { value: 'green', label: t('Green', 'Hijau'), color: '#33865c' }, { value: 'orange', label: t('Orange', 'Oranye'), color: '#c66a2e' } ];
  const chosenAccent = accents.find(item => item.value === appearance.accent)!;
  return <div className="appearance-preferences">
    <section id="device-appearance" className="appearance-visual-style" aria-labelledby="visual-style-heading"><h2 id="visual-style-heading">{t('Visual style', 'Gaya visual')}</h2>
      <div className="appearance-panel appearance-mode-panel"><SettingsRow title={t('Mode', 'Mode')}><div className="appearance-modes" role="group" aria-label={t('Appearance mode', 'Mode tampilan')}>
        {([['system', t('System', 'Sistem')], ['light', t('Light', 'Terang')], ['dark', t('Dark', 'Gelap')]] as const).map(([value, label]) => <button key={value} type="button" className="appearance-mode-button" aria-label={label} title={label} aria-pressed={preference === value} onClick={() => applySiteTheme(value)}><ModePreview mode={value} /><span className="appearance-mode-check" aria-hidden="true">{preference === value && <Check size={11} />}</span></button>)}
      </div></SettingsRow></div>
      <div className="appearance-panel appearance-palette-panel">
        <SettingsRow title={t('Theme', 'Tema')}><div className="appearance-theme-controls"><button className="appearance-icon-button" type="button" aria-label={t('Download theme', 'Unduh tema')} title={t('Download theme', 'Unduh tema')} onClick={download}><Download size={18} /></button><button className="appearance-icon-button" type="button" aria-label={t('Copy theme', 'Salin tema')} title={t('Copy theme', 'Salin tema')} onClick={() => void copy()}><Copy size={18} /></button><UiSelect label={t('Theme', 'Tema')} value={appearance.preset} displayValue={<><span className="appearance-theme-monogram">Aa</span><span>{appearance.preset === 'phynite' ? 'Phynite' : appearance.preset === 'paper' ? 'Paper' : appearance.preset === 'slate' ? 'Slate' : t('Custom', 'Kustom')}</span></>} options={[{ value: 'phynite', label: 'Phynite' }, { value: 'paper', label: 'Paper' }, { value: 'slate', label: 'Slate' }, { value: 'custom', label: t('Custom', 'Kustom') }]} onChange={value => { setDraft(null); if (value === 'custom') update({ customColors: true, preset: 'custom' }); else update(themePreset(value as Exclude<ThemePreset, 'custom'>, theme)); }} /></div></SettingsRow>
        <SettingsRow title={t('Accent', 'Aksen')}><UiSelect label={t('Accent', 'Aksen')} value={appearance.accent} displayValue={<><span className="appearance-accent-dot" style={{ background: chosenAccent.color }} /><span>{chosenAccent.label}</span></>} options={accents.map(item => ({ value: item.value, label: item.label }))} onChange={value => update({ accent: value as AccentColor })} /></SettingsRow>
        <SettingsRow title={t('Background', 'Latar belakang')}><label className="appearance-color-pill"><span style={{ background: colors.background } as CSSProperties} /><input type="color" aria-label={t('Background color', 'Warna latar belakang')} value={colors.background} onChange={event => changeColor('background', event.target.value)} /><code>{colors.background.toUpperCase()}</code></label></SettingsRow>
        <SettingsRow title={t('Foreground', 'Warna teks')}><label className="appearance-color-pill"><span style={{ background: colors.foreground } as CSSProperties} /><input type="color" aria-label={t('Foreground color', 'Warna teks')} value={colors.foreground} onChange={event => changeColor('foreground', event.target.value)} /><code>{colors.foreground.toUpperCase()}</code></label></SettingsRow>
      </div>
      {invalidColors && <p className="appearance-feedback" role="alert">{t('Choose both colors. They apply when text contrast reaches 4.5:1.', 'Pilih kedua warna. Pasangan diterapkan saat kontras teks mencapai 4,5:1.')}</p>}
      {notice && <p className="appearance-feedback" role="status">{notice}</p>}
    </section>
    <details className="appearance-advanced" open><summary>{t('Advanced', 'Lanjutan')}<ChevronDown size={14} /></summary>
      <div className="appearance-panel">
        <SettingsRow title={t('UI font size', 'Ukuran font antarmuka')} description={t('Adjust the base size used for Phynite Lab.', 'Atur ukuran dasar antarmuka Phynite Lab.')}><label className="appearance-number"><input type="number" aria-label={t('UI font size', 'Ukuran font antarmuka')} min={12} max={18} step={1} value={fontDraft || String(appearance.fontSize)} onChange={event => setFontDraft(event.target.value)} onBlur={() => { const value = Number(fontDraft); if (Number.isInteger(value) && value >= 12 && value <= 18) update({ fontSize: value }); else setFontDraft(''); }} onKeyDown={event => { if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur(); }} /><span>px</span></label></SettingsRow>
        <SettingsRow title={t('Code font size', 'Ukuran font kode')} description={t('Adjust the base size for code, input previews, and logs.', 'Atur ukuran dasar kode, pratinjau input, dan log.')}><label className="appearance-number"><input type="number" aria-label={t('Code font size', 'Ukuran font kode')} min={11} max={18} step={1} value={codeDraft || String(appearance.codeFontSize)} onChange={event => setCodeDraft(event.target.value)} onBlur={() => { const value = Number(codeDraft); if (Number.isInteger(value) && value >= 11 && value <= 18) update({ codeFontSize: value }); else setCodeDraft(''); }} onKeyDown={event => { if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur(); }} /><span>px</span></label></SettingsRow>
      </div>
      <div className="appearance-panel">
        <SettingsRow title={t('Reduce motion', 'Kurangi animasi')} description={t('Reduce interface animations or match your system.', 'Kurangi animasi antarmuka atau ikuti sistem.')}><div className="appearance-segments" role="group" aria-label={t('Reduce motion', 'Kurangi animasi')}>{([['system', t('System', 'Sistem')], [true, t('On', 'Aktif')], [false, t('Off', 'Mati')]] as const).map(([value, label]) => <button type="button" key={String(value)} aria-pressed={preferences.reduceMotion === value} onClick={() => globalUpdate({ reduceMotion: value })}>{label}</button>)}</div></SettingsRow>
        <SettingsRow title={t('Separate light and dark modes', 'Pisahkan mode terang dan gelap')} description={t('Choose a theme, colors, and font for each.', 'Pilih tema, warna, dan font untuk setiap mode.')}><button type="button" className="settings-toggle appearance-switch" role="switch" aria-label={t('Separate light and dark modes', 'Pisahkan mode terang dan gelap')} aria-checked={preferences.separateModes} data-active={preferences.separateModes || undefined} onClick={() => applyDevicePreferences(separateAppearanceModes(readDevicePreferences(), theme, !preferences.separateModes))}><span aria-hidden="true" /></button></SettingsRow>
      </div>
      <div className="appearance-panel"><SettingsRow title={t('Contrast', 'Kontras')}><label className="appearance-contrast"><input type="range" aria-label={t('Contrast', 'Kontras')} min={0} max={100} step={1} value={appearance.contrast} onChange={event => update({ contrast: Number(event.target.value) })} /><output>{appearance.contrast}</output></label></SettingsRow></div>
      <div className="appearance-panel"><SettingsRow title={t('Diff markers', 'Penanda perubahan')} description={t('Show AI input changes using colors or +/− markers.', 'Tampilkan perubahan input AI dengan warna atau penanda +/−.')}><div className="appearance-segments" role="group" aria-label={t('Diff markers', 'Penanda perubahan')}><button type="button" aria-pressed={preferences.diffMarkers === 'color'} onClick={() => globalUpdate({ diffMarkers: 'color' })}>{t('Color', 'Warna')}</button><button type="button" aria-pressed={preferences.diffMarkers === 'symbols'} onClick={() => globalUpdate({ diffMarkers: 'symbols' })}>+/−</button></div></SettingsRow></div>
      <div className="appearance-panel"><SettingsRow title={t('Interface density', 'Kepadatan antarmuka')}><div className="appearance-segments" role="group" aria-label={t('Interface density', 'Kepadatan antarmuka')}>{(['comfortable', 'compact'] as UiDensity[]).map(value => <button type="button" key={value} aria-pressed={preferences.density === value} onClick={() => globalUpdate({ density: value })}>{value === 'comfortable' ? t('Comfortable', 'Nyaman') : t('Compact', 'Ringkas')}</button>)}</div></SettingsRow><SettingsRow id="interface-language" title={t('Language', 'Bahasa')}><LanguageControl /></SettingsRow></div>
    </details>
    <footer className="appearance-footer"><p>{t('Saved on this device only.', 'Hanya tersimpan di perangkat ini.')}</p><button type="button" onClick={() => { applySiteTheme('light'); applyDevicePreferences(defaultDevicePreferences); setDraft(null); setNotice(''); }}>{t('Restore defaults', 'Pulihkan default')}</button></footer>
  </div>;
}

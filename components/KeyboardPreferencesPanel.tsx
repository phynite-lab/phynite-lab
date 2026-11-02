'use client';
import { useState, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { defaultKeyboardPreferences, keyboardPreferenceDefinitions, readKeyboardPreferences, saveKeyboardPreferences, keyboardPreferencesSnapshot, parseKeyboardPreferences, subscribeKeyboardPreferences, shortcutForEvent, validShortcut, type ShortcutId } from '@/lib/keyboard-preferences';
import { SettingsSection } from './SettingsPage';
export function KeyboardPreferencesPanel() {
  const { t } = useLocale();
  const raw = useSyncExternalStore(subscribeKeyboardPreferences, keyboardPreferencesSnapshot, () => JSON.stringify(defaultKeyboardPreferences));
  const values = parseKeyboardPreferences(raw);
  const [error, setError] = useState('');
  const update = (id: ShortcutId, value: string) => {
    if (!validShortcut(id, value)) { setError(id === 'send-message' ? t('Use Enter, Ctrl/Cmd+Enter, or Alt+Enter.', 'Gunakan Enter, Ctrl/Cmd+Enter, atau Alt+Enter.') : t('Use Ctrl/Cmd with a key, or Shift+Escape. Tab and Escape keep their navigation roles.', 'Gunakan Ctrl/Cmd dengan tombol, atau Shift+Escape. Tab dan Escape tetap untuk navigasi.')); return; }
    const current = readKeyboardPreferences();
    if (value && Object.entries(current).some(([key, binding]) => key !== id && binding === value)) { setError(t('This combination is already assigned to another action.', 'Kombinasi ini sudah dipakai oleh tindakan lain.')); return; }
    saveKeyboardPreferences({ ...current, [id]: value }); setError('');
  };
  return <SettingsSection id="keyboard-shortcuts" title={t('Keyboard shortcuts', 'Pintasan keyboard')} description={t('Focus a field and press a combination. Ctrl on Linux/Windows and Cmd on macOS use the same binding.', 'Fokuskan kolom lalu tekan kombinasi tombol. Ctrl di Linux/Windows dan Cmd di macOS memakai binding yang sama.')} actions={<button type="button" className="lab-button" onClick={() => { saveKeyboardPreferences(defaultKeyboardPreferences); setError(''); }}><RotateCcw size={14} />{t('Restore defaults', 'Pulihkan default')}</button>}>
    <div className="keyboard-preferences-list">{keyboardPreferenceDefinitions.map(item => <div className="keyboard-preference" key={item.id}><label htmlFor={`shortcut-${item.id}`}><strong>{t(item.label, item.idn)}</strong><small>{item.id === 'send-message' ? t('In the AI composer. Shift+Enter always adds a line.', 'Di kolom pesan AI. Shift+Enter selalu membuat baris baru.') : t('Available in the workspace. Editors keep their own shortcuts.', 'Tersedia di workspace. Editor mempertahankan pintasannya.')}</small></label><input id={`shortcut-${item.id}`} value={values[item.id] || t('Disabled', 'Nonaktif')} readOnly onKeyDown={event => { if (event.key === 'Tab') return; event.stopPropagation(); if (event.key === 'Escape' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) { event.currentTarget.blur(); return; } event.preventDefault(); const value = shortcutForEvent(event); if (value) update(item.id, value); }} /><button className="lab-button" type="button" aria-label={`${values[item.id] ? t('Disable', 'Nonaktifkan') : t('Enable', 'Aktifkan')} ${t(item.label, item.idn)}`} onClick={() => update(item.id, values[item.id] ? '' : item.defaultValue)}>{values[item.id] ? t('Disable', 'Nonaktifkan') : t('Enable', 'Aktifkan')}</button></div>)}</div>
    {error && <p className="settings-notice" role="alert">{error}</p>}
    <p className="lab-caption">{t('Saved only in this browser. Operating-system shortcuts may take precedence. Canvas and scientific-editor shortcuts are listed in the guide.', 'Hanya tersimpan di browser ini. Pintasan sistem operasi dapat mengambil prioritas. Pintasan kanvas dan editor ilmiah tercantum di panduan.')}</p>
  </SettingsSection>;
}

'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { useUnsavedSettings } from '@/app/use-unsaved-settings';
import { phyniteEmail, type EmailPreferences } from '@/lib/email-api';
import { UiSelect } from './UiSelect';
import './email.css';

const categories = [
  ['jobs', 'Compute job results', 'Hasil job compute'],
  ['inbox', 'Inbox messages & announcements', 'Pesan inbox & pengumuman'],
  ['product', 'Product updates', 'Update produk'],
  ['adminWaitlist', 'New waitlist signups', 'Pendaftar waitlist baru'],
  ['adminContact', 'Incoming support messages', 'Pesan support masuk'],
  ['adminAlerts', 'Operational alerts', 'Alert operasional'],
] as const;

export function NotificationPreferencesPanel({ admin = false }: { admin?: boolean }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<EmailPreferences | null>(null);
  const [saved, setSaved] = useState<EmailPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const initialLoad = useRef(false);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedSettings(dirty);
  const load = useCallback(async () => {
    setError('');
    try { const { preferences } = await phyniteEmail.preferences(); setDraft(preferences); setSaved(preferences); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Email preferences are unavailable.', 'Preferensi email belum tersedia.')); }
  }, [t]);
  useEffect(() => { if (initialLoad.current) return; const timer = window.setTimeout(() => { initialLoad.current = true; void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  return <section className="lab-section email-preferences">
    <header className="lab-section-heading"><div><h2>{t('Email notifications', 'Notifikasi email')}</h2><p>{t('Choose which updates arrive in your inbox.', 'Pilih update yang masuk ke email Anda.')}</p></div></header>
    {error && <p role="alert" className="lab-notice">{error}{!draft && <button className="lab-button" onClick={() => void load()}>{t('Retry', 'Coba lagi')}</button>}</p>}
    {notice && <p role="status" className="lab-notice">{notice}</p>}
    {!draft ? !error && <WorkspaceLoading label={t('Loading email preferences…', 'Memuat preferensi email…')} /> : <form data-settings-dirty={dirty || undefined} onSubmit={async event => {
      event.preventDefault(); setBusy(true);
      try { const { preferences } = await phyniteEmail.savePreferences(draft); setDraft(preferences); setSaved(preferences); setNotice(t('Email preferences saved.', 'Preferensi email tersimpan.')); setError(''); }
      catch (failure) { setError(failure instanceof Error ? failure.message : t('Preferences could not be saved.', 'Preferensi belum tersimpan.')); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="email-preference-fields"><legend className="sr-only">{t('Email preferences', 'Preferensi email')}</legend>
        <div className="lab-preference"><div><h3>{t('Email language', 'Bahasa email')}</h3><p>{t('Used for automatic emails across your devices.', 'Digunakan untuk email otomatis di semua perangkat.')}</p></div><UiSelect ariaLabel={t('Email language', 'Bahasa email')} value={draft.locale} options={[{ value: 'en', label: 'English' }, { value: 'id', label: 'Bahasa Indonesia' }]} onChange={locale => setDraft({ ...draft, locale: locale as 'en' | 'id' })} /></div>
        {categories.filter(([key]) => admin ? key.startsWith('admin') : !key.startsWith('admin')).map(([key, en, id]) => <label key={key} className="email-preference-toggle"><span>{t(en, id)}</span><input type="checkbox" checked={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.checked })} /></label>)}
      </fieldset>
      <p className="lab-muted">{t('Account security, waitlist confirmations, access invitations, and payment emails stay enabled.', 'Email keamanan akun, konfirmasi waitlist, undangan akses, dan pembayaran tetap aktif.')}</p>
      <div className="lab-actions lab-actions-end"><button type="button" className="lab-button" disabled={busy || !dirty} onClick={() => { setDraft(saved); setError(''); setNotice(''); }}>{t('Cancel', 'Batal')}</button><button className="lab-button lab-button-primary" disabled={busy || !dirty}>{busy ? t('Saving…', 'Menyimpan…') : t('Save email preferences', 'Simpan preferensi email')}</button></div>
    </form>}
  </section>;
}

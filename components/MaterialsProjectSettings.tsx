'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocale } from '@/app/locale-provider';
import { useUnsavedSettings } from '@/app/use-unsaved-settings';
import { localRequest } from '@/lib/local-api';
import { SettingsRow, SettingsSection } from './SettingsPage';

type MaterialsProjectStatus = {
  configured: boolean;
  source: 'settings' | 'environment' | null;
  credentialStorage: 'os-keychain' | 'session-only' | 'environment' | 'none';
  persistent: boolean;
  verified: boolean;
  checkedAt: string | null;
};
type Action = 'save' | 'remove' | 'test';

export function MaterialsProjectSettings() {
  const { t, intlLocale } = useLocale();
  const [status, setStatus] = useState<MaterialsProjectStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useUnsavedSettings(Boolean(apiKey));

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setStatus(await localRequest<MaterialsProjectStatus>('materials-project')); }
    catch { setError(t('Could not read Materials Project settings. Check that the local app is running and your system credential store is unlocked, then retry.', 'Pengaturan Materials Project belum dapat dibaca. Pastikan aplikasi lokal berjalan dan penyimpanan kredensial sistem tidak terkunci, lalu coba lagi.')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => {
    let active = true;
    void localRequest<MaterialsProjectStatus>('materials-project').then(value => {
      if (active) { setStatus(value); setLoading(false); }
    }).catch(() => {
      if (active) { setError(t('Could not read Materials Project settings. Check that the local app is running and your system credential store is unlocked, then retry.', 'Pengaturan Materials Project belum dapat dibaca. Pastikan aplikasi lokal berjalan dan penyimpanan kredensial sistem tidak terkunci, lalu coba lagi.')); setLoading(false); }
    });
    return () => { active = false; };
  }, [t]);

  const act = async (action: Action) => {
    if (busy || loading || action === 'save' && !apiKey.trim()) return;
    setBusy(action); setNotice(''); setError('');
    try {
      const next = await localRequest<MaterialsProjectStatus>(action === 'test' ? 'materials-project/test' : 'materials-project', action === 'save' ? 'PUT' : action === 'remove' ? 'DELETE' : 'POST', action === 'save' ? { apiKey: apiKey.trim() } : undefined);
      setStatus(next);
      if (action === 'save') {
        setApiKey('');
        setNotice(next.persistent ? t('API key saved. Crystal database searches can use it immediately.', 'API key tersimpan. Pencarian database kristal langsung dapat menggunakannya.') : t('API key is available for this app session. Add it again after restarting the app.', 'API key tersedia untuk sesi aplikasi ini. Masukkan kembali setelah aplikasi dimulai ulang.'));
      } else if (action === 'remove') setNotice(next.source === 'environment' ? t('Saved key removed. The key from the launcher environment is still active.', 'Key tersimpan dihapus. Key dari environment launcher masih aktif.') : t('Saved API key removed. COD searches remain available without an account.', 'API key tersimpan dihapus. Pencarian COD tetap tersedia tanpa akun.'));
      else setNotice(t('Materials Project accepted the API key.', 'Materials Project menerima API key ini.'));
    } catch {
      // Never show provider/server error text here: a credential must not be reflected into the UI.
      if (action === 'test') setStatus(previous => previous ? { ...previous, verified: false } : previous);
      setError(action === 'test' ? t('Connection could not be verified. Check the key, internet connection, and Materials Project availability. Unlock your system credential store if needed, then retry.', 'Koneksi belum dapat diverifikasi. Periksa key, koneksi internet, dan ketersediaan Materials Project. Buka kunci penyimpanan kredensial sistem bila diperlukan, lalu coba lagi.') : action === 'save' ? t('API key could not be saved. Check the key and unlock your system credential store if needed, then retry.', 'API key belum dapat disimpan. Periksa key dan buka kunci penyimpanan kredensial sistem bila diperlukan, lalu coba lagi.') : t('API key could not be removed. Unlock your system credential store if needed, then retry.', 'API key belum dapat dihapus. Buka kunci penyimpanan kredensial sistem bila diperlukan, lalu coba lagi.'));
    } finally { setBusy(null); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void act('save'); };
  const storageDescription = status?.credentialStorage === 'session-only'
    ? t('The operating-system credential store is unavailable. This key lasts only until the local app restarts.', 'Penyimpanan kredensial sistem operasi tidak tersedia. Key ini hanya berlaku sampai aplikasi lokal dimulai ulang.')
    : status?.source === 'environment'
      ? t('Using MP_API_KEY from the launcher environment. A key saved here takes priority.', 'Menggunakan MP_API_KEY dari environment launcher. Key yang disimpan di sini akan diprioritaskan.')
      : status?.credentialStorage === 'os-keychain'
        ? t('Saved in this computer’s operating-system credential store.', 'Disimpan di penyimpanan kredensial sistem operasi komputer ini.')
        : t('Add your own key to search Materials Project in Crystal structure and Phynite AI. COD works without a key.', 'Tambahkan key Anda untuk mencari Materials Project melalui Crystal structure dan Phynite AI. COD dapat digunakan tanpa key.');
  const checkedAt = status?.checkedAt ? Date.parse(status.checkedAt) : NaN;

  return <SettingsSection id="materials-project" title="Materials Project" description={t('Connect the crystal database using your own API key. This connection is separate from AI providers and Phynite Cloud.', 'Hubungkan database kristal menggunakan API key Anda. Koneksi ini terpisah dari provider AI dan Phynite Cloud.')}>
    <SettingsRow title={t('Database access', 'Akses database')} description={storageDescription}>
      <span className="lab-tag" role="status">{loading ? t('Loading…', 'Memuat…') : !status ? t('Unavailable', 'Tidak tersedia') : status.verified ? t('Verified', 'Terverifikasi') : status.configured ? t('Configured', 'Dikonfigurasi') : t('Not configured', 'Belum dikonfigurasi')}</span>
    </SettingsRow>
    <form className="settings-api-key-form" onSubmit={submit} data-settings-dirty={Boolean(apiKey)}>
      <label className="settings-api-key-field" htmlFor="materials-project-api-key"><span>{t(status?.source === 'settings' ? 'Replace API key' : 'API key', status?.source === 'settings' ? 'Ganti API key' : 'API key')}</span><input id="materials-project-api-key" name="materials-project-api-key" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={apiKey} disabled={loading || Boolean(busy) || !status} placeholder={t('Paste your Materials Project API key', 'Tempel API key Materials Project Anda')} aria-describedby="materials-project-key-help" onChange={event => { setApiKey(event.target.value); setNotice(''); setError(''); }} /></label>
      <p className="settings-api-key-help" id="materials-project-key-help">{t('Your key is never shown again or included in project exports, Cloud Sync, or browser storage.', 'Key Anda tidak ditampilkan kembali atau disertakan dalam ekspor project, Cloud Sync, maupun storage browser.')} <a href="https://next-gen.materialsproject.org/api" target="_blank" rel="noreferrer">{t('Get an API key', 'Dapatkan API key')}</a></p>
      <div className="settings-api-key-actions"><button className="lab-button lab-button-primary" type="submit" disabled={loading || Boolean(busy) || !status || !apiKey.trim()}>{busy === 'save' ? t('Saving…', 'Menyimpan…') : t('Save API key', 'Simpan API key')}</button>{status?.configured && <button className="lab-button" type="button" disabled={loading || Boolean(busy) || Boolean(apiKey)} onClick={() => void act('test')}>{busy === 'test' ? t('Checking…', 'Memeriksa…') : t('Test connection', 'Uji koneksi')}</button>}{status?.source === 'settings' && <button className="lab-button" type="button" disabled={loading || Boolean(busy) || Boolean(apiKey)} onClick={() => void act('remove')}>{busy === 'remove' ? t('Removing…', 'Menghapus…') : t('Remove saved key', 'Hapus key tersimpan')}</button>}{apiKey && <button className="lab-button" type="button" disabled={Boolean(busy)} onClick={() => { setApiKey(''); setError(''); }}>{t('Cancel', 'Batal')}</button>}{!status && !loading && <button className="lab-button" type="button" onClick={() => void refresh()}>{t('Retry', 'Coba lagi')}</button>}</div>
      {status?.verified && Number.isFinite(checkedAt) && <p className="settings-api-key-help">{t('Last verified', 'Terakhir diverifikasi')}: {new Date(checkedAt).toLocaleString(intlLocale)}</p>}
      {notice && <p className="settings-api-key-feedback" role="status">{notice}</p>}
      {error && <p className="settings-api-key-feedback" role="alert">{error}</p>}
    </form>
  </SettingsSection>;
}

'use client';
import { useState, useSyncExternalStore } from 'react';
import { useLocale } from '@/app/locale-provider';
import { defaultLocalNotifications, localNotificationsSnapshot, parseLocalNotifications, readLocalNotifications, saveLocalNotifications, subscribeLocalNotifications, type LocalNotificationPreferences as Preferences } from '@/lib/local-notifications';
import { SettingsRow, SettingsSection } from './SettingsPage';
export function LocalNotificationPreferences() {
  const { t } = useLocale();
  const raw = useSyncExternalStore(subscribeLocalNotifications, localNotificationsSnapshot, () => JSON.stringify(defaultLocalNotifications));
  const preferences = parseLocalNotifications(raw);
  const [notice, setNotice] = useState('');
  const update = async (key: keyof Preferences, value: boolean) => {
    if (key === 'desktop' && value) {
      if (!('Notification' in window)) { setNotice(t('This browser does not support desktop notifications. In-app updates still work.', 'Browser ini tidak mendukung notifikasi desktop. Pembaruan di aplikasi tetap tersedia.')); return; }
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { setNotice(t('Allow notifications in your browser site settings, then enable this option again.', 'Izinkan notifikasi di pengaturan situs browser, lalu aktifkan opsi ini kembali.')); return; }
      } catch { setNotice(t('The browser could not enable desktop notifications.', 'Browser belum dapat mengaktifkan notifikasi desktop.')); return; }
    }
    saveLocalNotifications({ ...readLocalNotifications(), [key]: value }); setNotice('');
  };
  const toggle = (key: keyof Preferences, label: string, description: string) => <SettingsRow title={label} description={description}><button type="button" className="settings-toggle" role="switch" aria-label={label} aria-checked={preferences[key]} data-active={preferences[key] || undefined} onClick={() => void update(key, !preferences[key])}><span aria-hidden="true" />{preferences[key] ? t('On', 'Aktif') : t('Off', 'Mati')}</button></SettingsRow>;
  return <SettingsSection id="notifications" title={t('On this device', 'Di perangkat ini')} description={t('Receive updates while Phynite Lab is open. These choices stay in this browser.', 'Terima pembaruan selama Phynite Lab terbuka. Pilihan ini tetap di browser ini.')}>
    {toggle('jobFinished', t('Completed calculations', 'Kalkulasi selesai'), t('Notify when a running calculation completes.', 'Beri tahu saat kalkulasi berjalan selesai.'))}
    {toggle('jobFailed', t('Failed or cancelled calculations', 'Kalkulasi gagal atau dibatalkan'), t('Notify when a running calculation fails or is cancelled.', 'Beri tahu saat kalkulasi berjalan gagal atau dibatalkan.'))}
    {toggle('runtimeUpdates', t('Runtime installation', 'Pemasangan runtime'), t('Notify when a solver installation finishes or fails.', 'Beri tahu saat pemasangan solver selesai atau gagal.'))}
    {toggle('desktop', t('Desktop notifications', 'Notifikasi desktop'), t('Also show browser notifications when this tab is in the background. Permission is required.', 'Tampilkan juga notifikasi browser saat tab di latar belakang. Memerlukan izin.'))}
    <SettingsRow title={t('Test notifications', 'Uji notifikasi')}><button type="button" className="lab-button" onClick={() => { if (preferences.desktop && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('Phynite Lab', { body: t('Desktop notifications are ready.', 'Notifikasi desktop siap.') }); } catch { setNotice(t('Desktop delivery is unavailable in this browser.', 'Pengiriman desktop tidak tersedia di browser ini.')); return; } } setNotice(t('Notifications are ready. Research data stays on this computer.', 'Notifikasi siap. Data riset tetap di komputer ini.')); }}>{t('Send test notification', 'Kirim notifikasi uji')}</button></SettingsRow>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </SettingsSection>;
}

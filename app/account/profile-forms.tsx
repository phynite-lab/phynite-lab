'use client';
/* eslint-disable @next/next/no-img-element -- validated local profile image preview. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Check, RotateCcw, RotateCw, X } from 'lucide-react';
import { useLocale } from '../locale-provider';
import { useUnsavedSettings } from '../use-unsaved-settings';
import { ProfileAvatar } from '@/components/AccountMenu';
import { UiSelect } from '@/components/UiSelect';
import { SettingsSection, SettingsSaveActions } from '@/components/SettingsPage';
import { type AccountSettings } from '@/lib/account-settings';
import { accountRequest, type AccountResponse } from '@/lib/account-api';

type PhotoCropSource = { url: string; image: HTMLImageElement; name: string };

function PhotoCropEditor({ source, onCancel, onApply }: { source: PhotoCropSource; onCancel: () => void; onApply: (photo: string) => void }) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState(300);
  useEffect(() => { const element = stage.current; if (!element) return; const resize = () => setPreviewSize(element.clientWidth); const observer = new ResizeObserver(resize); observer.observe(element); resize(); return () => observer.disconnect(); }, []);
  const outputSize = 256;
  const quarterTurn = Math.abs(rotation / 90) % 2 === 1;
  const rotatedWidth = quarterTurn ? source.image.naturalHeight : source.image.naturalWidth;
  const rotatedHeight = quarterTurn ? source.image.naturalWidth : source.image.naturalHeight;
  const baseScale = Math.max(outputSize / rotatedWidth, outputSize / rotatedHeight);
  const renderedWidth = rotatedWidth * baseScale * zoom;
  const renderedHeight = rotatedHeight * baseScale * zoom;
  const clampOffset = (next: { x: number; y: number }) => ({
    x: Math.max(-(renderedWidth - outputSize) / 2, Math.min((renderedWidth - outputSize) / 2, next.x)),
    y: Math.max(-(renderedHeight - outputSize) / 2, Math.min((renderedHeight - outputSize) / 2, next.y)),
  });
  const safeOffset = clampOffset(offset);
  const rotate = (direction: number) => { setRotation((current) => (current + direction + 360) % 360); setOffset({ x: 0, y: 0 }); };
  const apply = () => {
    const canvas = document.createElement('canvas'); canvas.width = outputSize; canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, outputSize, outputSize);
    context.translate(outputSize / 2 + safeOffset.x, outputSize / 2 + safeOffset.y);
    context.rotate(rotation * Math.PI / 180);
    context.scale(baseScale * zoom, baseScale * zoom);
    context.drawImage(source.image, -source.image.naturalWidth / 2, -source.image.naturalHeight / 2);
    let quality = .86;
    let photo = canvas.toDataURL('image/webp', quality);
    while (photo.length > 100_000 && quality > .5) { quality -= .08; photo = canvas.toDataURL('image/webp', quality); }
    onApply(photo);
  };
  const previewScale = previewSize / outputSize;
  const imageScale = baseScale * zoom * previewScale;
  return <dialog ref={dialog} className="settings-photo-dialog" aria-labelledby="photo-crop-title" onCancel={event => { event.preventDefault(); onCancel(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel(); } }}><section className="photo-crop-dialog"><header><div><Camera size={18} /><span><strong id="photo-crop-title">{t('Frame profile photo', 'Atur bingkai foto profil')}</strong><small>{source.name}</small></span></div><button type="button" aria-label={t('Close photo editor', 'Tutup editor foto')} onClick={onCancel}><X size={17} /></button></header><div ref={stage} className="photo-crop-stage" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, offset: safeOffset }; }} onPointerMove={(event) => { if (!drag.current) return; setOffset(clampOffset({ x: drag.current.offset.x + (event.clientX - drag.current.x) / previewScale, y: drag.current.offset.y + (event.clientY - drag.current.y) / previewScale })); }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}><img draggable={false} src={source.url} alt={t('Crop preview', 'Pratinjau crop')} style={{ width: source.image.naturalWidth, height: source.image.naturalHeight, transform: `translate(-50%, -50%) translate(${safeOffset.x * previewScale}px, ${safeOffset.y * previewScale}px) rotate(${rotation}deg) scale(${imageScale})` }} /><span className="photo-crop-guide" aria-hidden="true" /></div><p>{t('Drag the photo to reframe it. The circular guide shows the visible avatar area.', 'Geser foto untuk mengatur bingkai. Lingkaran menunjukkan area avatar yang terlihat.')}</p><div className="photo-crop-controls"><label><span>{t('Zoom', 'Perbesar')}</span><input type="range" min="1" max="4" step="0.01" value={zoom} aria-label={t('Photo zoom', 'Perbesaran foto')} onChange={(event) => setZoom(Number(event.target.value))} /></label><div><button type="button" onClick={() => rotate(-90)}><RotateCcw size={15} />{t('Rotate left', 'Putar kiri')}</button><button type="button" onClick={() => rotate(90)}><RotateCw size={15} />{t('Rotate right', 'Putar kanan')}</button></div></div><footer><button type="button" className="lab-button" onClick={onCancel}>{t('Cancel', 'Batal')}</button><button type="button" className="lab-button lab-button-primary" onClick={apply}><Check size={15} />{t('Use photo', 'Gunakan foto')}</button></footer></section></dialog>;
}

async function saveProfilePatch(settings: AccountSettings, patch: Partial<AccountSettings>, exists: boolean) {
  const initialProfile = { version: settings.version, displayName: settings.displayName, institution: settings.institution, role: settings.role, researchArea: settings.researchArea, avatarDataUrl: settings.avatarDataUrl };
  const response = await fetch('/api/phynite/v1/profile', { method: exists ? 'PATCH' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exists ? patch : { ...initialProfile, ...patch }) });
  const data = await response.json() as { profile: AccountSettings; error?: string };
  if (!response.ok) throw new Error(data.error || 'Profile could not be saved.');
  return data.profile;
}

export function ProfileForm({ settings, exists, onSaved, onNotice, localMode = false }: { settings: AccountSettings; exists: boolean; onSaved: (profile: AccountSettings) => void; onNotice: (value: string) => void; localMode?: boolean }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(settings), [saved, setSaved] = useState(settings);
  const [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [error, setError] = useState('');
  const [photoCrop, setPhotoCrop] = useState<PhotoCropSource | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedSettings(dirty);
  useEffect(() => { if (!dirty && JSON.stringify(settings) !== JSON.stringify(saved)) { let active = true; queueMicrotask(() => { if (active) { setDraft(settings); setSaved(settings); } }); return () => { active = false; }; } }, [settings, saved, dirty]);
  const photoUrl = photoCrop?.url;
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const patch = (value: Partial<AccountSettings>) => setDraft(current => ({ ...current, ...value }));
  const selectPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoBusy(true); setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20_000_000) throw new Error(t('Choose a JPG, PNG, or WebP photo up to 20 MB.', 'Pilih foto JPG, PNG, atau WebP hingga 20 MB.'));
      const url = URL.createObjectURL(file), image = new Image(); image.src = url;
      try { await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw new Error(); }
      catch { URL.revokeObjectURL(url); throw new Error(t('This image could not be read. Choose another photo.', 'Gambar ini tidak dapat dibaca. Pilih foto lain.')); }
      setPhotoCrop({ url, image, name: file.name });
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('Photo could not be opened.', 'Foto belum dapat dibuka.')); }
    finally { setPhotoBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!dirty || busy) return;
    setBusy(true); setError('');
    try {
      const fields = ['displayName', 'institution', 'role', 'researchArea', 'avatarDataUrl'] as const;
      const changes = Object.fromEntries(fields.filter(key => draft[key] !== saved[key]).map(key => [key, draft[key] ?? '']));
      const profile = await saveProfilePatch(settings, changes, exists);
      setDraft(profile); setSaved(profile); onSaved(profile); onNotice(t('Profile saved.', 'Profil tersimpan.'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('Profile could not be saved. Your draft is still here.', 'Profil belum tersimpan. Draft Anda tetap tersedia.')); }
    finally { setBusy(false); }
  };
  return <form id="profile" data-settings-dirty={dirty || undefined} onSubmit={save}>
    <SettingsSection id="profile-photo" title={t('Profile photo', 'Foto profil')} description={t('Your identity across your private research workspace.', 'Identitas Anda di seluruh workspace riset privat.')}>
      <div className="settings-photo-row"><ProfileAvatar large photo={draft.avatarDataUrl} name={draft.displayName} /><div><p>{t('JPG, PNG, or WebP up to 20 MB. Crop and rotate before saving.', 'JPG, PNG, atau WebP hingga 20 MB. Crop dan putar sebelum menyimpan.')}</p><div className="lab-actions"><label className="lab-button lab-upload"><Camera size={14} />{photoBusy ? t('Opening…', 'Membuka…') : t('Choose photo', 'Pilih foto')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photoBusy} onChange={event => { void selectPhoto(event.target.files?.[0]); event.target.value = ''; }} /></label>{draft.avatarDataUrl && <button type="button" className="lab-button" disabled={busy} onClick={() => patch({ avatarDataUrl: '' })}>{t('Remove', 'Hapus')}</button>}</div></div></div>
    </SettingsSection>
    <SettingsSection id="research-identity" title={t('Research identity', 'Identitas riset')} description={localMode ? t('Saved locally on this computer. Connect Cloud Sync per project when you choose.', 'Disimpan lokal di komputer ini. Hubungkan Cloud Sync per project saat Anda memilihnya.') : t('Saved to your account and synchronized across devices.', 'Disimpan ke akun dan tersinkron antarperangkat.')}>
      <fieldset className="settings-fields settings-profile-fields" disabled={busy || photoBusy}>
        <label className="lab-field">{t('Display name', 'Nama tampilan')}<input value={draft.displayName} maxLength={100} required autoComplete="name" onChange={event => patch({ displayName: event.target.value })} /></label>
        <label className="lab-field">{t('Institution', 'Institusi')}<input value={draft.institution} maxLength={160} autoComplete="organization" placeholder={t('University or organization', 'Universitas atau organisasi')} onChange={event => patch({ institution: event.target.value })} /></label>
        <UiSelect label={t('Role', 'Peran')} value={draft.role} options={['Researcher', 'Student', 'Industrial R&D', 'Educator', 'Other'].map(value => ({ value, label: ({ Researcher: t('Researcher', 'Peneliti'), Student: t('Student', 'Mahasiswa'), 'Industrial R&D': t('Industrial R&D', 'Litbang industri'), Educator: t('Educator', 'Pengajar'), Other: t('Other', 'Lainnya') } as Record<string, string>)[value] }))} onChange={role => patch({ role })} />
        <label className="lab-field">{t('Research area', 'Bidang riset')}<input value={draft.researchArea} maxLength={240} placeholder={t('Electronic structure, nanomaterials…', 'Struktur elektronik, nanomaterial…')} onChange={event => patch({ researchArea: event.target.value })} /></label>
      </fieldset>
    </SettingsSection>
    {error && <p className="settings-notice" role="alert">{error}</p>}
    <SettingsSaveActions dirty={dirty} busy={busy || photoBusy} label={t('Save profile', 'Simpan profil')} onCancel={() => { setDraft(saved); setError(''); setPhotoCrop(null); }} />
    {photoCrop && <PhotoCropEditor source={photoCrop} onCancel={() => setPhotoCrop(null)} onApply={photo => { patch({ avatarDataUrl: photo }); setPhotoCrop(null); }} />}
  </form>;
}

export function SignInForm({ email, username, onSaved }: { email: string; username: string; onSaved: (account: AccountResponse['account']) => void }) {
  const { t } = useLocale();
  const [handle, setHandle] = useState(username), [saved, setSaved] = useState(username), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const dirty = handle !== saved;
  useUnsavedSettings(dirty);
  useEffect(() => { if (!dirty && username !== saved) { let active = true; queueMicrotask(() => { if (active) { setHandle(username); setSaved(username); } }); return () => { active = false; }; } }, [username, saved, dirty]);
  return <form data-settings-dirty={dirty || undefined} onSubmit={async event => {
    event.preventDefault(); if (!dirty || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await accountRequest<AccountResponse>('/username', 'PUT', { username: handle }); setHandle(result.account.username ?? ''); setSaved(result.account.username ?? ''); onSaved(result.account); setNotice(t('Username saved. Use it or your email the next time you sign in.', 'Username tersimpan. Gunakan username ini atau email saat masuk berikutnya.')); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Username could not be saved.', 'Username belum tersimpan.')); }
    finally { setBusy(false); }
  }}>
    <SettingsSection id="sign-in-details" title={t('Sign-in details', 'Informasi login')} description={t('Changing your username is a separate action. Your old username stops working once saved.', 'Mengubah username merupakan aksi tersendiri. Username lama tidak berlaku setelah disimpan.')}>
      <fieldset className="settings-fields settings-profile-fields" disabled={busy}>
        <label className="lab-field">Username<input value={handle} required minLength={3} maxLength={30} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,29}" onChange={event => setHandle(event.target.value.toLowerCase())} /><small>{t('3–30 letters, numbers, periods, hyphens, or underscores.', '3–30 huruf, angka, titik, tanda hubung, atau garis bawah.')}</small></label>
        <label className="lab-field">{t('Email address', 'Alamat email')}<input value={email} readOnly autoComplete="email" /><small>{t('Used for sign-in and account messages.', 'Digunakan untuk login dan pesan akun.')}</small></label>
      </fieldset>
    </SettingsSection>
    {error && <p className="settings-notice" role="alert">{error}</p>}{notice && <p className="settings-notice" role="status">{notice}</p>}
    <SettingsSaveActions dirty={dirty} busy={busy} label={t('Save username', 'Simpan username')} onCancel={() => { setHandle(saved); setError(''); }} />
  </form>;
}

export { AppearancePreferences as AppearanceForm } from '@/components/AppearancePreferences';

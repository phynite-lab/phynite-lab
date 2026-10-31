/** Shared guard for settings links and explicit actions such as sign out. */
export function confirmUnsavedSettings(message?: string): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !document.querySelector('[data-settings-dirty="true"]')) return true;
  const fallback = document.documentElement.lang.startsWith('id')
    ? 'Abaikan perubahan pengaturan yang belum disimpan?'
    : 'Discard unsaved settings changes?';
  return window.confirm(message ?? fallback);
}

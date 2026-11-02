export const settingsSections = [
  { id: 'profile', href: '/account', group: 'personal', en: 'Research profile', idn: 'Profil riset', keywords: 'name institution role email username nama institusi peran' },
  { id: 'appearance', href: '/account/appearance', group: 'device', en: 'Appearance & language', idn: 'Tampilan & bahasa', keywords: 'theme light dark language tema terang gelap bahasa' },
  { id: 'keyboard', href: '/account/keyboard', group: 'device', en: 'Keyboard shortcuts', idn: 'Pintasan keyboard', keywords: 'keyboard shortcut hotkey keys pintasan tombol' },
  { id: 'notifications', href: '/account/notifications', group: 'device', en: 'Notifications', idn: 'Notifikasi', keywords: 'email results jobs inbox notifications hasil pemberitahuan' },
  { id: 'compute', href: '/account/compute', group: 'research', en: 'Compute', idn: 'Komputasi', keywords: 'computer core cpu ram gpu vram resources cloud hardware duration komputer memori durasi sumber daya' },
  { id: 'ai-providers', href: '/account/ai-providers', group: 'ai', en: 'AI provider accounts', idn: 'Akun provider AI', keywords: 'ai provider account codex antigravity claude gemini token quota limit reset akun model' },
  { id: 'account', href: '/account/account', group: 'ai', en: 'Account', idn: 'Akun', keywords: 'account cloud login logout identity plan akun cloud masuk keluar identitas paket' },
  { id: 'usage', href: '/account/usage', group: 'research', en: 'Usage', idn: 'Pemakaian', keywords: 'hours time runs receipts charge refund history jam waktu kalkulasi biaya riwayat' },
  { id: 'storage', href: '/account/storage', group: 'research', en: 'Storage', idn: 'Penyimpanan', keywords: 'files capacity quota trajectory figures data berkas kapasitas kuota' },
  { id: 'billing', href: '/billing', group: 'account', en: 'Billing', idn: 'Tagihan', keywords: 'quanta balance top up payments plans saldo pembayaran paket' },
  { id: 'privacy', href: '/account/privacy', group: 'account', en: 'Privacy & session', idn: 'Privasi & sesi', keywords: 'cookies analytics logout sign out security sesi keluar keamanan' },
] as const;

export type SettingsSection = typeof settingsSections[number]['id'];
export type AccountSection = Exclude<SettingsSection, 'billing'>;
export const settingsControls = [
  { section: 'profile', anchor: 'profile-photo', en: 'Profile photo', idn: 'Foto profil', keywords: 'avatar crop zoom rotate gambar foto' },
  { section: 'profile', anchor: 'research-identity', en: 'Research identity', idn: 'Identitas riset', keywords: 'display name institution role area nama institusi bidang peran' },
  { section: 'profile', anchor: 'sign-in-details', en: 'Username & email', idn: 'Username & email', keywords: 'login sign in masuk nama pengguna' },
  { section: 'appearance', anchor: 'device-appearance', en: 'Device appearance', idn: 'Tampilan perangkat', keywords: 'theme light dark browser local tema terang gelap lokal' },
  { section: 'appearance', anchor: 'interface-language', en: 'Interface language', idn: 'Bahasa antarmuka', keywords: 'english indonesia browser bahasa' },
  { section: 'keyboard', anchor: 'keyboard-shortcuts', en: 'Keyboard shortcuts', idn: 'Pintasan keyboard', keywords: 'keyboard shortcut hotkey keys pintasan tombol' },
  { section: 'notifications', anchor: 'notifications', en: 'Email notifications', idn: 'Notifikasi email', keywords: 'jobs results inbox product language hasil pesan bahasa' },
  { section: 'compute', anchor: 'compute-defaults', en: 'CPU, RAM & duration', idn: 'CPU, RAM & durasi', keywords: 'cpu core ram gpu vram cloud resource funding duration minutes hours dft memori inti menit jam perkiraan' },
  { section: 'compute', anchor: 'compute-defaults', query: '?workload=md-simulation', en: 'MD simulation resources', idn: 'Resource simulasi MD', keywords: 'lammps cpu ram local simulasi lokal' },
  { section: 'compute', anchor: 'compute-defaults', query: '?workload=md-analysis', en: 'MD analysis resources', idn: 'Resource analisis MD', keywords: 'ovito analysis cpu ram local analisis lokal' },
  { section: 'compute', anchor: 'your-computer', en: 'Worker connection', idn: 'Koneksi worker', keywords: 'computer connect pair install komputer hubungkan pemasangan' },
  { section: 'ai-providers', anchor: 'provider-accounts', en: 'AI usage & reset', idn: 'Pemakaian & reset AI', keywords: 'codex antigravity remaining weekly session limit kuota sisa batas mingguan sesi' },
  { section: 'account', anchor: 'account-identity', en: 'Phynite Cloud account', idn: 'Akun Phynite Cloud', keywords: 'account cloud login logout sync connect akun masuk keluar sinkronisasi koneksi' },
  { section: 'usage', anchor: 'recorded-compute', en: 'Run time & CPU-hours', idn: 'Waktu run & jam CPU', keywords: 'solver wall time hours elapsed waktu jam durasi' },
  { section: 'usage', anchor: 'job-receipts', en: 'Job charges & refunds', idn: 'Biaya job & refund', keywords: 'history ledger cost quanta riwayat biaya' },
  { section: 'storage', anchor: 'cloud-storage', en: 'Cloud storage & quota', idn: 'Penyimpanan cloud & kuota', keywords: 'categories capacity upload reservations files kategori kapasitas reservasi berkas' },
  { section: 'billing', anchor: 'payments', en: 'Top up Quanta & buy storage', idn: 'Top-up Quanta & beli storage', keywords: 'balance payment purchase saldo pembayaran pembelian' },
  { section: 'privacy', anchor: 'privacy', en: 'Cookies & analytics', idn: 'Cookie & analytics', keywords: 'consent privacy tracking persetujuan privasi' },
  { section: 'privacy', anchor: 'current-session', en: 'Current session', idn: 'Sesi saat ini', keywords: 'sign out logout security keluar keamanan' },
] as const;

export function searchSettingsControls(query: string, mode: 'local' | 'hosted' = 'hosted') {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return settingsControls.filter(control => terms.every(term => `${control.en} ${control.idn} ${control.keywords}`.toLocaleLowerCase().includes(term))).map(control => {
    const anchor = mode === 'local' && control.anchor === 'cloud-storage' ? 'local-storage' : mode === 'local' && control.anchor === 'sign-in-details' ? 'account-identity' : control.anchor;
    const en = mode === 'local' && control.anchor === 'cloud-storage' ? 'Local storage & archives' : mode === 'local' && control.section === 'notifications' ? 'Device notifications' : control.en;
    const idn = mode === 'local' && control.anchor === 'cloud-storage' ? 'Penyimpanan lokal & arsip' : mode === 'local' && control.section === 'notifications' ? 'Notifikasi perangkat' : control.idn;
    return { ...control, en, idn, href: `${settingsSections.find(section => section.id === (mode === 'local' && control.anchor === 'sign-in-details' ? 'account' : control.section))!.href}${mode !== 'local' && 'query' in control ? control.query : ''}#${anchor}` };
  });
}
export const accountLinks = [...settingsSections, { id: 'pricing', href: '/pricing', en: 'Pricing', idn: 'Harga' }, { id: 'guide', href: '/guide#account', en: 'Account guide', idn: 'Panduan akun' }] as const;
export function accountLinksFor() { return [...accountLinks]; }

export function searchSettingsSections(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return settingsSections.filter(section => terms.every(term => `${section.en} ${section.idn} ${section.keywords}`.toLocaleLowerCase().includes(term)));
}

export function legacyAccountDestination(section: string, hash = '') {
  if (section === 'computer') return { pathname: '/account/compute', hash: hash || '#your-computer' };
  if (section === 'preferences') return { pathname: hash === '#notifications' ? '/account/notifications' : hash === '#privacy' ? '/account/privacy' : '/account/appearance', hash };
  if (section === 'subscription') return { pathname: '/billing', hash };
  return null;
}

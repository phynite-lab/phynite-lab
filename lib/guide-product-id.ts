import type { GuideSection } from './guide-content.ts';

export const productGuideSectionsId: GuideSection[] = [
  {
    id: 'npm-local-app', group: 'Aplikasi lokal', title: 'Instal, perbarui, dan diagnosis aplikasi npm',
    intro: 'Aplikasi npm publik adalah jalur local-first untuk menjalankan workspace, DFT, MD, dan analisis native di komputer Anda. Login Phynite, Docker, checkout source, dan Python global tidak diperlukan.',
    blocks: [
      { title: 'Instal dan jalankan', code: 'npm install -g phynite-lab@latest\nphynite-lab', paragraphs: [
        'Paket publik saat ini adalah phynite-lab@{{LOCAL_NPM_VERSION}}. Gunakan Node.js dengan versi yang memenuhi {{NODE_REQUIREMENT}}. npm memasang launcher dan paket aplikasi native opsional yang sesuai dengan OS serta CPU.',
        'Pastikan optional dependencies npm tidak dinonaktifkan. Jika paket dipasang dengan --omit=optional atau paket platform dihapus, launcher menampilkan error runtime yang hilang dan tidak diam-diam memakai fixture development.',
        'Launcher mengikat layanan ke loopback, membuka browser, dan menyimpan workspace lokal di ~/.phynite-lab. Project serta runtime pengguna berada di luar direktori instalasi npm.',
      ] },
      { title: 'Platform yang didukung', table: { headings: ['Platform', 'Paket/runtime', 'Catatan'], rows: [
        ['macOS Apple Silicon', 'darwin-arm64', 'Paket native arm64.'],
        ['Linux ARM64', 'linux-arm64', 'Memerlukan glibc >=2.39 dan user namespace yang tersedia.'],
        ['Linux x64 / Omarchy / Arch', 'linux-x64', 'Memerlukan glibc >=2.39 dan user namespace yang tersedia.'],
        ['Windows', 'WSL2 linux-x64', 'Jalankan npm dan phynite-lab di dalam WSL2; solver native Windows tidak dipasang.'],
      ] }, note: 'Paket mendeklarasikan target darwin/linux dan arm64/x64. Platform didukung setelah runtime native, probe isolasi, dan pemeriksaan scientific-nya lulus; tersedianya paket saja bukan bukti kualifikasi.' },
      { title: 'Perintah launcher dan identitas workspace', code: 'phynite-lab --no-open --port 3000 --data-dir /path/to/workspace\nphynite-lab status --data-dir /path/to/workspace\nphynite-lab doctor --data-dir /path/to/workspace\nphynite-lab stop --data-dir /path/to/workspace', paragraphs: [
        'Perintah biasa menjalankan service di foreground. --no-open mencetak URL loopback tanpa membuka browser. --port meminta port tertentu; bila sudah dipakai, launcher memilih port loopback yang tersedia dan mencetak origin aktual. --data-dir memberi setiap workspace database, project, runtime, dan log sendiri.',
        'status melaporkan instance sehat untuk data directory tersebut. stop meminta instance workspace berhenti dengan tertib. doctor memeriksa identitas distribusi, kesiapan service, path data, dan diagnosis startup. Menjalankan workspace yang sama lagi memakai instance sehat yang ada, bukan membuat duplikat.',
      ] },
      { title: 'Perbarui tanpa menghapus project', code: 'npm install -g phynite-lab@latest\nphynite-lab --version', steps: [
        'Selesaikan atau batalkan job aktif lalu hentikan instance.',
        'Jalankan perintah update npm dari instalasi Node yang sama dengan pemilik paket global.',
        'Buka aplikasi lagi dan cek Pengaturan → Komputasi untuk memastikan kemampuan runtime tetap tersedia.',
        'Jika startup gagal, jalankan phynite-lab doctor dan baca log di data directory; memasang ulang paket tidak menghapus ~/.phynite-lab.',
      ], paragraphs: [
        'Aplikasi lokal dapat menampilkan notifikasi update setelah memeriksa https://registry.npmjs.org/phynite-lab/latest. Pemeriksaan berhasil disimpan maksimal enam jam; response tidak tersedia atau tidak valid dicoba lagi sekitar lima menit. Pemeriksaan tidak mengirim data project atau kredensial, tidak memasang update otomatis, dan tidak memblokir pekerjaan lokal saat offline.',
      ] },
      { title: 'Perbaikan startup npm yang umum', table: { headings: ['Gejala', 'Periksa'], rows: [
        ['Versi Node ditolak', 'Jalankan node --version dan gunakan versi Node.js yang memenuhi {{NODE_REQUIREMENT}}.'],
        ['Paket runtime hilang', 'Pasang ulang dengan optional dependencies aktif dan cek target paket melalui doctor.'],
        ['Port sudah dipakai', 'Gunakan --no-open, ikuti port yang dicetak, atau pilih --port yang kosong.'],
        ['Project tidak terlihat', 'Gunakan --data-dir yang sama; setiap directory adalah workspace terpisah.'],
        ['Service berhenti saat startup', 'Jalankan status dan doctor lalu baca logs/<service>.log di data directory.'],
        ['Update tidak tersedia', 'Lanjutkan offline, cek npm/jaringan nanti, lalu coba lagi; notifikasi bersifat informatif.'],
      ] }, links: [{ label: 'Referensi distribusi lokal', href: '/id/guide/local-compute' }, { label: 'Pemecahan masalah dan pemulihan', href: '/id/guide/troubleshooting' }] },
    ],
  },
  {
    id: 'ai-providers', group: 'Koneksi AI', title: 'Koneksi provider AI di komputer Anda',
    intro: 'AI lokal memakai CLI provider yang Anda pilih. Ini terpisah dari login Phynite Cloud dan tidak memakai layanan AI hosted Phynite.',
    blocks: [
      { title: 'Hubungkan akun', steps: [
        'Instal dan autentikasi CLI provider resmi di komputer ini.',
        'Buka Pengaturan → Akun provider AI dan pilih Codex atau Antigravity.',
        'Selesaikan autentikasi melalui alur milik provider. Login CLI yang didukung dapat dipakai ulang tanpa mengimpor cookie atau file session.',
        'Biarkan aplikasi terbuka saat discovery model dan capability probe berjalan. Halaman hanya memilih model yang lulus pemeriksaan teks, streaming, dan tool.',
      ], links: [{ label: 'Pengaturan provider AI', href: '/id/account/ai-providers' }] },
      { title: 'Provider, model, dan limit', paragraphs: [
        'Aplikasi lokal memakai satu profil yang dikelola CLI provider resmi. Request yang gagal atau terkena rate limit tidak mengganti provider atau akun secara diam-diam.',
        'Kartu pemakaian hanya menampilkan telemetry yang dilaporkan provider: grup model, persentase session atau mingguan, window, dan waktu reset bila tersedia. Laporan yang hilang tetap ditampilkan tidak tersedia; aplikasi tidak membuat angka token, saldo, atau tanggal reset.',
        'Ketersediaan model dapat berubah mengikuti entitlement provider. Pengaturan model Cloud tidak mengatur akun provider lokal.',
      ] },
      { title: 'Keamanan dan status yang belum didukung', bullets: [
        'Kredensial provider tetap di CLI provider atau credential store lokal dan tidak masuk browser storage, log, arsip project, atau Cloud Sync. Aplikasi lokal tidak menerima URL atau token gateway.',
        'Bridge lokal berjalan di loopback dengan shell, MCP, plugin, browser, dan aksi jaringan yang belum diverifikasi dinonaktifkan. Perubahan Canvas tetap mengikuti approval dan validasi yang ada.',
        'Jika autentikasi, discovery, streaming, atau verifikasi tool gagal, provider tetap terlihat disconnected atau unavailable sampai diperbaiki. Tidak ada fallback provider otomatis.',
        'Akses AI provider terpisah dari instalasi runtime scientific dan dari login Phynite Cloud.',
      ] },
    ],
  },
  {
    id: 'cloud-sync', group: 'Akun & koneksi', title: 'Phynite Cloud, Cloud Sync, dan compute online',
    intro: 'Layanan Cloud adalah koneksi opsional di atas workspace lokal yang lengkap. Login tidak mengunggah project lokal atau mengganti identitas lokalnya.',
    blocks: [
      { title: 'Lokal, Cloud Sync, dan compute cloud', table: { headings: ['Pilihan', 'Yang terjadi'], rows: [
        ['Lokal saja', 'Project, input, hasil, dan runtime tetap di komputer yang dipilih. Login Cloud tidak diperlukan.'],
        ['Login Cloud', 'Membuka fitur akun; project lokal tetap lokal sampai aksi project mengaktifkan sync.'],
        ['Cloud Sync', 'Diaktifkan per project setelah meninjau cakupan, ukuran, dan kuota. Revision serta artefak project yang diizinkan disinkronkan.'],
        ['Run on cloud', 'Hanya mengunggah input/dependensi job yang sudah ditinjau, membuat eksekusi cloud terpisah, lalu mengunduh hasil terverifikasi. Tidak mengaktifkan sync.'],
      ] } },
      { title: 'Siklus sync dan konflik', steps: [
        'Login dari Pengaturan → Akun dan pertahankan identitas workspace lokal.',
        'Buka kontrol sync project, tinjau file, ukuran, kuota, dan retensi yang ditampilkan, lalu aktifkan Cloud Sync secara eksplisit.',
        'Tunggu outbox persisten selesai. Transfer terputus dapat dilanjutkan dengan checksum; revision Cloud baru diterbitkan setelah seluruh artefak snapshot diverifikasi.',
        'Jika perangkat lain mengubah project, bandingkan revision lokal dan Cloud sebelum memilih pakai lokal, pakai Cloud, atau simpan sebagai salinan.',
        'Gunakan Trash untuk penghapusan Cloud. Tombstone dan masa retensi melindungi salinan Cloud; mematikan sync mempertahankan dua salinan, sedangkan logout menghentikan sync tanpa menghapus data lokal.',
      ] },
      { title: 'Batas akun dan billing', paragraphs: [
        'Antrean sync dan mapping akun terikat pada akun Cloud yang sedang login. Berganti akun tidak melanjutkan upload milik akun lain.',
        'Kuota Cloud, retensi artefak, Trash, dan allowance Free hosted terpisah dari ruang disk lokal. Billing dan perubahan paket tersedia di website hosted; pembelian tidak otomatis menjalankan job.',
        'MD Cloud belum tersedia sampai service yang didukung muncul di katalog aktif. Jangan menyimpulkan ketersediaannya dari runtime MD lokal.',
      ], links: [{ label: 'Pengaturan akun Cloud', href: '/id/account/account' }, { label: 'Pemakaian dan kuota', href: '/id/account/usage' }, { label: 'Billing hosted', href: '/billing' }] },
    ],
  },
  {
    id: 'storage-backup', group: 'Data & reproduksibilitas', title: 'Storage, ekspor, backup, dan state QE besar',
    intro: 'Storage lokal adalah disk yang tersedia untuk workspace terpilih. Storage Cloud adalah layanan akun dengan kuota dan retensi sendiri.',
    blocks: [
      { title: 'Yang diukur Storage lokal', table: { headings: ['Dihitung', 'Di luar inventaris project'], rows: [
        ['Struktur, input, konfigurasi, hasil selesai, trajectory, dan arsip project yang terinventarisasi.', 'Metadata SQLite, file instalasi solver/runtime, log worker, cache browser, dan file lain di disk.'],
        ['State intermediate yang dipertahankan sebagai artefak project.', 'Ruang kosong sistem operasi dan data aplikasi lain.'],
      ] }, paragraphs: ['Data directory default adalah ~/.phynite-lab. Gunakan --data-dir bila disk yang lebih besar atau terpisah lebih sesuai. Mode lokal tidak memiliki kuota tetap 10 GiB dan tidak menghapus artefak otomatis setelah tujuh hari; ruang disk kosong adalah batas praktisnya.'] },
      { title: 'File intermediate dan wavefunction QE', bullets: [
        'Pengaturan disk_io dan state sementara dapat jauh lebih besar daripada ringkasan SCF akhir.',
        'Data wavefunction dan tmp mungkin diperlukan untuk band, DOS, fonon, workflow projected, checkpoint, atau interoperabilitas eksternal.',
        'Jangan menghapus state intermediate sebelum semua workflow lanjutan selesai. Simpan input eksak, identitas dan checksum pseudopotensial, provenance, serta artefak state bersama-sama.',
        'Wannier90 adalah workflow eksternal/manual kecuali ada integrasi native yang didokumentasikan terpisah; ikuti kebutuhan handoff resminya.',
      ], links: [{ label: 'Dokumentasi Quantum ESPRESSO', href: 'https://www.quantum-espresso.org/documentation/' }, { label: 'Dokumentasi Wannier90', href: 'https://wannier.org/documentation/' }] },
      { title: 'Ekspor, impor, dan backup', steps: [
        'Ekspor arsip project dari Pengaturan → Penyimpanan sebelum memindahkan workspace atau melakukan perubahan destruktif.',
        'Simpan backup kedua di luar ~/.phynite-lab, termasuk input eksak, identitas/checksum potential, provenance, dan state intermediate yang diperlukan workflow lanjutan.',
        'Impor ke data directory baru terlebih dahulu dan periksa struktur, konfigurasi, hasil, serta checksum sebelum mengganti salinan kerja.',
        'Gunakan Source package untuk figur; itu tidak menggantikan arsip project atau backup runtime solver.',
      ], links: [{ label: 'Pengaturan penyimpanan', href: '/id/account/storage' }] },
    ],
  },
  {
    id: 'settings-reference', group: 'Pengaturan & preferensi', title: 'Pengaturan, preferensi, profil, dan pemakaian',
    intro: 'Pengaturan memisahkan preferensi perangkat, compute scientific, akun AI provider, status akun Cloud, pemakaian, storage, dan privasi.',
    blocks: [
      { title: 'Memilih halaman yang tepat', table: { headings: ['Halaman', 'Fungsi', 'Tempat tersimpan'], rows: [
        ['Tampilan & bahasa', 'Tema, aksen, kepadatan, ukuran teks, reduced motion, dan bahasa.', 'Browser/perangkat ini.'],
        ['Pintasan keyboard', 'Binding aplikasi yang didukung.', 'Browser/perangkat ini.'],
        ['Notifikasi', 'Alert job/runtime dan izin desktop.', 'Browser/perangkat ini; delivery hosted mengikuti akun.'],
        ['Komputasi', 'Instalasi runtime, probe isolasi, default CPU/RAM/job, dan transfer Cloud.', 'Workspace lokal atau akun Cloud sesuai kontrolnya.'],
        ['Akun provider AI', 'Login provider, pergantian akun, kesiapan model, limit, dan reset.', 'CLI provider/credential store lokal.'],
        ['Akun', 'Login/logout Phynite Cloud dan sync per project.', 'Akun Cloud; data lokal tetap lokal.'],
        ['Profil', 'Identitas riset yang tampil setelah login Cloud.', 'Akun Cloud.'],
        ['Pemakaian', 'Job scientific dan pemakaian AI yang dilaporkan provider.', 'Record eksekusi/provider nyata.'],
        ['Penyimpanan / Privasi', 'Inventaris project, arsip, session, dan batas data lokal.', 'Workspace lokal dan browser.'],
      ] } },
      { title: 'Tema, notifikasi, dan pintasan', paragraphs: [
        'Perubahan Appearance langsung berlaku dan tetap device-only kecuali halaman secara eksplisit menawarkan default akun Cloud. Light, dark, system, aksen, kepadatan, ukuran teks kode, reduced motion, dan bahasa dapat diatur terpisah.',
        'Preferensi notifikasi mengatur alert job/runtime lokal dan izin browser. Preferensi itu tidak membuat session Cloud atau mengunggah project.',
        'Perubahan keyboard berlaku untuk binding aplikasi yang didukung pada browser ini. Shortcut browser dan sistem operasi dapat tetap mengambil alih.',
      ] },
      { title: 'Profil dan visibilitas login', paragraphs: [
        'Workspace lokal tanpa login Cloud tidak menampilkan user profile. Hubungkan akun Cloud sebelum membuka Profil; logout menghapus kontrol profil tetapi mempertahankan project dan identitas lokal.',
        'Login AI provider terpisah dari login Cloud. Akun provider dapat dihubungkan saat Phynite Cloud tetap logout.',
      ] },
    ],
  },
];

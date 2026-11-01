import type { GuideSection } from './guide-content.ts';
import type { Locale } from './locale.ts';
import { guidePath } from './guide-routing.ts';
import { personalComputeCommand, personalComputeLogs } from './personal-compute.ts';

export function localComputeGuide(locale: Locale): GuideSection {
  const t = (en: string, id: string) => locale === 'id' ? id : en;
  return {
    id: 'local-compute',
    group: t('Account & compute', 'Akun & komputasi'),
    title: t('Connect your computer with Phynite Compute', 'Menghubungkan komputer melalui Phynite Compute'),
    intro: t(
      'Run DFT and molecular-dynamics calculations on your own computer through one Phynite connection. Download the helper for your operating system, open it, and approve the connection in your account. Phynite Compute prepares the verified Quantum ESPRESSO, LAMMPS, and OVITO runtimes for you.',
      'Jalankan kalkulasi DFT dan dinamika molekuler pada komputer sendiri melalui satu koneksi Phynite. Unduh aplikasi pendamping untuk sistem operasi Anda, buka, lalu setujui koneksi pada akun. Phynite Compute menyiapkan runtime Quantum ESPRESSO, LAMMPS, dan OVITO terverifikasi secara otomatis.',
    ),
    blocks: [
      {
        title: t('Plan, review, monitor, compare', 'Rencanakan, tinjau, pantau, bandingkan'),
        steps: [
          t('Open Resources from the workspace sidebar, the collapsed rail, or Workspace options on a small screen. Check available Quanta after reservations, storage measured at its last inventory, CPU/RAM, and the estimated affordable Cloud time. That time describes capacity for one new job at the selected paid profile rate, including its minimum billable duration; it is not a completion ETA. Pilot grants have separate job/time limits.', 'Buka Resource dari sidebar workspace, rail saat sidebar ditutup, atau Pilihan workspace pada layar kecil. Periksa Quanta tersedia setelah reservasi, penyimpanan pada pengukuran inventaris terakhir, CPU/RAM, dan perkiraan jam Cloud yang dapat dibiayai. Angka ini adalah kapasitas satu job baru pada tarif profil berbayar terpilih, termasuk durasi minimum tagihan; bukan ETA selesai. Grant pilot memiliki batas job/waktu terpisah.'),
          t('Review the run before starting. A run override takes precedence over the account default for that workload, then the existing service default. Make default explicitly saves choices for future runs. Estimated duration helps quote a budget; it does not change the enforced runtime timeout.', 'Tinjau run sebelum mulai. Pilihan run mengungguli default akun workload tersebut, lalu default layanan yang berlaku. Jadikan default menyimpan pilihan untuk run berikutnya secara eksplisit. Perkiraan durasi membantu menghitung anggaran; tidak mengubah timeout eksekusi yang diberlakukan.'),
          t('Monitor the selected active job: queued, preparation, computing, and saving results. Elapsed time starts at the recorded start, and each job has its own clock. Finish includes uploading results. Resource data refreshes every 15 seconds with active jobs or every 60 seconds while idle; refresh errors retain the last available values.', 'Pantau job aktif terpilih: antre, persiapan, compute, dan penyimpanan hasil. Elapsed dimulai pada waktu mulai tercatat, dan setiap job memiliki waktunya sendiri. Penyelesaian mencakup unggah hasil. Data resource diperbarui setiap 15 detik saat ada job aktif atau 60 detik saat idle; kegagalan refresh mempertahankan nilai terakhir.'),
          t('Compare short representative runs with several CPU allocations before a large campaign. Keep the same scientific inputs when comparing performance. More cores do not always improve speed: Quantum ESPRESSO scaling depends on the system and parallel work distribution, and LAMMPS recommends measuring your actual workload. Phynite does not automatically start a paid benchmark.', 'Bandingkan run pendek yang representatif pada beberapa alokasi CPU sebelum kampanye besar. Pertahankan input ilmiah yang sama saat membandingkan performa. Lebih banyak core tidak selalu lebih cepat: skalabilitas Quantum ESPRESSO bergantung pada sistem dan pembagian kerja paralel, sementara LAMMPS menyarankan pengukuran workload aktual. Phynite tidak menjalankan benchmark berbayar secara otomatis.'),
        ],
        table: {
          headings: [t('Metric', 'Metrik'), t('Meaning', 'Arti')],
          rows: [
            [t('Run wall time', 'Wall time run'), t('Recorded completion minus recorded start, including preparation and result upload; queue waiting before start is excluded.', 'Waktu selesai dikurangi waktu mulai tercatat, mencakup persiapan dan unggah hasil; antre sebelum mulai tidak dihitung.')],
            [t('Solver / analysis time', 'Waktu solver / analisis'), t('Measured compute duration reported to the Phynite ledger. Paid charges follow that ledger and profile rate, with the per-job minimum; external HPC charging policies do not determine Phynite charges.', 'Durasi compute terukur yang dilaporkan ke ledger Phynite. Tagihan berbayar mengikuti ledger dan tarif profil, dengan minimum per job; kebijakan tagihan HPC lain tidak menentukan tagihan Phynite.')],
            ['CPU-hours', t('Recorded run wall hours multiplied by worker-reported vCPUs, or the Cloud grant when no worker report exists. Personal jobs without reported runtime allocation are excluded and marked partial, never assumed to use one core.', 'Jam wall time run tercatat dikalikan vCPU yang dilaporkan worker, atau grant Cloud bila laporan worker tidak tersedia. Job personal tanpa laporan alokasi runtime dikecualikan dan ditandai parsial, tidak diasumsikan satu core.')],
            ['GPU / VRAM', t('GPU is unsupported by this runtime. Missing VRAM telemetry is unreported. Missing historical duration, allocation, or charges appear as unavailable, rather than zero.', 'GPU belum didukung runtime ini. Telemetri VRAM yang tidak tersedia ditampilkan belum dilaporkan. Durasi, alokasi, atau biaya historis yang tidak tercatat ditampilkan tidak tersedia, bukan nol.')],
          ],
        },
        links: [
          { label: t('Compute defaults', 'Default compute'), href: '/account/compute' },
          { label: t('Usage and run receipts', 'Pemakaian dan catatan run'), href: '/account/usage' },
          { label: 'NERSC: resource accounting', href: 'https://docs.nersc.gov/policies/resource-usage/' },
          { label: 'Quantum ESPRESSO: parallelization', href: 'https://www.quantum-espresso.org/Doc/pw_user_guide/node18.html' },
          { label: 'LAMMPS: measure performance', href: 'https://docs.lammps.org/stable/Speed_measure.html' },
        ],
      },
      {
        title: t('Before you start', 'Sebelum memulai'),
        paragraphs: [
          t('Choose CPU and RAM per job in Compute settings or the workspace drawer, within the limits shown for DFT, MD simulation, or MD analysis. Allocation describes resources requested for the job. New workers also report the CPU/RAM allocation passed to the launched runtime; this is not hardware utilization. Required capacity depends on atoms, cutoffs, k-points, bands, and calculation type.', 'Pilih CPU dan RAM per job pada pengaturan Compute atau drawer workspace, sesuai batas DFT, simulasi MD, atau analisis MD yang ditampilkan. Alokasi adalah resource yang diminta job. Worker baru juga melaporkan alokasi CPU/RAM yang diteruskan ke runtime saat diluncurkan; ini bukan utilisasi perangkat. Kebutuhannya bergantung pada atom, cutoff, k-point, band, dan jenis kalkulasi.'),
          t('Keep several GB of disk space free for the verified runtime and scientific libraries, plus working space for results. Internet is needed to connect the account, receive calculations, and upload results.', 'Sediakan beberapa GB ruang disk untuk runtime terverifikasi dan pustaka ilmiah, serta ruang kerja hasil. Internet diperlukan untuk menghubungkan akun, menerima kalkulasi, dan mengunggah hasil.'),
        ],
        table: {
          headings: [t('Computer', 'Komputer'), t('Download', 'Unduhan'), t('Open', 'Buka')],
          rows: [
            ['macOS', 'Phynite Compute for macOS', 'Open Phynite Compute.command'],
            ['Windows 10 / 11', 'Phynite Compute for Windows', 'Open Phynite Compute.cmd'],
            ['Linux', 'Phynite Compute for Linux', './phynite-compute'],
          ],
        },
        links: [{ label: t('Download Phynite Compute', 'Unduh Phynite Compute'), href: '/account/compute#your-computer' }],
      },
      {
        title: t('1. Download and open', '1. Unduh dan buka'),
        steps: [
          t('Open Your computer from the avatar menu. The website recommends the correct download for your operating system; links for other supported systems remain available.', 'Buka Komputer Anda dari menu avatar. Website merekomendasikan unduhan yang sesuai dengan sistem operasi; tautan untuk sistem lain tetap tersedia.'),
          t('Extract the ZIP and open its launcher. The helper checks the local engine and opens its official installer page only when that prerequisite is missing.', 'Ekstrak ZIP lalu buka launchernya. Aplikasi pendamping memeriksa engine lokal dan hanya membuka halaman installer resminya ketika prasyarat tersebut belum tersedia.'),
          t('The first setup downloads a pinned, architecture-compatible scientific runtime. Later launches reuse it and preserve the private Phynite Compute volume.', 'Setup pertama mengunduh runtime ilmiah bertanda versi yang sesuai dengan arsitektur. Sesi berikutnya menggunakannya kembali dan mempertahankan volume privat Phynite Compute.'),
        ],
        links: [{ label: t('Open Your computer', 'Buka Komputer Anda'), href: '/account/compute#your-computer' }],
      },
      {
        title: t('2. Approve this computer', '2. Setujui komputer ini'),
        steps: [
          t('The launcher returns to Your computer with the 12-digit Connection code already filled in. Review the page and choose Connect computer.', 'Launcher kembali ke Komputer Anda dengan Kode koneksi 12 digit yang sudah terisi. Periksa halaman lalu pilih Hubungkan komputer.'),
          t('Each code works once and expires after 10 minutes. Only approve a computer you control.', 'Setiap kode hanya dapat dipakai sekali dan berlaku 10 menit. Setujui hanya komputer milik Anda.'),
          t('If another computer is linked, finish or cancel its active calculations before confirming replacement.', 'Jika komputer lain sudah terhubung, selesaikan atau batalkan kalkulasi aktif sebelum mengonfirmasi penggantian.'),
          t('After approval, Phynite Compute downloads and verifies the scientific libraries. Wait until the web status changes to Connected. That single connection enables both DFT Lab and MD Lab.', 'Setelah disetujui, Phynite Compute mengunduh dan memverifikasi pustaka ilmiah. Tunggu hingga status web berubah menjadi Terhubung. Satu koneksi tersebut mengaktifkan DFT Lab dan MD Lab.'),
        ],
        note: t('The short-lived code authorizes one computer without exposing its private credential.', 'Kode sementara memberi akses pada satu komputer tanpa mengekspos kredensial privatnya.'),
      },
      {
        title: t('3. Run your first calculation', '3. Jalankan kalkulasi pertama'),
        steps: [
          t('Open DFT Lab and begin with a small silicon Total energy calculation. Select Your computer as the compute destination.', 'Buka DFT Lab dan mulai dengan kalkulasi Total energy silikon kecil. Pilih Komputer Anda sebagai tujuan komputasi.'),
          t('Watch the execution log. A queued job waits for your connected computer and earlier dependencies. One calculation runs at a time on this computer.', 'Periksa log eksekusi. Job yang antre menunggu komputer terhubung dan dependensi sebelumnya. Satu kalkulasi berjalan pada satu waktu di komputer ini.'),
          t('For a successful SCF result, check convergence, JOB DONE, and the final Completed state. Completion also requires result upload.', 'Untuk hasil SCF yang berhasil, periksa konvergensi, JOB DONE, dan status akhir Completed. Penyelesaian juga memerlukan unggah hasil.'),
          t('Open Figure Lab from the completed result. Its data remains linked to the project, source calculation, and numerical settings.', 'Buka Figure Lab dari hasil selesai. Datanya tetap terhubung dengan project, kalkulasi sumber, dan pengaturan numerik.'),
          t('Open MD Lab and run a small Lennard-Jones equilibration. It uses the same connected computer and does not require a second pairing.', 'Buka MD Lab lalu jalankan equilibration Lennard-Jones kecil. MD memakai komputer terhubung yang sama dan tidak memerlukan pairing kedua.'),
        ],
        links: [
          { label: t('Silicon tutorial', 'Tutorial silikon'), href: guidePath(locale, 'quickstart-silicon') },
          { label: t('Read execution logs', 'Membaca log eksekusi'), href: guidePath(locale, 'execution') },
        ],
      },
      {
        title: t('Everyday use', 'Penggunaan harian'),
        table: {
          headings: [t('Action', 'Tindakan'), t('Location', 'Lokasi')],
          rows: [
            [t('Open or restart Phynite Compute', 'Buka atau mulai ulang Phynite Compute'), t('Open the downloaded launcher again', 'Buka kembali launcher yang diunduh')],
            [t('Check connection', 'Periksa koneksi'), t('Your computer in the account menu', 'Komputer Anda pada menu akun')],
            [t('View technical messages', 'Lihat pesan teknis'), t('Advanced manual setup → Show service logs', 'Setup manual lanjutan → Tampilkan log layanan')],
            [t('Cancel a calculation', 'Batalkan kalkulasi'), t('Use Cancel in the execution log and wait for its final state', 'Gunakan Cancel pada log eksekusi dan tunggu status akhirnya')],
          ],
        },
        paragraphs: [
          t('The private Phynite Compute volume remembers the connection and downloaded libraries. Keep the computer awake and internet available while a calculation is active; the website may be closed.', 'Volume privat Phynite Compute menyimpan koneksi dan pustaka yang diunduh. Pertahankan komputer aktif dan internet tersedia selama kalkulasi berjalan; website boleh ditutup.'),
          t('Stopping the local engine or putting the computer to sleep can interrupt a calculation. Restore connectivity and inspect the job state before sending a duplicate. Completed local work files are cleaned up after three days.', 'Menghentikan engine lokal atau menidurkan komputer dapat menginterupsi kalkulasi. Pulihkan koneksi dan periksa status job sebelum mengirim duplikat. File kerja lokal yang selesai dibersihkan setelah tiga hari.'),
        ],
      },
      {
        title: t('Update, disconnect, or move computers', 'Memperbarui, memutus, atau memindahkan komputer'),
        steps: [
          t('Finish or cancel active calculations before an update, replacement, or disconnection.', 'Selesaikan atau batalkan kalkulasi aktif sebelum pembaruan, penggantian, atau pemutusan.'),
          t('For an update, download and open the current launcher. It asks before replacing a changed runtime and preserves the private volume.', 'Untuk memperbarui, unduh dan buka launcher terbaru. Launcher meminta konfirmasi sebelum mengganti runtime dan mempertahankan volume privat.'),
          t('To move computers, disconnect the old one in Your computer, download Phynite Compute on the new machine, and approve its new code.', 'Untuk memindahkan komputer, putuskan komputer lama pada Komputer Anda, unduh Phynite Compute di perangkat baru, lalu setujui kode barunya.'),
        ],
        note: t('One active personal-computer credential is supported per account. Never copy or share the private runtime volume.', 'Satu kredensial komputer pribadi aktif didukung per akun. Jangan menyalin atau membagikan volume runtime privat.'),
      },
      {
        title: t('Troubleshooting', 'Pemecahan masalah'),
        table: {
          headings: [t('What you see', 'Yang terlihat'), t('What to do', 'Yang perlu dilakukan')],
          rows: [
            [t('The local engine is missing', 'Engine lokal belum tersedia'), t('The launcher opens its official installer page. Install it, wait until ready, then reopen Phynite Compute.', 'Launcher membuka halaman installer resmi. Instal, tunggu hingga siap, lalu buka kembali Phynite Compute.')],
            [t('No code appears', 'Kode belum muncul'), t('Allow the first runtime download to finish. Reopen the launcher, or use Show service logs under Advanced manual setup.', 'Tunggu unduhan runtime pertama selesai. Buka kembali launcher atau gunakan Tampilkan log layanan pada Setup manual lanjutan.')],
            [t('Code expired or was used', 'Kode kedaluwarsa atau telah digunakan'), t('Reopen the launcher to request and open the latest code.', 'Buka kembali launcher untuk meminta dan membuka kode terbaru.')],
            [t('Approved, but still Offline', 'Disetujui, tetapi masih Offline'), t('First-time library setup can take several minutes. Check service logs and refresh the connection afterward.', 'Setup pustaka pertama dapat memerlukan beberapa menit. Periksa log layanan lalu perbarui koneksi.')],
            [t('Job stays queued', 'Job tetap antre'), t('Check Connected status, Your computer destination, and completed dependencies. Do not submit a duplicate.', 'Periksa status Terhubung, tujuan Komputer Anda, dan dependensi selesai. Jangan kirim duplikat.')],
            ['OOMKilled / exit 137', t('The calculation exceeded available memory. Reduce system size or bands only where scientifically appropriate.', 'Kalkulasi melebihi memori. Kurangi ukuran sistem atau jumlah band hanya jika sesuai secara ilmiah.')],
          ],
        },
        links: [
          { label: t('Contact support', 'Hubungi dukungan'), href: '/contact' },
          { label: t('Calculation diagnostics', 'Diagnosis kalkulasi'), href: guidePath(locale, 'diagnostics') },
        ],
      },
      {
        title: t('Advanced manual diagnostics', 'Diagnostik manual lanjutan'),
        paragraphs: [t('Normal setup does not require Terminal or PowerShell. Support may ask you to run the pinned command or read recent service logs. These commands use the same read-only, non-root Docker runtime as the launcher.', 'Setup normal tidak memerlukan Terminal atau PowerShell. Dukungan mungkin meminta Anda menjalankan perintah bertanda versi atau membaca log layanan terbaru. Perintah ini memakai runtime Docker read-only dan non-root yang sama dengan launcher.')],
        code: `${personalComputeCommand()}\n${personalComputeLogs}`,
        note: t('Do not change the image reference, share the private volume, or paste connection codes into support messages.', 'Jangan mengubah referensi image, membagikan volume privat, atau menempelkan kode koneksi dalam pesan dukungan.'),
      },
      {
        title: t('Access, data, and scientific checks', 'Akses, data, dan pemeriksaan ilmiah'),
        paragraphs: [
          t('The isolated service receives only calculations belonging to the account that approved its code. Disconnecting revokes access. No incoming port, Docker socket, or host home folder is shared.', 'Layanan terisolasi hanya menerima kalkulasi milik akun yang menyetujui kodenya. Pemutusan koneksi mencabut akses. Tidak ada port masuk, socket Docker, atau direktori home host yang dibagikan.'),
          t('The runtime uses a read-only image, dedicated storage volume, non-root user, and CPU, memory, and process limits. It requires outgoing internet access for Phynite and verified library downloads.', 'Runtime memakai image read-only, volume penyimpanan khusus, pengguna non-root, serta batas CPU, memori, dan proses. Runtime memerlukan akses internet keluar untuk Phynite dan unduhan pustaka terverifikasi.'),
          t('Local machine owners can modify their own software. Account binding protects access to other accounts; it does not certify a scientific result. Check convergence, numerical settings, solver versions, and pseudopotentials before publication.', 'Pemilik komputer dapat memodifikasi perangkat lunaknya sendiri. Ikatan akun melindungi akses ke akun lain; ini tidak mensertifikasi hasil ilmiah. Periksa konvergensi, pengaturan numerik, versi solver, dan pseudopotensial sebelum publikasi.'),
        ],
        links: [
          { label: t('Convergence studies', 'Studi konvergensi'), href: guidePath(locale, 'convergence') },
          { label: t('Prepare publication figures', 'Menyiapkan figur publikasi'), href: guidePath(locale, 'publication') },
        ],
      },
    ],
  };
}

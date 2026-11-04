# Panduan Pengguna Phynite Lab

Panduan ini menjelaskan antarmuka yang diimplementasikan. Gunakan bersama dokumentasi solver dan uji konvergensi. Gambar disajikan dari aset dokumentasi publik; koneksi internet diperlukan untuk memuat gambar pada file Markdown.

- [Mulai di sini: dari instalasi hingga hasil lokal pertama](#getting-started)
- [Dari struktur hingga figur paper](#workflow)
- [Instal, perbarui, dan diagnosis aplikasi npm](#npm-local-app)
- [Compute npm lokal dan worker hosted](#local-compute)
- [Project, struktur, dan riwayat kalkulasi](#project)
- [Mengimpor dan memeriksa struktur](#structure)
- [Mengedit atom dan geometri sel](#edit)
- [Arah periodik, vakum, dan dimensionalitas](#periodicity)
- [Prosedur: menyiapkan slab dua dimensi](#slab-workflow)
- [Tutorial: kalkulasi silikon pertama](#quickstart-silicon)
- [Memilih dan menghubungkan kalkulasi](#calculation)
- [Mengatur dan memvalidasi Quantum ESPRESSO](#configure)
- [Prosedur: merancang uji konvergensi](#convergence)
- [Eksekusi, sumber daya, dan pembatalan](#execution)
- [Tutorial: simulasi MD lokal pertama](#quickstart-md)
- [Alur MD: Simple, Advanced, dan analisis trajectory](#md-workflows)
- [Koneksi provider AI di komputer Anda](#ai-providers)
- [Phynite Cloud, Cloud Sync, dan compute online](#cloud-sync)
- [Pengaturan, akun, profil, dan pemakaian](#account)
- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Mengelola paket, tagihan, dan pemakaian](#billing)
- [Storage, ekspor, backup, dan state QE besar](#storage-backup)
- [Pengaturan, preferensi, profil, dan pemakaian](#settings-reference)
- [Tampilan, bahasa, dan aksesibilitas](#language)
- [Membuka dan menafsirkan hasil](#results)
- [Histori run, konteks riset, dan bukti](#research-history)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)
- [Studi banyak material dan variasi parameter](#studies)
- [Template, penggantian sumber, dan histori](#reuse)
- [PDOS, unfolding, dan inset](#advanced)
- [Ekspor dan reproduksibilitas figur](#export)
- [Prosedur: menyiapkan figur publikasi](#publication)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Pemecahan masalah dan pemulihan lokal](#local-troubleshooting)
- [Diagnosis: menemukan tahap yang gagal](#diagnostics)
- [Referensi alat dan ikon](#tools-reference)
- [Pintasan keyboard dan pointer](#shortcuts)
- [Referensi: parameter kalkulasi dan satuan](#field-reference)
- [Ketersediaan fitur dan rencana alur](#roadmap)
- [Satuan, istilah, dan sumber ilmiah](#reference)

<a id="getting-started"></a>

## Mulai di sini: dari instalasi hingga hasil lokal pertama

Ikuti checklist ini sekali sebelum memulai studi besar. Panduan memisahkan aplikasi, runtime ilmiah, input fisik, eksekusi, dan bukti tersimpan agar prasyarat yang belum tersedia mudah ditemukan.

<a id="docs-getting-started-1"></a>

### 1. Instal aplikasi

Gunakan Node.js >=22.13.0 dan paket native yang saat ini didukung. macOS Apple Silicon dan Linux ARM64/x64 tersedia; Linux memerlukan glibc >=2.39. Pada Windows, gunakan lingkungan Linux x64 di dalam WSL2. Baca bukti rilis untuk platform yang benar-benar diuji.

Biarkan optional dependencies npm aktif. npm memasang aplikasi dan core native yang cocok; solver ilmiah DFT dan MD dipasang pada langkah berikutnya. Aplikasi lokal publik tidak membutuhkan Docker, Python global, checkout source, atau login Phynite.

```text
node --version
npm install -g phynite-lab@latest
phynite-lab
```

> Biarkan terminal ini berjalan. Browser adalah antarmuka; launcher menjalankan layanan lokal. Ikuti URL loopback aktual yang dicetak launcher bila port 3000 sudah terpakai.

- [Metadata paket npm saat ini](<https://www.npmjs.com/package/phynite-lab>)
- [Source rilis dan bukti pengujian](<https://github.com/phynite-lab/phynite-lab/releases>)

<a id="docs-getting-started-2"></a>

### 2. Kenali workspace

![Workspace lokal tanpa login](<https://phynitelab.com/docs/guide/onboarding-workspace-desktop-light.png>)

Workspace demo lokal nyata. Mulai dengan New project; login Cloud opsional.

1. Buka Workspace lalu pilih New project. Namai studi berdasarkan pertanyaan atau material, misalnya Silicon ground state.
2. Buka project. Canvas menghubungkan modul ilmiah; membuka modul menampilkan editornya. Simpan satu studi yang koheren dalam satu project dan beri nama jelas pada varian material.
3. Gunakan Pengaturan untuk mengonfigurasi komputer ini. Tidak adanya profil saat workspace lokal belum login adalah normal; login provider AI dan Phynite Cloud merupakan koneksi opsional yang terpisah.

- [Kenali alat dan ikon](<#tools-reference>)
- [Project dan catatan kalkulasi](<#project>)

<a id="docs-getting-started-3"></a>

### 3. Siapkan komputer untuk komputasi ilmiah

![Setup runtime ilmiah pada Pengaturan](<https://phynitelab.com/docs/guide/compute-runtime-setup-desktop-light.png>)

Komputer melaporkan runtime terpasang serta status isolasinya sendiri. Nilai Anda bisa berbeda.

1. Buka Pengaturan → Compute. Pastikan sistem operasi dan arsitektur terdeteksi, CPU/RAM tersedia, dan lokasi workspace sesuai.
2. Instal DFT untuk Quantum ESPRESSO, MD/analysis untuk LAMMPS dan analisis native, atau keduanya. Tunggu status instalasi dan pemeriksaan kemampuan aktual; unduhan selesai saja belum membuktikan solver siap.
3. Verifikasi probe isolasi. Jika terblokir, baca diagnosis sistem operasi dan perbaiki prasyaratnya. Jangan mematikan isolasi atau memakai runtime belum terverifikasi untuk melewati pesan.
4. Untuk DFT, instal pustaka SSSP Precision atau Efficiency yang dipilih secara eksplisit pada DFT pseudopotentials, atau sediakan file UPF eksak yang diperlukan input. Untuk MD, pilih force field yang kompatibel dan verifikasi pemetaan elemen, lisensi, serta sumber model.
5. Tetapkan alokasi CPU/RAM dan jumlah job paralel yang kecil untuk latihan pertama. Sisakan ruang bagi sistem operasi dan file sementara. Core lebih banyak tidak menjamin eksekusi lebih cepat.

> Runtime mengikuti --data-dir terpilih. Menginstal di ~/.phynite-lab-dev tidak memasangnya di ~/.phynite-lab. Buka workspace yang benar alih-alih menyalin lingkungan native antarpath.

<a id="docs-getting-started-4"></a>

### 4. Jalankan satu kalkulasi kecil yang dapat diperiksa

1. Impor struktur kecil yang diketahui, periksa spesies, jumlah atom, vektor sel, koordinat, dan satuan, lalu simpan file aslinya. Gunakan tutorial silikon untuk DFT atau argon untuk MD.
2. Tambahkan modul yang diperlukan dan hubungkan sumbernya. Untuk latihan DFT pertama, gunakan SCF / Total energy; untuk MD, periksa satu tahap Simple pendek sebelum menambahkan rangkaian lebih besar.
3. Periksa input eksak yang dihasilkan, metode, pseudopotensial atau force field, sampling, dan pengaturan output. Preset adalah titik awal, bukan bukti konvergensi ilmiah.
4. Pilih Your computer lalu Run. Pada Review run, periksa Compute plan dan daftar prasyarat. Selesaikan pemeriksaan runtime, potential, isolasi, input, atau resource yang terblokir sebelum Start run.
5. Ikuti Run history lalu buka Execution result pada modul. Queued berarti menunggu; Running berarti pekerjaan dimulai; Completed berarti hasil tersimpan tersedia. Buka Execution log dan periksa hasil numerik sebelum menerimanya.

- [Tutorial DFT silikon](<#quickstart-silicon>)
- [Tutorial MD argon](<#quickstart-md>)
- [Histori run dan bukti riset](<#research-history>)

<a id="docs-getting-started-5"></a>

### 5. Simpan, buka kembali, dan lindungi hasil

1. Pertahankan input eksak, struktur asli, identitas solver/runtime, checksum potential, provenance, dan seluruh artefak yang diperlukan kalkulasi lanjutan.
2. Tunggu status penyimpanan aplikasi. Selesaikan atau batalkan job aktif, hentikan launcher, dan buka data directory yang sama untuk memastikan project serta catatan eksekusi tetap tersedia.
3. Ekspor arsip project dan simpan backup terpisah untuk pekerjaan penting. Draft browser, gambar figur, dan Cloud Sync opsional memiliki fungsi berbeda; tidak satu pun membuktikan seluruh file intermediate ilmiah tersimpan.

| Jika ini terjadi | Langkah berikutnya |
| --- | --- |
| Start terblokir atau percobaan langsung gagal | Baca alasan setup/preflight pertama. Log solver tidak diharapkan bila proses solver belum dimulai. |
| Solver yang berjalan gagal | Simpan input, log tail, error, dan artefak tersedia. Periksa error solver pertama, disk, memori, dan model fisik. |
| Project atau runtime seolah hilang setelah restart | Periksa status, doctor, port aktual, dan --data-dir awal sebelum memasang ulang atau menghapus apa pun. |

- [Storage dan backup](<#storage-backup>)
- [Instal, perbarui, dan diagnosis](<#npm-local-app>)

<a id="docs-getting-started-6"></a>

### Topik terkait

- [Dari struktur hingga figur paper](<#workflow>)

<a id="workflow"></a>

## Dari struktur hingga figur paper

Project menampung satu studi material: struktur, pengaturan kalkulasi, riwayat eksekusi, dataset numerik, dan figur yang dapat digunakan kembali. Mulai dari pertanyaan fisik, lalu pilih kalkulasi dan perbandingan yang diperlukan untuk menjawabnya.

<a id="docs-workflow-1"></a>

### Alur kerja lengkap

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

1. Buka aplikasi lokal tanpa login, atau masuk saat memakai website hosted. Workspace menampilkan project dan alat riset; identitas lokal terpisah dari login Phynite Cloud opsional.
2. Pilih Project baru, beri nama yang menjelaskan studi, lalu buka project tersebut. Project juga dapat dibuat dari panel Project di DFT Lab.
3. Impor struktur, bangun sel, atau ambil dari Materials Project. Periksa satuan, vektor kisi, spesies, dan jumlah atom.
4. Periksa geometri ruang nyata. Tentukan arah periodik untuk tampilan dan tambahkan vakum secara eksplisit bila model slab, kawat, atau molekul membutuhkannya.
5. Buka Calculate dan tambahkan Total energy atau Structural relaxation. Periksa input, okupansi, pseudopotensial, cutoff, dan mesh k.
6. Pilih tujuan komputasi. Aplikasi npm memakai runtime pada Pengaturan → Komputasi untuk Komputer Anda; website hosted memakai worker pribadi terhubung. Phynite Cloud opsional memakai Quanta atau grant pilot serta profil CPU/RAM yang tersedia.
7. Jalankan dan ikuti Log. Status Completed tidak otomatis berarti hasil konvergen secara fisik; periksa energi, gaya, konvergensi, dan pesan solver.
8. Tambahkan kalkulasi band, DOS, fonon, atau transport sesuai kebutuhan. Pilih hasil relaksasi yang kompatibel sebagai sumber struktur bila diperlukan.
9. Pada hasil yang memiliki data plot, pilih Open in Figure Lab. Figur aktif yang sudah memakai hasil tersebut dibuka kembali, atau data numeriknya diimpor untuk membuat figur.
10. Atur perbandingan, referensi energi, dimensi fisik, dan tipografi. Tunggu status penyimpanan di editor Figure Lab, lalu ekspor figur dan Source package.

<a id="docs-workflow-2"></a>

### Pembagian fungsi halaman

| Halaman | Fungsi |
| --- | --- |
| Workspace | Membuat dan mencari project, melanjutkan studi, membuka alat riset. |
| DFT Lab / Project | Mengatur project, struktur, dan variasi material. |
| DFT Lab / Inspect | Memeriksa dan mengubah geometri. |
| DFT Lab / Calculate | Mengatur kalkulasi, dependensi, eksekusi, dan log. |
| Figure Lab | Membandingkan data, mengatur panel, dan mengekspor figur. |
| Pengaturan | Halaman tampilan, notifikasi, keyboard, compute, akun provider AI, Akun, Pemakaian, dan Penyimpanan terpisah. |
| Tagihan | Pembelian cloud serta faktur pada website Phynite; mode lokal membuka situs hosted. |

<a id="docs-workflow-3"></a>

### Sebelum menyebut hasil final

- Catat sumber struktur dan sel komputasi untuk setiap run.
- Uji cutoff, mesh k/q, vakum, smearing, dan toleransi solver terhadap besaran yang akan dilaporkan.
- Periksa satuan dan titik nol energi sebelum membuat overlay.
- Simpan input yang benar-benar dieksekusi serta sumber numerik bersama figur.
- Jelaskan fungsional, keluarga pseudopotensial, perlakuan spin, dan normalisasi dalam metode paper.

<a id="docs-workflow-4"></a>

### Topik terkait

- [Mulai di sini: dari instalasi hingga hasil lokal pertama](<#getting-started>)

<a id="npm-local-app"></a>

## Instal, perbarui, dan diagnosis aplikasi npm

Aplikasi npm publik adalah jalur local-first untuk menjalankan workspace, DFT, MD, dan analisis native di komputer Anda. Login Phynite, Docker, checkout source, dan Python global tidak diperlukan.

<a id="docs-npm-local-app-1"></a>

### Instal dan jalankan

![Workspace lokal tanpa login](<https://phynitelab.com/docs/guide/onboarding-workspace-desktop-light.png>)

Workspace demo lokal nyata. Mulai dengan New project; login Cloud opsional.

![Logo Phynite Lab](<https://phynitelab.com/brand/phynite-mark-dark.png>)

Launcher lokal membuka workspace di komputer Anda.

Paket publik saat ini adalah phynite-lab@0.1.11. Gunakan Node.js dengan versi yang memenuhi >=22.13.0. npm memasang launcher dan paket aplikasi native opsional yang sesuai dengan OS serta CPU.

Pastikan optional dependencies npm tidak dinonaktifkan. Jika paket dipasang dengan --omit=optional atau paket platform dihapus, launcher menampilkan error runtime yang hilang dan tidak diam-diam memakai fixture development.

Launcher mengikat layanan ke loopback, membuka browser, dan menyimpan workspace lokal di ~/.phynite-lab. Project serta runtime pengguna berada di luar direktori instalasi npm.

```text
npm install -g phynite-lab@latest
phynite-lab
```

<a id="docs-npm-local-app-2"></a>

### Platform yang didukung

| Platform | Paket/runtime | Catatan |
| --- | --- | --- |
| macOS Apple Silicon | darwin-arm64 | Paket native arm64. |
| Linux ARM64 | linux-arm64 | Memerlukan glibc >=2.39 dan user namespace yang tersedia. |
| Linux x64 | linux-x64 | Memerlukan glibc >=2.39 (seperti Ubuntu 24.04+, Arch Linux) dan user namespace yang tersedia. |
| Windows | WSL2 linux-x64 | Jalankan npm dan phynite-lab di dalam WSL2; solver native Windows tidak dipasang. |

> Paket mendeklarasikan target darwin/linux dan arm64/x64. Platform didukung setelah runtime native, probe isolasi, dan pemeriksaan scientific-nya lulus; tersedianya paket saja bukan bukti kualifikasi.

<a id="docs-npm-local-app-3"></a>

### Perintah launcher dan identitas workspace

Perintah biasa menjalankan service di foreground. --no-open mencetak URL loopback tanpa membuka browser. --port meminta port tertentu; bila sudah dipakai, launcher memilih port loopback yang tersedia dan mencetak origin aktual. --data-dir memberi setiap workspace database, project, runtime, dan log sendiri.

status melaporkan instance sehat untuk data directory tersebut. stop meminta instance workspace berhenti dengan tertib. doctor memeriksa identitas distribusi, kesiapan service, path data, dan diagnosis startup. Menjalankan workspace yang sama lagi memakai instance sehat yang ada, bukan membuat duplikat.

```text
phynite-lab --no-open --port 3000 --data-dir /path/to/workspace
phynite-lab status --data-dir /path/to/workspace
phynite-lab doctor --data-dir /path/to/workspace
phynite-lab stop --data-dir /path/to/workspace
```

<a id="docs-npm-local-app-4"></a>

### Perbarui tanpa menghapus project

Aplikasi lokal dapat menampilkan notifikasi update setelah memeriksa https://registry.npmjs.org/phynite-lab/latest. Pemeriksaan berhasil disimpan maksimal enam jam; response tidak tersedia atau tidak valid dicoba lagi sekitar lima menit. Pemeriksaan tidak mengirim data project atau kredensial, tidak memasang update otomatis, dan tidak memblokir pekerjaan lokal saat offline.

1. Selesaikan atau batalkan job aktif lalu hentikan instance.
2. Jalankan perintah update npm dari instalasi Node yang sama dengan pemilik paket global.
3. Buka aplikasi lagi dan cek Pengaturan → Komputasi untuk memastikan kemampuan runtime tetap tersedia.
4. Jika startup gagal, jalankan phynite-lab doctor dan baca log di data directory; memasang ulang paket tidak menghapus ~/.phynite-lab.

```text
npm install -g phynite-lab@latest
phynite-lab --version
```

<a id="docs-npm-local-app-5"></a>

### Perbaikan startup npm yang umum

| Gejala | Periksa |
| --- | --- |
| Versi Node ditolak | Jalankan node --version dan gunakan versi Node.js yang memenuhi >=22.13.0. |
| Paket runtime hilang | Pasang ulang dengan optional dependencies aktif dan cek target paket melalui doctor. |
| Port sudah dipakai | Gunakan --no-open, ikuti port yang dicetak, atau pilih --port yang kosong. |
| Project tidak terlihat | Gunakan --data-dir yang sama; setiap directory adalah workspace terpisah. |
| Service berhenti saat startup | Jalankan status dan doctor lalu baca logs/<service>.log di data directory. |
| Update tidak tersedia | Lanjutkan offline, cek npm/jaringan nanti, lalu coba lagi; notifikasi bersifat informatif. |

- [Referensi distribusi lokal](<#local-compute>)
- [Pemecahan masalah dan pemulihan](<#troubleshooting>)

<a id="docs-npm-local-app-6"></a>

### Topik terkait

- [Compute npm lokal dan worker hosted](<#local-compute>)

<a id="local-compute"></a>

## Compute npm lokal dan worker hosted

Aplikasi npm lokal menjalankan DFT, MD, dan analisis melalui runtime native tanpa login Phynite atau Docker. Setup berada di Pengaturan → Komputasi. Website hosted memakai alur worker terhubung yang berbeda, dijelaskan setelah bagian native; worker hosted bukan fallback runtime untuk aplikasi npm.

<a id="docs-local-compute-1"></a>

### Pilih jalur eksekusi

![Batas data workspace lokal, Cloud Sync project, dan compute cloud](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-id-light.png>)

Diagram konsep: login, sync project, dan transfer job adalah pilihan terpisah.

| Jalur | Kebutuhan | Perilaku data |
| --- | --- | --- |
| Komputer Anda / aplikasi npm | Node.js, runtime native, potential, dan probe isolasi. | Project dan hasil tetap di data directory lokal yang dipilih. |
| Personal worker hosted | Login Cloud, worker berpasangan, dan kebutuhan worker hosted. | Artefak project/job mengikuti akun dan aturan retensi hosted. |
| Compute Phynite Cloud | Akun Cloud, katalog yang didukung, kuota, dan review transfer. | Hanya input job yang direview yang ditransfer; ini tidak mengaktifkan Cloud Sync. |

<a id="docs-local-compute-2"></a>

### Aplikasi native: instal dan buka

![Setup runtime ilmiah pada Pengaturan](<https://phynitelab.com/docs/guide/compute-runtime-setup-desktop-light.png>)

Komputer melaporkan runtime terpasang serta status isolasinya sendiri. Nilai Anda bisa berbeda.

Gunakan Node.js 22.13 atau lebih baru. Launcher membuka browser pada loopback dan menyimpan database, project, artefak, runtime, serta log di ~/.phynite-lab. Paket publik lengkap menyertakan core native; tidak memerlukan checkout source, Python global, Docker, AWS CLI, atau akun Phynite.

Buka Pengaturan → Komputasi. Periksa platform terdeteksi, CPU/RAM, kemampuan solver terpasang, dan probe isolasi. Pilih DFT, MD/analisis, atau keduanya. Internet diperlukan untuk unduhan terverifikasi pertama; eksekusi ilmiah lokal dapat berjalan offline setelah runtime dan potensial wajib tersedia.

Unduhan memakai versi serta checksum terkunci, staging, dan aktivasi atomik. Pembaruan gagal mempertahankan runtime sebelumnya. Pilih file potensial sesuai lisensi, identitas eksak, checksum, dan pemetaan unsur.

```text
npm install -g phynite-lab
phynite-lab
```

- [Buka Komputasi](<https://phynitelab.com/account/compute>)

<a id="docs-local-compute-3"></a>

### Aplikasi native: resource, job, dan pemulihan

1. Atur default CPU, anggaran RAM, dan job paralel pada Komputasi. Default mulai dari satu job, sekitar setengah core logis, dan maksimum setengah RAM fisik. Default baru berlaku untuk job berikutnya; override job tidak mengubah job aktif.
2. Mulai dengan kalkulasi referensi kecil. Pilih Komputer Anda dan periksa Log sampai status akhir. Verifikasi keberhasilan solver, konvergensi, input, provenance, dan output numerik sebelum menafsirkan hasil.
3. LAMMPS Guided dan manual mempertahankan pengaturan fisik terpilih. Input manual juga memerlukan probe sandbox native berhasil. Bila isolasi tidak tersedia, ikuti perbaikan yang ditampilkan; eksekusi manual tetap diblokir.
4. Pertahankan CLI berjalan dan komputer aktif. Batalkan melalui log job dan tunggu status akhir. Setelah crash atau restart, periksa job terinterupsi; job tidak dijalankan ulang otomatis. Anggaran RAM yang dipantau tidak disebut hard limit sistem operasi.

```text
phynite-lab status
phynite-lab doctor
phynite-lab stop
```

<a id="docs-local-compute-4"></a>

### Kalkulasi lokal pertama: alur aman paling singkat

1. Instal dan jalankan aplikasi, lalu buka Pengaturan → Komputasi.
2. Instal DFT atau MD/analisis, atau keduanya. Tunggu unduhan bertanda versi, verifikasi checksum, dan aktivasi atomik selesai.
3. Pastikan kemampuan solver terdeteksi dan probe isolasi native berhasil. LAMMPS manual tetap tidak tersedia bila probe gagal.
4. Instal file pseudopotensial atau potential yang diperlukan unsur terpilih dan catat identitas serta checksum eksaknya.
5. Pada tinjauan run pilih Komputer Anda, kirim kalkulasi referensi kecil, dan tunggu status akhir.
6. Baca status antrean dan eksekusi, error solver pertama bila ada, penanda konvergensi, provenance, checksum, dan hasil numerik sebelum memperbesar kalkulasi.

- [Setup komputasi](<https://phynitelab.com/account/compute>)
- [Diagnosis kalkulasi](<#diagnostics>)

<a id="docs-local-compute-5"></a>

### Aplikasi native: data, preferensi, dan koneksi opsional

Data SQLite dan filesystem adalah salinan lokal utama. Gunakan Pengaturan → Penyimpanan untuk ekspor/impor arsip project dan simpan backup terpisah. Storage browser menampung draft pemulihan serta preferensi perangkat, bukan seluruh workspace native.

Tampilan, bahasa, pintasan keyboard, dan pilihan notifikasi lokal tetap pada browser ini. Koneksi provider AI memakai CLI resmi Codex atau Antigravity; setiap provider memiliki satu koneksi yang dikelola CLI dan aplikasi lokal tidak memiliki setup gateway. Akun mengelola Phynite Cloud secara terpisah; login tidak mengunggah project. Cloud Sync diaktifkan per project, dan compute cloud meninjau transfer input sendiri tanpa mengaktifkan sync.

Tagihan membuka website Phynite. Selesaikan atau batalkan job, hentikan aplikasi, perbarui dengan npm install -g phynite-lab@latest, lalu buka kembali. Pembaruan paket mempertahankan data di luar direktori instalasi.

<a id="docs-local-compute-6"></a>

### Penyimpanan lokal dan state Quantum ESPRESSO yang besar

Workspace lokal default adalah ~/.phynite-lab; gunakan phynite-lab --data-dir /path/to/workspace bila disk lain lebih sesuai. SQLite menyimpan metadata dan filesystem menyimpan artefak project, instalasi runtime, serta log. Halaman Penyimpanan hanya mengukur artefak project yang terinventarisasi; metadata database, instalasi solver/runtime, log, dan file lain di disk tidak termasuk angka itu.

Mode lokal tidak memiliki kuota tetap 10 GiB dan tidak melakukan pembersihan otomatis tujuh hari. Batas praktisnya adalah ruang kosong pada disk yang dipilih; installer runtime dan log tetap memakai disk walau tidak masuk inventaris. Ekspor/impor arsip project dan backup terpisah wajib untuk data penting.

Pengaturan disk_io Quantum ESPRESSO dan state intermediate dapat jauh lebih besar daripada output akhir. Data wavefunction dan tmp mungkin diperlukan untuk band, DOS, phonon, workflow projected, atau interoperabilitas eksternal. Jangan menghapus state intermediate sebelum semua workflow lanjutan selesai; simpan input eksak, identitas/checksum pseudopotensial, provenance, dan artefak state bersama-sama.

Wannier90 adalah workflow eksternal/manual kecuali ada integrasi native yang didokumentasikan terpisah. Ekspor state Quantum ESPRESSO yang diperlukan dan ikuti dokumentasi resmi Wannier90; Phynite tidak menyatakan menjalankan tool itu secara native di sini.

| Dihitung oleh Penyimpanan lokal | Tidak dihitung oleh Penyimpanan lokal |
| --- | --- |
| Input project, struktur, konfigurasi, hasil, trajectory, dan artefak ekspor yang terinventarisasi. | Metadata SQLite, file instalasi solver/runtime, log, cache browser, dan file lain yang tidak terkait project di disk. |
| Artefak selesai yang dipertahankan di project, termasuk state QE besar bila direkam di sana. | Ruang kosong yang dipakai sistem operasi atau aplikasi lain. |

- [Pengaturan penyimpanan](<https://phynitelab.com/account/storage>)
- [Quantum ESPRESSO documentation](<https://www.quantum-espresso.org/documentation/>)
- [Wannier90 documentation](<https://wannier.org/documentation/>)

<a id="docs-local-compute-7"></a>

### Website hosted: hubungkan worker pribadi

Instruksi kode koneksi, aplikasi pendamping, dan Docker berikut berlaku saat memakai website Phynite hosted. Aplikasi npm native tidak memerlukannya. Worker ini menerima job hosted dan mengunggah hasil ke akun yang sedang masuk.

<a id="docs-local-compute-8"></a>

### Rencanakan, tinjau, pantau, bandingkan

1. Buka Resource dari sidebar workspace, rail saat sidebar ditutup, atau Pilihan workspace pada layar kecil. Periksa Quanta tersedia setelah reservasi, penyimpanan pada pengukuran inventaris terakhir, CPU/RAM, dan perkiraan jam Cloud yang dapat dibiayai. Angka ini adalah kapasitas satu job baru pada tarif profil berbayar terpilih, termasuk durasi minimum tagihan; bukan ETA selesai. Grant pilot memiliki batas job/waktu terpisah.
2. Tinjau run sebelum mulai. Pilihan run mengungguli default akun workload tersebut, lalu default layanan yang berlaku. Jadikan default menyimpan pilihan untuk run berikutnya secara eksplisit. Perkiraan durasi membantu menghitung anggaran; tidak mengubah timeout eksekusi yang diberlakukan.
3. Pantau job aktif terpilih: antre, persiapan, compute, dan penyimpanan hasil. Elapsed dimulai pada waktu mulai tercatat, dan setiap job memiliki waktunya sendiri. Penyelesaian mencakup unggah hasil. Data resource diperbarui setiap 15 detik saat ada job aktif atau 60 detik saat idle; kegagalan refresh mempertahankan nilai terakhir.
4. Bandingkan run pendek yang representatif pada beberapa alokasi CPU sebelum kampanye besar. Pertahankan input ilmiah yang sama saat membandingkan performa. Lebih banyak core tidak selalu lebih cepat: skalabilitas Quantum ESPRESSO bergantung pada sistem dan pembagian kerja paralel, sementara LAMMPS menyarankan pengukuran workload aktual. Phynite tidak menjalankan benchmark berbayar secara otomatis.

| Metrik | Arti |
| --- | --- |
| Wall time run | Waktu selesai dikurangi waktu mulai tercatat, mencakup persiapan dan unggah hasil; antre sebelum mulai tidak dihitung. |
| Waktu solver / analisis | Durasi compute terukur yang dilaporkan ke ledger Phynite. Tagihan berbayar mengikuti ledger dan tarif profil, dengan minimum per job; kebijakan tagihan HPC lain tidak menentukan tagihan Phynite. |
| CPU-hours | Jam wall time run tercatat dikalikan vCPU yang dilaporkan worker, atau grant Cloud bila laporan worker tidak tersedia. Job personal tanpa laporan alokasi runtime dikecualikan dan ditandai parsial, tidak diasumsikan satu core. |
| GPU / VRAM | GPU belum didukung runtime ini. Telemetri VRAM yang tidak tersedia ditampilkan belum dilaporkan. Durasi, alokasi, atau biaya historis yang tidak tercatat ditampilkan tidak tersedia, bukan nol. |

- [Default compute](<https://phynitelab.com/account/compute>)
- [Pemakaian dan catatan run](<https://phynitelab.com/account/usage>)
- [NERSC: resource accounting](<https://docs.nersc.gov/policies/resource-usage/>)
- [Quantum ESPRESSO: parallelization](<https://www.quantum-espresso.org/Doc/pw_user_guide/node18.html>)
- [LAMMPS: measure performance](<https://docs.lammps.org/stable/Speed_measure.html>)

<a id="docs-local-compute-9"></a>

### Worker website: sebelum memulai

Pilih CPU dan RAM per job pada pengaturan Compute atau drawer workspace, sesuai batas DFT, simulasi MD, atau analisis MD yang ditampilkan. Alokasi adalah resource yang diminta job. Worker baru juga melaporkan alokasi CPU/RAM yang diteruskan ke runtime saat diluncurkan; ini bukan utilisasi perangkat. Kebutuhannya bergantung pada atom, cutoff, k-point, band, dan jenis kalkulasi.

Sediakan beberapa GB ruang disk untuk runtime terverifikasi dan pustaka ilmiah, serta ruang kerja hasil. Internet diperlukan untuk menghubungkan akun, menerima kalkulasi, dan mengunggah hasil.

| Komputer | Unduhan | Buka |
| --- | --- | --- |
| macOS | Phynite Compute for macOS | Open Phynite Compute.command |
| Windows 10 / 11 | Phynite Compute for Windows | Open Phynite Compute.cmd |
| Linux | Phynite Compute for Linux | ./phynite-compute |

- [Unduh Phynite Compute](<https://phynitelab.com/account/compute#your-computer>)

<a id="docs-local-compute-10"></a>

### 1. Unduh dan buka

1. Buka Komputer Anda dari menu avatar. Website merekomendasikan unduhan yang sesuai dengan sistem operasi; tautan untuk sistem lain tetap tersedia.
2. Ekstrak ZIP lalu buka launchernya. Aplikasi pendamping memeriksa engine lokal dan hanya membuka halaman installer resminya ketika prasyarat tersebut belum tersedia.
3. Setup pertama mengunduh runtime ilmiah bertanda versi yang sesuai dengan arsitektur. Sesi berikutnya menggunakannya kembali dan mempertahankan volume privat Phynite Compute.

- [Buka Komputer Anda](<https://phynitelab.com/account/compute#your-computer>)

<a id="docs-local-compute-11"></a>

### 2. Setujui komputer ini

1. Launcher kembali ke Komputer Anda dengan Kode koneksi 12 digit yang sudah terisi. Periksa halaman lalu pilih Hubungkan komputer.
2. Setiap kode hanya dapat dipakai sekali dan berlaku 10 menit. Setujui hanya komputer milik Anda.
3. Jika komputer lain sudah terhubung, selesaikan atau batalkan kalkulasi aktif sebelum mengonfirmasi penggantian.
4. Setelah disetujui, Phynite Compute mengunduh dan memverifikasi pustaka ilmiah. Tunggu hingga status web berubah menjadi Terhubung. Satu koneksi tersebut mengaktifkan DFT Lab dan MD Lab.

> Kode sementara memberi akses pada satu komputer tanpa mengekspos kredensial privatnya.

<a id="docs-local-compute-12"></a>

### 3. Jalankan kalkulasi pertama

1. Buka DFT Lab dan mulai dengan kalkulasi Total energy silikon kecil. Pilih Komputer Anda sebagai tujuan komputasi.
2. Periksa log eksekusi. Job yang antre menunggu komputer terhubung dan dependensi sebelumnya. Satu kalkulasi berjalan pada satu waktu di komputer ini.
3. Untuk hasil SCF yang berhasil, periksa konvergensi, JOB DONE, dan status akhir Completed. Penyelesaian juga memerlukan unggah hasil.
4. Buka Figure Lab dari hasil selesai. Datanya tetap terhubung dengan project, kalkulasi sumber, dan pengaturan numerik.
5. Buka MD Lab lalu jalankan equilibration Lennard-Jones kecil. MD memakai komputer terhubung yang sama dan tidak memerlukan pairing kedua.

- [Tutorial silikon](<#quickstart-silicon>)
- [Membaca log eksekusi](<#execution>)

<a id="docs-local-compute-13"></a>

### Penggunaan harian

Volume privat Phynite Compute menyimpan koneksi dan pustaka yang diunduh. Pertahankan komputer aktif dan internet tersedia selama kalkulasi berjalan; website boleh ditutup.

Menghentikan engine lokal atau menidurkan komputer dapat menginterupsi kalkulasi. Pulihkan koneksi dan periksa status job sebelum mengirim duplikat. Artefak project lokal tetap berada di disk data terpilih sampai Anda menghapus atau mengekspornya; retensi dan Trash hosted worker adalah aturan terpisah.

| Tindakan | Lokasi |
| --- | --- |
| Buka atau mulai ulang Phynite Compute | Buka kembali launcher yang diunduh |
| Periksa koneksi | Komputer Anda pada menu akun |
| Lihat pesan teknis | Setup manual lanjutan → Tampilkan log layanan |
| Batalkan kalkulasi | Gunakan Cancel pada log eksekusi dan tunggu status akhirnya |

<a id="docs-local-compute-14"></a>

### Memperbarui, memutus, atau memindahkan komputer

1. Selesaikan atau batalkan kalkulasi aktif sebelum pembaruan, penggantian, atau pemutusan.
2. Untuk memperbarui, unduh dan buka launcher terbaru. Launcher meminta konfirmasi sebelum mengganti runtime dan mempertahankan volume privat.
3. Untuk memindahkan komputer, putuskan komputer lama pada Komputer Anda, unduh Phynite Compute di perangkat baru, lalu setujui kode barunya.

> Satu kredensial komputer pribadi aktif didukung per akun. Jangan menyalin atau membagikan volume runtime privat.

<a id="docs-local-compute-15"></a>

### Pemecahan masalah

| Yang terlihat | Yang perlu dilakukan |
| --- | --- |
| Engine lokal belum tersedia | Launcher membuka halaman installer resmi. Instal, tunggu hingga siap, lalu buka kembali Phynite Compute. |
| Kode belum muncul | Tunggu unduhan runtime pertama selesai. Buka kembali launcher atau gunakan Tampilkan log layanan pada Setup manual lanjutan. |
| Kode kedaluwarsa atau telah digunakan | Buka kembali launcher untuk meminta dan membuka kode terbaru. |
| Disetujui, tetapi masih Offline | Setup pustaka pertama dapat memerlukan beberapa menit. Periksa log layanan lalu perbarui koneksi. |
| Job tetap antre | Periksa status Terhubung, tujuan Komputer Anda, dan dependensi selesai. Jangan kirim duplikat. |
| Setup/preflight ditolak sebelum solver mulai | Tidak ada log solver karena runtime belum mulai. Baca pesan kemampuan, isolasi, potential, atau validasi input yang terlihat, perbaiki prasyarat, lalu kirim sekali. |
| Solver mulai lalu gagal | Buka log eksekusi dan error solver pertama, pertahankan provenance serta artefak gagal, lalu periksa memori/disk/konvergensi sebelum mengubah input ilmiah. |
| OOMKilled / exit 137 | Kalkulasi melebihi memori. Kurangi ukuran sistem atau jumlah band hanya jika sesuai secara ilmiah. |

- [Hubungi dukungan](<https://phynitelab.com/contact>)
- [Diagnosis kalkulasi](<#diagnostics>)

<a id="docs-local-compute-16"></a>

### Worker website: diagnostik Docker lanjutan

Setup normal tidak memerlukan Terminal atau PowerShell. Dukungan mungkin meminta Anda menjalankan perintah bertanda versi atau membaca log layanan terbaru. Perintah ini memakai runtime Docker read-only dan non-root yang sama dengan launcher.

```text
docker run -d --name phynite-compute --restart unless-stopped --init --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --cpus 4 --memory 8g --tmpfs /tmp:rw,size=512m -v phynite-compute:/state public.ecr.aws/p8i3a1t8/phynite/personal-compute@sha256:2e478dd301384eaa9ea754fcf6630de7fe7ad1ccb114fb5f5c5d8dba3d49a185
docker logs --tail 30 phynite-compute
```

> Jangan mengubah referensi image, membagikan volume privat, atau menempelkan kode koneksi dalam pesan dukungan.

<a id="docs-local-compute-17"></a>

### Akses, data, dan pemeriksaan ilmiah

Layanan terisolasi hanya menerima kalkulasi milik akun yang menyetujui kodenya. Pemutusan koneksi mencabut akses. Tidak ada port masuk, socket Docker, atau direktori home host yang dibagikan.

Runtime memakai image read-only, volume penyimpanan khusus, pengguna non-root, serta batas CPU, memori, dan proses. Runtime memerlukan akses internet keluar untuk Phynite dan unduhan pustaka terverifikasi.

Pemilik komputer dapat memodifikasi perangkat lunaknya sendiri. Ikatan akun melindungi akses ke akun lain; ini tidak mensertifikasi hasil ilmiah. Periksa konvergensi, pengaturan numerik, versi solver, dan pseudopotensial sebelum publikasi.

- [Studi konvergensi](<#convergence>)
- [Menyiapkan figur publikasi](<#publication>)

<a id="docs-local-compute-18"></a>

### Topik terkait

- [Instal, perbarui, dan diagnosis aplikasi npm](<#npm-local-app>)

<a id="project"></a>

## Project, struktur, dan riwayat kalkulasi

Gunakan satu project untuk satu studi yang berkaitan. Simpan variasi material sebagai struktur terpisah dengan nama jelas. Pengaturan kalkulasi dapat diedit; setiap eksekusi menyimpan riwayat input yang dikirim.

<a id="docs-project-1"></a>

### Membuat project dari Workspace

![Membuat project demo netral](<https://phynitelab.com/docs/guide/new-project-desktop-light.png>)

Gunakan nama yang mengidentifikasi studi.

1. Tunggu Workspace akun selesai dimuat, lalu pilih Project baru.
2. Isi nama, misalnya Respons strain MoS2. Nama wajib diisi, maksimal 100 karakter; deskripsi opsional maksimal 500 karakter.
3. Pilih Buat project. Project tampil di daftar dan dapat langsung dibuka melalui konfirmasi.
4. Buka project untuk menambahkan struktur. Project kosong tidak menjalankan kalkulasi atau memakai kapasitas worker.
5. Gunakan pencarian untuk nama project, deskripsi, atau rumus kimia struktur utama. Urutkan berdasarkan edit terakhir atau nama.

<a id="docs-project-2"></a>

### Mengatur variasi

1. Berikan nama yang menjelaskan kondisi, misalnya MoS2 strain -2%, 0%, dan +2%.
2. Tambahkan tumpukan kalkulasi di bawah setiap struktur.
3. Duplikasikan konfigurasi untuk memakai metode serupa pada variasi lain, lalu periksa parameter yang perlu berubah.
4. Gunakan menu project atau struktur untuk mengganti nama dan menduplikasi. Periksa konfirmasi sebelum menghapus.

<a id="docs-project-3"></a>

### Identitas data

Struktur lokal, struktur yang diunggah, dan kalkulasi yang sudah dikirim merupakan record berbeda yang saling terkait. Mengedit struktur saat ini tidak mengubah input historis run yang selesai.

Figur merujuk dataset numerik dengan identitas tersendiri. Mengganti data di figur merupakan tindakan eksplisit; perubahan metadata sumber tidak diam-diam mengubah perbandingan yang telah disimpan.

URL project dan tampilan Figure Lab dipertahankan saat halaman dibuka kembali. Tautan project yang sudah tidak tersedia tidak boleh dianggap sebagai figur project lain.

> Pengulangan sel di viewport hanya tampilan. Menambah jumlah sel yang terlihat tidak otomatis menambah atom dalam sel komputasi.

<a id="docs-project-4"></a>

### Membuka project lama

Tautan project lokal lama dikenali dan dimigrasikan ke Canvas saat tujuan belum memiliki revisi tersimpan. Konfigurasi lama yang persis serta riwayat run dipertahankan; revisi Canvas yang sudah ada tidak ditimpa.

Jika layanan workflow atau project terkait tidak tersedia, salinan lokal yang terverifikasi dapat dibuka di editor awal. Kegagalan lain tetap menampilkan error dan dapat menawarkan Buka editor awal saat tersedia salinan lokal yang cocok. Jangan menghapus data browser untuk pemecahan masalah; ekspor backup riset penting sebelum melanjutkan pemulihan.

<a id="docs-project-5"></a>

### Topik terkait

- [Mengimpor dan memeriksa struktur](<#structure>)
- [Mengedit atom dan geometri sel](<#edit>)
- [Arah periodik, vakum, dan dimensionalitas](<#periodicity>)

<a id="structure"></a>

## Mengimpor dan memeriksa struktur

Periksa struktur sebagai model fisik sebelum menyiapkan input solver. Visualisasi yang tampak benar belum membuktikan satuan, okupansi, atau sel komputasinya sesuai.

<a id="docs-structure-1"></a>

### Memilih sumber

| Sumber | Pemeriksaan |
| --- | --- |
| CIF | Satuan sel, koordinat fraksional, simetri, dan okupansi situs. Struktur dengan okupansi parsial memerlukan model atomistik yang sesuai. |
| POSCAR / CONTCAR | Faktor skala, urutan unsur, jumlah atom, serta koordinat Direct atau Cartesian. |
| XYZ | Satuan dan informasi sel. XYZ biasa tidak selalu mendefinisikan kisi periodik. |
| Input Quantum ESPRESSO | CELL_PARAMETERS, ATOMIC_POSITIONS, spesies, dan satuan setiap card. |
| Materials Project | Identitas sumber, komposisi, sel standar, dan konvensi basis. |
| DFT Lab | Geometri, jarak antaratom, dan kesesuaian model yang Anda bangun. |

<a id="docs-structure-2"></a>

### Mengimpor file

![Editor struktur dan pemeriksaan sel](<https://phynitelab.com/docs/guide/structure-editor-desktop-light.png>)

Periksa spesies, koordinat, dan sel simulasi sebelum run.

1. Pilih project tujuan.
2. Gunakan Add structure / Import atau seret satu file struktur yang didukung ke DFT Lab.
3. Periksa nama, rumus kimia, jumlah atom, dan parameter sel.
4. Putar struktur dan gunakan pengulangan visual untuk mencari atom yang salah posisi atau tetangga yang tidak wajar.
5. Selesaikan peringatan parser dan okupansi parsial sebelum menjalankan model QE terurut.

<a id="docs-structure-3"></a>

### Mencari database kristal

Buka atau tambahkan modul Crystal structure, lalu pilih Crystal database di dalam editornya untuk mencari record struktur publik. Crystallography Open Database (COD) dapat digunakan tanpa API key; Materials Project membutuhkan MP_API_KEY pada environment server. Pencarian memakai provider yang ditampilkan pada browser, dan kegagalan provider tetap terlihat.

Pilih dan impor record yang dimaksud, lalu periksa rumus kimia, kisi, jumlah atom, okupansi, dan identitas sumber. Struktur database merupakan model awal, bukan bukti bahwa fase, keadaan magnetik, atau pengaturan kalkulasinya sesuai. Properti numerik yang tidak dilaporkan tetap tidak tersedia.

1. Buka modul Crystal structure tujuan lalu pilih Crystal database dari toolbar editornya.
2. Pilih database lalu masukkan rumus kimia, daftar unsur, nama material, atau ID sumber yang didukung.
3. Periksa hasil dan impor satu struktur pilihan ke modul tersebut. Koneksi Kanvas dan identitas modul tetap dipertahankan.
4. Untuk impor dibantu AI, minta Phynite AI mencari database lalu memakai record tertentu. Pencarian hanya membaca; penerapan impor mengikuti mode izin percakapan serta review aksinya.
5. Baca identitas sumber dan checksum hasil impor. Periksa geometri dan pseudopotensial sebelum menghubungkan struktur ke kalkulasi.

> Akses database membutuhkan internet. Kredensial Materials Project tetap di environment server; jangan menempelkan API key ke chat atau menyertakannya dalam ekspor project.

- [Crystallography Open Database](<https://www.crystallography.net/cod/>)
- [Dokumentasi Materials Project](<https://docs.materialsproject.org/>)

<a id="docs-structure-4"></a>

### Koordinat fraksional dan Cartesian

Koordinat fraksional menyatakan r = f1 a + f2 b + f3 c, dengan a, b, c sebagai vektor kisi. Koordinat Cartesian menyatakan posisi pada sumbu ruang nyata dalam satuan panjang.

Mempertahankan koordinat fraksional sambil mengubah kisi dapat meregangkan posisi atom. Mempertahankan koordinat Cartesian menjaga posisi ruang nyata tetapi mengubah representasi fraksionalnya. Pastikan operasi yang dipilih sesuai deformasi yang dimaksud.

Sel primitif dan konvensional dapat merepresentasikan kristal yang sama dengan jumlah atom serta basis resiprok berbeda. Perbedaan ini memengaruhi energi total per sel, lintasan k, dan normalisasi DOS.

<a id="docs-structure-5"></a>

### Informasi yang perlu dipertahankan

- File asli atau identitas database asal.
- Satuan, orientasi, dan pilihan sel primitif/konvensional.
- Komposisi, okupansi, serta perlakuan cacat atau disorder.
- Perubahan yang dilakukan sebelum kalkulasi, termasuk strain, vakum, dan relaksasi.

<a id="docs-structure-6"></a>

### Topik terkait

- [Project, struktur, dan riwayat kalkulasi](<#project>)
- [Mengedit atom dan geometri sel](<#edit>)
- [Arah periodik, vakum, dan dimensionalitas](<#periodicity>)

<a id="edit"></a>

## Mengedit atom dan geometri sel

DFT Lab bekerja di ruang nyata. Pilih alat berdasarkan operasi yang diperlukan dan gunakan koordinat numerik untuk perubahan yang harus presisi.

<a id="docs-edit-1"></a>

### Alat viewport

![Alat edit atom pada editor struktur](<https://phynitelab.com/docs/guide/structure-editor-desktop-light.png>)

Ikon alat bekerja pada struktur terpilih; pengulangan visual tidak mengubah sel simulasi.

| Alat | Fungsi |
| --- | --- |
| Select (V) | Memilih atom untuk inspeksi dan operasi berikutnya. |
| Move (G) | Memindahkan atom terpilih. |
| Add atom (A) | Menambahkan atom dengan spesies dan posisi yang dipilih. |
| Measure (M) | Mengukur jarak atau sudut sesuai mode dan urutan pilihan. |
| Focus (F) | Memusatkan tampilan pada atom terpilih. |
| Delete / Backspace | Menghapus pilihan saat konteks viewport aktif, bukan saat mengetik. |

<a id="docs-edit-2"></a>

### Gerak terkendala

Dalam mode Move, X, Y, atau Z membatasi gerak pada sumbu Cartesian tersebut. Shift+X, Shift+Y, atau Shift+Z menggunakan bidang tegak lurus YZ, XZ, atau XY. Enter menerapkan perpindahan; Escape membatalkan.

Gunakan field koordinat untuk perpindahan eksak. Field numerik mengizinkan draft sementara seperti tanda minus atau eksponen. Enter atau keluar dari field menerapkan nilai valid; Escape mengembalikan nilai sebelumnya.

<a id="docs-edit-3"></a>

### Geometri dibanding tampilan

- Mengubah metrik sel mengubah kisi yang disimulasikan. Periksa apakah deformasinya sesuai strain yang dimaksud.
- Aksi vakum menambah pemisahan normal terhadap bidang a-b sambil mempertahankan jarak atom Cartesian; bukan pembuat slab untuk semua orientasi.
- Ukuran atom, ukuran ikatan, label, cutoff tetangga, dan pengulangan visual mengatur tampilan.
- Undo/redo berlaku untuk operasi editor yang didukung dalam sesi berjalan. Simpan variasi fisik penting sebagai salinan struktur yang jelas.

<a id="docs-edit-4"></a>

### Topik terkait

- [Project, struktur, dan riwayat kalkulasi](<#project>)
- [Mengimpor dan memeriksa struktur](<#structure>)
- [Arah periodik, vakum, dan dimensionalitas](<#periodicity>)

<a id="periodicity"></a>

## Arah periodik, vakum, dan dimensionalitas

Checkbox a, b, dan c menyatakan arah periodik yang dimaksud pada tampilan ruang nyata. Quantum ESPRESSO tetap menggunakan sel simulasi tiga dimensi yang berulang periodik.

<a id="docs-periodicity-1"></a>

### Ketika satu arah dinonaktifkan

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

Menonaktifkan c menghentikan pengulangan visual dan koneksi tetangga periodik pada arah itu; jumlah pengulangannya menjadi satu. Aksi ini tidak memperpendek sel, menghapus vektor c, menambah vakum, atau mengaktifkan koreksi elektrostatik.

Ukuran sel tidak boleh ditebak dari checkbox: ketebalan slab, vakum yang konvergen, dan kondisi elektrostatik berbeda pada setiap studi. Mengubah sel otomatis tanpa konteks dapat mengubah jarak atom atau kerapatan fisik.

> Untuk slab, pertahankan tinggi sel yang finite, tambahkan dan konvergensikan vakum, gunakan satu titik k pada arah nonperiodik, lalu tentukan perlakuan elektrostatik dalam input QE yang dijalankan.

<a id="docs-periodicity-2"></a>

### Sistem umum

| Sistem | Periodisitas tampilan | Pemeriksaan komputasi |
| --- | --- | --- |
| Kristal bulk | a, b, c | Konvergensikan mesh tiga dimensi dan pilih sel yang dimaksud. |
| Slab / lembaran 2D pada a-b | a, b | Vakum tegak lurus, mesh dalam bidang, biasanya satu k sepanjang c; periksa dipol atau isolasi 2D bila sesuai. |
| Kawat sepanjang c | c | Vakum pada kedua arah transversal dan sampling sepanjang kawat. Aksi vakum c saja tidak menyiapkan model ini. |
| Molekul / cluster | Tidak ada | Kotak 3D cukup besar, biasanya sampling Γ; periksa muatan dan dipol. |

<a id="docs-periodicity-3"></a>

### Prosedur slab yang dapat diulang

1. Orientasikan permukaan pada bidang a-b.
2. Nonaktifkan c untuk memperjelas batas tampilan.
3. Tambahkan vakum dan periksa kisi serta posisi atom sebenarnya.
4. Gunakan mesh N × M × 1; tentukan N dan M melalui konvergensi.
5. Periksa perlakuan elektrostatik pada input yang dihasilkan atau expert input.
6. Ulangi dengan vakum lebih besar dan sampling lebih rapat hingga besaran target stabil.

<a id="docs-periodicity-4"></a>

### Topik terkait

- [Project, struktur, dan riwayat kalkulasi](<#project>)
- [Mengimpor dan memeriksa struktur](<#structure>)
- [Mengedit atom dan geometri sel](<#edit>)

<a id="slab-workflow"></a>

## Prosedur: menyiapkan slab dua dimensi

Gunakan prosedur ini untuk lembaran atau slab dengan permukaan pada bidang a-b. Quantum ESPRESSO memerlukan sel tiga dimensi dengan vakum yang terkonvergensi.

<a id="docs-slab-workflow-1"></a>

### Prasyarat geometri

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

- Mulai dari terminasi, komposisi, dan orientasi permukaan yang bermakna secara fisik.
- Periksa koordinat fraksional dan Cartesian. Pada sel miring, ukur vakum normal terhadap permukaan, bukan hanya panjang c.
- Pastikan ketebalan slab dan ikatan lintas batas sesuai model.
- Duplikasikan struktur sebelum mengubah sel agar sumber bulk atau slab awal tetap tersedia.

<a id="docs-slab-workflow-2"></a>

### Menyiapkan model

1. Orientasikan permukaan pada a-b. Periksa vektor kisi, bukan hanya arah kamera.
2. Atur pengulangan sel c ke 1 (misal 2 × 2 × 1) untuk memeriksa perluasan permukaan tanpa mengulang ke arah vakum.
3. Gunakan aksi vakum eksplisit untuk permukaan a-b. Periksa kisi yang diperbarui dan jarak atom Cartesian.
4. Pilih mesh dalam bidang N × M × 1; tentukan N dan M melalui konvergensi.
5. Periksa perlakuan elektrostatik di input yang dihasilkan atau expert input. Slab asimetris, polar, dan bermuatan membutuhkan perhatian khusus.
6. Konvergensikan ketebalan slab, vakum, dan sampling terhadap besaran penelitian.

<a id="docs-slab-workflow-3"></a>

### Slab dengan strain

Strain biaksial mengubah metrik dalam bidang. Catat tensor strain, kisi referensi, dan apakah posisi atom direlaksasi dengan sel dalam bidang tetap.

Menambah vakum mengubah volume sel 3D tanpa mengubah ketebalan fisik lembaran. Tegangan atau konduktivitas yang dinormalisasi dengan volume tersebut dapat membutuhkan konversi 2D yang didefinisikan jelas.

Aksi vakum c bukan pembuat semua kawat, slab indeks Miller arbitrer, atau cluster terisolasi. Impor geometri yang telah disiapkan bila operasi di luar cakupan builder.

<a id="docs-slab-workflow-4"></a>

### Validasi sebelum submit

| Pemeriksaan | Bukti yang disimpan |
| --- | --- |
| Permukaan dan orientasi | Vektor kisi, koordinat, terminasi, dan sumber asli. |
| Vakum | Pemisahan normal dan hasil beberapa nilai di sekitar pilihan akhir. |
| Sampling | Mesh yang dijalankan dan hasil konvergensi dalam bidang. |
| Elektrostatik | Pengaturan QE eksak dan justifikasi fisiknya. |
| Relaksasi | Derajat kebebasan tetap/bebas, toleransi gaya, dan geometri akhir. |

<a id="docs-slab-workflow-5"></a>

### Topik terkait

- [Project, struktur, dan riwayat kalkulasi](<#project>)
- [Mengimpor dan memeriksa struktur](<#structure>)
- [Mengedit atom dan geometri sel](<#edit>)

<a id="quickstart-silicon"></a>

## Tutorial: kalkulasi silikon pertama

Selesaikan kalkulasi keadaan dasar kecil sebelum menjalankan studi besar. Tutorial ini memeriksa alur struktur, worker, dan hasil. Parameter latihan bukan metode produksi yang sudah konvergen.

<a id="docs-quickstart-silicon-1"></a>

### Sebelum mulai

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

- Buka aplikasi lokal tanpa login, atau masuk ke website hosted dengan akun pemilik project.
- Pada aplikasi npm, pasang DFT di Pengaturan → Komputasi dan pertahankan CLI berjalan. Pada website hosted, hubungkan Komputer Anda melalui worker berpasangan dan pertahankan Docker aktif.
- Siapkan struktur silikon diamond-cubic dalam CIF, POSCAR, atau format lain yang didukung. Simpan sumber serta parameter kisinya.
- Gunakan sel primitif dua atom untuk latihan. Sel konvensional delapan atom juga valid secara fisik, tetapi energi total, vektor resiprok, dan biayanya berbeda.

<a id="docs-quickstart-silicon-2"></a>

### Membuat dan memeriksa project

1. Di Workspace, pilih Project baru. Isi nama Keadaan dasar silikon dan deskripsi opsional, lalu pilih Buat project.
2. Buka project dari konfirmasi atau daftar, kemudian tambahkan struktur silikon.
3. Pastikan Si merupakan satu-satunya spesies dan sel primitif berisi dua atom. Periksa panjang, sudut, satuan, serta tetangga terdekat.
4. Pertahankan a, b, c periodik untuk silikon bulk. Sel berulang di tampilan bukan atom tambahan yang dikirim ke solver.
5. Beri nama struktur yang mengidentifikasi sumbernya. Simpan file asli sebelum mengubah kisi.

<a id="docs-quickstart-silicon-3"></a>

### Konfigurasi latihan

| Pilihan | Titik awal | Alasan pemeriksaan |
| --- | --- | --- |
| Workflow | Total energy / SCF | Menghasilkan keadaan dasar self-consistent, bukan langsung figur lintasan band. |
| Metode | PBE dengan pseudopotensial Si yang sesuai | Fungsional atau pseudopotensial berbeda mengubah model dan titik nol energi. |
| Cutoff wavefunction | Rekomendasi pseudopotensial yang diselesaikan aplikasi | Nilai dari potensial lain bukan bukti konvergensi yang dapat dipindahkan. |
| Cutoff kerapatan | Rekomendasi yang sesuai | Rasio terhadap cutoff wavefunction bergantung pada jenis potensial. |
| Mesh integrasi | 4 × 4 × 4 sebagai awal latihan | Ulangi dengan mesh lebih rapat sebelum menafsirkan selisih energi kecil. |
| Okupansi | Periksa kebijakan okupansi isolator | Pilihan smearing numerik tidak otomatis berarti material logam. |
| Sumber daya | Alokasi kecil dalam batas akun | Alokasi menentukan sumber daya worker, bukan akurasi metode. |

<a id="docs-quickstart-silicon-4"></a>

### Menjalankan dan memeriksa

1. Periksa input yang dihasilkan dan pilih tujuan compute yang dimaksud.
2. Jalankan sekali, buka Log, dan ikuti Queued, Running, hingga status akhir.
3. Cari konvergensi SCF pada output solver. Proses selesai tanpa self-consistency belum merupakan keadaan dasar yang dapat diterima.
4. Catat energi total, jumlah atom, input eksekusi, identitas pseudopotensial, dan ID run.
5. Untuk plot dispersi, tambahkan Band structure dengan lintasan resiprok sesuai sel. Setelah selesai, pilih Open in Figure Lab dari hasilnya.

<a id="docs-quickstart-silicon-5"></a>

### Hasil yang diharapkan

Project berisi struktur asli, setup yang dapat diedit, dan record eksekusi dengan artefak hasil. Run band atau DOS terpisah menghasilkan sumber numerik untuk plot.

Tidak ada satu energi target universal untuk tutorial: nilainya bergantung pada potensial, sel, cutoff, dan konvensi. Periksa konvergensi internal serta identitas metode, bukan angka tanpa sumber.

> Jika job tetap Queued, periksa tujuan dan koneksi worker sebelum mengirim duplikat. Lihat topik Eksekusi dan tabel diagnosis.

<a id="docs-quickstart-silicon-6"></a>

### Kegagalan dan pemulihan

- Jika worker offline, sambungkan kembali dan tunggu job yang mengantre tanpa mengirim ulang.
- Untuk status Failed, periksa input tersimpan dan kesalahan solver pertama yang bermakna di log sebelum mengubah pengaturan.
- Untuk status Cancelled, simpan log parsial dan kirim run baru hanya setelah job sebelumnya mencapai status akhir.

<a id="docs-quickstart-silicon-7"></a>

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](<#calculation>)
- [Mengatur dan memvalidasi Quantum ESPRESSO](<#configure>)
- [Eksekusi, sumber daya, dan pembatalan](<#execution>)

<a id="calculation"></a>

## Memilih dan menghubungkan kalkulasi

Panel Calculate memisahkan pengaturan DFT, Log eksekusi, dan konfigurasi yang dapat dipakai ulang. Pilih tugas ilmiahnya; alur yang dihasilkan menyiapkan tahap solver yang diperlukan.

<a id="docs-calculation-1"></a>

### Alur tersedia

| Kalkulasi | Tujuan | Alat utama |
| --- | --- | --- |
| Total energy | Keadaan dasar elektronik SCF dan energi. | pw.x |
| Structural relaxation | Optimasi ion; opsi derajat kebebasan sel yang diizinkan. | pw.x relax / vc-relax |
| Band structure | Eigenvalue sepanjang lintasan resiprok. | pw.x + bands.x |
| Density of states | DOS dari mesh seragam dan opsi proyeksi. | pw.x + dos.x / input proyeksi |
| Phonon dispersion | DFPT, konstanta gaya, dan lintasan fonon. | ph.x + q2r.x + matdyn.x |
| Thermoelectric properties | Interpolasi band dan transport semiklasik. | QE + BoltzTraP2 |

<a id="docs-calculation-2"></a>

### Menyusun kalkulasi

![Modul ilmiah terhubung pada Canvas](<https://phynitelab.com/docs/guide/workflow-canvas-desktop-light.png>)

Koneksi menjelaskan dependensi. Modul draft bukan run selesai.

1. Pilih struktur lalu buka Calculate / DFT.
2. Pilih Add calculation dan tugas yang dibutuhkan.
3. Atur parameter dan periksa file input.
4. Jika diperlukan, pilih hasil relaksasi yang sesuai sebagai sumber struktur.
5. Jalankan satu kalkulasi, Run selected, atau Run all. Tahap pendahulu dapat dikirim terlebih dahulu dan dipakai ulang ketika kompatibel.
6. Periksa setiap run di Log; job hilir dapat menunggu dependensinya.

<a id="docs-calculation-3"></a>

### Dependensi dan eksekusi ulang

Job hilir menunggu prasyarat yang dideklarasikan selesai. Pemakaian ulang bergantung pada record eksekusi yang kompatibel, bukan kemiripan nama.

Perubahan struktur, fungsional, muatan, spin, atau cutoff dapat membuat hasil lama tidak sesuai untuk dipakai ulang. Buat run baru bila ragu dan pertahankan hasil lama sebagai pembanding.

Save selected menyimpan konfigurasi kalkulasi, bukan menjalankan solver. Figure Lab memiliki penyimpanan otomatis dan tidak membutuhkan tombol Save revision.

<a id="docs-calculation-4"></a>

### Topik terkait

- [Mengatur dan memvalidasi Quantum ESPRESSO](<#configure>)
- [Eksekusi, sumber daya, dan pembatalan](<#execution>)
- [Tutorial: kalkulasi silikon pertama](<#quickstart-silicon>)

<a id="configure"></a>

## Mengatur dan memvalidasi Quantum ESPRESSO

Default adaptif adalah titik awal. Pengaturan tersebut tidak menggantikan uji konvergensi atau pengetahuan tentang material. Input yang dihasilkan dan expert raw input memiliki tanggung jawab berbeda.

<a id="docs-configure-1"></a>

### Pilihan utama

![Konfigurasi DFT dan kontrol input](<https://phynitelab.com/docs/guide/dft-configuration-desktop-light.png>)

Konfigurasi demo menunjukkan kontrol; konvergensikan pengaturan untuk material Anda sendiri.

| Pengaturan | Makna | Pemeriksaan |
| --- | --- | --- |
| Functional | Pendekatan exchange-correlation. | Gunakan pseudopotensial dan alur solver yang kompatibel. |
| ecutwfc / ecutrho | Cutoff gelombang bidang dan kerapatan muatan. | Konvergensikan energi, gaya, tegangan, atau respons yang dilaporkan. |
| Mesh k | Sampling integrasi zona Brillouin. | Gunakan mesh seragam untuk SCF/DOS; lintasan band bukan penggantinya. |
| Occupations / smearing | Pengisian dan integrasi keadaan elektronik. | Sesuaikan dengan sifat logam, isolator, spin, dan asumsi temperatur. |
| nbnd | Jumlah band yang dihitung. | Cukupkan keadaan kosong untuk rentang energi atau transport. |
| Threshold / mixing | Penghentian dan perilaku iterasi SCF. | Periksa konvergensi; menaikkan batas iterasi tidak selalu menyelesaikan masalah. |
| Charge / magnetization / spin | Asumsi keadaan elektronik. | Gunakan referensi fisik dan pseudopotensial yang sesuai. |

<a id="docs-configure-2"></a>

### Mode adaptif dan expert

Mode adaptif menentukan default okupansi dan cutoff dari konteks material serta alur kerja. Override pengguna tetap merupakan pilihan eksplisit.

Expert raw input menjadi teks utama yang dikirim. Resolusi adaptif tidak diam-diam menulis ulang okupansi dan cutoff pada teks tersebut. Pengguna bertanggung jawab atas card, path, spesies, satuan, dan opsi solver.

Periksa input yang benar-benar dieksekusi dari artefak hasil. Preview lama tidak selalu mencakup data runtime, termasuk identitas pseudopotensial yang diselesaikan worker.

<a id="docs-configure-3"></a>

### Contoh uji konvergensi

1. Tetapkan struktur dan metode; buat baseline Total energy.
2. Variasikan ecutwfc dan ecutrho yang kompatibel pada mesh k tetap.
3. Amati energi per atom, gaya, atau tegangan sesuai tujuan.
4. Pilih cutoff memadai lalu variasikan mesh k.
5. Uji vakum secara terpisah untuk sistem berdimensi rendah.
6. Catat toleransi yang digunakan untuk menyatakan besaran konvergen.

> Preset Fast, Balanced, dan High accuracy adalah kemudahan konfigurasi, bukan jaminan akurasi publikasi.

<a id="docs-configure-4"></a>

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](<#calculation>)
- [Eksekusi, sumber daya, dan pembatalan](<#execution>)
- [Tutorial: kalkulasi silikon pertama](<#quickstart-silicon>)

<a id="convergence"></a>

## Prosedur: merancang uji konvergensi

Uji konvergensi mengukur pengaruh pilihan numerik terhadap besaran fisik yang dilaporkan. Tentukan besaran dan toleransi terlebih dahulu, lalu ubah satu parameter terkendali dengan input lain tetap.

<a id="docs-convergence-1"></a>

### Menentukan perbandingan

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

Untuk perbandingan energi fase, konvergensikan selisih energi dengan sel dan normalisasi yang sebanding. Untuk relaksasi, periksa kestabilan gaya serta tegangan. Untuk tepi band, koefisien transport, atau mode fonon, konvergensikan besaran itu secara langsung.

Energi total yang stabil tidak menjamin semua respons telah konvergen. Catat toleransi target pada deskripsi project atau catatan metode.

<a id="docs-convergence-2"></a>

### Menjalankan seri terkendali

1. Duplikasikan setup referensi dan beri nama setiap variasi beserta parameter serta satuannya.
2. Variasikan ecutwfc dengan ecutrho yang sesuai. Pertahankan geometri, pseudopotensial, mesh k, spin, okupansi, dan toleransi SCF.
3. Pada cutoff cukup tinggi, variasikan mesh k seragam. Uji sensitivitas smearing secara terpisah untuk logam.
4. Untuk sistem berdimensi rendah, variasikan pemisahan vakum sebenarnya tanpa mengubah geometri slab atau sel dalam bidang.
5. Uji kombinasi di sekitar pilihan akhir agar parameter yang diuji terpisah tetap cukup ketika digabung.
6. Simpan setiap run dan hitung selisih terhadap referensi paling teresolusi. Ekspor tabel observasi sebagai data numerik untuk plot.

<a id="docs-convergence-3"></a>

### Tabel hasil minimum

Ganti placeholder dengan hasil pengukuran. Tabel ini format pencatatan, bukan data simulasi. Untuk komposisi dan sel yang sama, selisih per atom = (E - E_referensi) / jumlah_atom. Konversikan Ry ke satuan paper secara konsisten.

Jangan mengurangkan energi total mentah dari komposisi berbeda seolah-olah langsung merupakan energi pembentukan. Perbandingan tersebut memerlukan referensi potensial kimia dan stoikiometri.

```text
cutoff_Ry,k_mesh,energy_Ry,atoms,delta_meV_per_atom,run_id
40,4x4x4,<hasil>,2,<turunan>,<id-run>
50,4x4x4,<hasil>,2,<turunan>,<id-run>
60,4x4x4,<hasil>,2,<turunan>,<id-run>
```

<a id="docs-convergence-4"></a>

### Kriteria berhenti

| Besaran | Periksa | Kesalahan umum |
| --- | --- | --- |
| Selisih energi | Perubahan antarperhitungan dengan resolusi meningkat. | Memakai toleransi universal tanpa mempertimbangkan efek yang diteliti. |
| Gaya dan tegangan | Komponen relevan terbesar dan geometri setimbang. | Menganggap single point cutoff tinggi memperbaiki geometri yang direlaksasi dengan cutoff rendah. |
| Ekstremum band | Sampling dan lokasi ekstremum sebenarnya. | Menganggap band gap selalu berada pada lintasan simetri tinggi. |
| Fonon | Toleransi SCF/DFPT, mesh k/q, dan cabang akustik. | Menghilangkan mode negatif secara kosmetik sebelum memahami penyebabnya. |
| Transport | Sampling rapat, interpolasi, potensial kimia, dan temperatur. | Menganggap kurva interpolasi halus sebagai bukti konvergensi. |

<a id="docs-convergence-5"></a>

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](<#calculation>)
- [Mengatur dan memvalidasi Quantum ESPRESSO](<#configure>)
- [Eksekusi, sumber daya, dan pembatalan](<#execution>)

<a id="execution"></a>

## Eksekusi, sumber daya, dan pembatalan

Run melewati persiapan, antrean, eksekusi, penyimpanan hasil, dan penyelesaian. Hasil native tersimpan lokal; job hosted juga mengunggah artefak wajib. Log menunjukkan tahap yang memerlukan pemeriksaan.

<a id="docs-execution-1"></a>

### Membaca status

![Diagnosis preflight, eksekusi solver, dan penyimpanan hasil secara terpisah](<https://phynitelab.com/docs/guide/diagrams/failure-stages-id-light.png>)

Diagram konsep: periksa tahap pertama yang gagal sebelum mencoba lagi.

| Status | Makna | Tindakan |
| --- | --- | --- |
| Draft / Ready | Konfigurasi ada; solver belum tentu berjalan. | Periksa input lalu jalankan. |
| Queued | Menunggu worker atau dependensi. | Periksa tujuan, koneksi, dan prasyarat. |
| Running | Worker sudah mengambil job. | Periksa tahap, log, dan alokasi. |
| Completed | Hasil wajib tersimpan dan diterima secara lokal atau oleh layanan hosted. | Periksa konvergensi dan validitas ilmiah. |
| Failed | Persiapan, solver, penyimpanan lokal, atau unggah hosted gagal. | Baca penyebab dan log sebelum mengulang. |
| Cancellation requested | Permintaan berhenti dikirim ke worker. | Tunggu heartbeat dan status akhir. |
| Cancelled | Run dihentikan atau dikeluarkan dari antrean. | Simpan log yang berguna; buat run baru bila perlu. |

<a id="docs-execution-2"></a>

### Arti core dan RAM

Core menunjukkan alokasi vCPU atau proses worker. RAM menunjukkan anggaran job terkonfigurasi. Keduanya bukan pengukuran utilisasi atau memori fisik. Watchdog memori native adalah anggaran terpantau, bukan hard limit sistem operasi.

Buka detail sumber daya di Log untuk alokasi backend, durasi, proses MPI, serta estimasi memori dan waktu QE bila tersedia. Data historis yang tidak dilaporkan tidak diisi dengan tebakan.

Job native mengikuti kapasitas scheduler pada Pengaturan → Komputasi. Worker pribadi hosted juga mengikuti batas job layanan. Permintaan tidak didukung ditolak tanpa mengubah input ilmiah diam-diam.

<a id="docs-execution-3"></a>

### Membatalkan run

- Job yang masih antre dapat dikeluarkan dari antrean.
- Pembatalan bersifat asinkron. Supervisor proses lokal atau worker hosted mengonfirmasinya sebelum status akhir.
- Menutup browser tidak membatalkan kalkulasi yang sudah dikirim. Pertahankan CLI native atau worker hosted; periksa job terinterupsi setelah restart sebelum mengirim ulang.
- Mencabut kredensial komputer dapat mengganggu unggah hasil. Gunakan pembatalan kalkulasi sebelum mengganti koneksi ketika ada run aktif.

<a id="docs-execution-4"></a>

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](<#calculation>)
- [Mengatur dan memvalidasi Quantum ESPRESSO](<#configure>)
- [Tutorial: kalkulasi silikon pertama](<#quickstart-silicon>)

<a id="quickstart-md"></a>

## Tutorial: simulasi MD lokal pertama

Gunakan sistem argon kecil untuk mempelajari alur struktur, pengaturan, eksekusi, dan hasil di MD Lab. Ini latihan alur kerja, bukan studi fisika yang sudah tervalidasi.

<a id="docs-quickstart-md-1"></a>

### Siapkan komputer dan struktur

1. Pada aplikasi npm, pasang MD/analisis di Pengaturan → Komputasi dan pertahankan CLI berjalan; login Phynite tidak diperlukan. Website hosted memakai akun yang masuk serta worker pribadi terhubung.
2. Buka MD Lab dan buat project bernama Ekuilibrasi argon.
3. Impor atau bangun struktur argon kecil dengan kotak periodik yang sesuai secara fisik. Periksa jumlah atom, identitas unsur, koordinat, ukuran kotak, satuan, dan massa atom. XYZ dengan spesies Ar atau berkas data LAMMPS yang memuat Masses dapat dipakai; dump yang hanya berisi nomor tipe tidak punya massa untuk dinamika.
4. Simpan berkas struktur asli serta sumbernya. Pengulangan tampilan tidak menambah atom dalam simulasi.

<a id="docs-quickstart-md-2"></a>

### Tinjau simulasi

![Konfigurasi tahap MD Simple](<https://phynitelab.com/docs/guide/md-guided-desktop-light.png>)

Periksa model fisik, durasi tahap, dan interval output.

1. Buka drawer konfigurasi dan pilih mode Guided. Pilih model Lennard-Jones bawaan untuk Ar; jangan pakai parameter Generic tanpa mencatat sumbernya.
2. Pilih resep ekuilibrasi singkat. Periksa temperatur, timestep, batas periodik, seed acak, sistem satuan, parameter potensial, dan interval output.
3. Jalankan preflight di browser dan baca input LAMMPS yang dibuat. Pastikan struktur dan potensialnya sesuai.

<a id="docs-quickstart-md-3"></a>

### Jalankan sekali dan periksa

1. Pilih Komputer Anda dan kirim satu run. Ikuti status Queued dan Running pada catatan job serta periksa koneksi worker.
2. Jika worker offline, hubungkan kembali dan tunggu job yang mengantre; jangan kirim run ganda.
3. Setelah selesai, buka log, data thermo, trajectory, dan input tersimpan dari project. Periksa error LAMMPS serta apakah perilaku temperatur dan energi mendukung ekuilibrasi yang dimaksud.
4. Status Completed berarti proses selesai; itu belum memvalidasi force field, timestep, ekuilibrasi, atau kesimpulan ilmiah.

<a id="docs-quickstart-md-4"></a>

### Kegagalan dan pemulihan

- Untuk Failed, periksa error LAMMPS pertama yang bermakna dan input tersimpan sebelum mengubah pengaturan.
- Untuk Cancelled, tinjau log parsial dan kirim run baru hanya setelah job lama mencapai status akhir.
- Jika trajectory hilang, periksa pengaturan output dan artefak tersimpan. Viewer kosong bukan hasil fisika.

> Tidak ada target energi atau kurva temperatur universal. Catat input nyata, identitas potensial, ID run, dan output sebelum membandingkan sistem.

<a id="docs-quickstart-md-5"></a>

### Topik terkait

- [Alur MD: Simple, Advanced, dan analisis trajectory](<#md-workflows>)

<a id="md-workflows"></a>

## Alur MD: Simple, Advanced, dan analisis trajectory

Simulasi LAMMPS mengubah sistem fisik; inspeksi dan analisis trajectory mengukur frame tersimpan. Editor simulasi saat ini menamai Guided sebagai “Simple” dan editor manual/blok sebagai “Advanced”. Pertahankan sumber, potential, satuan, dan bukti yang eksplisit pada kedua mode.

<a id="docs-md-workflows-1"></a>

### Prasyarat dan pemetaan sumber

- Instal MD/analysis pada Pengaturan → Compute dan verifikasi kemampuan LAMMPS/analisis serta isolasi native. MD memakai Your computer pada workflow saat ini.
- Gunakan struktur atau trajectory dengan sel simulasi valid, koordinat diketahui, identitas partikel, dan massa. Dump yang hanya memiliki nomor tipe tidak cukup untuk menyimpulkan elemen atau massa.
- Petakan setiap tipe partikel sebelum memilih force field. Periksa bahwa aset potential yang diunggah mendukung seluruh elemen, atom style terpilih, dan sistem satuan yang diperlukan.
- Jeda playback trajectory dan selesaikan analisis frame sebelum mengirim simulasi. Simpan trajectory asli dan sitasi model; pemeriksaan integritas/runtime yang berhasil tidak membuktikan akurasi fisik.

<a id="docs-md-workflows-2"></a>

### Susun tahap simulasi Simple

![Konfigurasi MD Simple](<https://phynitelab.com/docs/guide/md-guided-desktop-light.png>)

Simple adalah workflow Guided pada antarmuka saat ini.

1. Tambahkan modul MD simulation ke project dan hubungkan strukturnya, atau buka Simulation di MD Lab. Add stage memilih resep; buat latihan awal tetap pendek.
2. Buka konfigurasi tahap lalu pilih Simple. Periksa resep, potential, periodic boundary condition, ensemble, timestep, total steps, temperatur, kontrol tekanan bila relevan, dan random seed.
3. Periksa Output & Trajectory. Thermo interval dan Trajectory interval adalah jumlah langkah; pilih interval yang menghasilkan data berguna selama durasi rencana tanpa penggunaan disk berlebihan.
4. Pilih Inspect in.lammps. Verifikasi input lengkap yang dihasilkan, pemetaan sumber dan potential, timestep tetap, urutan tahap, dan perintah output. Save to library menyimpan setup yang dapat dipakai ulang; aksi ini tidak menjalankan solver.
5. Pilih Run step untuk satu tahap, atau periksa Run selected/Run all untuk rangkaian berurutan yang dimaksud. Periksa alokasi compute dan kirim satu kali.

| Besaran UI | Satuan tampilan | Interpretasi |
| --- | --- | --- |
| Timestep | fs | Input dengan units metal yang dihasilkan mengonversinya ke ps. Simpan timestep tetap dan durasi tahap. |
| Temperatur / damping | K / ps | Temperatur dan waktu relaksasi thermostat adalah kontrol berbeda. |
| Tekanan / damping | bar / ps | Periksa ensemble dan arah periodik sebelum pengaturan kopling tekanan. |
| LJ epsilon / sigma / cutoff | eV / Å / Å | Parameter model harus cocok dengan spesies dan studi fisik yang dimaksud. |
| Strain rate / safety limit | s⁻¹ / ratio | Laju dan durasi total menentukan strain rencana; safety limit bukan konversi satuan target. |

<a id="docs-md-workflows-3"></a>

### Advanced: Blocks dan input Expert

![Blok MD Advanced dan input manual](<https://phynitelab.com/docs/guide/md-manual-desktop-light.png>)

Advanced tetap mempertahankan validasi input terkelola dan persyaratan isolasi.

Advanced adalah workflow LAMMPS terkelola, bukan shell tanpa batas atau file input standalone penuh. Phynite mengelola pemuatan sumber, satuan, boundary, massa, force field, waktu, dan path output. Eksekusi eksternal, include/jump, path file arbitrer, perintah bertingkat, serta output tak terkelola ditolak. Gunakan timestep tetap per tahap; perintah timestep adaptif tidak didukung kontrak waktu fisik tersimpan.

1. Beralih ke Advanced. Blocks membuka Command library dan rak Simulation commands berurutan. Tambahkan blok yang didukung, edit nilainya, dan periksa pratinjau perintahnya.
2. Gunakan kontrol On/Off, panah, atau handle geser pada blok untuk menentukan urutan eksekusi. Blok nonaktif tetap disimpan tetapi tidak masuk input yang dihasilkan.
3. Buka Expert untuk memeriksa perintah hasil kompilasi. Mengedit teks mentah membuat override yang mengendalikan tahap tersebut walaupun rak blok kemudian diubah. Regenerate from Blocks menghapus override secara eksplisit.
4. Baca validasi browser sebelum submit, lalu periksa in.lammps lagi. Perintah manual harus memuat run atau minimize serta lulus validasi runtime native dan probe isolasi.

> Aplikasi npm menggunakan isolasi native terverifikasi tanpa Docker. Worker pribadi hosted mempunyai jalur runtime terpisah. Ikuti Pengaturan → Compute pada aplikasi yang benar-benar Anda jalankan.

<a id="docs-md-workflows-4"></a>

### Analisis frame tersimpan

![Kontrol analisis MD untuk data trajectory tersimpan](<https://phynitelab.com/docs/guide/md-analysis-desktop-light.png>)

Tinjau frame sumber dan parameter analisis sebelum menjalankan.

1. Buka Execution result simulasi selesai dan pilih Inspect trajectory bila trajectory tersimpan tersedia. Alternatifnya, impor trajectory yang diketahui dan pertahankan file aslinya.
2. Dalam workflow project, hubungkan trajectory ke modul MD analysis. Pilih Analysis: Radial distribution function, Common neighbor analysis, Polyhedral template matching, atau Coordination number.
3. Tetapkan cutoff dalam Å bila berlaku, lalu pilih Start frame dan Frame stride. Review run menyertakan sumber serta pengaturan analisis aktual. MD Lab juga menyediakan pipeline modifier; pertahankan urutannya saat membandingkan hasil.
4. Periksa tabel output, distribusi, klasifikasi struktur, atau artefak analisis tersimpan. Waktu sumber tetap tidak diketahui bila tidak dideklarasikan; nomor frame saja bukan waktu fisik yang berlalu.
5. Ekspor data numerik asli dan konfigurasi bersama figur. Simpan satuan, pemilihan frame, cutoff, dan identitas potential dalam catatan metode.

- [LAMMPS documentation](<https://docs.lammps.org/>)
- [OVITO manual](<https://www.ovito.org/docs/>)
- [Figur ilmiah](<#figures>)

<a id="docs-md-workflows-5"></a>

### Baca hasil dan pulihkan dengan aman

| Pengamatan | Yang diperiksa |
| --- | --- |
| Configuration ready | Field browser saat ini lulus validasi. Runtime, potential, dan isolasi tetap perlu pemeriksaan eksekusi yang berhasil. |
| Run tetap antre | Kesiapan worker, tahap sebelumnya, kapasitas resource, dan job aktif. Jangan kirim duplikat. |
| LAMMPS keluar atau melaporkan lost atoms | Baca error log pertama yang bermakna; periksa geometri, boundary, force field, timestep, pengaturan neighbor, serta resource sebelum mengubah parameter. |
| Trajectory atau metrik tidak tersedia | Periksa artefak tersimpan dan interval output. Data yang hilang bukan nol dan tampilan kosong bukan hasil fisik. |
| Dibatalkan atau terinterupsi | Tunggu status akhir, simpan log parsial, dan periksa hasil tersimpan sebelum run baru. Pemulihan hanya ditawarkan bila ada output tersimpan yang dapat diverifikasi. |

> Completed mengonfirmasi penanganan proses/hasil, bukan ekuilibrasi, validitas force field, konvergensi timestep, atau kesimpulan siap publikasi. Tidak ada energi target universal yang diasumsikan untuk demo.

<a id="docs-md-workflows-6"></a>

### Topik terkait

- [Tutorial: simulasi MD lokal pertama](<#quickstart-md>)

<a id="ai-providers"></a>

## Koneksi provider AI di komputer Anda

AI lokal memakai CLI provider yang Anda pilih. Ini terpisah dari login Phynite Cloud dan tidak memakai layanan AI hosted Phynite.

<a id="docs-ai-providers-1"></a>

### Hubungkan akun

![Pengaturan koneksi provider AI lokal](<https://phynitelab.com/docs/guide/ai-provider-accounts-desktop-light.png>)

Demo belum login: selesaikan alur provider resmi pada komputer Anda. Tidak ada akun atau kuota yang disimulasikan.

![Ikon provider Codex](<https://phynitelab.com/brand/ai/codex.png>)

Hubungkan melalui CLI provider resmi yang Anda gunakan.

![Ikon provider Antigravity](<https://phynitelab.com/brand/ai/antigravity.png>)

Autentikasi provider tetap berada pada CLI lokal resminya.

1. Instal dan autentikasi CLI provider resmi di komputer ini.
2. Buka Pengaturan → Akun provider AI dan pilih Codex atau Antigravity.
3. Selesaikan autentikasi melalui alur milik provider. Login CLI yang didukung dapat dipakai ulang tanpa mengimpor cookie atau file session.
4. Biarkan aplikasi terbuka saat discovery model dan capability probe berjalan. Halaman hanya memilih model yang lulus pemeriksaan teks, streaming, dan tool.

- [Pengaturan provider AI](<https://phynitelab.com/account/ai-providers>)

<a id="docs-ai-providers-2"></a>

### Provider, model, dan limit

Aplikasi lokal memakai satu profil yang dikelola CLI provider resmi. Request yang gagal atau terkena rate limit tidak mengganti provider atau akun secara diam-diam.

Kartu pemakaian hanya menampilkan telemetry yang dilaporkan provider: grup model, persentase session atau mingguan, window, dan waktu reset bila tersedia. Laporan yang hilang tetap ditampilkan tidak tersedia; aplikasi tidak membuat angka token, saldo, atau tanggal reset.

Ketersediaan model dapat berubah mengikuti entitlement provider. Pengaturan model Cloud tidak mengatur akun provider lokal.

<a id="docs-ai-providers-3"></a>

### Keamanan dan status yang belum didukung

- Kredensial provider tetap di CLI provider atau credential store lokal dan tidak masuk browser storage, log, arsip project, atau Cloud Sync. Aplikasi lokal tidak menerima URL atau token gateway.
- Bridge lokal berjalan di loopback dengan shell, MCP, plugin, browser, dan aksi jaringan yang belum diverifikasi dinonaktifkan. Perubahan Canvas tetap mengikuti approval dan validasi yang ada.
- Jika autentikasi, discovery, streaming, atau verifikasi tool gagal, provider tetap terlihat disconnected atau unavailable sampai diperbaiki. Tidak ada fallback provider otomatis.
- Akses AI provider terpisah dari instalasi runtime scientific dan dari login Phynite Cloud.

<a id="docs-ai-providers-4"></a>

### Topik terkait

- [Phynite Cloud, Cloud Sync, dan compute online](<#cloud-sync>)

<a id="cloud-sync"></a>

## Phynite Cloud, Cloud Sync, dan compute online

Layanan Cloud adalah koneksi opsional di atas workspace lokal yang lengkap. Login tidak mengunggah project lokal atau mengganti identitas lokalnya.

<a id="docs-cloud-sync-1"></a>

### Lokal, Cloud Sync, dan compute cloud

![Batas data workspace lokal, Cloud Sync project, dan compute cloud](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-id-light.png>)

Diagram konsep: login, sync project, dan transfer job adalah pilihan terpisah.

| Pilihan | Yang terjadi |
| --- | --- |
| Lokal saja | Project, input, hasil, dan runtime tetap di komputer yang dipilih. Login Cloud tidak diperlukan. |
| Login Cloud | Membuka fitur akun; project lokal tetap lokal sampai aksi project mengaktifkan sync. |
| Cloud Sync | Diaktifkan per project setelah meninjau cakupan, ukuran, dan kuota. Revision serta artefak project yang diizinkan disinkronkan. |
| Run on cloud | Hanya mengunggah input/dependensi job yang sudah ditinjau, membuat eksekusi cloud terpisah, lalu mengunduh hasil terverifikasi. Tidak mengaktifkan sync. |

<a id="docs-cloud-sync-2"></a>

### Siklus sync dan konflik

![Login Phynite Cloud opsional](<https://phynitelab.com/docs/guide/cloud-account-desktop-light.png>)

Demo belum login. Login tidak mengaktifkan sync project.

1. Login dari Pengaturan → Akun dan pertahankan identitas workspace lokal.
2. Buka kontrol sync project, tinjau file, ukuran, kuota, dan retensi yang ditampilkan, lalu aktifkan Cloud Sync secara eksplisit.
3. Tunggu outbox persisten selesai. Transfer terputus dapat dilanjutkan dengan checksum; revision Cloud baru diterbitkan setelah seluruh artefak snapshot diverifikasi.
4. Jika perangkat lain mengubah project, bandingkan revision lokal dan Cloud sebelum memilih pakai lokal, pakai Cloud, atau simpan sebagai salinan.
5. Gunakan Trash untuk penghapusan Cloud. Tombstone dan masa retensi melindungi salinan Cloud; mematikan sync mempertahankan dua salinan, sedangkan logout menghentikan sync tanpa menghapus data lokal.

<a id="docs-cloud-sync-3"></a>

### Batas akun dan billing

Antrean sync dan mapping akun terikat pada akun Cloud yang sedang login. Berganti akun tidak melanjutkan upload milik akun lain.

Kuota Cloud, retensi artefak, Trash, dan allowance Free hosted terpisah dari ruang disk lokal. Billing dan perubahan paket tersedia di website hosted; pembelian tidak otomatis menjalankan job.

MD Cloud belum tersedia sampai service yang didukung muncul di katalog aktif. Jangan menyimpulkan ketersediaannya dari runtime MD lokal.

- [Pengaturan akun Cloud](<https://phynitelab.com/account/account>)
- [Pemakaian dan kuota](<https://phynitelab.com/account/usage>)
- [Billing hosted](<https://phynitelab.com/billing>)

<a id="docs-cloud-sync-4"></a>

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](<#saving>)
- [Pengaturan, akun, profil, dan pemakaian](<#account>)
- [Mengelola paket, tagihan, dan pemakaian](<#billing>)

<a id="account"></a>

## Pengaturan, akun, profil, dan pemakaian

Pengaturan memisahkan preferensi browser, compute ilmiah, akun provider AI, dan login Phynite Cloud opsional. Pemakaian berasal dari record eksekusi/provider nyata; pengukuran yang tidak ada tidak dibuat-buat.

<a id="docs-account-1"></a>

### Memilih halaman pengaturan

![Pengaturan akun Cloud tanpa profil login](<https://phynitelab.com/docs/guide/cloud-account-desktop-light.png>)

Profil baru muncul setelah autentikasi Cloud.

| Halaman | Yang diatur |
| --- | --- |
| Tampilan & bahasa | Tema, aksen, kepadatan, ukuran teks antarmuka/kode, reduced motion, dan bahasa pada browser ini. |
| Pintasan keyboard | Binding aplikasi yang didukung dan disimpan pada browser ini. |
| Notifikasi | Alert job/runtime lokal dan izin desktop; preferensi pengiriman hosted pada website. |
| Komputasi | Instalasi runtime native serta CPU/RAM/job paralel lokal; worker dan default akun pada website. |
| Akun provider AI | Login AI sendiri, akun aktif, status koneksi/model, batas terlapor, dan waktu reset. |
| Akun | Login/logout Phynite Cloud opsional dan sync per project; terpisah dari login AI. |
| Pemakaian / Penyimpanan | Pengukuran job serta pemakaian provider / arsip project dan inventaris penyimpanan. |
| Profil riset / Privasi & sesi | Identitas Phynite terhubung / privasi serta sesi sesuai mode. |

<a id="docs-account-2"></a>

### Navigasi tanpa menu ganda

Pengaturan memakai satu sidebar kategori dan pencarian. Akun berada setelah Akun provider AI. Pada mobile, buka drawer navigasi; Escape, tombol tutup, atau backdrop menutupnya. Menu akun mendukung navigasi keyboard. Bookmark Runtime lokal & cloud lama diarahkan ke kategori yang sesuai.

Workspace lokal yang belum login menampilkan aksi pengaturan serta koneksi tanpa profil pengguna palsu. Setelah akun Phynite terhubung, Profil membuka halaman profil tersendiri dengan aksi Edit profil.

<a id="docs-account-3"></a>

### Mengedit profil riset terhubung

1. Hubungkan akun Phynite Cloud sebelum membuka Profil; project lokal tetap tersedia tanpa login itu.
2. Pilih Edit profil lalu isi nama tampilan, institusi, peran, dan bidang riset.
3. Pilih foto JPG, PNG, atau WebP hingga 20 MB. Crop, perbesar, dan putar foto; browser menyimpan gambar 256 piksel terkompresi.
4. Periksa preview lalu Simpan profil. Penghapusan foto berlaku setelah disimpan. Draft akun yang belum disimpan memerlukan keputusan sebelum navigasi.
5. Gunakan Tampilan & bahasa untuk tampilan perangkat. Pilihan langsung berlaku dan tidak menjadi default akun cloud.

<a id="docs-account-4"></a>

### Menentukan username login cloud

1. Buat akun Phynite Cloud dengan email lalu verifikasi email, ketika pendaftaran tersedia.
2. Buka editor profil riset. Nama tampilan boleh mengandung spasi dan tidak harus unik.
3. Pada Username, masukkan 3–30 karakter dengan awalan huruf atau angka. Huruf, angka, titik, tanda hubung, dan garis bawah didukung; nama yang dicadangkan tidak dapat dipakai.
4. Pilih Simpan username. Aksi ini terpisah dari menyimpan identitas riset; keunikan diperiksa tanpa membedakan huruf besar dan kecil.
5. Saat login berikutnya, gunakan username atau email dengan password sama. Username lama berhenti berlaku setelah diganti dan dapat tersedia bagi akun lain. Pemulihan memakai email terverifikasi.

> Username tidak membuat akun lain, membagikan project, atau mengubah email. Pekerjaan lokal native tidak memerlukan username login.

<a id="docs-account-5"></a>

### Mengatur compute sesuai lokasi eksekusi

Pada aplikasi npm lokal, Komputasi memuat deteksi platform/kemampuan, instalasi runtime ilmiah, status isolasi, serta default CPU/RAM/job paralel. Pasang runtime sebelum menjalankan. Default baru berlaku bagi job berikutnya; override workspace berlaku untuk run terpilih. Compute native lokal tidak memerlukan Docker atau worker yang dipasangkan ke cloud.

Pada website hosted, Komputasi mempertahankan default akun per workload, profil Cloud serta estimasi yang didukung, dan pairing worker pribadi. Simpan default adalah aksi eksplisit; Batal mengembalikan nilai tersimpan. MD tetap pada compute pribadi sampai layanan Cloud tersedia. Lebih banyak core belum tentu lebih cepat; bandingkan run pendek terkendali.

<a id="docs-account-6"></a>

### Menghubungkan AI dan membaca batasnya

Koneksi provider AI memakai CLI resmi Codex atau Antigravity dengan akun sendiri. Login ini terpisah dari Phynite Cloud. Setelah autentikasi, penemuan model serta pemeriksaan kemampuan berjalan otomatis. Tools dan attachment memerlukan dukungan terverifikasi; perubahan Canvas tetap memakai approval serta validasi. Aplikasi lokal menyimpan satu koneksi yang dikelola CLI untuk setiap provider; tidak ada pengganti akun atau setup gateway lokal.

Pemakaian serta reset berasal dari provider: persentase, jendela waktu, dan tanggal ditampilkan hanya jika dilaporkan. Sisa token tidak disimpulkan. Provider terputus, rate-limit, atau tidak didukung menampilkan status nyata tanpa berpindah provider diam-diam.

<a id="docs-account-7"></a>

### Notifikasi pada perangkat ini

Atur alert job selesai, job gagal/dibatalkan, dan instalasi runtime secara terpisah. Alert lokal mengamati perubahan status nyata selama aplikasi terbuka. Alert desktop opsional memerlukan izin browser dan dapat diperiksa melalui Kirim notifikasi uji.

Preferensi lokal ini tetap pada browser ini. Preferensi tidak menjadwalkan cloud push atau email setelah aplikasi ditutup. Pengiriman email serta inbox hosted dikelola terpisah.

<a id="docs-account-8"></a>

### Membaca pemakaian dengan benar

| Metrik | Interpretasi |
| --- | --- |
| Waktu run tercatat | Interval mulai-selesai valid; run gagal/dibatalkan dihitung bila kedua timestamp tersedia. Persiapan serta penyimpanan/unggah hasil dapat termasuk. |
| Jam CPU teralokasi | Detik tercatat × core teralokasi / 3600. Ini alokasi, bukan aktivitas CPU nyata atau energi. |
| File lokal / cloud | Inventaris penyimpanan berbeda. Pengukuran objek cloud tidak mencakup disk native; storage lokal bukan langganan cloud. |
| Run belum terukur | Record tanpa waktu atau alokasi valid tetap tidak tersedia atau parsial, tidak dianggap nol. |
| Batas AI dan reset | Pengukuran yang dilaporkan akun provider terpilih; terpisah dari jam CPU ilmiah dan tagihan Phynite. |

<a id="docs-account-9"></a>

### Riwayat dan salinan portabel

Pemakaian menampilkan job serta catatan biaya tercatat dengan timestamp, status, tujuan, dan alokasi tersedia. Pagination mengubah baris terlihat; total seluruh akun tetap mencakup semua record terukur. Perbarui mengambil pengukuran baru.

Penyimpanan memuat ekspor/impor arsip project native. Simpan struktur asli, input eksekusi, hasil tersedia, provenance, checksum, dan backup terpisah. Patuhi lisensi aset potensial. Draft browser membantu pemulihan dan bukan database native.

<a id="docs-account-10"></a>

### Cloud opsional dan tagihan website

Akun menghubungkan atau memutus Phynite Cloud. Login mempertahankan identitas lokal dan tidak mengunggah project. Aktifkan Cloud Sync per project setelah meninjau cakupan transfer; compute cloud meninjau transfer input terpisah tanpa mengaktifkan sync. Logout mempertahankan data lokal dan menghentikan sync.

Tagihan pada mode lokal membuka https://phynitelab.com/billing. Akses, harga, kuota, dan kapasitas Cloud mengikuti katalog hosted serta akun saat ini. Pembelian tidak menjalankan job otomatis. MD Cloud belum tersedia sampai layanannya didukung.

> Eksekusi lokal memakai perangkat, listrik, dan disk sendiri. Setelah runtime serta potensial wajib terpasang, sains lokal dapat berjalan offline. AI provider, Cloud opsional, pencarian data eksternal, dan unduhan baru memerlukan koneksi masing-masing.

<a id="docs-account-11"></a>

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](<#saving>)
- [Mengelola paket, tagihan, dan pemakaian](<#billing>)
- [Phynite Cloud, Cloud Sync, dan compute online](<#cloud-sync>)

<a id="saving"></a>

## Penyimpanan otomatis dan banyak perangkat

DFT Lab dan Figure Lab menampilkan status penyimpanan dokumen aktif. Aplikasi npm menyimpan project pada SQLite/filesystem; storage browser memuat draft pemulihan. Project lokal tidak diunggah otomatis dan tidak memiliki kuota tetap 10 GiB. Status cloud berikut berlaku untuk website hosted atau project dengan Cloud Sync aktif secara eksplisit.

<a id="docs-saving-1"></a>

### Arti status editor

![Inventaris project, file di luar inventaris, dan backup terpisah](<https://phynitelab.com/docs/guide/diagrams/storage-layers-id-light.png>)

Diagram konsep: inventaris project hanya sebagian penggunaan disk.

| Label | Makna | Tindakan |
| --- | --- | --- |
| Saving... | Draft atau sinkronisasi berlangsung. | Tunggu sebentar sebelum mengandalkan perangkat lain. |
| Saved to cloud | Dokumen aktif dan sumber yang diperlukan dikonfirmasi tersimpan. | Dapat dibuka dengan akun yang sama. |
| Saved on device / Offline | Salinan browser ada, unggah belum selesai. | Jangan hapus data browser; sambungkan kembali. |
| Sync pending | Salinan lokal disimpan selama unggah dicoba lagi. | Periksa jaringan dan batas penyimpanan. |
| Sync conflict | Revisi cloud berbeda dari revisi yang diedit. | Periksa History sebelum memilih versi. |

<a id="docs-saving-2"></a>

### Cakupan penyimpanan lokal

Workspace lokal default adalah ~/.phynite-lab dan dapat dipindahkan dengan phynite-lab --data-dir /path/to/workspace. SQLite menyimpan metadata, sedangkan filesystem menyimpan artefak project, instalasi runtime, dan log. Pengaturan → Penyimpanan hanya mengukur artefak project yang terinventarisasi; metadata database, instalasi solver/runtime, log, cache browser, dan file lain di disk berada di luar pengukuran.

Mode lokal dibatasi ruang kosong disk, bukan kuota hosted 10 GiB, dan artefak lokal tidak mendapat pembersihan otomatis tujuh hari. Installer runtime dan log tetap memakai disk. Ekspor/impor arsip project dan backup terpisah diperlukan untuk pekerjaan penting.

| Dihitung oleh Penyimpanan lokal | Tidak dihitung oleh Penyimpanan lokal |
| --- | --- |
| Struktur, input, konfigurasi, hasil selesai, trajectory, dan artefak project yang terinventarisasi. | Metadata SQLite, instalasi solver/runtime, log, cache browser, dan file lain di disk. |
| State intermediate besar bila disimpan sebagai artefak project. | Ruang kosong sistem operasi atau data milik aplikasi lain. |

- [Pengaturan penyimpanan](<https://phynitelab.com/account/storage>)

<a id="docs-saving-3"></a>

### Data intermediate Quantum ESPRESSO

Pilihan disk_io dan output intermediate QE dapat jauh lebih besar daripada hasil akhir. Data wavefunction/tmp mungkin diperlukan untuk band, DOS, fonon, workflow projected, atau interoperabilitas eksternal; jangan menghapusnya sebelum workflow lanjutan selesai. Simpan input eksak, identitas dan checksum pseudopotensial, provenance, serta artefak state bersama-sama.

Wannier90 adalah workflow eksternal/manual kecuali ada integrasi native yang didokumentasikan terpisah. Ikuti dokumentasi resmi Quantum ESPRESSO dan Wannier90; panduan ini tidak menyatakan adanya runner Wannier90 native.

- [Dokumentasi Quantum ESPRESSO](<https://www.quantum-espresso.org/documentation/>)
- [Dokumentasi Wannier90](<https://wannier.org/documentation/>)

<a id="docs-saving-4"></a>

### Perilaku Figure Lab

Figure Lab menyimpan draft lokal setelah sekitar 350 ms tanpa edit baru dan memulai sinkronisasi cloud sekitar 1,2 detik. Unggah dijalankan berurutan; edit selama unggah disimpan berikutnya.

Meninggalkan Figure Lab mem-flush draft yang masih tertunda. Kembali online atau memfokuskan halaman membantu mencoba lagi sinkronisasi yang tertunda. Kegagalan tetap ditampilkan sebagai kegagalan.

Tidak ada tombol Save revision yang wajib. Ctrl/Cmd+S merupakan checkpoint histori opsional.

<a id="docs-saving-5"></a>

### Batas saat ini

| Sumber daya | Batas |
| --- | --- |
| Snapshot Workspace | 4,5 MB per snapshot. |
| Dokumen riset | 4 MB per dataset, figur, atau template. |
| Sampel dataset | 250.000 titik per dataset. |
| Komposisi figur | 64 panel dan 32 layer per panel. |
| Checkpoint figur | 100 revisi eksplisit ditambah working copy otomatis. |
| Kuota Figure Lab | Berbagi kuota total cloud: Free 10 GiB atau kapasitas berbayar aktif. Revisi tersimpan dan reservasi upload dihitung. |
| Impor data | 20 MB file input; dokumen hasil tetap mengikuti batasnya. |
| Source package | 200 MB paket/JSON terpilih setelah ekstraksi, serta batas dokumen individual. |

<a id="docs-saving-6"></a>

### Salinan portabel

- Ekspor Source package untuk figur penting dan arsip project untuk studi lokal.
- Simpan struktur asli, input kalkulasi, identitas/checksum pseudopotensial, provenance, dan state intermediate yang dibutuhkan workflow lanjutan.
- Penyimpanan browser memiliki kuota perangkat dan hilang bila data situs dibersihkan.
- Archive mengatur daftar, bukan menghapus record atau membebaskan kuota.
- Inventaris storage akun memisahkan objek cloud dari kuota dokumen riset. Login Cloud tidak mengunggah project lokal; Cloud Sync diaktifkan per project.

<a id="docs-saving-7"></a>

### Topik terkait

- [Pengaturan, akun, profil, dan pemakaian](<#account>)
- [Mengelola paket, tagihan, dan pemakaian](<#billing>)
- [Phynite Cloud, Cloud Sync, dan compute online](<#cloud-sync>)

<a id="billing"></a>

## Mengelola paket, tagihan, dan pemakaian

Tagihan mengelola pembelian serta faktur Phynite Cloud pada website hosted. Aplikasi lokal membuka https://phynitelab.com/billing; compute lokal, akun AI, dan preferensi perangkat dikelola terpisah pada Pengaturan.

<a id="docs-billing-1"></a>

### Memeriksa akun

![Batas data workspace lokal, Cloud Sync project, dan compute cloud](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-id-light.png>)

Diagram konsep: login, sync project, dan transfer job adalah pilihan terpisah.

1. Buka Tagihan pada website Phynite. Dari aplikasi lokal, tautan membuka https://phynitelab.com/billing.
2. Periksa paket aktif, status langganan, dan alokasi per run yang berasal dari akun.
3. Pada Pemakaian tercatat, pilih Perbarui setelah kalkulasi selesai atau file cloud berubah.
4. Baca penggunaan Figure Lab dan file cloud saat ini. Storage berbayar berbagi satu kuota total untuk file cloud dan reservasi upload.
5. Pilih Ekspor pemakaian untuk mengunduh JSON bertanggal. Ekspor berisi pengukuran sumber daya, bukan tanda terima pembayaran.

<a id="docs-billing-2"></a>

### Aksi paket

| Paket | Aksi | Efek |
| --- | --- | --- |
| Free | Gunakan Free | Mencakup run DFT dan MD lokal. Aplikasi npm memakai runtime native tanpa login; website hosted memakai worker pribadi terhubung. |
| Cloud | Top-up Quanta | Akun early access memakai kredit produksi terverifikasi; pengunjung publik tetap melalui waitlist. Pembayaran tidak langsung menjalankan job. |
| Enterprise | Diskusikan kebutuhan | Membuka kontak untuk kapasitas dan ketentuan institusi. |

<a id="docs-billing-3"></a>

### Menafsirkan waktu dan penyimpanan

Waktu run menjumlahkan interval worker mulai sampai selesai yang valid. Persiapan, unggah, serta run gagal atau batal dapat termasuk bila timestamp lengkap.

Jam CPU teralokasi mengalikan durasi dengan core. Nilai ini bukan utilisasi CPU, konsumsi listrik, atau tarif.

Penyimpanan menghitung versi objek cloud saat ini. Versi lama, metadata, dan disk lokal tidak termasuk. Tanda plus berarti inventaris mencapai batas objek dan angka merupakan batas bawah.

Kuota Figure Lab mencakup dataset, dokumen figur, template, dan revisi. Mengarsipkan figur tidak menghapus record atau membebaskan kuota.

<a id="docs-billing-4"></a>

### Pembayaran dan faktur

Billing membuka checkout Phynite pada /billing/checkout setelah aktivasi merchant. Pilih Direct Virtual Account atau QRIS saat tersedia; DOKU memproses pembayaran. Virtual Account menambah Rp4.000; QRIS tanpa surcharge. Quanta dijual Rp18.000 per Quanta, mulai 0,5 Quanta (harga dasar Rp9.000, melalui VA Rp13.000). /billing/payments/[id] menampilkan instruksi dan status terverifikasi; /billing/history memuat 20 pembelian per halaman dengan filter status. Invoice hosted lama mempertahankan nominalnya. Pesanan dibuat, aktivasi terverifikasi, percobaan gagal dan kedaluwarsa terkonfirmasi menghasilkan notifikasi inbox; email transaksi diaktifkan setelah verifikasi SES, dengan pengirim dan balasan support@phynitelab.com. Kegagalan email tidak membatalkan pembayaran. Halaman tidak menerima nomor kartu. Penerbitan faktur pajak belum terhubung.

Akun early access memakai workflow Cloud yang tersedia pada katalog saat ini dengan Quanta produksi terverifikasi sesuai saldo dan kapasitas. MD tetap pada compute pribadi sampai layanan Cloud didukung. Pilot memakai grant admin; Institution mengikuti kesepakatan kapasitas. Komputasi lokal gratis, tetapi perangkat, internet, penyimpanan, dan listrik tetap menjadi tanggung jawab pengguna.

> Ekspor pemakaian dapat berisi nama dan ID kalkulasi. Bagikan hanya kepada kolaborator atau dukungan yang dituju.

<a id="docs-billing-5"></a>

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](<#saving>)
- [Pengaturan, akun, profil, dan pemakaian](<#account>)
- [Phynite Cloud, Cloud Sync, dan compute online](<#cloud-sync>)

<a id="storage-backup"></a>

## Storage, ekspor, backup, dan state QE besar

Storage lokal adalah disk yang tersedia untuk workspace terpilih. Storage Cloud adalah layanan akun dengan kuota dan retensi sendiri.

<a id="docs-storage-backup-1"></a>

### Yang diukur Storage lokal

![Inventaris project, file di luar inventaris, dan backup terpisah](<https://phynitelab.com/docs/guide/diagrams/storage-layers-id-light.png>)

Diagram konsep: inventaris project hanya sebagian penggunaan disk.

Data directory default adalah ~/.phynite-lab. Gunakan --data-dir bila disk yang lebih besar atau terpisah lebih sesuai. Mode lokal tidak memiliki kuota tetap 10 GiB dan tidak menghapus artefak otomatis setelah tujuh hari; ruang disk kosong adalah batas praktisnya.

| Dihitung | Di luar inventaris project |
| --- | --- |
| Struktur, input, konfigurasi, hasil selesai, trajectory, dan arsip project yang terinventarisasi. | Metadata SQLite, file instalasi solver/runtime, log worker, cache browser, dan file lain di disk. |
| State intermediate yang dipertahankan sebagai artefak project. | Ruang kosong sistem operasi dan data aplikasi lain. |

<a id="docs-storage-backup-2"></a>

### File intermediate dan wavefunction QE

- Pengaturan disk_io dan state sementara dapat jauh lebih besar daripada ringkasan SCF akhir.
- Data wavefunction dan tmp mungkin diperlukan untuk band, DOS, fonon, workflow projected, checkpoint, atau interoperabilitas eksternal.
- Jangan menghapus state intermediate sebelum semua workflow lanjutan selesai. Simpan input eksak, identitas dan checksum pseudopotensial, provenance, serta artefak state bersama-sama.
- Wannier90 adalah workflow eksternal/manual kecuali ada integrasi native yang didokumentasikan terpisah; ikuti kebutuhan handoff resminya.

- [Dokumentasi Quantum ESPRESSO](<https://www.quantum-espresso.org/documentation/>)
- [Dokumentasi Wannier90](<https://wannier.org/documentation/>)

<a id="docs-storage-backup-3"></a>

### Ekspor, impor, dan backup

![Inventaris storage dan arsip project](<https://phynitelab.com/docs/guide/storage-archives-desktop-light.png>)

Ekspor project penting dan verifikasi backup terpisah.

1. Ekspor arsip project dari Pengaturan → Penyimpanan sebelum memindahkan workspace atau melakukan perubahan destruktif.
2. Simpan backup kedua di luar ~/.phynite-lab, termasuk input eksak, identitas/checksum potential, provenance, dan state intermediate yang diperlukan workflow lanjutan.
3. Impor ke data directory baru terlebih dahulu dan periksa struktur, konfigurasi, hasil, serta checksum sebelum mengganti salinan kerja.
4. Gunakan Source package untuk figur; itu tidak menggantikan arsip project atau backup runtime solver.

- [Pengaturan penyimpanan](<https://phynitelab.com/account/storage>)

<a id="docs-storage-backup-4"></a>

### Topik terkait



<a id="settings-reference"></a>

## Pengaturan, preferensi, profil, dan pemakaian

Pengaturan memisahkan preferensi perangkat, compute scientific, akun AI provider, status akun Cloud, pemakaian, storage, dan privasi.

<a id="docs-settings-reference-1"></a>

### Memilih halaman yang tepat

![Preferensi tampilan dan bahasa](<https://phynitelab.com/docs/guide/appearance-settings-desktop-light.png>)

Preferensi perangkat terpisah dari pengaturan akun Cloud.

| Halaman | Fungsi | Tempat tersimpan |
| --- | --- | --- |
| Tampilan & bahasa | Tema, aksen, kepadatan, ukuran teks, reduced motion, dan bahasa. | Browser/perangkat ini. |
| Pintasan keyboard | Binding aplikasi yang didukung. | Browser/perangkat ini. |
| Notifikasi | Alert job/runtime dan izin desktop. | Browser/perangkat ini; delivery hosted mengikuti akun. |
| Komputasi | Instalasi runtime, probe isolasi, default CPU/RAM/job, dan transfer Cloud. | Workspace lokal atau akun Cloud sesuai kontrolnya. |
| Akun provider AI | Login provider, pergantian akun, kesiapan model, limit, dan reset. | CLI provider/credential store lokal. |
| Akun | Login/logout Phynite Cloud dan sync per project. | Akun Cloud; data lokal tetap lokal. |
| Profil | Identitas riset yang tampil setelah login Cloud. | Akun Cloud. |
| Pemakaian | Job scientific dan pemakaian AI yang dilaporkan provider. | Record eksekusi/provider nyata. |
| Penyimpanan / Privasi | Inventaris project, arsip, session, dan batas data lokal. | Workspace lokal dan browser. |

<a id="docs-settings-reference-2"></a>

### Tema, notifikasi, dan pintasan

Perubahan Appearance langsung berlaku dan tetap device-only kecuali halaman secara eksplisit menawarkan default akun Cloud. Light, dark, system, aksen, kepadatan, ukuran teks kode, reduced motion, dan bahasa dapat diatur terpisah.

Preferensi notifikasi mengatur alert job/runtime lokal dan izin browser. Preferensi itu tidak membuat session Cloud atau mengunggah project.

Perubahan keyboard berlaku untuk binding aplikasi yang didukung pada browser ini. Shortcut browser dan sistem operasi dapat tetap mengambil alih.

<a id="docs-settings-reference-3"></a>

### Profil dan visibilitas login

Workspace lokal tanpa login Cloud tidak menampilkan user profile. Hubungkan akun Cloud sebelum membuka Profil; logout menghapus kontrol profil tetapi mempertahankan project dan identitas lokal.

Login AI provider terpisah dari login Cloud. Akun provider dapat dihubungkan saat Phynite Cloud tetap logout.

<a id="docs-settings-reference-4"></a>

### Topik terkait

- [Tampilan, bahasa, dan aksesibilitas](<#language>)

<a id="language"></a>

## Tampilan, bahasa, dan aksesibilitas

Pengaturan → Tampilan & bahasa mengatur browser ini. Tema, aksen, kepadatan, ukuran teks, motion, dan bahasa langsung berlaku tanpa mengubah akun Phynite atau input ilmiah.

<a id="docs-language-1"></a>

### Memilih tampilan

![Kontrol bahasa pada pengaturan tampilan](<https://phynitelab.com/docs/guide/appearance-settings-desktop-light.png>)

Bahasa antarmuka mengubah label, bukan data atau satuan ilmiah.

1. Pilih Sistem, Terang, atau Gelap untuk browser ini. Sistem mengikuti warna OS; warna latar/teks kustom opsional memerlukan kontras minimal 4,5:1.
2. Pilih aksen serta kepadatan nyaman/ringkas yang tersedia, lalu atur ukuran teks antarmuka dan kode dalam rentang yang ditampilkan.
3. Aktifkan reduced motion bila diinginkan. Kembalikan default mengatur ulang kontrol perangkat.
4. Nilai tersimpan pada browser serta origin situs ini. Perangkat, browser, atau port lokal lain dapat memakai pilihan berbeda; menghapus data situs meresetnya.

> Skala teks antarmuka dan tema tidak mengubah dimensi ekspor figur, sampel plot, satuan, atau pengaturan solver.

<a id="docs-language-2"></a>

### Memilih bahasa

1. Buka Pengaturan → Tampilan & bahasa.
2. Pilih English, Bahasa Indonesia, atau deteksi otomatis dari preferensi browser.
3. Buka halaman lain atau muat ulang untuk memeriksa pilihan. Preferensi tetap pada browser ini dan bukan default akun cloud.

<a id="docs-language-3"></a>

### Deteksi bahasa otomatis

Pilihan eksplisit didahulukan. Mode otomatis membaca bahasa browser/perangkat yang didukung sesuai urutannya. Respons server pertama dapat memakai header bahasa dan, pada website hosted, petunjuk negara edge. English menjadi fallback bila tidak ada bahasa didukung.

Phynite tidak meminta GPS atau memakai layanan lokasi IP terpisah untuk memilih bahasa. Saran tidak menimpa pilihan eksplisit. Browser berbeda dapat memakai bahasa berbeda.

<a id="docs-language-4"></a>

### Teks ilmiah dan data

Keyword solver, simbol kimia, label keyboard, data numerik, dan teks publikasi pengguna tidak diterjemahkan menjadi makna ilmiah lain. QE serta CSV mempertahankan sintaks parser.

Dokumentasi English memakai /guide/topik dan Indonesia /id/guide/topik. Pergantian bahasa mempertahankan topik aktif; unduhan memakai bahasa terpilih.

<a id="docs-language-5"></a>

### Keyboard, notifikasi, dan keterbacaan

- Tab memindahkan fokus antarkontrol; cincin fokus menunjukkan kontrol aktif. Enter/Space mengaktifkan kontrol dan Escape menutup menu/dialog yang mendukung.
- Sesuaikan hanya aksi aplikasi yang terdaftar dan bekerja pada Pengaturan → Pintasan keyboard. Pintasan editor mempertahankan konteksnya dan field teks memakai penyuntingan native.
- Gunakan Pengaturan → Notifikasi untuk alert job/runtime lokal dan izin desktop opsional. Aplikasi harus tetap terbuka; pengaturan lokal tidak mengaktifkan pengiriman email cloud.
- Pencarian dokumentasi memakai Primary+K atau / di luar field teks. Pada mobile, buka daftar isi saat diperlukan.
- Pilihan reduced motion perangkat serta preferensi motion sistem operasi yang didukung mengurangi transisi dekoratif.

<a id="docs-language-6"></a>

### Topik terkait

- [Pengaturan, preferensi, profil, dan pemakaian](<#settings-reference>)

<a id="results"></a>

## Membuka dan menafsirkan hasil

Gunakan Log untuk bukti eksekusi dan unduhan. Gunakan Figure Lab untuk pengeditan plot, perbandingan, tata letak, serta ekspor publikasi.

<a id="docs-results-1"></a>

### Membuka hasil langsung

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

1. Temukan run selesai di Log.
2. Periksa pesan konvergensi dan ringkasan numeriknya.
3. Pilih Open in Figure Lab bila hasil memiliki data numerik yang dapat diplot.
4. Figur aktif yang terakhir diedit dan memakai run itu dibuka kembali. Jika belum ada, Figure Lab mengimpor sumber dan menyiapkan figur.
5. Jika sumber tersimpan belum dapat dimuat, gunakan Retry, periksa ketersediaan sumber, atau impor file numerik asli.

<a id="docs-results-2"></a>

### Data numerik dan preview

PNG preview merupakan gambar. Dataset numerik menyimpan sampel dan metadata agar dapat diatur ulang, disejajarkan, dan diekspor kembali.

Output kalkulasi baru yang didukung menyimpan dataset riset ringkas terpisah dari akses artefak mentah sementara. Run lama tanpa data tersimpan dapat membutuhkan CSV/teks asli atau eksekusi baru.

Jendela akses artefak biasa umumnya tiga hari. Pembersihan penyimpanan merupakan konfigurasi terpisah. Tautan unduh kedaluwarsa tidak membuktikan dataset riset tersimpan ikut hilang.

<a id="docs-results-3"></a>

### Interpretasi fisik

- Estimasi band gap membutuhkan okupansi atau referensi energi yang bermakna. Fermi yang tidak diketahui bukan Fermi nol.
- Normalisasi DOS harus mengacu ke sel, atom, satuan formula, atau volume yang benar.
- Frekuensi fonon imajiner dapat menunjukkan ketidakstabilan atau konvergensi belum cukup; periksa modelnya.
- Transport bergantung pada interpolasi, sampling, temperatur, potensial kimia, dan waktu relaksasi. Konduktivitas dibagi waktu relaksasi bukan konduktivitas absolut tanpa waktu yang dijustifikasi.

<a id="docs-results-4"></a>

### Topik terkait

- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)
- [Studi banyak material dan variasi parameter](<#studies>)

<a id="research-history"></a>

## Histori run, konteks riset, dan bukti

Gunakan Run history untuk percobaan eksekusi dan pembatalan. Gunakan Research context untuk timeline project, ledger run ringkas, perbandingan terbaru, dan konteks AI read-only. Panel ini melaporkan bukti tersimpan; panel tidak menggantikan log solver atau validasi ilmiah.

<a id="docs-research-history-1"></a>

### Temukan catatan project saat ini

![Histori run project dan percobaan tercatat](<https://phynitelab.com/docs/guide/run-history-desktop-light.png>)

Periksa project terpilih dan penyebab pertama yang tercatat; tidak ada output solver yang dibuat-buat.

1. Buka Canvas project. Pilih ikon jam/histori berlabel Run history untuk melihat run, waktu pembuatannya, status percobaan tiap modul, dan error tercatat.
2. Periksa Execution result pada modul tertentu untuk ringkasan numerik, Execution log, unduhan artefak, dan pratinjau trajectory bila tersedia. Eksekusi lama dapat ditandai Outdated setelah setup saat ini berubah.
3. Gunakan Cancel branch untuk cabang modul aktif atau Cancel run untuk workflow aktif. Tunggu status akhir sebelum mengirim ulang; permintaan pembatalan belum berarti proses selesai berhenti.
4. Pilih ikon garis aktivitas berlabel Research context. Refresh research context memuat ulang bukti tercatat untuk project ini.

<a id="docs-research-history-2"></a>

### Baca ledger, timeline, dan ringkasan terbaru

Run ledger menampilkan hingga delapan catatan terbaru beserta nama atau jenis, timestamp, status, kategori/alasan kegagalan tercatat, dan checksum input bila tersedia. Timeline menampilkan hingga delapan event project terbaru yang tercatat. Daftar kosong berarti belum ada bukti yang dikembalikan, bukan bahwa kalkulasi tak tercatat berhasil.

Summarize latest run menampilkan status catatan terbaru dan ringkasan hasil yang tersedia, checksum, alokasi CPU/RAM, serta apakah provenance tercatat. Nilai yang hilang tetap tidak tersedia. Ringkasan singkat disusun dari catatan tersimpan; ini bukan kalkulasi AI baru.

Alokasi CPU dan memori menggambarkan anggaran job yang diminta atau efektif. Nilai ini bukan utilisasi CPU terukur atau RAM puncak. Gunakan catatan eksekusi dan log aktual untuk waktu tercatat dan kegagalan resource.

<a id="docs-research-history-3"></a>

### Bandingkan run terbaru tanpa interpretasi berlebihan

1. Selesaikan minimal dua run dalam project. Compare recent runs tetap nonaktif sampai tersedia dua catatan selesai.
2. Pilih Compare recent runs. Perbandingan ringkas saat ini memilih dua run selesai terbaru dan menampilkan status, checksum input, serta waktu selesai.
3. Buka artefak input dan hasil asli sebelum membandingkan energi, konvergensi, trajectory, atau runtime. Panel tidak otomatis membuktikan kesamaan struktur, force field, pseudopotensial, normalisasi, atau kondisi fisik.
4. Untuk overlay ilmiah atau seri parameter, siapkan dataset numerik kompatibel di Figure Lab dan catat satuan serta konvensi referensi. Gunakan panel terpisah jika sumber tidak sebanding.

> Ini adalah perbandingan metadata run terbaru, bukan plot multi-run bebas atau penilaian konvergensi otomatis. Checksum berbeda menunjukkan byte input tercatat berbeda; checksum sama saja bukan bukti kondisi eksekusi identik.

- [Rencanakan studi konvergensi](<#convergence>)
- [Selaraskan data ilmiah](<#alignment>)

<a id="docs-research-history-4"></a>

### Berikan konteks riset yang dapat ditelusuri ke AI lokal

AI lokal berarti koneksi dan pengelolaan kredensial berjalan di komputer Anda. Provider terpilih dapat memproses prompt dan konteks yang dikirim sesuai ketentuan layanannya. Jangan sertakan riset rahasia dalam permintaan provider kecuali Anda memang ingin membagikannya kepada provider tersebut.

1. Hubungkan provider lokal yang tersedia pada Pengaturan → AI provider accounts. Login Cloud tidak diperlukan untuk koneksi ini.
2. Pada Research context, pilih Add context to local AI. Konteks project muncul sebagai sumber read-only di workspace AI.
3. Ajukan pertanyaan terbatas, misalnya mengidentifikasi kegagalan terbaru atau menjelaskan perbedaan input tercatat. Minta respons menyebut run atau artefak yang dipakai, lalu periksa buktinya sendiri.
4. Periksa perubahan ilmiah yang diusulkan melalui alur approval yang ada. Menambahkan bukti read-only tidak memberi izin mengedit struktur, menjalankan solver, atau mengganti potential.

- [Login provider dan model tidak tersedia](<#ai-providers>)

<a id="docs-research-history-5"></a>

### Bukti kegagalan, notifikasi, dan visibilitas tim

Aktifkan alert job/runtime lokal pada Pengaturan → Notifications untuk mengetahui perubahan status aktual saat aplikasi terbuka. Alert adalah petunjuk menuju catatan tersimpan; simpan log dan provenance sebelum mencoba lagi.

| Sinyal | Interpretasi |
| --- | --- |
| Penolakan preflight atau setup | Perbaiki prasyarat runtime, isolasi, sumber, potential, atau validasi sebelum run baru. Log solver tidak ada bila solver belum pernah dimulai. |
| Kegagalan solver, resource, atau artefak | Baca penyebab pertama yang tercatat dan log terkait. Kegagalan saat menyimpan artefak tidak berarti proses numerik belum pernah berjalan. |
| Recover saved result muncul | Aplikasi lokal menemukan output yang dapat dipulihkan. Aksi memverifikasi dan mengimpor hasil tersimpan; tidak menjalankan ulang solver. |
| Local context only | Sync project belum aktif. Login Cloud saja tidak memublikasikan project ini. |
| Team visibility enabled | Project sudah memiliki cakupan Cloud Sync yang disetujui dan revisi tercatat. Panel tidak membuat izin berbagi atau mengunggah file tambahan. |

- [Temukan tahap workflow yang gagal](<#diagnostics>)
- [Cakupan Cloud, konflik, dan batas akun](<#cloud-sync>)

<a id="docs-research-history-6"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="figures"></a>

## Menyusun figur

Figure Lab menyediakan pustaka hasil di kiri, halaman publikasi di tengah, dan Inspector di kanan. Pada layar kecil, Results dan Inspector dibuka sebagai panel geser.

<a id="docs-figures-1"></a>

### Memilih tata letak

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

| Layout | Pemakaian | Pemeriksaan |
| --- | --- | --- |
| Single plot | Satu hasil dengan satu pesan. | Besaran, satuan, sumbu, dan judul. |
| Overlay | Beberapa kurva dengan koordinat fisik sebanding. | Lintasan, referensi energi, normalisasi, dan legenda. |
| One panel per result | Material atau hasil yang memerlukan panel mandiri. | Dimensi dan rentang yang adil. |
| Band + DOS pairs | Dispersi berdampingan dengan DOS terkait. | Identitas geometri dan elektronik serta konvensi energi. |
| Parameter series | Urutan strain, tekanan, temperatur, atau variasi lain. | Nama parameter, satuan, dan nilai numerik. |

<a id="docs-figures-2"></a>

### Menyusun halaman

1. Pilih hasil selesai pada project aktif dan impor dataset numeriknya.
2. Cari dan pilih dataset pembanding.
3. Pilih layout. Satu dataset boleh digunakan di beberapa figur tanpa mengubah sampel aslinya.
4. Tentukan lebar dan tinggi dalam milimeter sesuai ukuran kolom jurnal.
5. Pilih panel dari kanvas atau Inspector. Atur rentang, bentang panel, urutan, legenda, dan sumbu terhubung.
6. Gunakan kontrol Data untuk nama layer, channel, penggantian sumber, warna, dan gaya garis.
7. Periksa catatan konteks ilmiah, tunggu penyimpanan cloud selesai, lalu ekspor.

<a id="docs-figures-3"></a>

### Interaksi kanvas

Tombol + dan - mengubah pembesaran halaman; 0 atau Fit menyesuaikan dengan area kanvas. Rentangnya 25 sampai 400 persen terhadap tampilan yang sudah di-fit.

Space+drag, Alt+drag, atau drag tombol tengah menggeser halaman. Ctrl/Cmd+scroll memperbesar tampilan. Klik panel plot untuk mengeditnya.

Zoom kanvas tidak mengubah dimensi ekspor, batas sumbu, atau nilai data. Untuk mengubah rentang plot, gunakan minimum dan maksimum panel.

> Garis dan marker dipotong pada kotak sumbu. Simbol Γ menunjukkan pusat zona Brillouin; metadata sumber tetap dipertahankan.

<a id="docs-figures-4"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)
- [Studi banyak material dan variasi parameter](<#studies>)

<a id="alignment"></a>

## Energi, lintasan k, dan normalisasi DOS

Perbandingan bisa terlihat rapi sambil mencampur referensi fisik yang tidak sesuai. Tentukan makna setiap sumbu sebelum mengubah tampilannya.

<a id="docs-alignment-1"></a>

### Penyelarasan energi

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

| Mode | Makna | Interpretasi |
| --- | --- | --- |
| Source energy | Mempertahankan referensi numerik impor. | Gunakan bila konvensi sumber dipahami. |
| Each Fermi = 0 | Menggeser tiap dataset dengan Fermi masing-masing. | Membandingkan bentuk relatif, bukan offset band absolut. |
| Each VBM = 0 | Menggeser terhadap maksimum band valensi tercatat. | Bandingkan fitur relatif terhadap tepi valensi yang bermakna. |
| Vacuum alignment | Memakai referensi vakum tercatat. | Perbandingan referensi bersama jika vakumnya dijustifikasi. |
| Manual shift | Menerapkan offset energi eksplisit. | Catat metode dan besar offset yang digunakan. |

<a id="docs-alignment-2"></a>

### Band + DOS

Pasangan terverifikasi memerlukan identitas geometri dan sumber elektronik yang sesuai serta data relatif Fermi yang kompatibel. Nama file atau rumus kimia sama belum cukup.

Layout pasangan memakai sumbu energi vertikal bersama, umumnya dengan rasio lebar 2:1. Batas energi yang terhubung diperbarui pada kedua panel.

Mengganti satu sumber dengan kalkulasi yang tidak terkait membatalkan klaim pasangan terverifikasi. Gunakan panel perbandingan biasa jika sumber memang berbeda.

<a id="docs-alignment-3"></a>

### Kompatibilitas lintasan k

Label Γ, X, atau K tidak cukup untuk memastikan koordinat resiprok sama. Basis sel, titik ujung, dan koordinat segmen perlu diperiksa.

Normalisasi segmen dapat menyelaraskan titik ujung ketika metadata memadai, tetapi mengubah skala horizontal yang ditampilkan.

Cabang lintasan yang terputus harus tetap dipisahkan. Menghubungkan ujung cabang berbeda menghasilkan band kontinu yang tidak berasal dari data.

<a id="docs-alignment-4"></a>

### DOS dan spin

- DOS QE sering dinormalisasi per sel. Jangan menamainya per atom tanpa konversi.
- Normalisasi per atom, satuan formula, atau volume membutuhkan metadata jumlah atau volume yang benar.
- Pencerminan spin-down hanya cara visual membedakan channel; DOS fisik tidak menjadi negatif.
- Bedakan total DOS, proyeksi orbital/atom, dan kolom numerik umum. Nama channel harus menjelaskan besaran sebenarnya.

<a id="docs-alignment-5"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Studi banyak material dan variasi parameter](<#studies>)

<a id="studies"></a>

## Studi banyak material dan variasi parameter

Pilih layout berdasarkan perbandingan ilmiah, kemudian gunakan gaya yang konsisten. Tidak semua hasil perlu dipaksakan ke satu overlay yang padat.

<a id="docs-studies-1"></a>

### Banyak material dalam paper

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

1. Simpan struktur dalam satu project studi dengan identitas sumber jelas.
2. Dokumentasikan perbedaan dan pendekatan metode secara konsisten.
3. Jalankan band atau DOS untuk tiap material.
4. Gunakan grid ketika lintasan k atau skala energi sangat berbeda. Overlay hanya untuk koordinat dan referensi yang mendukung.
5. Namai layer berdasarkan material, gunakan sedikit warna yang jelas, dan tulis referensi energi.
6. Simpan layout sebagai template untuk material berikutnya.

<a id="docs-studies-2"></a>

### Satu material pada beberapa strain

1. Duplikasikan struktur referensi sebelum memberi strain.
2. Catat apakah strain uniaksial, biaksial, volumetrik, atau tensor lain; satu angka persen tidak mewakili seluruh tensor.
3. Gunakan kendala relaksasi dan pengaturan elektronik yang konsisten.
4. Untuk tiap dataset, masukkan nama parameter kondisi, satuan, dan nilai numerik yang sejenis.
5. Pilih Parameter series untuk urutan numerik termasuk strain negatif.
6. Bandingkan memakai referensi energi yang dijustifikasi dan jelaskan normalisasi lintasan bila digunakan.

<a id="docs-studies-3"></a>

### Band berdampingan dengan DOS

1. Pastikan geometri dan asumsi elektronik kedua kalkulasi sesuai.
2. Muat kedua dataset numerik ke Figure Lab.
3. Pilih Band + DOS pairs dan baca catatan kompatibilitas.
4. Tentukan interval energi vertikal bersama dan titik nolnya.
5. Atur kepadatan garis serta rentang horizontal DOS tanpa mengubah skala energi bersama.
6. Ekspor figur vektor dan Source package.

<a id="docs-studies-4"></a>

### Konvergensi dan temperatur

Gunakan dataset numerik umum untuk besaran turunan seperti energi per atom terhadap cutoff, atau dataset transport yang sesuai bila tersedia.

Catat parameter dan satuan dengan jelas. Tambahkan ketidakpastian serta asumsi metode pada caption atau metadata; banyak digit desimal bukan bukti presisi.

Template menjaga dimensi dan tipografi stabil di seluruh paper sementara provenance tiap dataset tetap tersimpan.

<a id="docs-studies-5"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="reuse"></a>

## Template, penggantian sumber, dan histori

Gunakan kembali pengaturan visual sambil mempertahankan identitas sumber numerik. Template menjelaskan layout; figur menghubungkan layout dengan dataset tertentu.

<a id="docs-reuse-1"></a>

### Memakai template

![Inventaris project, file di luar inventaris, dan backup terpisah](<https://phynitelab.com/docs/guide/diagrams/storage-layers-id-light.png>)

Diagram konsep: inventaris project hanya sebagian penggunaan disk.

1. Selesaikan layout, tipografi, susunan panel, dan gaya layer pada contoh figur.
2. Simpan sebagai template. Ikatan sumber menjadi slot yang dapat dipakai ulang.
3. Pilih dataset pengganti mengikuti urutan slot lalu terapkan template.
4. Periksa judul, besaran, dan channel setelah sumber dihubungkan.
5. Edit caption khusus sendiri; template tidak mengetahui kesimpulan ilmiah studi baru.

<a id="docs-reuse-2"></a>

### Mengganti dataset

Gunakan Replace source pada layer terpilih. Warna, gaya garis, dan pengaturan channel yang kompatibel dipertahankan. Judul otomatis mengikuti sumber baru, sementara teks khusus tetap dapat diedit.

Mengubah metadata sumber menghasilkan identitas dataset baru. Figur lama tetap memakai sumber awal sampai diganti secara eksplisit.

Inset dapat memakai slot sumber yang sama dengan batas sendiri tanpa menyalin atau melakukan resampling data asli.

<a id="docs-reuse-3"></a>

### Undo dan penyimpanan

- Undo/redo mencakup sampai 50 langkah pada sesi Figure Lab saat ini.
- Edit rutin disimpan otomatis; Ctrl/Cmd+S dapat membuat checkpoint eksplisit di History.
- Edit otomatis memperbarui working copy sehingga tidak menghasilkan revisi permanen tanpa batas.
- History menyediakan versi tersimpan untuk diperiksa dan dipulihkan menjadi figur aktif yang dapat diedit.
- Jika tab atau perangkat lain mengubah revisi cloud, penimpaan otomatis berhenti. Periksa versi lokal dan cloud sebelum memilih.

<a id="docs-reuse-4"></a>

### Arsip dan project lain

Archive menyembunyikan figur dari daftar aktif dan menyediakan Restore. Arsip bukan penghapusan dan tidak membebaskan kuota histori.

Include other projects menampilkan dataset milik akun Anda dari studi lain, bukan akses ke akun lain.

Impor Source package menyalin figur dan sumber ke project yang dipilih; hash sumber diperiksa ketika tersedia.

<a id="docs-reuse-5"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="advanced"></a>

## PDOS, unfolding, dan inset

Gunakan fitur khusus ketika data yang diperlukan benar-benar tersedia. Pengaturan visual tidak dapat menghasilkan informasi fisik yang tidak dihitung oleh sumbernya.

<a id="docs-advanced-1"></a>

### Projected density of states

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

Pilih channel proyeksi yang tersedia pada dataset dan beri label atom, unsur, atau orbital sesuai metadata. Jangan menafsirkan kolom total DOS sebagai proyeksi.

Penjumlahan proyeksi dapat bergantung pada basis proyektor dan konvensi solver. Perbedaan terhadap DOS total tidak selalu merupakan kesalahan plot.

Gunakan warna dan legenda yang membedakan proyeksi; periksa satuan, normalisasi, dan spin sebelum menggabungkan channel.

<a id="docs-advanced-2"></a>

### Band unfolding

Tampilan unfolding membutuhkan data spektral berbobot yang telah dihitung dengan pemetaan sel primitif dan supercell yang sesuai. Bobot menentukan intensitas titik atau representasi spektral.

Memuat band supercell biasa tidak otomatis menghasilkan unfolding. Simpan metode, pemetaan sel, koordinat k, dan makna bobot bersama dataset.

Periksa batas ukuran data serta koordinat lintasan sebelum ekspor. Transparansi visual bukan pengganti normalisasi bobot yang jelas.

<a id="docs-advanced-3"></a>

### Inset

1. Pilih panel induk yang memerlukan detail.
2. Tambahkan inset dan pilih sumber atau layer yang sesuai.
3. Atur posisi, ukuran, serta batas sumbu inset secara independen.
4. Periksa agar inset tidak menutupi legenda, label, atau fitur utama.
5. Jelaskan wilayah dan besaran yang diperbesar pada caption; ekspor pada ukuran akhir untuk memeriksa keterbacaan.

<a id="docs-advanced-4"></a>

### Batas interpretasi

Metadata yang tidak diketahui harus tetap dinyatakan tidak diketahui. Jangan mengisi geometri, Fermi, degenerasi, atau bobot dengan nilai buatan agar suatu layout terlihat terverifikasi.

Gunakan dokumentasi solver pembentuk proyeksi atau unfolding untuk asumsi dan satuannya. Figure Lab mempertahankan data yang diimpor, bukan memvalidasi seluruh metode ilmiah hulu.

<a id="docs-advanced-5"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="export"></a>

## Ekspor dan reproduksibilitas figur

Pilih format berdasarkan tujuan pemakaian. Simpan figur yang sudah dirender bersama data dan pengaturannya agar dapat dibuka kembali.

<a id="docs-export-1"></a>

### Format tersedia

![Inventaris project, file di luar inventaris, dan backup terpisah](<https://phynitelab.com/docs/guide/diagrams/storage-layers-id-light.png>)

Diagram konsep: inventaris project hanya sebagian penggunaan disk.

| Format | Pemakaian | Sifat |
| --- | --- | --- |
| SVG | Pengeditan vektor dan web. | Path vektor; pertahankan informasi font yang diberikan. |
| PDF | Pengiriman paper dan tata letak dokumen. | Vektor dengan teks yang dapat dipilih dan font publikasi tertanam. |
| PNG | Slide, preview, dan alur raster. | Piksel ditentukan dari milimeter dan DPI; maksimal 40 megapiksel. |
| Source package | Arsip, kolaborasi, dan pengeditan ulang. | JSON figur, dataset, SVG, lisensi font, identitas sumber, dan checksum. |

<a id="docs-export-2"></a>

### Prosedur ekspor

1. Gunakan lebar kolom jurnal; 85 mm dan 180 mm hanyalah contoh umum.
2. Tentukan ukuran huruf dalam point dan periksa label, legenda, serta huruf panel pada ukuran akhir.
3. Periksa batas minimum/maksimum, clipping, satuan, simbol Γ, dan referensi energi.
4. Pilih SVG atau PDF untuk grafik garis ketika penerbit menerima vektor.
5. Untuk PNG, tentukan DPI dan periksa dimensi piksel hasilnya.
6. Unduh Source package dan simpan bersama input eksekusi serta catatan metode.

<a id="docs-export-3"></a>

### Fidelity dan batasnya

Renderer mempertahankan vertex garis. Penyelarasan, normalisasi, warna, dan pencerminan spin mengubah tampilan sementara sampel asli tetap disimpan.

Font publikasi harus dapat dimuat dari frontend atau cache browser. Ekspor menampilkan kegagalan ketika sumber wajib tidak tersedia; sambungkan internet dan coba lagi.

Source package mereproduksi figur. Mengulang simulasi juga membutuhkan lingkungan komputasi, pseudopotensial yang kompatibel, input lengkap, dan data antara yang diperlukan.

<a id="docs-export-4"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="publication"></a>

## Prosedur: menyiapkan figur publikasi

Siapkan perbandingan fisik terlebih dahulu, kemudian geometri halaman, tipografi, dan ekspor. Sertakan sumber yang dapat diedit untuk setiap figur yang dikirim.

<a id="docs-publication-1"></a>

### Kompatibilitas sumber

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

1. Buka hasil selesai di Figure Lab atau pilih dataset tersimpan dari pustaka hasil.
2. Periksa besaran, satuan, identitas geometri, referensi energi, dan metadata lintasan k.
3. Pilih grid untuk lintasan berbeda; overlay hanya untuk koordinat dan referensi yang sebanding.
4. Untuk Band + DOS, periksa geometri dan asumsi elektronik pasangan serta rentang energi terhubung.
5. Jelaskan konvensi alignment. Each Fermi = 0 membandingkan struktur elektronik relatif, bukan offset band absolut.

<a id="docs-publication-2"></a>

### Mengatur halaman

| Kontrol | Pilihan praktis | Verifikasi |
| --- | --- | --- |
| Lebar / tinggi | Dimensi jurnal tujuan. | PDF lebar kolom tetap terbaca pada ukuran 100%. |
| Tipografi | Satu font publikasi dan hierarki sederhana. | Label sumbu, tick, legenda, dan huruf panel punya peran berbeda. |
| Gaya garis | Warna ditambah dash atau marker bila perlu. | Kurva dapat dibedakan dalam grayscale dan variasi penglihatan warna. |
| Batas | Rentang sebanding bila dijustifikasi. | Tidak menyembunyikan data dengan crop yang tidak dijelaskan; garis tetap di dalam kotak. |
| Legenda | Material atau kondisi dengan satuan. | ID run bukan satu-satunya deskripsi ilmiah. |
| Inset | Detail dengan posisi dan rentang eksplisit. | Sumber serta wilayah yang diperbesar dapat dikenali. |

<a id="docs-publication-3"></a>

### Ekspor dan pemeriksaan

1. Tunggu Figure Lab mengonfirmasi penyimpanan terbaru. Pekerjaan native lokal tetap pada komputer ini; perangkat lain memerlukan ekspor portabel atau Cloud Sync aktif dan terkonfirmasi secara eksplisit.
2. Pilih PDF/SVG untuk vektor atau tentukan ukuran fisik serta DPI sebelum PNG.
3. Buka hasil pada aplikasi manuskrip. Periksa skala fisik, simbol Yunani, font, label panel, dan clipping.
4. Ekspor Source package terpisah. Simpan di samping figur dan input simulasi yang dijalankan.
5. Jika sumber atau metode berubah, ganti dataset secara eksplisit, periksa kembali legenda serta referensi, dan ekspor versi baru.

<a id="docs-publication-4"></a>

### Catatan untuk caption

Daftar ini membantu penulis memeriksa bukti, bukan menghasilkan klaim ilmiah otomatis. Isi hanya informasi yang didukung kalkulasi serta sumber numerik tersimpan.

```text
Besaran dan material:
Sumber struktur dan sel:
Metode, fungsional, pseudopotensial:
Sampling k/q dan konvergensi:
Referensi energi dan normalisasi:
Nilai parameter dan satuan:
Arti warna, garis, dan panel:
Source package dan ID run:
```

<a id="docs-publication-5"></a>

### Topik terkait

- [Membuka dan menafsirkan hasil](<#results>)
- [Menyusun figur](<#figures>)
- [Energi, lintasan k, dan normalisasi DOS](<#alignment>)

<a id="troubleshooting"></a>

## Pemecahan masalah dan pemulihan

Mulai dari pesan yang terlihat dan tahap pertama yang gagal. Simpan data lokal yang belum tersinkron sebelum mencoba pemulihan yang menghapus data browser.

<a id="docs-troubleshooting-1"></a>

### Diagnosis run npm lokal

![Diagnosis preflight, eksekusi solver, dan penyimpanan hasil secara terpisah](<https://phynitelab.com/docs/guide/diagrams/failure-stages-id-light.png>)

Diagram konsep: periksa tahap pertama yang gagal sebelum mencoba lagi.

Status Completed berarti proses dan persistence yang diwajibkan selesai; itu belum membuktikan konvergensi atau validitas scientific. Simpan input eksak dan log gagal sebelum mencoba ulang. Percobaan baru harus memakai perubahan yang ditinjau secara eksplisit.

| Tahap | Makna | Tempat memeriksa |
| --- | --- | --- |
| Sebelum solver dimulai | Setup, runtime, potential, validasi input, isolasi, atau kesiapan worker menolak job. Tidak ada output solver. | Run review, Pengaturan → Komputasi, phynite-lab doctor, dan log data directory terpilih. |
| Queued | Job menunggu dependency atau worker lokal yang tersedia. | Status job, record dependency, status worker, dan histori notifikasi. |
| Setelah solver dimulai | Solver atau analisis mengembalikan error atau terinterupsi. | Execution log, error solver pertama yang bermakna, input tersimpan, provenance, dan artefak. |
| Persistence/upload | Kalkulasi mungkin selesai tetapi penyimpanan atau transfer gagal. | Status hasil, checksum/provenance, inventaris storage, jaringan, dan status transfer Cloud. |

<a id="docs-troubleshooting-2"></a>

### Urutan pemulihan launcher

1. Jalankan phynite-lab status dengan --data-dir yang sama saat aplikasi dijalankan.
2. Jalankan phynite-lab doctor dan catat diagnosis distribusi, port, runtime, dan path data.
3. Baca log service serta worker terbaru di data directory terpilih.
4. Jika instance sehat, buka origin loopback yang dicetak dan jangan membuat workspace baru.
5. Jika aktivasi update atau runtime gagal, pertahankan runtime aktif sebelumnya, perbaiki penyebabnya, lalu coba lagi dari Pengaturan → Komputasi.
6. Setelah restart, periksa job yang terinterupsi; job lokal tidak dijalankan ulang otomatis.

<a id="docs-troubleshooting-3"></a>

### Masalah umum

| Masalah | Tindakan |
| --- | --- |
| Tidak dapat masuk | Periksa koneksi, status akun, dan kredensial; ulangi login dari halaman resmi. |
| Project belum muncul | Tunggu pemuatan akun dan sinkronisasi; pastikan akun yang digunakan sama. |
| Struktur terlihat aneh | Periksa satuan, basis, jumlah atom, dan koordinat fraksional/Cartesian. |
| Nonperiodik tetapi masih ada sel | QE memerlukan sel 3D; checkbox tampilan bukan penghapus kisi. |
| Queued terlalu lama | Periksa tujuan compute, worker, kapasitas, dan dependensi. |
| SCF tidak konvergen | Periksa geometri, okupansi, magnetisme, mixing, dan cutoff. |
| Hasil lama tidak terbuka di Figure Lab | Cari dataset tersimpan atau impor file numerik asli; akses artefak lama dapat kedaluwarsa. |
| Plot berbeda setelah alignment | Periksa referensi energi dan normalisasi yang dipilih. |
| Cloud conflict | Bandingkan versi lokal dan cloud melalui History. |
| Ekspor gagal | Periksa akses font, jaringan, batas dokumen, dan ukuran raster. |

<a id="docs-troubleshooting-4"></a>

### Informasi untuk dukungan

- Halaman, tindakan, dan teks error yang persis.
- Nama atau ID project dan kalkulasi yang memang boleh dibagikan.
- Tahap kegagalan: sebelum submit, antrean, solver, unggah, atau Figure Lab.
- Cuplikan log yang relevan serta perilaku yang diharapkan.
- Jangan sertakan password, cookie browser, token, atau konfigurasi komputer privat.

<a id="docs-troubleshooting-5"></a>

### Urutan pemulihan

1. Pertahankan tab yang menyimpan edit lokal.
2. Ekspor figur dan sumber penting bila masih dapat diakses.
3. Coba Retry atau sambungkan ulang jaringan.
4. Periksa konflik dan kuota sebelum mengganti data remote.
5. Bersihkan data situs hanya setelah sumber penting sudah disimpan di tempat lain.

<a id="docs-troubleshooting-6"></a>

### Topik terkait

- [Diagnosis: menemukan tahap yang gagal](<#diagnostics>)
- [Pemecahan masalah dan pemulihan lokal](<#local-troubleshooting>)

<a id="local-troubleshooting"></a>

## Pemecahan masalah dan pemulihan lokal

Gunakan jalur pemulihan singkat ini ketika launcher lokal terbuka tetapi runtime, job, browser, atau workspace tersimpan tidak bekerja seperti yang diharapkan. Pertahankan data directory dan log sampai penyebabnya jelas.

<a id="docs-local-troubleshooting-1"></a>

### Startup dan browser

![Diagnosis preflight, eksekusi solver, dan penyimpanan hasil secara terpisah](<https://phynitelab.com/docs/guide/diagrams/failure-stages-id-light.png>)

Diagram konsep: periksa tahap pertama yang gagal sebelum mencoba lagi.

| Gejala | Pemulihan |
| --- | --- |
| Service lokal berhenti saat startup | Jalankan status dan doctor dengan --data-dir yang sama. Baca log startup yang dicetak atau disimpan di data directory; jangan membuat workspace kedua dengan mengganti path. |
| Browser tidak terbuka | Gunakan --no-open dan buka URL loopback eksak yang dicetak launcher. Port 3000 mungkin diganti port yang tersedia. |
| Perintah kedua menunjukkan instance yang sudah ada | Gunakan URL yang dilaporkan atau hentikan instance dengan tertib sebelum memulai data directory berbeda. |
| Project tampak kosong | Periksa --data-dir awal, status, dan identitas workspace. Memasang ulang npm tidak mengambil data dari directory lain. |

```text
phynite-lab status --data-dir ~/.phynite-lab
phynite-lab doctor --data-dir ~/.phynite-lab
phynite-lab --no-open --port 3000 --data-dir ~/.phynite-lab
```

<a id="docs-local-troubleshooting-2"></a>

### Runtime dan isolasi

1. Buka Pengaturan → Compute dan verifikasi runtime DFT atau MD/analysis yang diminta sudah terinstal, berjalan, dan diperiksa kemampuannya untuk workspace ini.
2. Jika probe sandbox tidak tersedia, ikuti perbaikan sistem operasi yang ditampilkan aplikasi. Jangan mematikan user namespace, melewati bubblewrap, atau mengganti ke runtime yang belum diverifikasi.
3. Untuk DFT, verifikasi pustaka pseudopotential yang dipilih atau aset UPF eksak beserta checksum. Untuk MD, verifikasi pemetaan elemen, integritas potential, validasi runtime, dan sistem satuan yang dipilih.
4. Jalankan job referensi kecil setelah Compute plan siap. Pertahankan percobaan gagal dan penyebab pertamanya bila masih gagal.

- [Jalur compute lokal dan hosted](<#local-compute>)
- [Checklist hasil lokal pertama](<#getting-started>)

<a id="docs-local-troubleshooting-3"></a>

### Baca log kegagalan yang benar

| Tahap gagal pertama | Bukti | Langkah berikutnya |
| --- | --- | --- |
| Preflight / setup | Alasan pada Compute plan atau run-review; tidak ada log solver karena proses belum dimulai. | Perbaiki validasi runtime, isolasi, sumber, potential, resource, atau input lalu kirim percobaan baru. |
| Eksekusi solver | Execution log, log tail, status keluar, dan input/artefak tersimpan. | Baca error solver pertama yang bermakna; periksa memori, disk, sintaks, dan pengaturan fisik. |
| Persistensi hasil / artefak | Output solver mungkin ada ketika impor hasil atau verifikasi artefak gagal. | Pertahankan percobaan, periksa disk dan checksum, lalu gunakan Recover saved result hanya jika ditawarkan. |
| Provider AI | Status Pengaturan provider, probe kemampuan, dan error koneksi aman. | Perbaiki login CLI resmi atau ketersediaan provider. Tidak ada fallback provider diam-diam. |

<a id="docs-local-troubleshooting-4"></a>

### Identitas rilis, lisensi, dan verifikasi update

Metadata rilis dokumentasi saat ini menunjukkan phynite-lab@0.1.11. Perintah pertama melaporkan launcher terpasang; perintah kedua membaca metadata registry npm. Versi registry yang lebih baru tidak memperbarui proses yang masih berjalan.

Buka Source code and license pada aplikasi untuk corresponding source. Distribusi publik mencatat commit source publik dan arsip source eksaknya; aset rilis menyediakan checksum paket serta bukti kualifikasi. Kode lokal milik Phynite berlisensi AGPL-3.0-only; solver pihak ketiga dan file potential mempertahankan lisensinya sendiri.

Selesaikan atau batalkan pekerjaan aktif, hentikan aplikasi, perbarui dengan npm install -g phynite-lab@latest, lalu buka data directory yang sama. Verifikasi versi launcher dan kemampuan Compute. Notifikasi update latar tidak memasang paket otomatis dan gangguan registry tidak menghalangi pekerjaan lokal.

```text
phynite-lab --version
npm view phynite-lab version
```

- [Source code dan lisensi](<https://phynitelab.com/source>)
- [Update dan pemulihan startup](<#npm-local-app>)

<a id="docs-local-troubleshooting-5"></a>

### Restart, batalkan, dan pulihkan

1. Batalkan run aktif dari Run history lalu tunggu hingga menjadi Cancelled atau status terminal lain. Jangan mengirim pengganti ketika run asli masih aktif.
2. Setelah launcher atau komputer restart, periksa status run dan log tersimpan. Pekerjaan terinterupsi memerlukan pemeriksaan; aplikasi tidak diam-diam menjalankan ulang job ilmiah.
3. Gunakan Recover saved result hanya ketika aplikasi melaporkan output tersimpan yang terverifikasi. Pemulihan mengimpor output itu; tidak menyatakan solver konvergen atau menjalankan ulang job.
4. Sebelum membersihkan disk atau migrasi, ekspor arsip project dan buat backup terpisah input, provenance, checksum, serta state QE tmp/wavefunction yang diperlukan.

> Completed adalah status aplikasi, bukan kesimpulan ilmiah. Periksa kembali konvergensi, satuan, identitas metode, dan kelengkapan artefak lanjutan sebelum memakai hasil.

- [Pemecahan masalah umum](<#troubleshooting>)
- [Diagnosis tahap kegagalan](<#diagnostics>)
- [Storage dan backup](<#storage-backup>)

<a id="docs-local-troubleshooting-6"></a>

### Topik terkait

- [Pemecahan masalah dan pemulihan](<#troubleshooting>)
- [Diagnosis: menemukan tahap yang gagal](<#diagnostics>)

<a id="diagnostics"></a>

## Diagnosis: menemukan tahap yang gagal

Identifikasi tahap pertama yang tidak selesai. Mengulang aksi hilir tidak memperbaiki struktur yang hilang, worker terputus, atau sumber numerik yang tidak kompatibel.

<a id="docs-diagnostics-1"></a>

### Tabel diagnosis

![Diagnosis preflight, eksekusi solver, dan penyimpanan hasil secara terpisah](<https://phynitelab.com/docs/guide/diagrams/failure-stages-id-light.png>)

Diagram konsep: periksa tahap pertama yang gagal sebelum mencoba lagi.

| Gejala | Tahap | Pemeriksaan berikutnya |
| --- | --- | --- |
| Project baru belum aktif | Pemuatan Workspace akun. | Tunggu atau muat ulang pada error cloud; jangan hapus edit yang belum tersinkron. |
| Impor struktur gagal | Parser atau geometri. | Format, encoding, kisi, koordinat, dan okupansi. |
| Run langsung ditolak | Validasi submit. | Pesan field, status runtime/isolasi lokal, batas resource, serta metode; autentikasi cloud hanya untuk aksi cloud. |
| Run tetap Queued | Worker atau dependensi. | Tujuan, heartbeat personal, kapasitas shared, dan pendahulu. |
| Worker mulai tetapi QE keluar | Runtime atau input ilmiah. | Error solver pertama, pseudopotensial, spesies, sintaks, memori, dan disk. |
| SCF tidak stabil | Self-consistency. | Geometri, okupansi, magnetisme, mixing, toleransi, dan keadaan hampir degenerat. |
| Solver selesai, hasil belum tersedia | Penyimpanan atau unggah. | Disk/runtime lokal dan status akhir; jaringan/kredensial juga berlaku untuk unggah hosted. Pertahankan worker aktif. |
| Open in Figure Lab gagal | Pengambilan sumber. | Retry; hasil lama mungkin membutuhkan file numerik asli. |
| Overlay atau pasangan memberi peringatan | Perbandingan ilmiah. | Geometri, referensi energi, dan identitas path; gunakan panel mandiri bila perlu. |
| Ekspor gagal | Renderer atau font. | Sambungkan internet, periksa ukuran raster, lalu coba lagi. |

<a id="docs-diagnostics-2"></a>

### Mengumpulkan bukti

1. Catat halaman, aksi eksak, waktu, project, dan ID run.
2. Salin error serta baris log di sekitar kegagalan pertama.
3. Catat tujuan, alokasi, sistem operasi, image worker, dan apakah masalah berulang.
4. Untuk masalah plot, simpan dataset, Source package, serta konvensi sumbu yang diharapkan.
5. Hubungi dukungan dengan contoh minimum yang dapat diulang. Hapus kredensial, cookie, password, dan data project yang tidak terkait.

<a id="docs-diagnostics-3"></a>

### Melindungi pekerjaan

Pertahankan sesi browser yang menyimpan figur atau project belum tersinkron. Ekspor sumber sebelum membersihkan data situs.

Periksa kalkulasi antre dan aktif sebelum mengirim ulang agar tidak menambah run duplikat.

Mengganti kredensial membatalkan worker lama. Selesaikan atau batalkan pekerjaan aktif sebelum rotasi agar solver yang selesai masih dapat mengunggah hasil.

<a id="docs-diagnostics-4"></a>

### Topik terkait

- [Pemecahan masalah dan pemulihan](<#troubleshooting>)
- [Pemecahan masalah dan pemulihan lokal](<#local-troubleshooting>)

<a id="tools-reference"></a>

## Referensi alat dan ikon

Ikon mengenali aksi atau workspace, bukan validitas ilmiah. Arahkan pointer ke ikon untuk melihat label, atau fokuskan dengan keyboard untuk memakai nama aksesibelnya. Aksi yang sama dapat berpindah ke menu pada layar sempit.

<a id="docs-tools-reference-1"></a>

### Workspace riset

![Alat modul dan navigasi Canvas](<https://phynitelab.com/docs/guide/workflow-canvas-desktop-light.png>)

Gunakan tooltip dan referensi alat untuk mengenali kontrol.

![Logo provider Codex](<https://phynitelab.com/brand/ai/codex.png>)

Koneksi provider Codex di Pengaturan

![Logo provider Antigravity](<https://phynitelab.com/brand/ai/antigravity.png>)

Koneksi provider Antigravity di Pengaturan

| Ikon / label | Fungsi | Perhatikan |
| --- | --- | --- |
| Labu — DFT Lab | Menyiapkan struktur dan workflow kalkulasi Quantum ESPRESSO. | Setup dapat diedit; catatan eksekusi menyimpan percobaan yang dikirim. |
| Tiga gelombang — MD Lab | Memeriksa trajectory, mengonfigurasi tahap LAMMPS, dan menganalisis frame. | Tampilan frame dan waktu fisik aktual adalah besaran berbeda. |
| Sumbu dan garis — Figure Lab | Menyusun dataset numerik menjadi figur ilmiah dan mengekspor sumber. | Gaya figur tidak mengubah input ilmiah yang dijalankan. |
| Spark bertingkat — AI | Membuka workspace AI project dan memeriksa aksi yang diusulkan. | Ikon masuk AI Phynite berbeda dari logo provider di Pengaturan. |

<a id="docs-tools-reference-2"></a>

### Kontrol Canvas dan eksekusi

| Kontrol | Fungsinya |
| --- | --- |
| Plus — Add module | Membuka katalog modul. Tambahkan sumber, tugas ilmiah, analisis, atau modul Figure lalu hubungkan port yang kompatibel. |
| Panah melengkung — Undo / Redo | Berpindah dalam histori penyuntingan yang didukung; tidak membatalkan job solver yang sudah dijalankan. |
| Play — Run / Run selected / Run all | Menyiapkan Review run, menyertakan prasyarat sekali, dan memakai ulang hasil tersimpan yang kompatibel. Start run mengonfirmasi rencana yang ditinjau. |
| Jam — Run history | Menampilkan percobaan workflow, status per modul, error, dan aksi pembatalan yang tersedia. |
| Garis aktivitas — Research context | Membuka ledger run project, timeline, perbandingan terbaru, dan konteks AI read-only. |

> Tombol Run nonaktif memerlukan penyelesaian masalah validasi atau setup yang ditampilkan. Menambahkan modul tidak menginstal solver atau menghasilkan hasil ilmiah.

<a id="docs-tools-reference-3"></a>

### Alat geometri dan trajectory

| Alat / tombol | Penggunaan | Cakupan |
| --- | --- | --- |
| Select / V | Memilih atom atau partikel untuk inspeksi. | Viewport aktif. |
| Move / G | Memindahkan atom terpilih; periksa koordinat hasil sebelum menerapkan. | Editor struktur. |
| Measure / M | Mengukur geometri terpilih dengan mode jarak/sudut aktif. | Viewport struktur atau trajectory. |
| Slice cross-section / S | Memeriksa penampang trajectory yang ditampilkan. | MD Lab |
| Fit structure / F | Memuat struktur dalam kamera; tidak mengubah ukuran sel. | MD Lab |
| View angle | Memilih orientasi atau tata letak multiview yang didukung. | Kamera viewport. |
| Display overlays | Mengubah bantuan tampilan tanpa menulis ulang sumber ilmiah. | MD Lab |
| Capture snapshot | Menyimpan gambar viewport untuk ilustrasi. | Gambar tidak menggantikan ekspor numerik atau provenance. |

> Pintasan keyboard bergantung pada konteks fokus. Mengetik dalam field teks menggunakan penyuntingan teks; pintasan browser dan sistem operasi dapat didahulukan. Periksa halaman Keyboard untuk aksi yang benar-benar dapat diubah pintasannya.

- [Edit atom dan geometri sel](<#edit>)
- [Referensi keyboard lengkap](<#shortcuts>)

<a id="docs-tools-reference-4"></a>

### Baca ikon status dan bukti

| Label | Arti |
| --- | --- |
| Ready / Configuration ready | Pemeriksaan yang relevan lulus pada tahap itu. Tetap periksa prasyarat eksekusi dan pilihan ilmiah. |
| Queued / Running | Job menunggu atau berjalan. Tunggu status akhir dan hindari pengiriman duplikat. |
| Completed | Aplikasi menyimpan hasil. Periksa konvergensi, peringatan, satuan, dan asumsi fisik. |
| Failed / Cancelled | Buka alasan dan log tercatat. Pertahankan bukti parsial sebelum mencoba lagi. |
| Integrity / Elements / Runtime | Indikator potential MD menunjukkan pemeriksaan terpisah. Indikator tidak memvalidasi force field untuk studi Anda. |
| Not recorded / unavailable | Sumber tidak menyediakan pengukuran tersebut. Jangan menafsirkannya sebagai nol. |

- [Telusuri bukti riset](<#research-history>)
- [Pengaturan dan preferensi](<#settings-reference>)

<a id="docs-tools-reference-5"></a>

### Topik terkait

- [Pintasan keyboard dan pointer](<#shortcuts>)
- [Ketersediaan fitur dan rencana alur](<#roadmap>)
- [Satuan, istilah, dan sumber ilmiah](<#reference>)

<a id="shortcuts"></a>

## Pintasan keyboard dan pointer

Primary berarti Command pada macOS dan Control pada Windows/Linux. Pintasan mengikuti editor aktif. Field teks mempertahankan perilaku edit teksnya.

<a id="docs-shortcuts-1"></a>

### Menyesuaikan pintasan aplikasi yang didukung

![Pintasan aplikasi yang dapat disesuaikan](<https://phynitelab.com/docs/guide/keyboard-settings-desktop-light.png>)

Binding yang didukung disimpan pada perangkat ini.

Buka Pengaturan → Pintasan keyboard. Atur ulang kombinasi yang didukung untuk membuka Pengaturan, menutup/membuka sidebar, memfokuskan chat AI terbuka, atau mengirim pesan. Perubahan langsung berlaku pada browser ini; kembalikan default bila perlu.

Tabel berikut menjelaskan default editor dan konteksnya. Binding aplikasi tidak mengganti penyuntingan teks native, operasi geometri, atau tombol aksesibilitas browser.

<a id="docs-shortcuts-2"></a>

### DFT Lab

| Pintasan | Aksi | Konteks |
| --- | --- | --- |
| Primary + K / Space | Buka command menu | DFT Lab; Space di luar field edit. |
| Primary + Z | Undo | Histori editor struktur. |
| Primary + Shift + Z / Primary + Y | Redo | Histori editor struktur. |
| V / G / A / M / F | Select / Move / Add / Measure / Focus | Viewport; Focus memerlukan pilihan. |
| Delete / Backspace | Hapus pilihan | Di luar field teks. |
| X / Y / Z | Kunci sumbu gerak | Mode Move. |
| Shift + X / Y / Z | Kunci bidang YZ / XZ / XY | Mode Move. |
| Enter / Escape | Terapkan / batalkan gerak | Mode Move. |
| Arrow Left / Right | Ubah lebar sidebar 16 px | Separator resize yang terfokus. |

<a id="docs-shortcuts-3"></a>

### Figure Lab

| Pintasan | Aksi | Konteks |
| --- | --- | --- |
| Primary + Z | Undo perubahan figur | Di luar kontrol editable. |
| Primary + Shift + Z / Primary + Y | Redo perubahan figur | Di luar kontrol editable. |
| Primary + S | Checkpoint eksplisit | Menerapkan draft angka terfokus; autosave tetap berjalan. |
| Primary + Shift + E | Ekspor format terpilih | Figur siap di luar kontrol editable. |
| + atau = / - / 0 | Zoom in / zoom out / Fit | Tampilan halaman. |
| ? | Buka/tutup bantuan pintasan | Figure Lab. |
| Space + drag / Alt + drag / drag tengah | Geser kanvas | Kanvas Figure Lab. |
| Primary + scroll | Zoom halaman | Kanvas Figure Lab. |
| Escape | Tutup bantuan atau panel geser | Figure Lab. |

<a id="docs-shortcuts-4"></a>

### Field dan menu

| Pintasan | Aksi |
| --- | --- |
| Tab / Shift + Tab | Pindah fokus berikutnya / sebelumnya. |
| Enter / Space | Aktifkan tombol atau opsi menu terpilih. |
| Arrow Up / Down | Buka atau pindahkan pilihan menu. |
| Home / End | Opsi aktif pertama / terakhir. |
| Ketik huruf | Cari label pada menu terbuka atau isi pencarian command menu. |
| Escape | Tutup menu atau batalkan draft angka. |
| Enter / keluar field | Terapkan draft numerik valid. |
| Primary + Z di teks | Undo teks, bukan struktur atau figur. |
| Primary + K atau / di dokumentasi | Fokuskan pencarian saat di luar field. |

<a id="docs-shortcuts-5"></a>

### Pointer dan layar kecil

Kontrol kamera memutar, menggeser, dan memperbesar struktur. Pilih alat atom yang sesuai sebelum melakukan drag.

Pada layar kecil, buka Results atau Inspector dari toolbar Figure Lab. Tutup dengan backdrop atau Escape.

Separator sidebar dapat diseret pada desktop atau diubah memakai tombol arah ketika terfokus. Browser atau sistem operasi dapat menangkap pintasan lebih dahulu; aksi utama juga tersedia melalui tombol.

<a id="docs-shortcuts-6"></a>

### Topik terkait

- [Ketersediaan fitur dan rencana alur](<#roadmap>)
- [Satuan, istilah, dan sumber ilmiah](<#reference>)
- [Referensi: parameter kalkulasi dan satuan](<#field-reference>)

<a id="field-reference"></a>

## Referensi: parameter kalkulasi dan satuan

Ikuti label serta satuan pada panel kalkulasi aktif. Tabel ini menjelaskan input QE umum; kontrol yang tersedia bergantung pada alur dan pemilihan input otomatis atau expert.

<a id="docs-field-reference-1"></a>

### Geometri dan elektronik

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

| Field / keyword QE | Satuan / bentuk | Interpretasi |
| --- | --- | --- |
| CELL_PARAMETERS | Tiga vektor; baca satuan card. | Sel yang disimulasikan termasuk vakum. |
| ATOMIC_POSITIONS | crystal atau satuan panjang. | crystal berarti koordinat fraksional dalam basis kisi. |
| ecutwfc | Ry | Energi kinetik maksimum gelombang bidang wavefunction. |
| ecutrho | Ry | Cutoff kerapatan dan potensial; konvergensikan sesuai pseudopotensial. |
| K_POINTS automatic | N1 N2 N3 s1 s2 s3 | Jumlah mesh dan offset integrasi; offset bukan perpindahan atom. |
| K_POINTS crystal_b | Vertex lintasan resiprok dan bobot. | Lintasan band, bukan mesh integrasi SCF. |
| nbnd | Integer | Jumlah keadaan elektronik pada setiap k. |
| tot_charge | Konvensi muatan elektron QE. | Nilai positif mengurangi elektron; periksa perlakuan muatan periodik. |
| nspin / noncolin / lspinorb | Pilihan diskret. | Model spin dan SOC; perlu pseudopotensial yang kompatibel. |

<a id="docs-field-reference-2"></a>

### Konvergensi dan relaksasi

| Keyword | Makna | Interpretasi |
| --- | --- | --- |
| conv_thr | Toleransi SCF dalam Ry. | Estimasi galat energi elektronik, bukan toleransi gaya. |
| electron_maxstep | Batas iterasi elektronik. | Mencapai batas bukan bukti konvergen. |
| mixing_beta | Parameter pencampuran kerapatan. | Memengaruhi kestabilan iterasi; satu nilai tidak cocok untuk semua material. |
| degauss | Lebar smearing dalam Ry. | Pilihan okupansi/integrasi, bukan otomatis temperatur kisi. |
| forc_conv_thr | Toleransi gaya dalam Ry/bohr. | Digunakan pada relaksasi ion dengan konvergensi elektronik memadai. |
| press | Tekanan target dalam kbar. | Bedakan tekanan target dan tegangan residu. |
| cell_dofree | Derajat kebebasan sel. | Tentukan komponen kisi yang boleh relaksasi, terutama slab atau strain terkendala. |

<a id="docs-field-reference-3"></a>

### Input numerik

Field numerik menampung draft selama pengetikan. Enter atau keluar dari field menerapkan nilai valid; Escape membatalkan pada kontrol yang mendukung. Batas sumbu kosong berarti otomatis, sedangkan nol merupakan batas eksplisit.

Bahasa wilayah tidak mengubah sintaks solver. QE, CSV, dan kode mempertahankan format yang dibutuhkan parser. Mengganti bahasa tidak menulis ulang input atau sampel dataset.

> Baca INPUT_PW versi QE yang digunakan untuk semantik keyword eksak. Referensi ini tidak menyatakan semua modul QE tersedia dalam formulir Phynite.

<a id="docs-field-reference-4"></a>

### Topik terkait

- [Pintasan keyboard dan pointer](<#shortcuts>)
- [Ketersediaan fitur dan rencana alur](<#roadmap>)
- [Satuan, istilah, dan sumber ilmiah](<#reference>)

<a id="roadmap"></a>

## Ketersediaan fitur dan rencana alur

Label ketersediaan membedakan fungsi yang dapat dijalankan saat ini dari rencana produk. Gunakan kontrol aktif dan status akun sebagai acuan akses.

<a id="docs-roadmap-1"></a>

### Molecular dynamics

![Batas data workspace lokal, Cloud Sync project, dan compute cloud](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-id-light.png>)

Diagram konsep: login, sync project, dan transfer job adalah pilihan terpisah.

MD Lab mendukung simulasi LAMMPS Guided dan input manual tervalidasi serta analisis OVITO pada komputer sendiri. Eksekusi MD Cloud belum tersedia sampai layanan itu didukung; pendanaan tidak mengaktifkannya.

Pilih resource pada drawer lab sebelum menjalankan. Input manual memerlukan isolasi terverifikasi. Input trajectory asli dipertahankan; frame hasil dimuat sesuai kebutuhan dengan proteksi memori browser.

<a id="docs-roadmap-2"></a>

### Komputasi terkelola

Free mencakup DFT Lab, MD Lab dan Figure Lab, impor, template, ekspor, total storage cloud 10 GiB, serta run DFT dan MD pada satu komputer pribadi yang terhubung per akun. Tidak ada biaya aktivasi Phynite atau biaya komputasi lokal per jam. Cloud memakai Quanta sebagai satuan utama; estimasi Rupiah adalah harga pembelian kredit merchant, saat ini Rp18.000 per Quanta, bukan konversi kurs.

Paid Cloud memakai kredit produksi terverifikasi; pembayaran sandbox tidak mendanai produksi. Tarif memakai profil AWS terpilih ditambah 10%, hanya untuk waktu solver/analisis, minimum 60 detik sekali per job. Persiapan, upload, cleanup, disk sementara, dan transfer compute ditanggung Phynite. Estimasi durasi bukan batas runtime paid. Pendanaan diperbarui maksimal lima menit sesuai saldo; top-up sebelum tenggat mempertahankan job tanpa restart. Kegagalan scientific menagih compute aktual; kegagalan platform mengembalikan biaya compute. Project dan hasil tetap dapat diakses setelah saldo habis. Penawaran total storage cloud menggantikan Free 10 GiB: 50 GiB Rp27.000, 100 GiB Rp55.000, 250 GiB Rp129.000, 500 GiB Rp259.000 dan 1 TiB Rp519.000 per 30 hari. Kapasitas lebih besar dan transfer besar melalui support@phynitelab.com, tanpa tagihan transfer otomatis. Perpanjangan manual. Paket sama menambah 30 hari; upgrade mengonversi nilai sisa harga dasar menjadi waktu tambahan tanpa biaya gateway; downgrade setelah kedaluwarsa. Kedaluwarsa mengembalikan Free tanpa menghapus file. Akun di atas kuota tetap dapat membaca, mengunduh, dan menghapus, sementara penambahan data diblokir. Lihat /pricing untuk estimasi dan ketentuan.

<a id="docs-roadmap-3"></a>

### Ruang lingkup dokumentasi

Panduan menjelaskan perilaku produk yang diimplementasikan. Dukungan suatu input ahli tidak berarti semua opsi solver telah divalidasi lewat formulir.

Gunakan catatan metode dan dokumentasi solver untuk penilaian fisik. Penyelesaian teknis job tetap perlu diikuti pemeriksaan konvergensi dan kesesuaian model.

<a id="docs-roadmap-4"></a>

### Topik terkait

- [Pintasan keyboard dan pointer](<#shortcuts>)
- [Satuan, istilah, dan sumber ilmiah](<#reference>)
- [Referensi: parameter kalkulasi dan satuan](<#field-reference>)

<a id="reference"></a>

## Satuan, istilah, dan sumber ilmiah

Selalu tulis satuan dan referensi yang menyertai angka. Istilah serupa pada tampilan, solver, dan publikasi dapat memiliki cakupan berbeda.

<a id="docs-reference-1"></a>

### Istilah utama

![Struktur, input, run, dan bukti sebagai langkah riset terpisah](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-id-light.png>)

Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.

| Istilah | Makna |
| --- | --- |
| Å / bohr | Satuan panjang; baca satuan card input sebelum mengubah koordinat. |
| Ry / eV | Satuan energi; cutoff QE umumnya Ry, plot energi dapat memakai eV. |
| Ruang nyata | Kisi dan posisi atom yang ditampilkan DFT Lab. |
| Ruang resiprok | Koordinat k/q untuk integrasi serta lintasan band/fonon. |
| Γ | Pusat zona Brillouin, k = 0. |
| DOS / PDOS | Kerapatan keadaan total / terproyeksi dengan normalisasi yang harus dijelaskan. |
| SCF | Penyelesaian elektronik self-consistent. |
| CPU-hour | Durasi dikalikan core alokasi untuk pengukuran akun; bukan utilisasi. |
| DPI / mm / pt | Resolusi raster / dimensi halaman / ukuran tipografi. |

<a id="docs-reference-2"></a>

### Sumber yang dibaca bersama panduan

Dokumentasi resmi Quantum ESPRESSO menjelaskan pw.x, bands.x, dos.x, projwfc.x, ph.x, q2r.x, dan matdyn.x.

Dokumentasi Materials Project menjelaskan provenance serta konvensi database. SeeK-path menjelaskan standardisasi lintasan. BoltzTraP2 menjelaskan interpolasi dan asumsi transport.

Panduan antarmuka tidak menggantikan studi konvergensi, dokumentasi versi solver yang digunakan, atau validasi terhadap literatur ilmiah.

<a id="docs-reference-3"></a>

### Topik terkait

- [Pintasan keyboard dan pointer](<#shortcuts>)
- [Ketersediaan fitur dan rencana alur](<#roadmap>)
- [Referensi: parameter kalkulasi dan satuan](<#field-reference>)

## Referensi ilmiah

- https://www.quantum-espresso.org/documentation/
- https://docs.materialsproject.org/
- https://seekpath.readthedocs.io/
- https://www.boltztrap.org/
- https://docs.lammps.org/
- https://www.ovito.org/docs/
- https://wannier.org/documentation/

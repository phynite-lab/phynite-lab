# Panduan Pengguna Phynite Lab

Panduan ini menjelaskan antarmuka yang diimplementasikan. Gunakan bersama dokumentasi solver dan uji konvergensi.

- [Dari struktur hingga figur paper](#workflow)
- [Tutorial: kalkulasi silikon pertama](#quickstart-silicon)
- [Tutorial: simulasi MD lokal pertama](#quickstart-md)
- [Project, struktur, dan riwayat kalkulasi](#project)
- [Mengimpor dan memeriksa struktur](#structure)
- [Mengedit atom dan geometri sel](#edit)
- [Arah periodik, vakum, dan dimensionalitas](#periodicity)
- [Prosedur: menyiapkan slab dua dimensi](#slab-workflow)
- [Memilih dan menghubungkan kalkulasi](#calculation)
- [Mengatur dan memvalidasi Quantum ESPRESSO](#configure)
- [Prosedur: merancang uji konvergensi](#convergence)
- [Eksekusi, sumber daya, dan pembatalan](#execution)
- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)
- [Studi banyak material dan variasi parameter](#studies)
- [Template, penggantian sumber, dan histori](#reuse)
- [PDOS, unfolding, dan inset](#advanced)
- [Ekspor dan reproduksibilitas figur](#export)
- [Prosedur: menyiapkan figur publikasi](#publication)
- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Profil, pemakaian, dan paket](#account)
- [Mengelola paket, tagihan, dan pemakaian](#billing)
- [Menghubungkan komputer melalui Phynite Compute](#local-compute)
- [Bahasa, wilayah, dan aksesibilitas](#language)
- [Pintasan keyboard dan pointer](#shortcuts)
- [Referensi: parameter kalkulasi dan satuan](#field-reference)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Diagnosis: menemukan tahap yang gagal](#diagnostics)
- [Ketersediaan fitur dan rencana alur](#roadmap)
- [Satuan, istilah, dan sumber ilmiah](#reference)

<a id="workflow"></a>

## Dari struktur hingga figur paper

Project menampung satu studi material: struktur, pengaturan kalkulasi, riwayat eksekusi, dataset numerik, dan figur yang dapat digunakan kembali. Mulai dari pertanyaan fisik, lalu pilih kalkulasi dan perbandingan yang diperlukan untuk menjawabnya.

### Alur kerja lengkap

1. Masuk ke akun. Workspace menampilkan project dan alat riset. Membuka beranda saat sudah masuk akan mengarahkan Anda kembali ke Workspace.
2. Pilih Project baru, beri nama yang menjelaskan studi, lalu buka project tersebut. Project juga dapat dibuat dari panel Project di DFT Lab.
3. Impor struktur, bangun sel, atau ambil dari Materials Project. Periksa satuan, vektor kisi, spesies, dan jumlah atom.
4. Periksa geometri ruang nyata. Tentukan arah periodik untuk tampilan dan tambahkan vakum secara eksplisit bila model slab, kawat, atau molekul membutuhkannya.
5. Buka Calculate dan tambahkan Total energy atau Structural relaxation. Periksa input, okupansi, pseudopotensial, cutoff, dan mesh k.
6. Pilih tujuan komputasi. Phynite Cloud menyediakan paid Quanta atau grant pilot admin, lalu pilihan CPU dan RAM yang tersedia. Your computer memerlukan worker pribadi yang aktif.
7. Jalankan dan ikuti Log. Status Completed tidak otomatis berarti hasil konvergen secara fisik; periksa energi, gaya, konvergensi, dan pesan solver.
8. Tambahkan kalkulasi band, DOS, fonon, atau transport sesuai kebutuhan. Pilih hasil relaksasi yang kompatibel sebagai sumber struktur bila diperlukan.
9. Pada hasil yang memiliki data plot, pilih Open in Figure Lab. Figur aktif yang sudah memakai hasil tersebut dibuka kembali, atau data numeriknya diimpor untuk membuat figur.
10. Atur perbandingan, referensi energi, dimensi fisik, dan tipografi. Tunggu status penyimpanan di editor Figure Lab, lalu ekspor figur dan Source package.

### Pembagian fungsi halaman

| Halaman | Fungsi |
| --- | --- |
| Workspace | Membuat dan mencari project, melanjutkan studi, membuka alat riset. |
| DFT Lab / Project | Mengatur project, struktur, dan variasi material. |
| DFT Lab / Inspect | Memeriksa dan mengubah geometri. |
| DFT Lab / Calculate | Mengatur kalkulasi, dependensi, eksekusi, dan log. |
| Figure Lab | Membandingkan data, mengatur panel, dan mengekspor figur. |
| Account | Profil, preferensi, dan koneksi komputer pribadi. |
| Billing | Paket, alokasi, waktu komputasi, dan penyimpanan. |

### Sebelum menyebut hasil final

- Catat sumber struktur dan sel komputasi untuk setiap run.
- Uji cutoff, mesh k/q, vakum, smearing, dan toleransi solver terhadap besaran yang akan dilaporkan.
- Periksa satuan dan titik nol energi sebelum membuat overlay.
- Simpan input yang benar-benar dieksekusi serta sumber numerik bersama figur.
- Jelaskan fungsional, keluarga pseudopotensial, perlakuan spin, dan normalisasi dalam metode paper.

### Topik terkait

- [Project, struktur, dan riwayat kalkulasi](#project)
- [Tutorial: kalkulasi silikon pertama](#quickstart-silicon)
- [Tutorial: simulasi MD lokal pertama](#quickstart-md)

<a id="quickstart-silicon"></a>

## Tutorial: kalkulasi silikon pertama

Selesaikan kalkulasi keadaan dasar kecil sebelum menjalankan studi besar. Tutorial ini memeriksa alur struktur, worker, dan hasil. Parameter latihan bukan metode produksi yang sudah konvergen.

### Sebelum mulai

- Masuk dengan akun undangan yang akan menjadi pemilik project dan hasil.
- Hubungkan komputer Anda melalui Docker. Pertahankan Docker berjalan dan komputer tidak tidur. Terminal boleh ditutup setelah kontainer berjalan di latar belakang.
- Siapkan struktur silikon diamond-cubic dalam CIF, POSCAR, atau format lain yang didukung. Simpan sumber serta parameter kisinya.
- Gunakan sel primitif dua atom untuk latihan. Sel konvensional delapan atom juga valid secara fisik, tetapi energi total, vektor resiprok, dan biayanya berbeda.

### Membuat dan memeriksa project

1. Di Workspace, pilih Project baru. Isi nama Keadaan dasar silikon dan deskripsi opsional, lalu pilih Buat project.
2. Buka project dari konfirmasi atau daftar, kemudian tambahkan struktur silikon.
3. Pastikan Si merupakan satu-satunya spesies dan sel primitif berisi dua atom. Periksa panjang, sudut, satuan, serta tetangga terdekat.
4. Pertahankan a, b, c periodik untuk silikon bulk. Sel berulang di tampilan bukan atom tambahan yang dikirim ke solver.
5. Beri nama struktur yang mengidentifikasi sumbernya. Simpan file asli sebelum mengubah kisi.

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

### Menjalankan dan memeriksa

1. Periksa input yang dihasilkan dan pilih tujuan compute yang dimaksud.
2. Jalankan sekali, buka Log, dan ikuti Queued, Running, hingga status akhir.
3. Cari konvergensi SCF pada output solver. Proses selesai tanpa self-consistency belum merupakan keadaan dasar yang dapat diterima.
4. Catat energi total, jumlah atom, input eksekusi, identitas pseudopotensial, dan ID run.
5. Untuk plot dispersi, tambahkan Band structure dengan lintasan resiprok sesuai sel. Setelah selesai, pilih Open in Figure Lab dari hasilnya.

### Hasil yang diharapkan

Project berisi struktur asli, setup yang dapat diedit, dan record eksekusi dengan artefak hasil. Run band atau DOS terpisah menghasilkan sumber numerik untuk plot.

Tidak ada satu energi target universal untuk tutorial: nilainya bergantung pada potensial, sel, cutoff, dan konvensi. Periksa konvergensi internal serta identitas metode, bukan angka tanpa sumber.

> Jika job tetap Queued, periksa tujuan dan koneksi worker sebelum mengirim duplikat. Lihat topik Eksekusi dan tabel diagnosis.

### Kegagalan dan pemulihan

- Jika worker offline, sambungkan kembali dan tunggu job yang mengantre tanpa mengirim ulang.
- Untuk status Failed, periksa input tersimpan dan kesalahan solver pertama yang bermakna di log sebelum mengubah pengaturan.
- Untuk status Cancelled, simpan log parsial dan kirim run baru hanya setelah job sebelumnya mencapai status akhir.

### Topik terkait

- [Dari struktur hingga figur paper](#workflow)
- [Project, struktur, dan riwayat kalkulasi](#project)
- [Tutorial: simulasi MD lokal pertama](#quickstart-md)

<a id="quickstart-md"></a>

## Tutorial: simulasi MD lokal pertama

Gunakan sistem argon kecil untuk mempelajari alur struktur, pengaturan, eksekusi, dan hasil di MD Lab. Ini latihan alur kerja, bukan studi fisika yang sudah tervalidasi.

### Siapkan komputer dan struktur

1. Masuk dengan akun yang diundang dan hubungkan Komputer Anda di Akun. Biarkan worker dan Docker berjalan.
2. Buka MD Lab dan buat project bernama Ekuilibrasi argon.
3. Impor atau bangun struktur argon kecil dengan kotak periodik yang sesuai secara fisik. Periksa jumlah atom, identitas unsur, koordinat, ukuran kotak, satuan, dan massa atom. XYZ dengan spesies Ar atau berkas data LAMMPS yang memuat Masses dapat dipakai; dump yang hanya berisi nomor tipe tidak punya massa untuk dinamika.
4. Simpan berkas struktur asli serta sumbernya. Pengulangan tampilan tidak menambah atom dalam simulasi.

### Tinjau simulasi

1. Buka drawer konfigurasi dan pilih mode Guided. Pilih model Lennard-Jones bawaan untuk Ar; jangan pakai parameter Generic tanpa mencatat sumbernya.
2. Pilih resep ekuilibrasi singkat. Periksa temperatur, timestep, batas periodik, seed acak, sistem satuan, parameter potensial, dan interval output.
3. Jalankan preflight di browser dan baca input LAMMPS yang dibuat. Pastikan struktur dan potensialnya sesuai.

### Jalankan sekali dan periksa

1. Pilih Komputer Anda dan kirim satu run. Ikuti status Queued dan Running pada catatan job serta periksa koneksi worker.
2. Jika worker offline, hubungkan kembali dan tunggu job yang mengantre; jangan kirim run ganda.
3. Setelah selesai, buka log, data thermo, trajectory, dan input tersimpan dari project. Periksa error LAMMPS serta apakah perilaku temperatur dan energi mendukung ekuilibrasi yang dimaksud.
4. Status Completed berarti proses selesai; itu belum memvalidasi force field, timestep, ekuilibrasi, atau kesimpulan ilmiah.

### Kegagalan dan pemulihan

- Untuk Failed, periksa error LAMMPS pertama yang bermakna dan input tersimpan sebelum mengubah pengaturan.
- Untuk Cancelled, tinjau log parsial dan kirim run baru hanya setelah job lama mencapai status akhir.
- Jika trajectory hilang, periksa pengaturan output dan artefak tersimpan. Viewer kosong bukan hasil fisika.

> Tidak ada target energi atau kurva temperatur universal. Catat input nyata, identitas potensial, ID run, dan output sebelum membandingkan sistem.

### Topik terkait

- [Dari struktur hingga figur paper](#workflow)
- [Project, struktur, dan riwayat kalkulasi](#project)
- [Tutorial: kalkulasi silikon pertama](#quickstart-silicon)

<a id="project"></a>

## Project, struktur, dan riwayat kalkulasi

Gunakan satu project untuk satu studi yang berkaitan. Simpan variasi material sebagai struktur terpisah dengan nama jelas. Pengaturan kalkulasi dapat diedit; setiap eksekusi menyimpan riwayat input yang dikirim.

### Membuat project dari Workspace

1. Tunggu Workspace akun selesai dimuat, lalu pilih Project baru.
2. Isi nama, misalnya Respons strain MoS2. Nama wajib diisi, maksimal 100 karakter; deskripsi opsional maksimal 500 karakter.
3. Pilih Buat project. Project tampil di daftar dan dapat langsung dibuka melalui konfirmasi.
4. Buka project untuk menambahkan struktur. Project kosong tidak menjalankan kalkulasi atau memakai kapasitas worker.
5. Gunakan pencarian untuk nama project, deskripsi, atau rumus kimia struktur utama. Urutkan berdasarkan edit terakhir atau nama.

### Mengatur variasi

1. Berikan nama yang menjelaskan kondisi, misalnya MoS2 strain -2%, 0%, dan +2%.
2. Tambahkan tumpukan kalkulasi di bawah setiap struktur.
3. Duplikasikan konfigurasi untuk memakai metode serupa pada variasi lain, lalu periksa parameter yang perlu berubah.
4. Gunakan menu project atau struktur untuk mengganti nama dan menduplikasi. Periksa konfirmasi sebelum menghapus.

### Identitas data

Struktur lokal, struktur yang diunggah, dan kalkulasi yang sudah dikirim merupakan record berbeda yang saling terkait. Mengedit struktur saat ini tidak mengubah input historis run yang selesai.

Figur merujuk dataset numerik dengan identitas tersendiri. Mengganti data di figur merupakan tindakan eksplisit; perubahan metadata sumber tidak diam-diam mengubah perbandingan yang telah disimpan.

URL project dan tampilan Figure Lab dipertahankan saat halaman dibuka kembali. Tautan project yang sudah tidak tersedia tidak boleh dianggap sebagai figur project lain.

> Pengulangan sel di viewport hanya tampilan. Menambah jumlah sel yang terlihat tidak otomatis menambah atom dalam sel komputasi.

### Topik terkait

- [Dari struktur hingga figur paper](#workflow)
- [Tutorial: kalkulasi silikon pertama](#quickstart-silicon)
- [Tutorial: simulasi MD lokal pertama](#quickstart-md)

<a id="structure"></a>

## Mengimpor dan memeriksa struktur

Periksa struktur sebagai model fisik sebelum menyiapkan input solver. Visualisasi yang tampak benar belum membuktikan satuan, okupansi, atau sel komputasinya sesuai.

### Memilih sumber

| Sumber | Pemeriksaan |
| --- | --- |
| CIF | Satuan sel, koordinat fraksional, simetri, dan okupansi situs. Struktur dengan okupansi parsial memerlukan model atomistik yang sesuai. |
| POSCAR / CONTCAR | Faktor skala, urutan unsur, jumlah atom, serta koordinat Direct atau Cartesian. |
| XYZ | Satuan dan informasi sel. XYZ biasa tidak selalu mendefinisikan kisi periodik. |
| Input Quantum ESPRESSO | CELL_PARAMETERS, ATOMIC_POSITIONS, spesies, dan satuan setiap card. |
| Materials Project | Identitas sumber, komposisi, sel standar, dan konvensi basis. |
| DFT Lab | Geometri, jarak antaratom, dan kesesuaian model yang Anda bangun. |

### Mengimpor file

1. Pilih project tujuan.
2. Gunakan Add structure / Import atau seret satu file struktur yang didukung ke DFT Lab.
3. Periksa nama, rumus kimia, jumlah atom, dan parameter sel.
4. Putar struktur dan gunakan pengulangan visual untuk mencari atom yang salah posisi atau tetangga yang tidak wajar.
5. Selesaikan peringatan parser dan okupansi parsial sebelum menjalankan model QE terurut.

### Koordinat fraksional dan Cartesian

Koordinat fraksional menyatakan r = f1 a + f2 b + f3 c, dengan a, b, c sebagai vektor kisi. Koordinat Cartesian menyatakan posisi pada sumbu ruang nyata dalam satuan panjang.

Mempertahankan koordinat fraksional sambil mengubah kisi dapat meregangkan posisi atom. Mempertahankan koordinat Cartesian menjaga posisi ruang nyata tetapi mengubah representasi fraksionalnya. Pastikan operasi yang dipilih sesuai deformasi yang dimaksud.

Sel primitif dan konvensional dapat merepresentasikan kristal yang sama dengan jumlah atom serta basis resiprok berbeda. Perbedaan ini memengaruhi energi total per sel, lintasan k, dan normalisasi DOS.

### Informasi yang perlu dipertahankan

- File asli atau identitas database asal.
- Satuan, orientasi, dan pilihan sel primitif/konvensional.
- Komposisi, okupansi, serta perlakuan cacat atau disorder.
- Perubahan yang dilakukan sebelum kalkulasi, termasuk strain, vakum, dan relaksasi.

### Topik terkait

- [Mengedit atom dan geometri sel](#edit)
- [Arah periodik, vakum, dan dimensionalitas](#periodicity)
- [Prosedur: menyiapkan slab dua dimensi](#slab-workflow)

<a id="edit"></a>

## Mengedit atom dan geometri sel

DFT Lab bekerja di ruang nyata. Pilih alat berdasarkan operasi yang diperlukan dan gunakan koordinat numerik untuk perubahan yang harus presisi.

### Alat viewport

| Alat | Fungsi |
| --- | --- |
| Select (V) | Memilih atom untuk inspeksi dan operasi berikutnya. |
| Move (G) | Memindahkan atom terpilih. |
| Add atom (A) | Menambahkan atom dengan spesies dan posisi yang dipilih. |
| Measure (M) | Mengukur jarak atau sudut sesuai mode dan urutan pilihan. |
| Focus (F) | Memusatkan tampilan pada atom terpilih. |
| Delete / Backspace | Menghapus pilihan saat konteks viewport aktif, bukan saat mengetik. |

### Gerak terkendala

Dalam mode Move, X, Y, atau Z membatasi gerak pada sumbu Cartesian tersebut. Shift+X, Shift+Y, atau Shift+Z menggunakan bidang tegak lurus YZ, XZ, atau XY. Enter menerapkan perpindahan; Escape membatalkan.

Gunakan field koordinat untuk perpindahan eksak. Field numerik mengizinkan draft sementara seperti tanda minus atau eksponen. Enter atau keluar dari field menerapkan nilai valid; Escape mengembalikan nilai sebelumnya.

### Geometri dibanding tampilan

- Mengubah metrik sel mengubah kisi yang disimulasikan. Periksa apakah deformasinya sesuai strain yang dimaksud.
- Aksi vakum menambah pemisahan normal terhadap bidang a-b sambil mempertahankan jarak atom Cartesian; bukan pembuat slab untuk semua orientasi.
- Ukuran atom, ukuran ikatan, label, cutoff tetangga, dan pengulangan visual mengatur tampilan.
- Undo/redo berlaku untuk operasi editor yang didukung dalam sesi berjalan. Simpan variasi fisik penting sebagai salinan struktur yang jelas.

### Topik terkait

- [Mengimpor dan memeriksa struktur](#structure)
- [Arah periodik, vakum, dan dimensionalitas](#periodicity)
- [Prosedur: menyiapkan slab dua dimensi](#slab-workflow)

<a id="periodicity"></a>

## Arah periodik, vakum, dan dimensionalitas

Checkbox a, b, dan c menyatakan arah periodik yang dimaksud pada tampilan ruang nyata. Quantum ESPRESSO tetap menggunakan sel simulasi tiga dimensi yang berulang periodik.

### Ketika satu arah dinonaktifkan

Menonaktifkan c menghentikan pengulangan visual dan koneksi tetangga periodik pada arah itu; jumlah pengulangannya menjadi satu. Aksi ini tidak memperpendek sel, menghapus vektor c, menambah vakum, atau mengaktifkan koreksi elektrostatik.

Ukuran sel tidak boleh ditebak dari checkbox: ketebalan slab, vakum yang konvergen, dan kondisi elektrostatik berbeda pada setiap studi. Mengubah sel otomatis tanpa konteks dapat mengubah jarak atom atau kerapatan fisik.

> Untuk slab, pertahankan tinggi sel yang finite, tambahkan dan konvergensikan vakum, gunakan satu titik k pada arah nonperiodik, lalu tentukan perlakuan elektrostatik dalam input QE yang dijalankan.

### Sistem umum

| Sistem | Periodisitas tampilan | Pemeriksaan komputasi |
| --- | --- | --- |
| Kristal bulk | a, b, c | Konvergensikan mesh tiga dimensi dan pilih sel yang dimaksud. |
| Slab / lembaran 2D pada a-b | a, b | Vakum tegak lurus, mesh dalam bidang, biasanya satu k sepanjang c; periksa dipol atau isolasi 2D bila sesuai. |
| Kawat sepanjang c | c | Vakum pada kedua arah transversal dan sampling sepanjang kawat. Aksi vakum c saja tidak menyiapkan model ini. |
| Molekul / cluster | Tidak ada | Kotak 3D cukup besar, biasanya sampling Γ; periksa muatan dan dipol. |

### Prosedur slab yang dapat diulang

1. Orientasikan permukaan pada bidang a-b.
2. Nonaktifkan c untuk memperjelas batas tampilan.
3. Tambahkan vakum dan periksa kisi serta posisi atom sebenarnya.
4. Gunakan mesh N × M × 1; tentukan N dan M melalui konvergensi.
5. Periksa perlakuan elektrostatik pada input yang dihasilkan atau expert input.
6. Ulangi dengan vakum lebih besar dan sampling lebih rapat hingga besaran target stabil.

### Topik terkait

- [Mengimpor dan memeriksa struktur](#structure)
- [Mengedit atom dan geometri sel](#edit)
- [Prosedur: menyiapkan slab dua dimensi](#slab-workflow)

<a id="slab-workflow"></a>

## Prosedur: menyiapkan slab dua dimensi

Gunakan prosedur ini untuk lembaran atau slab dengan permukaan pada bidang a-b. Quantum ESPRESSO memerlukan sel tiga dimensi dengan vakum yang terkonvergensi.

### Prasyarat geometri

- Mulai dari terminasi, komposisi, dan orientasi permukaan yang bermakna secara fisik.
- Periksa koordinat fraksional dan Cartesian. Pada sel miring, ukur vakum normal terhadap permukaan, bukan hanya panjang c.
- Pastikan ketebalan slab dan ikatan lintas batas sesuai model.
- Duplikasikan struktur sebelum mengubah sel agar sumber bulk atau slab awal tetap tersedia.

### Menyiapkan model

1. Orientasikan permukaan pada a-b. Periksa vektor kisi, bukan hanya arah kamera.
2. Atur pengulangan sel c ke 1 (misal 2 × 2 × 1) untuk memeriksa perluasan permukaan tanpa mengulang ke arah vakum.
3. Gunakan aksi vakum eksplisit untuk permukaan a-b. Periksa kisi yang diperbarui dan jarak atom Cartesian.
4. Pilih mesh dalam bidang N × M × 1; tentukan N dan M melalui konvergensi.
5. Periksa perlakuan elektrostatik di input yang dihasilkan atau expert input. Slab asimetris, polar, dan bermuatan membutuhkan perhatian khusus.
6. Konvergensikan ketebalan slab, vakum, dan sampling terhadap besaran penelitian.

### Slab dengan strain

Strain biaksial mengubah metrik dalam bidang. Catat tensor strain, kisi referensi, dan apakah posisi atom direlaksasi dengan sel dalam bidang tetap.

Menambah vakum mengubah volume sel 3D tanpa mengubah ketebalan fisik lembaran. Tegangan atau konduktivitas yang dinormalisasi dengan volume tersebut dapat membutuhkan konversi 2D yang didefinisikan jelas.

Aksi vakum c bukan pembuat semua kawat, slab indeks Miller arbitrer, atau cluster terisolasi. Impor geometri yang telah disiapkan bila operasi di luar cakupan builder.

### Validasi sebelum submit

| Pemeriksaan | Bukti yang disimpan |
| --- | --- |
| Permukaan dan orientasi | Vektor kisi, koordinat, terminasi, dan sumber asli. |
| Vakum | Pemisahan normal dan hasil beberapa nilai di sekitar pilihan akhir. |
| Sampling | Mesh yang dijalankan dan hasil konvergensi dalam bidang. |
| Elektrostatik | Pengaturan QE eksak dan justifikasi fisiknya. |
| Relaksasi | Derajat kebebasan tetap/bebas, toleransi gaya, dan geometri akhir. |

### Topik terkait

- [Mengimpor dan memeriksa struktur](#structure)
- [Mengedit atom dan geometri sel](#edit)
- [Arah periodik, vakum, dan dimensionalitas](#periodicity)

<a id="calculation"></a>

## Memilih dan menghubungkan kalkulasi

Panel Calculate memisahkan pengaturan DFT, Log eksekusi, dan konfigurasi yang dapat dipakai ulang. Pilih tugas ilmiahnya; alur yang dihasilkan menyiapkan tahap solver yang diperlukan.

### Alur tersedia

| Kalkulasi | Tujuan | Alat utama |
| --- | --- | --- |
| Total energy | Keadaan dasar elektronik SCF dan energi. | pw.x |
| Structural relaxation | Optimasi ion; opsi derajat kebebasan sel yang diizinkan. | pw.x relax / vc-relax |
| Band structure | Eigenvalue sepanjang lintasan resiprok. | pw.x + bands.x |
| Density of states | DOS dari mesh seragam dan opsi proyeksi. | pw.x + dos.x / input proyeksi |
| Phonon dispersion | DFPT, konstanta gaya, dan lintasan fonon. | ph.x + q2r.x + matdyn.x |
| Thermoelectric properties | Interpolasi band dan transport semiklasik. | QE + BoltzTraP2 |

### Menyusun kalkulasi

1. Pilih struktur lalu buka Calculate / DFT.
2. Pilih Add calculation dan tugas yang dibutuhkan.
3. Atur parameter dan periksa file input.
4. Jika diperlukan, pilih hasil relaksasi yang sesuai sebagai sumber struktur.
5. Jalankan satu kalkulasi, Run selected, atau Run all. Tahap pendahulu dapat dikirim terlebih dahulu dan dipakai ulang ketika kompatibel.
6. Periksa setiap run di Log; job hilir dapat menunggu dependensinya.

### Dependensi dan eksekusi ulang

Job hilir menunggu prasyarat yang dideklarasikan selesai. Pemakaian ulang bergantung pada record eksekusi yang kompatibel, bukan kemiripan nama.

Perubahan struktur, fungsional, muatan, spin, atau cutoff dapat membuat hasil lama tidak sesuai untuk dipakai ulang. Buat run baru bila ragu dan pertahankan hasil lama sebagai pembanding.

Save selected menyimpan konfigurasi kalkulasi, bukan menjalankan solver. Figure Lab memiliki penyimpanan otomatis dan tidak membutuhkan tombol Save revision.

### Topik terkait

- [Mengatur dan memvalidasi Quantum ESPRESSO](#configure)
- [Eksekusi, sumber daya, dan pembatalan](#execution)
- [Prosedur: merancang uji konvergensi](#convergence)

<a id="configure"></a>

## Mengatur dan memvalidasi Quantum ESPRESSO

Default adaptif adalah titik awal. Pengaturan tersebut tidak menggantikan uji konvergensi atau pengetahuan tentang material. Input yang dihasilkan dan expert raw input memiliki tanggung jawab berbeda.

### Pilihan utama

| Pengaturan | Makna | Pemeriksaan |
| --- | --- | --- |
| Functional | Pendekatan exchange-correlation. | Gunakan pseudopotensial dan alur solver yang kompatibel. |
| ecutwfc / ecutrho | Cutoff gelombang bidang dan kerapatan muatan. | Konvergensikan energi, gaya, tegangan, atau respons yang dilaporkan. |
| Mesh k | Sampling integrasi zona Brillouin. | Gunakan mesh seragam untuk SCF/DOS; lintasan band bukan penggantinya. |
| Occupations / smearing | Pengisian dan integrasi keadaan elektronik. | Sesuaikan dengan sifat logam, isolator, spin, dan asumsi temperatur. |
| nbnd | Jumlah band yang dihitung. | Cukupkan keadaan kosong untuk rentang energi atau transport. |
| Threshold / mixing | Penghentian dan perilaku iterasi SCF. | Periksa konvergensi; menaikkan batas iterasi tidak selalu menyelesaikan masalah. |
| Charge / magnetization / spin | Asumsi keadaan elektronik. | Gunakan referensi fisik dan pseudopotensial yang sesuai. |

### Mode adaptif dan expert

Mode adaptif menentukan default okupansi dan cutoff dari konteks material serta alur kerja. Override pengguna tetap merupakan pilihan eksplisit.

Expert raw input menjadi teks utama yang dikirim. Resolusi adaptif tidak diam-diam menulis ulang okupansi dan cutoff pada teks tersebut. Pengguna bertanggung jawab atas card, path, spesies, satuan, dan opsi solver.

Periksa input yang benar-benar dieksekusi dari artefak hasil. Preview lama tidak selalu mencakup data runtime, termasuk identitas pseudopotensial yang diselesaikan worker.

### Contoh uji konvergensi

1. Tetapkan struktur dan metode; buat baseline Total energy.
2. Variasikan ecutwfc dan ecutrho yang kompatibel pada mesh k tetap.
3. Amati energi per atom, gaya, atau tegangan sesuai tujuan.
4. Pilih cutoff memadai lalu variasikan mesh k.
5. Uji vakum secara terpisah untuk sistem berdimensi rendah.
6. Catat toleransi yang digunakan untuk menyatakan besaran konvergen.

> Preset Fast, Balanced, dan High accuracy adalah kemudahan konfigurasi, bukan jaminan akurasi publikasi.

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](#calculation)
- [Eksekusi, sumber daya, dan pembatalan](#execution)
- [Prosedur: merancang uji konvergensi](#convergence)

<a id="convergence"></a>

## Prosedur: merancang uji konvergensi

Uji konvergensi mengukur pengaruh pilihan numerik terhadap besaran fisik yang dilaporkan. Tentukan besaran dan toleransi terlebih dahulu, lalu ubah satu parameter terkendali dengan input lain tetap.

### Menentukan perbandingan

Untuk perbandingan energi fase, konvergensikan selisih energi dengan sel dan normalisasi yang sebanding. Untuk relaksasi, periksa kestabilan gaya serta tegangan. Untuk tepi band, koefisien transport, atau mode fonon, konvergensikan besaran itu secara langsung.

Energi total yang stabil tidak menjamin semua respons telah konvergen. Catat toleransi target pada deskripsi project atau catatan metode.

### Menjalankan seri terkendali

1. Duplikasikan setup referensi dan beri nama setiap variasi beserta parameter serta satuannya.
2. Variasikan ecutwfc dengan ecutrho yang sesuai. Pertahankan geometri, pseudopotensial, mesh k, spin, okupansi, dan toleransi SCF.
3. Pada cutoff cukup tinggi, variasikan mesh k seragam. Uji sensitivitas smearing secara terpisah untuk logam.
4. Untuk sistem berdimensi rendah, variasikan pemisahan vakum sebenarnya tanpa mengubah geometri slab atau sel dalam bidang.
5. Uji kombinasi di sekitar pilihan akhir agar parameter yang diuji terpisah tetap cukup ketika digabung.
6. Simpan setiap run dan hitung selisih terhadap referensi paling teresolusi. Ekspor tabel observasi sebagai data numerik untuk plot.

### Tabel hasil minimum

Ganti placeholder dengan hasil pengukuran. Tabel ini format pencatatan, bukan data simulasi. Untuk komposisi dan sel yang sama, selisih per atom = (E - E_referensi) / jumlah_atom. Konversikan Ry ke satuan paper secara konsisten.

Jangan mengurangkan energi total mentah dari komposisi berbeda seolah-olah langsung merupakan energi pembentukan. Perbandingan tersebut memerlukan referensi potensial kimia dan stoikiometri.

```text
cutoff_Ry,k_mesh,energy_Ry,atoms,delta_meV_per_atom,run_id
40,4x4x4,<hasil>,2,<turunan>,<id-run>
50,4x4x4,<hasil>,2,<turunan>,<id-run>
60,4x4x4,<hasil>,2,<turunan>,<id-run>
```

### Kriteria berhenti

| Besaran | Periksa | Kesalahan umum |
| --- | --- | --- |
| Selisih energi | Perubahan antarperhitungan dengan resolusi meningkat. | Memakai toleransi universal tanpa mempertimbangkan efek yang diteliti. |
| Gaya dan tegangan | Komponen relevan terbesar dan geometri setimbang. | Menganggap single point cutoff tinggi memperbaiki geometri yang direlaksasi dengan cutoff rendah. |
| Ekstremum band | Sampling dan lokasi ekstremum sebenarnya. | Menganggap band gap selalu berada pada lintasan simetri tinggi. |
| Fonon | Toleransi SCF/DFPT, mesh k/q, dan cabang akustik. | Menghilangkan mode negatif secara kosmetik sebelum memahami penyebabnya. |
| Transport | Sampling rapat, interpolasi, potensial kimia, dan temperatur. | Menganggap kurva interpolasi halus sebagai bukti konvergensi. |

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](#calculation)
- [Mengatur dan memvalidasi Quantum ESPRESSO](#configure)
- [Eksekusi, sumber daya, dan pembatalan](#execution)

<a id="execution"></a>

## Eksekusi, sumber daya, dan pembatalan

Run melewati persiapan, antrean, eksekusi worker, unggah, dan penyelesaian. Log menunjukkan tahap yang sedang berlangsung dan bagian yang perlu diperiksa.

### Membaca status

| Status | Makna | Tindakan |
| --- | --- | --- |
| Draft / Ready | Konfigurasi ada; solver belum tentu berjalan. | Periksa input lalu jalankan. |
| Queued | Menunggu worker atau dependensi. | Periksa tujuan, koneksi, dan prasyarat. |
| Running | Worker sudah mengambil job. | Periksa tahap, log, dan alokasi. |
| Completed | Hasil diunggah dan diterima. | Periksa konvergensi dan validitas ilmiah. |
| Failed | Persiapan, solver, atau unggah gagal. | Baca penyebab dan log sebelum mengulang. |
| Cancellation requested | Permintaan berhenti dikirim ke worker. | Tunggu heartbeat dan status akhir. |
| Cancelled | Run dihentikan atau dikeluarkan dari antrean. | Simpan log yang berguna; buat run baru bila perlu. |

### Arti core dan RAM

Core menunjukkan alokasi vCPU atau proses worker. RAM menunjukkan batas memori yang dikonfigurasi. Keduanya bukan pengukuran utilisasi CPU atau RAM fisik terpasang.

Buka detail sumber daya di Log untuk alokasi backend, durasi, proses MPI, serta estimasi memori dan waktu QE bila tersedia. Data historis yang tidak dilaporkan tidak diisi dengan tebakan.

Worker lokal tetap mengikuti batas job pada layanan. Batas saat ini terlihat di akun dan tujuan komputasi. Permintaan di atas batas ditolak, bukan diam-diam diubah.

### Membatalkan run

- Job yang masih antre dapat dikeluarkan dari antrean.
- Pembatalan run aktif diterima melalui heartbeat worker sehingga tidak seketika.
- Menutup browser tidak membatalkan kalkulasi yang sudah dikirim.
- Mencabut kredensial komputer dapat mengganggu unggah hasil. Gunakan pembatalan kalkulasi sebelum mengganti koneksi ketika ada run aktif.

### Topik terkait

- [Memilih dan menghubungkan kalkulasi](#calculation)
- [Mengatur dan memvalidasi Quantum ESPRESSO](#configure)
- [Prosedur: merancang uji konvergensi](#convergence)

<a id="results"></a>

## Membuka dan menafsirkan hasil

Gunakan Log untuk bukti eksekusi dan unduhan. Gunakan Figure Lab untuk pengeditan plot, perbandingan, tata letak, serta ekspor publikasi.

### Membuka hasil langsung

1. Temukan run selesai di Log.
2. Periksa pesan konvergensi dan ringkasan numeriknya.
3. Pilih Open in Figure Lab bila hasil memiliki data numerik yang dapat diplot.
4. Figur aktif yang terakhir diedit dan memakai run itu dibuka kembali. Jika belum ada, Figure Lab mengimpor sumber dan menyiapkan figur.
5. Jika sumber tersimpan belum dapat dimuat, gunakan Retry, periksa ketersediaan sumber, atau impor file numerik asli.

### Data numerik dan preview

PNG preview merupakan gambar. Dataset numerik menyimpan sampel dan metadata agar dapat diatur ulang, disejajarkan, dan diekspor kembali.

Output kalkulasi baru yang didukung menyimpan dataset riset ringkas terpisah dari akses artefak mentah sementara. Run lama tanpa data tersimpan dapat membutuhkan CSV/teks asli atau eksekusi baru.

Jendela akses artefak biasa umumnya tiga hari. Pembersihan penyimpanan merupakan konfigurasi terpisah. Tautan unduh kedaluwarsa tidak membuktikan dataset riset tersimpan ikut hilang.

### Interpretasi fisik

- Estimasi band gap membutuhkan okupansi atau referensi energi yang bermakna. Fermi yang tidak diketahui bukan Fermi nol.
- Normalisasi DOS harus mengacu ke sel, atom, satuan formula, atau volume yang benar.
- Frekuensi fonon imajiner dapat menunjukkan ketidakstabilan atau konvergensi belum cukup; periksa modelnya.
- Transport bergantung pada interpolasi, sampling, temperatur, potensial kimia, dan waktu relaksasi. Konduktivitas dibagi waktu relaksasi bukan konduktivitas absolut tanpa waktu yang dijustifikasi.

### Topik terkait

- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)
- [Studi banyak material dan variasi parameter](#studies)

<a id="figures"></a>

## Menyusun figur

Figure Lab menyediakan pustaka hasil di kiri, halaman publikasi di tengah, dan Inspector di kanan. Pada layar kecil, Results dan Inspector dibuka sebagai panel geser.

### Memilih tata letak

| Layout | Pemakaian | Pemeriksaan |
| --- | --- | --- |
| Single plot | Satu hasil dengan satu pesan. | Besaran, satuan, sumbu, dan judul. |
| Overlay | Beberapa kurva dengan koordinat fisik sebanding. | Lintasan, referensi energi, normalisasi, dan legenda. |
| One panel per result | Material atau hasil yang memerlukan panel mandiri. | Dimensi dan rentang yang adil. |
| Band + DOS pairs | Dispersi berdampingan dengan DOS terkait. | Identitas geometri dan elektronik serta konvensi energi. |
| Parameter series | Urutan strain, tekanan, temperatur, atau variasi lain. | Nama parameter, satuan, dan nilai numerik. |

### Menyusun halaman

1. Pilih hasil selesai pada project aktif dan impor dataset numeriknya.
2. Cari dan pilih dataset pembanding.
3. Pilih layout. Satu dataset boleh digunakan di beberapa figur tanpa mengubah sampel aslinya.
4. Tentukan lebar dan tinggi dalam milimeter sesuai ukuran kolom jurnal.
5. Pilih panel dari kanvas atau Inspector. Atur rentang, bentang panel, urutan, legenda, dan sumbu terhubung.
6. Gunakan kontrol Data untuk nama layer, channel, penggantian sumber, warna, dan gaya garis.
7. Periksa catatan konteks ilmiah, tunggu penyimpanan cloud selesai, lalu ekspor.

### Interaksi kanvas

Tombol + dan - mengubah pembesaran halaman; 0 atau Fit menyesuaikan dengan area kanvas. Rentangnya 25 sampai 400 persen terhadap tampilan yang sudah di-fit.

Space+drag, Alt+drag, atau drag tombol tengah menggeser halaman. Ctrl/Cmd+scroll memperbesar tampilan. Klik panel plot untuk mengeditnya.

Zoom kanvas tidak mengubah dimensi ekspor, batas sumbu, atau nilai data. Untuk mengubah rentang plot, gunakan minimum dan maksimum panel.

> Garis dan marker dipotong pada kotak sumbu. Simbol Γ menunjukkan pusat zona Brillouin; metadata sumber tetap dipertahankan.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)
- [Studi banyak material dan variasi parameter](#studies)

<a id="alignment"></a>

## Energi, lintasan k, dan normalisasi DOS

Perbandingan bisa terlihat rapi sambil mencampur referensi fisik yang tidak sesuai. Tentukan makna setiap sumbu sebelum mengubah tampilannya.

### Penyelarasan energi

| Mode | Makna | Interpretasi |
| --- | --- | --- |
| Source energy | Mempertahankan referensi numerik impor. | Gunakan bila konvensi sumber dipahami. |
| Each Fermi = 0 | Menggeser tiap dataset dengan Fermi masing-masing. | Membandingkan bentuk relatif, bukan offset band absolut. |
| Each VBM = 0 | Menggeser terhadap maksimum band valensi tercatat. | Bandingkan fitur relatif terhadap tepi valensi yang bermakna. |
| Vacuum alignment | Memakai referensi vakum tercatat. | Perbandingan referensi bersama jika vakumnya dijustifikasi. |
| Manual shift | Menerapkan offset energi eksplisit. | Catat metode dan besar offset yang digunakan. |

### Band + DOS

Pasangan terverifikasi memerlukan identitas geometri dan sumber elektronik yang sesuai serta data relatif Fermi yang kompatibel. Nama file atau rumus kimia sama belum cukup.

Layout pasangan memakai sumbu energi vertikal bersama, umumnya dengan rasio lebar 2:1. Batas energi yang terhubung diperbarui pada kedua panel.

Mengganti satu sumber dengan kalkulasi yang tidak terkait membatalkan klaim pasangan terverifikasi. Gunakan panel perbandingan biasa jika sumber memang berbeda.

### Kompatibilitas lintasan k

Label Γ, X, atau K tidak cukup untuk memastikan koordinat resiprok sama. Basis sel, titik ujung, dan koordinat segmen perlu diperiksa.

Normalisasi segmen dapat menyelaraskan titik ujung ketika metadata memadai, tetapi mengubah skala horizontal yang ditampilkan.

Cabang lintasan yang terputus harus tetap dipisahkan. Menghubungkan ujung cabang berbeda menghasilkan band kontinu yang tidak berasal dari data.

### DOS dan spin

- DOS QE sering dinormalisasi per sel. Jangan menamainya per atom tanpa konversi.
- Normalisasi per atom, satuan formula, atau volume membutuhkan metadata jumlah atau volume yang benar.
- Pencerminan spin-down hanya cara visual membedakan channel; DOS fisik tidak menjadi negatif.
- Bedakan total DOS, proyeksi orbital/atom, dan kolom numerik umum. Nama channel harus menjelaskan besaran sebenarnya.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Studi banyak material dan variasi parameter](#studies)

<a id="studies"></a>

## Studi banyak material dan variasi parameter

Pilih layout berdasarkan perbandingan ilmiah, kemudian gunakan gaya yang konsisten. Tidak semua hasil perlu dipaksakan ke satu overlay yang padat.

### Banyak material dalam paper

1. Simpan struktur dalam satu project studi dengan identitas sumber jelas.
2. Dokumentasikan perbedaan dan pendekatan metode secara konsisten.
3. Jalankan band atau DOS untuk tiap material.
4. Gunakan grid ketika lintasan k atau skala energi sangat berbeda. Overlay hanya untuk koordinat dan referensi yang mendukung.
5. Namai layer berdasarkan material, gunakan sedikit warna yang jelas, dan tulis referensi energi.
6. Simpan layout sebagai template untuk material berikutnya.

### Satu material pada beberapa strain

1. Duplikasikan struktur referensi sebelum memberi strain.
2. Catat apakah strain uniaksial, biaksial, volumetrik, atau tensor lain; satu angka persen tidak mewakili seluruh tensor.
3. Gunakan kendala relaksasi dan pengaturan elektronik yang konsisten.
4. Untuk tiap dataset, masukkan nama parameter kondisi, satuan, dan nilai numerik yang sejenis.
5. Pilih Parameter series untuk urutan numerik termasuk strain negatif.
6. Bandingkan memakai referensi energi yang dijustifikasi dan jelaskan normalisasi lintasan bila digunakan.

### Band berdampingan dengan DOS

1. Pastikan geometri dan asumsi elektronik kedua kalkulasi sesuai.
2. Muat kedua dataset numerik ke Figure Lab.
3. Pilih Band + DOS pairs dan baca catatan kompatibilitas.
4. Tentukan interval energi vertikal bersama dan titik nolnya.
5. Atur kepadatan garis serta rentang horizontal DOS tanpa mengubah skala energi bersama.
6. Ekspor figur vektor dan Source package.

### Konvergensi dan temperatur

Gunakan dataset numerik umum untuk besaran turunan seperti energi per atom terhadap cutoff, atau dataset transport yang sesuai bila tersedia.

Catat parameter dan satuan dengan jelas. Tambahkan ketidakpastian serta asumsi metode pada caption atau metadata; banyak digit desimal bukan bukti presisi.

Template menjaga dimensi dan tipografi stabil di seluruh paper sementara provenance tiap dataset tetap tersimpan.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)

<a id="reuse"></a>

## Template, penggantian sumber, dan histori

Gunakan kembali pengaturan visual sambil mempertahankan identitas sumber numerik. Template menjelaskan layout; figur menghubungkan layout dengan dataset tertentu.

### Memakai template

1. Selesaikan layout, tipografi, susunan panel, dan gaya layer pada contoh figur.
2. Simpan sebagai template. Ikatan sumber menjadi slot yang dapat dipakai ulang.
3. Pilih dataset pengganti mengikuti urutan slot lalu terapkan template.
4. Periksa judul, besaran, dan channel setelah sumber dihubungkan.
5. Edit caption khusus sendiri; template tidak mengetahui kesimpulan ilmiah studi baru.

### Mengganti dataset

Gunakan Replace source pada layer terpilih. Warna, gaya garis, dan pengaturan channel yang kompatibel dipertahankan. Judul otomatis mengikuti sumber baru, sementara teks khusus tetap dapat diedit.

Mengubah metadata sumber menghasilkan identitas dataset baru. Figur lama tetap memakai sumber awal sampai diganti secara eksplisit.

Inset dapat memakai slot sumber yang sama dengan batas sendiri tanpa menyalin atau melakukan resampling data asli.

### Undo dan penyimpanan

- Undo/redo mencakup sampai 50 langkah pada sesi Figure Lab saat ini.
- Edit rutin disimpan otomatis; Ctrl/Cmd+S dapat membuat checkpoint eksplisit di History.
- Edit otomatis memperbarui working copy sehingga tidak menghasilkan revisi permanen tanpa batas.
- History menyediakan versi tersimpan untuk diperiksa dan dipulihkan menjadi figur aktif yang dapat diedit.
- Jika tab atau perangkat lain mengubah revisi cloud, penimpaan otomatis berhenti. Periksa versi lokal dan cloud sebelum memilih.

### Arsip dan project lain

Archive menyembunyikan figur dari daftar aktif dan menyediakan Restore. Arsip bukan penghapusan dan tidak membebaskan kuota histori.

Include other projects menampilkan dataset milik akun Anda dari studi lain, bukan akses ke akun lain.

Impor Source package menyalin figur dan sumber ke project yang dipilih; hash sumber diperiksa ketika tersedia.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)

<a id="advanced"></a>

## PDOS, unfolding, dan inset

Gunakan fitur khusus ketika data yang diperlukan benar-benar tersedia. Pengaturan visual tidak dapat menghasilkan informasi fisik yang tidak dihitung oleh sumbernya.

### Projected density of states

Pilih channel proyeksi yang tersedia pada dataset dan beri label atom, unsur, atau orbital sesuai metadata. Jangan menafsirkan kolom total DOS sebagai proyeksi.

Penjumlahan proyeksi dapat bergantung pada basis proyektor dan konvensi solver. Perbedaan terhadap DOS total tidak selalu merupakan kesalahan plot.

Gunakan warna dan legenda yang membedakan proyeksi; periksa satuan, normalisasi, dan spin sebelum menggabungkan channel.

### Band unfolding

Tampilan unfolding membutuhkan data spektral berbobot yang telah dihitung dengan pemetaan sel primitif dan supercell yang sesuai. Bobot menentukan intensitas titik atau representasi spektral.

Memuat band supercell biasa tidak otomatis menghasilkan unfolding. Simpan metode, pemetaan sel, koordinat k, dan makna bobot bersama dataset.

Periksa batas ukuran data serta koordinat lintasan sebelum ekspor. Transparansi visual bukan pengganti normalisasi bobot yang jelas.

### Inset

1. Pilih panel induk yang memerlukan detail.
2. Tambahkan inset dan pilih sumber atau layer yang sesuai.
3. Atur posisi, ukuran, serta batas sumbu inset secara independen.
4. Periksa agar inset tidak menutupi legenda, label, atau fitur utama.
5. Jelaskan wilayah dan besaran yang diperbesar pada caption; ekspor pada ukuran akhir untuk memeriksa keterbacaan.

### Batas interpretasi

Metadata yang tidak diketahui harus tetap dinyatakan tidak diketahui. Jangan mengisi geometri, Fermi, degenerasi, atau bobot dengan nilai buatan agar suatu layout terlihat terverifikasi.

Gunakan dokumentasi solver pembentuk proyeksi atau unfolding untuk asumsi dan satuannya. Figure Lab mempertahankan data yang diimpor, bukan memvalidasi seluruh metode ilmiah hulu.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)

<a id="export"></a>

## Ekspor dan reproduksibilitas figur

Pilih format berdasarkan tujuan pemakaian. Simpan figur yang sudah dirender bersama data dan pengaturannya agar dapat dibuka kembali.

### Format tersedia

| Format | Pemakaian | Sifat |
| --- | --- | --- |
| SVG | Pengeditan vektor dan web. | Path vektor; pertahankan informasi font yang diberikan. |
| PDF | Pengiriman paper dan tata letak dokumen. | Vektor dengan teks yang dapat dipilih dan font publikasi tertanam. |
| PNG | Slide, preview, dan alur raster. | Piksel ditentukan dari milimeter dan DPI; maksimal 40 megapiksel. |
| Source package | Arsip, kolaborasi, dan pengeditan ulang. | JSON figur, dataset, SVG, lisensi font, identitas sumber, dan checksum. |

### Prosedur ekspor

1. Gunakan lebar kolom jurnal; 85 mm dan 180 mm hanyalah contoh umum.
2. Tentukan ukuran huruf dalam point dan periksa label, legenda, serta huruf panel pada ukuran akhir.
3. Periksa batas minimum/maksimum, clipping, satuan, simbol Γ, dan referensi energi.
4. Pilih SVG atau PDF untuk grafik garis ketika penerbit menerima vektor.
5. Untuk PNG, tentukan DPI dan periksa dimensi piksel hasilnya.
6. Unduh Source package dan simpan bersama input eksekusi serta catatan metode.

### Fidelity dan batasnya

Renderer mempertahankan vertex garis. Penyelarasan, normalisasi, warna, dan pencerminan spin mengubah tampilan sementara sampel asli tetap disimpan.

Font publikasi harus dapat dimuat dari frontend atau cache browser. Ekspor menampilkan kegagalan ketika sumber wajib tidak tersedia; sambungkan internet dan coba lagi.

Source package mereproduksi figur. Mengulang simulasi juga membutuhkan lingkungan komputasi, pseudopotensial yang kompatibel, input lengkap, dan data antara yang diperlukan.

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)

<a id="publication"></a>

## Prosedur: menyiapkan figur publikasi

Siapkan perbandingan fisik terlebih dahulu, kemudian geometri halaman, tipografi, dan ekspor. Sertakan sumber yang dapat diedit untuk setiap figur yang dikirim.

### Kompatibilitas sumber

1. Buka hasil selesai di Figure Lab atau pilih dataset tersimpan dari pustaka hasil.
2. Periksa besaran, satuan, identitas geometri, referensi energi, dan metadata lintasan k.
3. Pilih grid untuk lintasan berbeda; overlay hanya untuk koordinat dan referensi yang sebanding.
4. Untuk Band + DOS, periksa geometri dan asumsi elektronik pasangan serta rentang energi terhubung.
5. Jelaskan konvensi alignment. Each Fermi = 0 membandingkan struktur elektronik relatif, bukan offset band absolut.

### Mengatur halaman

| Kontrol | Pilihan praktis | Verifikasi |
| --- | --- | --- |
| Lebar / tinggi | Dimensi jurnal tujuan. | PDF lebar kolom tetap terbaca pada ukuran 100%. |
| Tipografi | Satu font publikasi dan hierarki sederhana. | Label sumbu, tick, legenda, dan huruf panel punya peran berbeda. |
| Gaya garis | Warna ditambah dash atau marker bila perlu. | Kurva dapat dibedakan dalam grayscale dan variasi penglihatan warna. |
| Batas | Rentang sebanding bila dijustifikasi. | Tidak menyembunyikan data dengan crop yang tidak dijelaskan; garis tetap di dalam kotak. |
| Legenda | Material atau kondisi dengan satuan. | ID run bukan satu-satunya deskripsi ilmiah. |
| Inset | Detail dengan posisi dan rentang eksplisit. | Sumber serta wilayah yang diperbesar dapat dikenali. |

### Ekspor dan pemeriksaan

1. Tunggu status cloud Figure Lab mengonfirmasi edit terbaru.
2. Pilih PDF/SVG untuk vektor atau tentukan ukuran fisik serta DPI sebelum PNG.
3. Buka hasil pada aplikasi manuskrip. Periksa skala fisik, simbol Yunani, font, label panel, dan clipping.
4. Ekspor Source package terpisah. Simpan di samping figur dan input simulasi yang dijalankan.
5. Jika sumber atau metode berubah, ganti dataset secara eksplisit, periksa kembali legenda serta referensi, dan ekspor versi baru.

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

### Topik terkait

- [Membuka dan menafsirkan hasil](#results)
- [Menyusun figur](#figures)
- [Energi, lintasan k, dan normalisasi DOS](#alignment)

<a id="saving"></a>

## Penyimpanan otomatis dan banyak perangkat

Editor DFT Lab dan Figure Lab menampilkan status penyimpanan yang relevan dengan dokumen aktif. Dashboard Workspace tidak menampilkan Saved to cloud; sinkronisasi project tetap berjalan di belakang layar.

### Arti status editor

| Label | Makna | Tindakan |
| --- | --- | --- |
| Saving... | Draft atau sinkronisasi berlangsung. | Tunggu sebentar sebelum mengandalkan perangkat lain. |
| Saved to cloud | Dokumen aktif dan sumber yang diperlukan dikonfirmasi tersimpan. | Dapat dibuka dengan akun yang sama. |
| Saved on device / Offline | Salinan browser ada, unggah belum selesai. | Jangan hapus data browser; sambungkan kembali. |
| Sync pending | Salinan lokal disimpan selama unggah dicoba lagi. | Periksa jaringan dan batas penyimpanan. |
| Sync conflict | Revisi cloud berbeda dari revisi yang diedit. | Periksa History sebelum memilih versi. |

### Perilaku Figure Lab

Figure Lab menyimpan draft lokal setelah sekitar 350 ms tanpa edit baru dan memulai sinkronisasi cloud sekitar 1,2 detik. Unggah dijalankan berurutan; edit selama unggah disimpan berikutnya.

Meninggalkan Figure Lab mem-flush draft yang masih tertunda. Kembali online atau memfokuskan halaman membantu mencoba lagi sinkronisasi yang tertunda. Kegagalan tetap ditampilkan sebagai kegagalan.

Tidak ada tombol Save revision yang wajib. Ctrl/Cmd+S merupakan checkpoint histori opsional.

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

### Salinan portabel

- Ekspor Source package untuk figur penting.
- Simpan struktur asli dan input kalkulasi yang dijalankan.
- Penyimpanan browser memiliki kuota perangkat dan hilang bila data situs dibersihkan.
- Archive mengatur daftar, bukan menghapus record atau membebaskan kuota.
- Billing memisahkan inventaris file cloud dari kuota dokumen Figure Lab. Angka penyimpanan bukan faktur.

### Topik terkait

- [Profil, pemakaian, dan paket](#account)
- [Menghubungkan komputer melalui Phynite Compute](#local-compute)
- [Mengelola paket, tagihan, dan pemakaian](#billing)

<a id="account"></a>

## Profil, pemakaian, dan paket

Account mengelola identitas riset, preferensi, pemakaian, dan koneksi komputer. Billing menyediakan tampilan khusus untuk paket serta pengukuran sumber daya.

### Mengedit profil

1. Buka menu avatar, pilih Profil, lalu Edit profil. Profil hanya terlihat oleh akun Anda.
2. Isi nama tampilan, institusi, peran, dan bidang riset.
3. Pilih foto JPG, PNG, atau WebP hingga 20 MB. Crop, perbesar, dan putar foto; browser menyimpan gambar 256 piksel terkompresi.
4. Periksa preview dan pilih Save profile. Menghapus foto baru diterapkan setelah profil disimpan.
5. Buka Pengaturan → Tampilan & bahasa untuk menyimpan default akun. Perangkat ini dapat mengikuti default akun atau memakai override Terang/Gelap. Tema perangkat dan bahasa browser langsung berlaku di luar formulir Simpan/Batal akun.

### Navigasi pengaturan akun

Menu avatar mengelompokkan Profil, Pengaturan, Pemakaian, dan Tagihan, lalu Harga, Bantuan, dan Keluar. Profil menampilkan job tersimpan, selesai, aktif saat pengukuran, waktu run tercatat, dan lima job terbaru. Waktu atau alokasi yang belum tercatat tidak tersedia; inventaris storage diukur terpisah.

Di atas 960px, sidebar Pengaturan menetap pada lebar 280px tanpa mengubah docking atau lebar workspace. Pencarian menemukan halaman dan kontrol pengaturan. Pada mobile, gunakan drawer navigasi; tutup melalui Escape, tombol tutup, atau latar. Menu akun mendukung tombol panah, Home, End, dan Escape. Draft memerlukan keputusan sebelum navigasi atau keluar.

### Menentukan username untuk masuk

1. Buat akun dengan email dan verifikasi email terlebih dahulu.
2. Buka Pengaturan → Profil riset. Nama tampilan boleh mengandung spasi dan tidak harus unik.
3. Pada Username, masukkan 3–30 karakter dengan awalan huruf atau angka. Huruf, angka, titik, tanda hubung, dan garis bawah didukung; nama yang dicadangkan tidak dapat dipakai.
4. Pilih Simpan username. Aksi ini terpisah dari menyimpan identitas riset. Layanan memeriksa keunikan tanpa membedakan huruf besar dan kecil. Pilih nama lain jika sudah digunakan.
5. Saat masuk berikutnya, gunakan username tersebut atau email dengan password yang sama. Setelah username diganti, nama lama berhenti berlaku dan dapat dipakai akun lain. Pemulihan password selalu memakai email terverifikasi.

> Username tidak membuat akun baru, membagikan project, atau mengganti email. Akun lama tetap dapat masuk melalui email dan menambahkan username kapan diperlukan.

### Menelusuri riwayat kalkulasi

Buka Pemakaian & penyimpanan lalu Kalkulasi terbaru. Setiap halaman menampilkan enam catatan berdasarkan waktu pembuatan, terbaru dahulu. Baris mencantumkan tanggal dan waktu lokal, jenis kalkulasi, tujuan, alokasi core dan RAM, serta status.

Berikutnya dan Sebelumnya mengganti halaman tabel. Total sumber daya berlaku untuk seluruh akun, bukan hanya enam baris yang terlihat. Perbarui memuat ulang pengukuran dan halaman tabel aktif. Waktu yang tidak tercatat ditandai tidak tersedia, bukan diperkirakan.

### Membaca pengukuran

| Metrik | Perhitungan |
| --- | --- |
| Current cloud files | Ukuran objek cloud versi saat ini milik akun; tidak termasuk versi lama, metadata, atau disk lokal. |
| Recorded run time | Waktu worker mulai sampai selesai, termasuk persiapan dan unggah. Run gagal/batal ikut dihitung jika timestamp lengkap. |
| Allocated CPU-hours | Durasi tercatat dikalikan core alokasi lalu dibagi 3600; bukan utilisasi CPU. |
| On your computer | Durasi run dengan tujuan worker pribadi. |
| Last 30 days | Durasi run yang selesai dalam 30 hari terakhir. |
| Unmeasured runs | Run terminal tanpa waktu valid; dikecualikan dari jumlah durasi. |

### Pilihan paket

Free mencakup total storage cloud 10 GiB, persiapan struktur, project pribadi, Figure Lab, serta simulasi DFT dan MD pada komputer sendiri yang terhubung. Akun early access dapat memakai Cloud berbayar dengan Quanta produksi terverifikasi.

Paid Cloud mendukung seluruh workflow DFT, LAMMPS Guided/manual, dan OVITO dengan vCPU dan RAM tersedia yang Anda pilih. Job paid berjalan paralel sesuai pendanaan dan kapasitas region. Pilot memakai grant admin terpisah dengan CPU/RAM, budget operasional, jumlah job, dan masa berlaku; grant lama tetap 2 vCPU, 6 GiB, dan 15 menit, satu slot global tanpa memotong Quanta.

Komputer Anda menjadi tujuan awal akun Free baru. Hubungkan worker sebelum menjalankan simulasi. Pergantian tujuan tidak memindahkan run yang sudah ada.

Pendaftaran publik tetap waitlist dan undangan. Akun early access membuka checkout Quanta dan storage dari Billing. Pembayaran produksi terverifikasi memperbarui saldo tersedia dan akses compute tanpa langsung menjalankan job. Institution membuka jalur konsultasi.

> Komputasi lokal memakai perangkat, listrik, dan disk Anda. Internet tetap diperlukan untuk koordinasi, unduhan pseudopotensial bila perlu, serta sinkronisasi hasil. Batas storage dan transfer yang berlaku tetap digunakan.

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Menghubungkan komputer melalui Phynite Compute](#local-compute)
- [Mengelola paket, tagihan, dan pemakaian](#billing)

<a id="billing"></a>

## Mengelola paket, tagihan, dan pemakaian

Tagihan & pemakaian menyatukan paket aktif, tujuan komputasi, catatan sumber daya, dan pilihan paket. Pengukuran sumber daya berbeda dari faktur pembayaran.

### Memeriksa akun

1. Buka Tagihan pada header atau Tagihan & pemakaian pada navigasi studio.
2. Periksa paket aktif, status langganan, dan alokasi per run yang berasal dari akun.
3. Pada Pemakaian tercatat, pilih Perbarui setelah kalkulasi selesai atau file cloud berubah.
4. Baca penggunaan Figure Lab dan file cloud saat ini. Storage berbayar berbagi satu kuota total untuk file cloud dan reservasi upload.
5. Pilih Ekspor pemakaian untuk mengunduh JSON bertanggal. Ekspor berisi pengukuran sumber daya, bukan tanda terima pembayaran.

### Aksi paket

| Paket | Aksi | Efek |
| --- | --- | --- |
| Free | Gunakan Free | Mencakup run DFT dan MD lokal. Komputer Anda menjadi tujuan awal akun Free baru; hubungkan worker sebelum menjalankan simulasi. |
| Cloud | Top-up Quanta | Akun early access memakai kredit produksi terverifikasi; pengunjung publik tetap melalui waitlist. Pembayaran tidak langsung menjalankan job. |
| Enterprise | Diskusikan kebutuhan | Membuka kontak untuk kapasitas dan ketentuan institusi. |

### Menafsirkan waktu dan penyimpanan

Waktu run menjumlahkan interval worker mulai sampai selesai yang valid. Persiapan, unggah, serta run gagal atau batal dapat termasuk bila timestamp lengkap.

Jam CPU teralokasi mengalikan durasi dengan core. Nilai ini bukan utilisasi CPU, konsumsi listrik, atau tarif.

Penyimpanan menghitung versi objek cloud saat ini. Versi lama, metadata, dan disk lokal tidak termasuk. Tanda plus berarti inventaris mencapai batas objek dan angka merupakan batas bawah.

Kuota Figure Lab mencakup dataset, dokumen figur, template, dan revisi. Mengarsipkan figur tidak menghapus record atau membebaskan kuota.

### Pembayaran dan faktur

Billing membuka checkout Phynite pada /billing/checkout setelah aktivasi merchant. Pilih Direct Virtual Account atau QRIS saat tersedia; DOKU memproses pembayaran. Virtual Account menambah Rp4.000; QRIS tanpa surcharge. Quanta dijual Rp18.000 per Quanta, mulai 0,5 Quanta (harga dasar Rp9.000, melalui VA Rp13.000). /billing/payments/[id] menampilkan instruksi dan status terverifikasi; /billing/history memuat 20 pembelian per halaman dengan filter status. Invoice hosted lama mempertahankan nominalnya. Pesanan dibuat, aktivasi terverifikasi, percobaan gagal dan kedaluwarsa terkonfirmasi menghasilkan notifikasi inbox; email transaksi diaktifkan setelah verifikasi SES, dengan pengirim dan balasan support@phynitelab.com. Kegagalan email tidak membatalkan pembayaran. Halaman tidak menerima nomor kartu. Penerbitan faktur pajak belum terhubung.

Akun early access memakai seluruh workflow Cloud dengan Quanta produksi terverifikasi sesuai saldo dan kapasitas. Pilot memakai grant admin; Institution mengikuti kesepakatan kapasitas. Komputasi lokal gratis, tetapi perangkat, internet, penyimpanan, dan listrik tetap menjadi tanggung jawab pengguna.

> Ekspor pemakaian dapat berisi nama dan ID kalkulasi. Bagikan hanya kepada kolaborator atau dukungan yang dituju.

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Profil, pemakaian, dan paket](#account)
- [Menghubungkan komputer melalui Phynite Compute](#local-compute)

<a id="local-compute"></a>

## Menghubungkan komputer melalui Phynite Compute

Jalankan kalkulasi DFT dan dinamika molekuler pada komputer sendiri melalui satu koneksi Phynite. Unduh aplikasi pendamping untuk sistem operasi Anda, buka, lalu setujui koneksi pada akun. Phynite Compute menyiapkan runtime Quantum ESPRESSO, LAMMPS, dan OVITO terverifikasi secara otomatis.

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

- [Default compute](/account/compute)
- [Pemakaian dan catatan run](/account/usage)
- [NERSC: resource accounting](https://docs.nersc.gov/policies/resource-usage/)
- [Quantum ESPRESSO: parallelization](https://www.quantum-espresso.org/Doc/pw_user_guide/node18.html)
- [LAMMPS: measure performance](https://docs.lammps.org/stable/Speed_measure.html)

### Sebelum memulai

Pilih CPU dan RAM per job pada pengaturan Compute atau drawer workspace, sesuai batas DFT, simulasi MD, atau analisis MD yang ditampilkan. Alokasi adalah resource yang diminta job. Worker baru juga melaporkan alokasi CPU/RAM yang diteruskan ke runtime saat diluncurkan; ini bukan utilisasi perangkat. Kebutuhannya bergantung pada atom, cutoff, k-point, band, dan jenis kalkulasi.

Sediakan beberapa GB ruang disk untuk runtime terverifikasi dan pustaka ilmiah, serta ruang kerja hasil. Internet diperlukan untuk menghubungkan akun, menerima kalkulasi, dan mengunggah hasil.

| Komputer | Unduhan | Buka |
| --- | --- | --- |
| macOS | Phynite Compute for macOS | Open Phynite Compute.command |
| Windows 10 / 11 | Phynite Compute for Windows | Open Phynite Compute.cmd |
| Linux | Phynite Compute for Linux | ./phynite-compute |

- [Unduh Phynite Compute](/account/compute#your-computer)

### 1. Unduh dan buka

1. Buka Komputer Anda dari menu avatar. Website merekomendasikan unduhan yang sesuai dengan sistem operasi; tautan untuk sistem lain tetap tersedia.
2. Ekstrak ZIP lalu buka launchernya. Aplikasi pendamping memeriksa engine lokal dan hanya membuka halaman installer resminya ketika prasyarat tersebut belum tersedia.
3. Setup pertama mengunduh runtime ilmiah bertanda versi yang sesuai dengan arsitektur. Sesi berikutnya menggunakannya kembali dan mempertahankan volume privat Phynite Compute.

- [Buka Komputer Anda](/account/compute#your-computer)

### 2. Setujui komputer ini

1. Launcher kembali ke Komputer Anda dengan Kode koneksi 12 digit yang sudah terisi. Periksa halaman lalu pilih Hubungkan komputer.
2. Setiap kode hanya dapat dipakai sekali dan berlaku 10 menit. Setujui hanya komputer milik Anda.
3. Jika komputer lain sudah terhubung, selesaikan atau batalkan kalkulasi aktif sebelum mengonfirmasi penggantian.
4. Setelah disetujui, Phynite Compute mengunduh dan memverifikasi pustaka ilmiah. Tunggu hingga status web berubah menjadi Terhubung. Satu koneksi tersebut mengaktifkan DFT Lab dan MD Lab.

> Kode sementara memberi akses pada satu komputer tanpa mengekspos kredensial privatnya.

### 3. Jalankan kalkulasi pertama

1. Buka DFT Lab dan mulai dengan kalkulasi Total energy silikon kecil. Pilih Komputer Anda sebagai tujuan komputasi.
2. Periksa log eksekusi. Job yang antre menunggu komputer terhubung dan dependensi sebelumnya. Satu kalkulasi berjalan pada satu waktu di komputer ini.
3. Untuk hasil SCF yang berhasil, periksa konvergensi, JOB DONE, dan status akhir Completed. Penyelesaian juga memerlukan unggah hasil.
4. Buka Figure Lab dari hasil selesai. Datanya tetap terhubung dengan project, kalkulasi sumber, dan pengaturan numerik.
5. Buka MD Lab lalu jalankan equilibration Lennard-Jones kecil. MD memakai komputer terhubung yang sama dan tidak memerlukan pairing kedua.

- [Tutorial silikon](#quickstart-silicon)
- [Membaca log eksekusi](#execution)

### Penggunaan harian

Volume privat Phynite Compute menyimpan koneksi dan pustaka yang diunduh. Pertahankan komputer aktif dan internet tersedia selama kalkulasi berjalan; website boleh ditutup.

Menghentikan engine lokal atau menidurkan komputer dapat menginterupsi kalkulasi. Pulihkan koneksi dan periksa status job sebelum mengirim duplikat. File kerja lokal yang selesai dibersihkan setelah tiga hari.

| Tindakan | Lokasi |
| --- | --- |
| Buka atau mulai ulang Phynite Compute | Buka kembali launcher yang diunduh |
| Periksa koneksi | Komputer Anda pada menu akun |
| Lihat pesan teknis | Setup manual lanjutan → Tampilkan log layanan |
| Batalkan kalkulasi | Gunakan Cancel pada log eksekusi dan tunggu status akhirnya |

### Memperbarui, memutus, atau memindahkan komputer

1. Selesaikan atau batalkan kalkulasi aktif sebelum pembaruan, penggantian, atau pemutusan.
2. Untuk memperbarui, unduh dan buka launcher terbaru. Launcher meminta konfirmasi sebelum mengganti runtime dan mempertahankan volume privat.
3. Untuk memindahkan komputer, putuskan komputer lama pada Komputer Anda, unduh Phynite Compute di perangkat baru, lalu setujui kode barunya.

> Satu kredensial komputer pribadi aktif didukung per akun. Jangan menyalin atau membagikan volume runtime privat.

### Pemecahan masalah

| Yang terlihat | Yang perlu dilakukan |
| --- | --- |
| Engine lokal belum tersedia | Launcher membuka halaman installer resmi. Instal, tunggu hingga siap, lalu buka kembali Phynite Compute. |
| Kode belum muncul | Tunggu unduhan runtime pertama selesai. Buka kembali launcher atau gunakan Tampilkan log layanan pada Setup manual lanjutan. |
| Kode kedaluwarsa atau telah digunakan | Buka kembali launcher untuk meminta dan membuka kode terbaru. |
| Disetujui, tetapi masih Offline | Setup pustaka pertama dapat memerlukan beberapa menit. Periksa log layanan lalu perbarui koneksi. |
| Job tetap antre | Periksa status Terhubung, tujuan Komputer Anda, dan dependensi selesai. Jangan kirim duplikat. |
| OOMKilled / exit 137 | Kalkulasi melebihi memori. Kurangi ukuran sistem atau jumlah band hanya jika sesuai secara ilmiah. |

- [Hubungi dukungan](/contact)
- [Diagnosis kalkulasi](#diagnostics)

### Diagnostik manual lanjutan

Setup normal tidak memerlukan Terminal atau PowerShell. Dukungan mungkin meminta Anda menjalankan perintah bertanda versi atau membaca log layanan terbaru. Perintah ini memakai runtime Docker read-only dan non-root yang sama dengan launcher.

```text
docker run -d --name phynite-compute --restart unless-stopped --init --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --cpus 4 --memory 8g --tmpfs /tmp:rw,size=512m -v phynite-compute:/state public.ecr.aws/p8i3a1t8/phynite/personal-compute@sha256:2e478dd301384eaa9ea754fcf6630de7fe7ad1ccb114fb5f5c5d8dba3d49a185
docker logs --tail 30 phynite-compute
```

> Jangan mengubah referensi image, membagikan volume privat, atau menempelkan kode koneksi dalam pesan dukungan.

### Akses, data, dan pemeriksaan ilmiah

Layanan terisolasi hanya menerima kalkulasi milik akun yang menyetujui kodenya. Pemutusan koneksi mencabut akses. Tidak ada port masuk, socket Docker, atau direktori home host yang dibagikan.

Runtime memakai image read-only, volume penyimpanan khusus, pengguna non-root, serta batas CPU, memori, dan proses. Runtime memerlukan akses internet keluar untuk Phynite dan unduhan pustaka terverifikasi.

Pemilik komputer dapat memodifikasi perangkat lunaknya sendiri. Ikatan akun melindungi akses ke akun lain; ini tidak mensertifikasi hasil ilmiah. Periksa konvergensi, pengaturan numerik, versi solver, dan pseudopotensial sebelum publikasi.

- [Studi konvergensi](#convergence)
- [Menyiapkan figur publikasi](#publication)

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Profil, pemakaian, dan paket](#account)
- [Mengelola paket, tagihan, dan pemakaian](#billing)

<a id="language"></a>

## Bahasa, wilayah, dan aksesibilitas

Studio mendukung English dan Bahasa Indonesia. Tentukan bahasa secara eksplisit atau ikuti preferensi bahasa browser/perangkat.

### Memilih bahasa

1. Di beranda, gunakan menu globe pada header. Di Workspace, gunakan tombol bahasa dengan bendera di footer atau buka Akun / Preferensi. DFT Lab dan Figure Lab tidak memakai footer; buka Preferensi melalui menu avatar editor.
2. Pilih English atau Bahasa Indonesia untuk mengganti deteksi otomatis.
3. Buka halaman lain atau muat ulang. Pilihan tersimpan pada browser ini.

### Cara deteksi otomatis

Pilihan eksplisit yang tersimpan didahulukan. Dalam mode otomatis, Phynite membaca bahasa yang didukung sesuai urutan preferensi browser atau perangkat.

Respons server awal membaca header bahasa browser. Jika tidak ada bahasa yang didukung, petunjuk negara dari edge hosting dapat memilih Bahasa Indonesia untuk Indonesia; pilihan akhirnya English bila petunjuk tidak tersedia.

Phynite tidak meminta GPS atau memakai layanan lokasi IP terpisah untuk memilih bahasa. Jika negara terdeteksi menyarankan bahasa lain, popup menawarkan pergantian. Menutup saran diingat untuk negara itu. Perjalanan tidak mengubah pilihan eksplisit Anda. Preferensi berlaku per browser sehingga perangkat lain dapat memakai bahasa berbeda.

### Teks ilmiah dan data

Nama DFT Lab dan Figure Lab, keyword solver, simbol kimia, serta tombol pintasan tetap mudah dikenali lintas bahasa. Kode ilmiah, sumber numerik, dan teks publikasi tidak diterjemahkan otomatis.

Tanggal dan durasi mengikuti bahasa antarmuka pada bagian yang menampilkannya. Angka pada input QE tetap memakai sintaks solver.

Dokumentasi English memakai /guide/topik dan dokumentasi Indonesia memakai /id/guide/topik. Mengganti bahasa mempertahankan topik aktif. Unduh versi bahasa yang dipilih untuk referensi offline.

### Keyboard dan keterbacaan

- Tab memindahkan fokus antartautan, tombol, dan field; cincin fokus menunjukkan kontrol aktif.
- Enter atau Space mengaktifkan kontrol, Escape menutup menu atau dialog project.
- Di dokumentasi, Primary+K atau / memfokuskan pencarian ketika di luar field.
- Gunakan kontrol daftar isi mobile untuk menjelajah tanpa menutupi artikel terus-menerus.
- Preferensi reduced motion perangkat diterapkan pada transisi studio dan animasi beranda.

### Topik terkait

- [Penyimpanan otomatis dan banyak perangkat](#saving)
- [Profil, pemakaian, dan paket](#account)
- [Menghubungkan komputer melalui Phynite Compute](#local-compute)

<a id="shortcuts"></a>

## Pintasan keyboard dan pointer

Primary berarti Command pada macOS dan Control pada Windows/Linux. Pintasan mengikuti editor aktif. Field teks mempertahankan perilaku edit teksnya.

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

### Pointer dan layar kecil

Kontrol kamera memutar, menggeser, dan memperbesar struktur. Pilih alat atom yang sesuai sebelum melakukan drag.

Pada layar kecil, buka Results atau Inspector dari toolbar Figure Lab. Tutup dengan backdrop atau Escape.

Separator sidebar dapat diseret pada desktop atau diubah memakai tombol arah ketika terfokus. Browser atau sistem operasi dapat menangkap pintasan lebih dahulu; aksi utama juga tersedia melalui tombol.

### Topik terkait

- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Ketersediaan fitur dan rencana alur](#roadmap)
- [Satuan, istilah, dan sumber ilmiah](#reference)

<a id="field-reference"></a>

## Referensi: parameter kalkulasi dan satuan

Ikuti label serta satuan pada panel kalkulasi aktif. Tabel ini menjelaskan input QE umum; kontrol yang tersedia bergantung pada alur dan pemilihan input otomatis atau expert.

### Geometri dan elektronik

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

### Input numerik

Field numerik menampung draft selama pengetikan. Enter atau keluar dari field menerapkan nilai valid; Escape membatalkan pada kontrol yang mendukung. Batas sumbu kosong berarti otomatis, sedangkan nol merupakan batas eksplisit.

Bahasa wilayah tidak mengubah sintaks solver. QE, CSV, dan kode mempertahankan format yang dibutuhkan parser. Mengganti bahasa tidak menulis ulang input atau sampel dataset.

> Baca INPUT_PW versi QE yang digunakan untuk semantik keyword eksak. Referensi ini tidak menyatakan semua modul QE tersedia dalam formulir Phynite.

### Topik terkait

- [Pintasan keyboard dan pointer](#shortcuts)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Ketersediaan fitur dan rencana alur](#roadmap)

<a id="troubleshooting"></a>

## Pemecahan masalah dan pemulihan

Mulai dari pesan yang terlihat dan tahap pertama yang gagal. Simpan data lokal yang belum tersinkron sebelum mencoba pemulihan yang menghapus data browser.

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

### Informasi untuk dukungan

- Halaman, tindakan, dan teks error yang persis.
- Nama atau ID project dan kalkulasi yang memang boleh dibagikan.
- Tahap kegagalan: sebelum submit, antrean, solver, unggah, atau Figure Lab.
- Cuplikan log yang relevan serta perilaku yang diharapkan.
- Jangan sertakan password, cookie browser, token, atau konfigurasi komputer privat.

### Urutan pemulihan

1. Pertahankan tab yang menyimpan edit lokal.
2. Ekspor figur dan sumber penting bila masih dapat diakses.
3. Coba Retry atau sambungkan ulang jaringan.
4. Periksa konflik dan kuota sebelum mengganti data remote.
5. Bersihkan data situs hanya setelah sumber penting sudah disimpan di tempat lain.

### Topik terkait

- [Pintasan keyboard dan pointer](#shortcuts)
- [Ketersediaan fitur dan rencana alur](#roadmap)
- [Satuan, istilah, dan sumber ilmiah](#reference)

<a id="diagnostics"></a>

## Diagnosis: menemukan tahap yang gagal

Identifikasi tahap pertama yang tidak selesai. Mengulang aksi hilir tidak memperbaiki struktur yang hilang, worker terputus, atau sumber numerik yang tidak kompatibel.

### Tabel diagnosis

| Gejala | Tahap | Pemeriksaan berikutnya |
| --- | --- | --- |
| Project baru belum aktif | Pemuatan Workspace akun. | Tunggu atau muat ulang pada error cloud; jangan hapus edit yang belum tersinkron. |
| Impor struktur gagal | Parser atau geometri. | Format, encoding, kisi, koordinat, dan okupansi. |
| Run langsung ditolak | Validasi submit. | Pesan field, batas sumber daya, autentikasi, dan metode. |
| Run tetap Queued | Worker atau dependensi. | Tujuan, heartbeat personal, kapasitas shared, dan pendahulu. |
| Worker mulai tetapi QE keluar | Runtime atau input ilmiah. | Error solver pertama, pseudopotensial, spesies, sintaks, memori, dan disk. |
| SCF tidak stabil | Self-consistency. | Geometri, okupansi, magnetisme, mixing, toleransi, dan keadaan hampir degenerat. |
| Solver selesai, hasil belum tersedia | Unggah atau completion. | Jaringan, kredensial, dan status akhir; pertahankan worker aktif. |
| Open in Figure Lab gagal | Pengambilan sumber. | Retry; hasil lama mungkin membutuhkan file numerik asli. |
| Overlay atau pasangan memberi peringatan | Perbandingan ilmiah. | Geometri, referensi energi, dan identitas path; gunakan panel mandiri bila perlu. |
| Ekspor gagal | Renderer atau font. | Sambungkan internet, periksa ukuran raster, lalu coba lagi. |

### Mengumpulkan bukti

1. Catat halaman, aksi eksak, waktu, project, dan ID run.
2. Salin error serta baris log di sekitar kegagalan pertama.
3. Catat tujuan, alokasi, sistem operasi, image worker, dan apakah masalah berulang.
4. Untuk masalah plot, simpan dataset, Source package, serta konvensi sumbu yang diharapkan.
5. Hubungi dukungan dengan contoh minimum yang dapat diulang. Hapus kredensial, cookie, password, dan data project yang tidak terkait.

### Melindungi pekerjaan

Pertahankan sesi browser yang menyimpan figur atau project belum tersinkron. Ekspor sumber sebelum membersihkan data situs.

Periksa kalkulasi antre dan aktif sebelum mengirim ulang agar tidak menambah run duplikat.

Mengganti kredensial membatalkan worker lama. Selesaikan atau batalkan pekerjaan aktif sebelum rotasi agar solver yang selesai masih dapat mengunggah hasil.

### Topik terkait

- [Pintasan keyboard dan pointer](#shortcuts)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Ketersediaan fitur dan rencana alur](#roadmap)

<a id="roadmap"></a>

## Ketersediaan fitur dan rencana alur

Label ketersediaan membedakan fungsi yang dapat dijalankan saat ini dari rencana produk. Gunakan kontrol aktif dan status akun sebagai acuan akses.

### Molecular dynamics

MD Lab mendukung simulasi LAMMPS Guided dan manual tervalidasi, serta analisis OVITO pada komputer pribadi atau Cloud yang memiliki pendanaan.

Pilih resource dan pendanaan pada drawer lab sebelum menjalankan. Input trajectory asli dipertahankan; sumber Cloud besar memakai multipart dan frame hasil dimuat sesuai kebutuhan dengan proteksi memori browser.

### Komputasi terkelola

Free mencakup DFT Lab, MD Lab dan Figure Lab, impor, template, ekspor, total storage cloud 10 GiB, serta run DFT dan MD pada satu komputer pribadi yang terhubung per akun. Tidak ada biaya aktivasi Phynite atau biaya komputasi lokal per jam. Cloud memakai Quanta sebagai satuan utama; estimasi Rupiah adalah harga pembelian kredit merchant, saat ini Rp18.000 per Quanta, bukan konversi kurs.

Paid Cloud memakai kredit produksi terverifikasi; pembayaran sandbox tidak mendanai produksi. Tarif memakai profil AWS terpilih ditambah 10%, hanya untuk waktu solver/analisis, minimum 60 detik sekali per job. Persiapan, upload, cleanup, disk sementara, dan transfer compute ditanggung Phynite. Estimasi durasi bukan batas runtime paid. Pendanaan diperbarui maksimal lima menit sesuai saldo; top-up sebelum tenggat mempertahankan job tanpa restart. Kegagalan scientific menagih compute aktual; kegagalan platform mengembalikan biaya compute. Project dan hasil tetap dapat diakses setelah saldo habis. Penawaran total storage cloud menggantikan Free 10 GiB: 50 GiB Rp27.000, 100 GiB Rp55.000, 250 GiB Rp129.000, 500 GiB Rp259.000 dan 1 TiB Rp519.000 per 30 hari. Kapasitas lebih besar dan transfer besar melalui support@phynitelab.com, tanpa tagihan transfer otomatis. Perpanjangan manual. Paket sama menambah 30 hari; upgrade mengonversi nilai sisa harga dasar menjadi waktu tambahan tanpa biaya gateway; downgrade setelah kedaluwarsa. Kedaluwarsa mengembalikan Free tanpa menghapus file. Akun di atas kuota tetap dapat membaca, mengunduh, dan menghapus, sementara penambahan data diblokir. Lihat /pricing untuk estimasi dan ketentuan.

### Ruang lingkup dokumentasi

Panduan menjelaskan perilaku produk yang diimplementasikan. Dukungan suatu input ahli tidak berarti semua opsi solver telah divalidasi lewat formulir.

Gunakan catatan metode dan dokumentasi solver untuk penilaian fisik. Penyelesaian teknis job tetap perlu diikuti pemeriksaan konvergensi dan kesesuaian model.

### Topik terkait

- [Pintasan keyboard dan pointer](#shortcuts)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Satuan, istilah, dan sumber ilmiah](#reference)

<a id="reference"></a>

## Satuan, istilah, dan sumber ilmiah

Selalu tulis satuan dan referensi yang menyertai angka. Istilah serupa pada tampilan, solver, dan publikasi dapat memiliki cakupan berbeda.

### Istilah utama

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

### Sumber yang dibaca bersama panduan

Dokumentasi resmi Quantum ESPRESSO menjelaskan pw.x, bands.x, dos.x, projwfc.x, ph.x, q2r.x, dan matdyn.x.

Dokumentasi Materials Project menjelaskan provenance serta konvensi database. SeeK-path menjelaskan standardisasi lintasan. BoltzTraP2 menjelaskan interpolasi dan asumsi transport.

Panduan antarmuka tidak menggantikan studi konvergensi, dokumentasi versi solver yang digunakan, atau validasi terhadap literatur ilmiah.

### Topik terkait

- [Pintasan keyboard dan pointer](#shortcuts)
- [Pemecahan masalah dan pemulihan](#troubleshooting)
- [Ketersediaan fitur dan rencana alur](#roadmap)

## Referensi ilmiah

- https://www.quantum-espresso.org/documentation/
- https://docs.materialsproject.org/
- https://seekpath.readthedocs.io/
- https://www.boltztrap.org/

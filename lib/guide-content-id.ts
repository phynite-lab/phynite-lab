import { localComputeGuide } from './guide-local-compute.ts';
import type { GuideSection } from './guide-content';

export const guideSectionsId: GuideSection[] = [
  {
    id: 'workflow', group: 'Mulai menggunakan', title: 'Dari struktur hingga figur paper',
    intro: 'Project menampung satu studi material: struktur, pengaturan kalkulasi, riwayat eksekusi, dataset numerik, dan figur yang dapat digunakan kembali. Mulai dari pertanyaan fisik, lalu pilih kalkulasi dan perbandingan yang diperlukan untuk menjawabnya.',
    blocks: [
      { title: 'Alur kerja lengkap', steps: ['Buka aplikasi lokal tanpa login, atau masuk saat memakai website hosted. Workspace menampilkan project dan alat riset; identitas lokal terpisah dari login Phynite Cloud opsional.', 'Pilih Project baru, beri nama yang menjelaskan studi, lalu buka project tersebut. Project juga dapat dibuat dari panel Project di DFT Lab.', 'Impor struktur, bangun sel, atau ambil dari Materials Project. Periksa satuan, vektor kisi, spesies, dan jumlah atom.', 'Periksa geometri ruang nyata. Tentukan arah periodik untuk tampilan dan tambahkan vakum secara eksplisit bila model slab, kawat, atau molekul membutuhkannya.', 'Buka Calculate dan tambahkan Total energy atau Structural relaxation. Periksa input, okupansi, pseudopotensial, cutoff, dan mesh k.', 'Pilih tujuan komputasi. Aplikasi npm memakai runtime pada Pengaturan → Komputasi untuk Komputer Anda; website hosted memakai worker pribadi terhubung. Phynite Cloud opsional memakai Quanta atau grant pilot serta profil CPU/RAM yang tersedia.', 'Jalankan dan ikuti Log. Status Completed tidak otomatis berarti hasil konvergen secara fisik; periksa energi, gaya, konvergensi, dan pesan solver.', 'Tambahkan kalkulasi band, DOS, fonon, atau transport sesuai kebutuhan. Pilih hasil relaksasi yang kompatibel sebagai sumber struktur bila diperlukan.', 'Pada hasil yang memiliki data plot, pilih Open in Figure Lab. Figur aktif yang sudah memakai hasil tersebut dibuka kembali, atau data numeriknya diimpor untuk membuat figur.', 'Atur perbandingan, referensi energi, dimensi fisik, dan tipografi. Tunggu status penyimpanan di editor Figure Lab, lalu ekspor figur dan Source package.'] },
      { title: 'Pembagian fungsi halaman', table: { headings: ['Halaman', 'Fungsi'], rows: [['Workspace', 'Membuat dan mencari project, melanjutkan studi, membuka alat riset.'], ['DFT Lab / Project', 'Mengatur project, struktur, dan variasi material.'], ['DFT Lab / Inspect', 'Memeriksa dan mengubah geometri.'], ['DFT Lab / Calculate', 'Mengatur kalkulasi, dependensi, eksekusi, dan log.'], ['Figure Lab', 'Membandingkan data, mengatur panel, dan mengekspor figur.'], ['Pengaturan', 'Halaman tampilan, notifikasi, keyboard, compute, akun provider AI, Akun, Pemakaian, dan Penyimpanan terpisah.'], ['Tagihan', 'Pembelian cloud serta faktur pada website Phynite; mode lokal membuka situs hosted.']] } },
      { title: 'Sebelum menyebut hasil final', bullets: ['Catat sumber struktur dan sel komputasi untuk setiap run.', 'Uji cutoff, mesh k/q, vakum, smearing, dan toleransi solver terhadap besaran yang akan dilaporkan.', 'Periksa satuan dan titik nol energi sebelum membuat overlay.', 'Simpan input yang benar-benar dieksekusi serta sumber numerik bersama figur.', 'Jelaskan fungsional, keluarga pseudopotensial, perlakuan spin, dan normalisasi dalam metode paper.'] },
    ],
  },
  {
    id: 'project', group: 'Mulai menggunakan', title: 'Project, struktur, dan riwayat kalkulasi',
    intro: 'Gunakan satu project untuk satu studi yang berkaitan. Simpan variasi material sebagai struktur terpisah dengan nama jelas. Pengaturan kalkulasi dapat diedit; setiap eksekusi menyimpan riwayat input yang dikirim.',
    blocks: [
      { title: 'Membuat project dari Workspace', steps: ['Tunggu Workspace akun selesai dimuat, lalu pilih Project baru.', 'Isi nama, misalnya Respons strain MoS2. Nama wajib diisi, maksimal 100 karakter; deskripsi opsional maksimal 500 karakter.', 'Pilih Buat project. Project tampil di daftar dan dapat langsung dibuka melalui konfirmasi.', 'Buka project untuk menambahkan struktur. Project kosong tidak menjalankan kalkulasi atau memakai kapasitas worker.', 'Gunakan pencarian untuk nama project, deskripsi, atau rumus kimia struktur utama. Urutkan berdasarkan edit terakhir atau nama.'] },
      { title: 'Mengatur variasi', steps: ['Berikan nama yang menjelaskan kondisi, misalnya MoS2 strain -2%, 0%, dan +2%.', 'Tambahkan tumpukan kalkulasi di bawah setiap struktur.', 'Duplikasikan konfigurasi untuk memakai metode serupa pada variasi lain, lalu periksa parameter yang perlu berubah.', 'Gunakan menu project atau struktur untuk mengganti nama dan menduplikasi. Periksa konfirmasi sebelum menghapus.'] },
      { title: 'Identitas data', paragraphs: ['Struktur lokal, struktur yang diunggah, dan kalkulasi yang sudah dikirim merupakan record berbeda yang saling terkait. Mengedit struktur saat ini tidak mengubah input historis run yang selesai.', 'Figur merujuk dataset numerik dengan identitas tersendiri. Mengganti data di figur merupakan tindakan eksplisit; perubahan metadata sumber tidak diam-diam mengubah perbandingan yang telah disimpan.', 'URL project dan tampilan Figure Lab dipertahankan saat halaman dibuka kembali. Tautan project yang sudah tidak tersedia tidak boleh dianggap sebagai figur project lain.'], note: 'Pengulangan sel di viewport hanya tampilan. Menambah jumlah sel yang terlihat tidak otomatis menambah atom dalam sel komputasi.' },
    ],
  },
  {
    id: 'structure', group: 'Struktur & fisika', title: 'Mengimpor dan memeriksa struktur',
    intro: 'Periksa struktur sebagai model fisik sebelum menyiapkan input solver. Visualisasi yang tampak benar belum membuktikan satuan, okupansi, atau sel komputasinya sesuai.',
    blocks: [
      { title: 'Memilih sumber', table: { headings: ['Sumber', 'Pemeriksaan'], rows: [['CIF', 'Satuan sel, koordinat fraksional, simetri, dan okupansi situs. Struktur dengan okupansi parsial memerlukan model atomistik yang sesuai.'], ['POSCAR / CONTCAR', 'Faktor skala, urutan unsur, jumlah atom, serta koordinat Direct atau Cartesian.'], ['XYZ', 'Satuan dan informasi sel. XYZ biasa tidak selalu mendefinisikan kisi periodik.'], ['Input Quantum ESPRESSO', 'CELL_PARAMETERS, ATOMIC_POSITIONS, spesies, dan satuan setiap card.'], ['Materials Project', 'Identitas sumber, komposisi, sel standar, dan konvensi basis.'], ['DFT Lab', 'Geometri, jarak antaratom, dan kesesuaian model yang Anda bangun.']] } },
      { title: 'Mengimpor file', steps: ['Pilih project tujuan.', 'Gunakan Add structure / Import atau seret satu file struktur yang didukung ke DFT Lab.', 'Periksa nama, rumus kimia, jumlah atom, dan parameter sel.', 'Putar struktur dan gunakan pengulangan visual untuk mencari atom yang salah posisi atau tetangga yang tidak wajar.', 'Selesaikan peringatan parser dan okupansi parsial sebelum menjalankan model QE terurut.'] },
      { title: 'Koordinat fraksional dan Cartesian', paragraphs: ['Koordinat fraksional menyatakan r = f1 a + f2 b + f3 c, dengan a, b, c sebagai vektor kisi. Koordinat Cartesian menyatakan posisi pada sumbu ruang nyata dalam satuan panjang.', 'Mempertahankan koordinat fraksional sambil mengubah kisi dapat meregangkan posisi atom. Mempertahankan koordinat Cartesian menjaga posisi ruang nyata tetapi mengubah representasi fraksionalnya. Pastikan operasi yang dipilih sesuai deformasi yang dimaksud.', 'Sel primitif dan konvensional dapat merepresentasikan kristal yang sama dengan jumlah atom serta basis resiprok berbeda. Perbedaan ini memengaruhi energi total per sel, lintasan k, dan normalisasi DOS.'] },
      { title: 'Informasi yang perlu dipertahankan', bullets: ['File asli atau identitas database asal.', 'Satuan, orientasi, dan pilihan sel primitif/konvensional.', 'Komposisi, okupansi, serta perlakuan cacat atau disorder.', 'Perubahan yang dilakukan sebelum kalkulasi, termasuk strain, vakum, dan relaksasi.'] },
    ],
  },
  {
    id: 'edit', group: 'Struktur & fisika', title: 'Mengedit atom dan geometri sel',
    intro: 'DFT Lab bekerja di ruang nyata. Pilih alat berdasarkan operasi yang diperlukan dan gunakan koordinat numerik untuk perubahan yang harus presisi.',
    blocks: [
      { title: 'Alat viewport', table: { headings: ['Alat', 'Fungsi'], rows: [['Select (V)', 'Memilih atom untuk inspeksi dan operasi berikutnya.'], ['Move (G)', 'Memindahkan atom terpilih.'], ['Add atom (A)', 'Menambahkan atom dengan spesies dan posisi yang dipilih.'], ['Measure (M)', 'Mengukur jarak atau sudut sesuai mode dan urutan pilihan.'], ['Focus (F)', 'Memusatkan tampilan pada atom terpilih.'], ['Delete / Backspace', 'Menghapus pilihan saat konteks viewport aktif, bukan saat mengetik.']] } },
      { title: 'Gerak terkendala', paragraphs: ['Dalam mode Move, X, Y, atau Z membatasi gerak pada sumbu Cartesian tersebut. Shift+X, Shift+Y, atau Shift+Z menggunakan bidang tegak lurus YZ, XZ, atau XY. Enter menerapkan perpindahan; Escape membatalkan.', 'Gunakan field koordinat untuk perpindahan eksak. Field numerik mengizinkan draft sementara seperti tanda minus atau eksponen. Enter atau keluar dari field menerapkan nilai valid; Escape mengembalikan nilai sebelumnya.'] },
      { title: 'Geometri dibanding tampilan', bullets: ['Mengubah metrik sel mengubah kisi yang disimulasikan. Periksa apakah deformasinya sesuai strain yang dimaksud.', 'Aksi vakum menambah pemisahan normal terhadap bidang a-b sambil mempertahankan jarak atom Cartesian; bukan pembuat slab untuk semua orientasi.', 'Ukuran atom, ukuran ikatan, label, cutoff tetangga, dan pengulangan visual mengatur tampilan.', 'Undo/redo berlaku untuk operasi editor yang didukung dalam sesi berjalan. Simpan variasi fisik penting sebagai salinan struktur yang jelas.'] },
    ],
  },
  {
    id: 'periodicity', group: 'Struktur & fisika', title: 'Arah periodik, vakum, dan dimensionalitas',
    intro: 'Checkbox a, b, dan c menyatakan arah periodik yang dimaksud pada tampilan ruang nyata. Quantum ESPRESSO tetap menggunakan sel simulasi tiga dimensi yang berulang periodik.',
    blocks: [
      { title: 'Ketika satu arah dinonaktifkan', paragraphs: ['Menonaktifkan c menghentikan pengulangan visual dan koneksi tetangga periodik pada arah itu; jumlah pengulangannya menjadi satu. Aksi ini tidak memperpendek sel, menghapus vektor c, menambah vakum, atau mengaktifkan koreksi elektrostatik.', 'Ukuran sel tidak boleh ditebak dari checkbox: ketebalan slab, vakum yang konvergen, dan kondisi elektrostatik berbeda pada setiap studi. Mengubah sel otomatis tanpa konteks dapat mengubah jarak atom atau kerapatan fisik.'], note: 'Untuk slab, pertahankan tinggi sel yang finite, tambahkan dan konvergensikan vakum, gunakan satu titik k pada arah nonperiodik, lalu tentukan perlakuan elektrostatik dalam input QE yang dijalankan.' },
      { title: 'Sistem umum', table: { headings: ['Sistem', 'Periodisitas tampilan', 'Pemeriksaan komputasi'], rows: [['Kristal bulk', 'a, b, c', 'Konvergensikan mesh tiga dimensi dan pilih sel yang dimaksud.'], ['Slab / lembaran 2D pada a-b', 'a, b', 'Vakum tegak lurus, mesh dalam bidang, biasanya satu k sepanjang c; periksa dipol atau isolasi 2D bila sesuai.'], ['Kawat sepanjang c', 'c', 'Vakum pada kedua arah transversal dan sampling sepanjang kawat. Aksi vakum c saja tidak menyiapkan model ini.'], ['Molekul / cluster', 'Tidak ada', 'Kotak 3D cukup besar, biasanya sampling Γ; periksa muatan dan dipol.']] } },
      { title: 'Prosedur slab yang dapat diulang', steps: ['Orientasikan permukaan pada bidang a-b.', 'Nonaktifkan c untuk memperjelas batas tampilan.', 'Tambahkan vakum dan periksa kisi serta posisi atom sebenarnya.', 'Gunakan mesh N × M × 1; tentukan N dan M melalui konvergensi.', 'Periksa perlakuan elektrostatik pada input yang dihasilkan atau expert input.', 'Ulangi dengan vakum lebih besar dan sampling lebih rapat hingga besaran target stabil.'] },
    ],
  },
  {
    id: 'calculation', group: 'Kalkulasi', title: 'Memilih dan menghubungkan kalkulasi',
    intro: 'Panel Calculate memisahkan pengaturan DFT, Log eksekusi, dan konfigurasi yang dapat dipakai ulang. Pilih tugas ilmiahnya; alur yang dihasilkan menyiapkan tahap solver yang diperlukan.',
    blocks: [
      { title: 'Alur tersedia', table: { headings: ['Kalkulasi', 'Tujuan', 'Alat utama'], rows: [['Total energy', 'Keadaan dasar elektronik SCF dan energi.', 'pw.x'], ['Structural relaxation', 'Optimasi ion; opsi derajat kebebasan sel yang diizinkan.', 'pw.x relax / vc-relax'], ['Band structure', 'Eigenvalue sepanjang lintasan resiprok.', 'pw.x + bands.x'], ['Density of states', 'DOS dari mesh seragam dan opsi proyeksi.', 'pw.x + dos.x / input proyeksi'], ['Phonon dispersion', 'DFPT, konstanta gaya, dan lintasan fonon.', 'ph.x + q2r.x + matdyn.x'], ['Thermoelectric properties', 'Interpolasi band dan transport semiklasik.', 'QE + BoltzTraP2']] } },
      { title: 'Menyusun kalkulasi', steps: ['Pilih struktur lalu buka Calculate / DFT.', 'Pilih Add calculation dan tugas yang dibutuhkan.', 'Atur parameter dan periksa file input.', 'Jika diperlukan, pilih hasil relaksasi yang sesuai sebagai sumber struktur.', 'Jalankan satu kalkulasi, Run selected, atau Run all. Tahap pendahulu dapat dikirim terlebih dahulu dan dipakai ulang ketika kompatibel.', 'Periksa setiap run di Log; job hilir dapat menunggu dependensinya.'] },
      { title: 'Dependensi dan eksekusi ulang', paragraphs: ['Job hilir menunggu prasyarat yang dideklarasikan selesai. Pemakaian ulang bergantung pada record eksekusi yang kompatibel, bukan kemiripan nama.', 'Perubahan struktur, fungsional, muatan, spin, atau cutoff dapat membuat hasil lama tidak sesuai untuk dipakai ulang. Buat run baru bila ragu dan pertahankan hasil lama sebagai pembanding.', 'Save selected menyimpan konfigurasi kalkulasi, bukan menjalankan solver. Figure Lab memiliki penyimpanan otomatis dan tidak membutuhkan tombol Save revision.'] },
    ],
  },
  {
    id: 'configure', group: 'Kalkulasi', title: 'Mengatur dan memvalidasi Quantum ESPRESSO',
    intro: 'Default adaptif adalah titik awal. Pengaturan tersebut tidak menggantikan uji konvergensi atau pengetahuan tentang material. Input yang dihasilkan dan expert raw input memiliki tanggung jawab berbeda.',
    blocks: [
      { title: 'Pilihan utama', table: { headings: ['Pengaturan', 'Makna', 'Pemeriksaan'], rows: [['Functional', 'Pendekatan exchange-correlation.', 'Gunakan pseudopotensial dan alur solver yang kompatibel.'], ['ecutwfc / ecutrho', 'Cutoff gelombang bidang dan kerapatan muatan.', 'Konvergensikan energi, gaya, tegangan, atau respons yang dilaporkan.'], ['Mesh k', 'Sampling integrasi zona Brillouin.', 'Gunakan mesh seragam untuk SCF/DOS; lintasan band bukan penggantinya.'], ['Occupations / smearing', 'Pengisian dan integrasi keadaan elektronik.', 'Sesuaikan dengan sifat logam, isolator, spin, dan asumsi temperatur.'], ['nbnd', 'Jumlah band yang dihitung.', 'Cukupkan keadaan kosong untuk rentang energi atau transport.'], ['Threshold / mixing', 'Penghentian dan perilaku iterasi SCF.', 'Periksa konvergensi; menaikkan batas iterasi tidak selalu menyelesaikan masalah.'], ['Charge / magnetization / spin', 'Asumsi keadaan elektronik.', 'Gunakan referensi fisik dan pseudopotensial yang sesuai.']] } },
      { title: 'Mode adaptif dan expert', paragraphs: ['Mode adaptif menentukan default okupansi dan cutoff dari konteks material serta alur kerja. Override pengguna tetap merupakan pilihan eksplisit.', 'Expert raw input menjadi teks utama yang dikirim. Resolusi adaptif tidak diam-diam menulis ulang okupansi dan cutoff pada teks tersebut. Pengguna bertanggung jawab atas card, path, spesies, satuan, dan opsi solver.', 'Periksa input yang benar-benar dieksekusi dari artefak hasil. Preview lama tidak selalu mencakup data runtime, termasuk identitas pseudopotensial yang diselesaikan worker.'] },
      { title: 'Contoh uji konvergensi', steps: ['Tetapkan struktur dan metode; buat baseline Total energy.', 'Variasikan ecutwfc dan ecutrho yang kompatibel pada mesh k tetap.', 'Amati energi per atom, gaya, atau tegangan sesuai tujuan.', 'Pilih cutoff memadai lalu variasikan mesh k.', 'Uji vakum secara terpisah untuk sistem berdimensi rendah.', 'Catat toleransi yang digunakan untuk menyatakan besaran konvergen.'], note: 'Preset Fast, Balanced, dan High accuracy adalah kemudahan konfigurasi, bukan jaminan akurasi publikasi.' },
    ],
  },
  {
    id: 'execution', group: 'Kalkulasi', title: 'Eksekusi, sumber daya, dan pembatalan',
    intro: 'Run melewati persiapan, antrean, eksekusi, penyimpanan hasil, dan penyelesaian. Hasil native tersimpan lokal; job hosted juga mengunggah artefak wajib. Log menunjukkan tahap yang memerlukan pemeriksaan.',
    blocks: [
      { title: 'Membaca status', table: { headings: ['Status', 'Makna', 'Tindakan'], rows: [['Draft / Ready', 'Konfigurasi ada; solver belum tentu berjalan.', 'Periksa input lalu jalankan.'], ['Queued', 'Menunggu worker atau dependensi.', 'Periksa tujuan, koneksi, dan prasyarat.'], ['Running', 'Worker sudah mengambil job.', 'Periksa tahap, log, dan alokasi.'], ['Completed', 'Hasil wajib tersimpan dan diterima secara lokal atau oleh layanan hosted.', 'Periksa konvergensi dan validitas ilmiah.'], ['Failed', 'Persiapan, solver, penyimpanan lokal, atau unggah hosted gagal.', 'Baca penyebab dan log sebelum mengulang.'], ['Cancellation requested', 'Permintaan berhenti dikirim ke worker.', 'Tunggu heartbeat dan status akhir.'], ['Cancelled', 'Run dihentikan atau dikeluarkan dari antrean.', 'Simpan log yang berguna; buat run baru bila perlu.']] } },
      { title: 'Arti core dan RAM', paragraphs: ['Core menunjukkan alokasi vCPU atau proses worker. RAM menunjukkan anggaran job terkonfigurasi. Keduanya bukan pengukuran utilisasi atau memori fisik. Watchdog memori native adalah anggaran terpantau, bukan hard limit sistem operasi.', 'Buka detail sumber daya di Log untuk alokasi backend, durasi, proses MPI, serta estimasi memori dan waktu QE bila tersedia. Data historis yang tidak dilaporkan tidak diisi dengan tebakan.', 'Job native mengikuti kapasitas scheduler pada Pengaturan → Komputasi. Worker pribadi hosted juga mengikuti batas job layanan. Permintaan tidak didukung ditolak tanpa mengubah input ilmiah diam-diam.'] },
      { title: 'Membatalkan run', bullets: ['Job yang masih antre dapat dikeluarkan dari antrean.', 'Pembatalan bersifat asinkron. Supervisor proses lokal atau worker hosted mengonfirmasinya sebelum status akhir.', 'Menutup browser tidak membatalkan kalkulasi yang sudah dikirim. Pertahankan CLI native atau worker hosted; periksa job terinterupsi setelah restart sebelum mengirim ulang.', 'Mencabut kredensial komputer dapat mengganggu unggah hasil. Gunakan pembatalan kalkulasi sebelum mengganti koneksi ketika ada run aktif.'] },
    ],
  },
  {
    id: 'results', group: 'Hasil & Figure Lab', title: 'Membuka dan menafsirkan hasil',
    intro: 'Gunakan Log untuk bukti eksekusi dan unduhan. Gunakan Figure Lab untuk pengeditan plot, perbandingan, tata letak, serta ekspor publikasi.',
    blocks: [
      { title: 'Membuka hasil langsung', steps: ['Temukan run selesai di Log.', 'Periksa pesan konvergensi dan ringkasan numeriknya.', 'Pilih Open in Figure Lab bila hasil memiliki data numerik yang dapat diplot.', 'Figur aktif yang terakhir diedit dan memakai run itu dibuka kembali. Jika belum ada, Figure Lab mengimpor sumber dan menyiapkan figur.', 'Jika sumber tersimpan belum dapat dimuat, gunakan Retry, periksa ketersediaan sumber, atau impor file numerik asli.'] },
      { title: 'Data numerik dan preview', paragraphs: ['PNG preview merupakan gambar. Dataset numerik menyimpan sampel dan metadata agar dapat diatur ulang, disejajarkan, dan diekspor kembali.', 'Output kalkulasi baru yang didukung menyimpan dataset riset ringkas terpisah dari akses artefak mentah sementara. Run lama tanpa data tersimpan dapat membutuhkan CSV/teks asli atau eksekusi baru.', 'Jendela akses artefak biasa umumnya tiga hari. Pembersihan penyimpanan merupakan konfigurasi terpisah. Tautan unduh kedaluwarsa tidak membuktikan dataset riset tersimpan ikut hilang.'] },
      { title: 'Interpretasi fisik', bullets: ['Estimasi band gap membutuhkan okupansi atau referensi energi yang bermakna. Fermi yang tidak diketahui bukan Fermi nol.', 'Normalisasi DOS harus mengacu ke sel, atom, satuan formula, atau volume yang benar.', 'Frekuensi fonon imajiner dapat menunjukkan ketidakstabilan atau konvergensi belum cukup; periksa modelnya.', 'Transport bergantung pada interpolasi, sampling, temperatur, potensial kimia, dan waktu relaksasi. Konduktivitas dibagi waktu relaksasi bukan konduktivitas absolut tanpa waktu yang dijustifikasi.'] },
    ],
  },
  {
    id: 'figures', group: 'Hasil & Figure Lab', title: 'Menyusun figur',
    intro: 'Figure Lab menyediakan pustaka hasil di kiri, halaman publikasi di tengah, dan Inspector di kanan. Pada layar kecil, Results dan Inspector dibuka sebagai panel geser.',
    blocks: [
      { title: 'Memilih tata letak', table: { headings: ['Layout', 'Pemakaian', 'Pemeriksaan'], rows: [['Single plot', 'Satu hasil dengan satu pesan.', 'Besaran, satuan, sumbu, dan judul.'], ['Overlay', 'Beberapa kurva dengan koordinat fisik sebanding.', 'Lintasan, referensi energi, normalisasi, dan legenda.'], ['One panel per result', 'Material atau hasil yang memerlukan panel mandiri.', 'Dimensi dan rentang yang adil.'], ['Band + DOS pairs', 'Dispersi berdampingan dengan DOS terkait.', 'Identitas geometri dan elektronik serta konvensi energi.'], ['Parameter series', 'Urutan strain, tekanan, temperatur, atau variasi lain.', 'Nama parameter, satuan, dan nilai numerik.']] } },
      { title: 'Menyusun halaman', steps: ['Pilih hasil selesai pada project aktif dan impor dataset numeriknya.', 'Cari dan pilih dataset pembanding.', 'Pilih layout. Satu dataset boleh digunakan di beberapa figur tanpa mengubah sampel aslinya.', 'Tentukan lebar dan tinggi dalam milimeter sesuai ukuran kolom jurnal.', 'Pilih panel dari kanvas atau Inspector. Atur rentang, bentang panel, urutan, legenda, dan sumbu terhubung.', 'Gunakan kontrol Data untuk nama layer, channel, penggantian sumber, warna, dan gaya garis.', 'Periksa catatan konteks ilmiah, tunggu penyimpanan cloud selesai, lalu ekspor.'] },
      { title: 'Interaksi kanvas', paragraphs: ['Tombol + dan - mengubah pembesaran halaman; 0 atau Fit menyesuaikan dengan area kanvas. Rentangnya 25 sampai 400 persen terhadap tampilan yang sudah di-fit.', 'Space+drag, Alt+drag, atau drag tombol tengah menggeser halaman. Ctrl/Cmd+scroll memperbesar tampilan. Klik panel plot untuk mengeditnya.', 'Zoom kanvas tidak mengubah dimensi ekspor, batas sumbu, atau nilai data. Untuk mengubah rentang plot, gunakan minimum dan maksimum panel.'], note: 'Garis dan marker dipotong pada kotak sumbu. Simbol Γ menunjukkan pusat zona Brillouin; metadata sumber tetap dipertahankan.' },
    ],
  },
  {
    id: 'alignment', group: 'Hasil & Figure Lab', title: 'Energi, lintasan k, dan normalisasi DOS',
    intro: 'Perbandingan bisa terlihat rapi sambil mencampur referensi fisik yang tidak sesuai. Tentukan makna setiap sumbu sebelum mengubah tampilannya.',
    blocks: [
      { title: 'Penyelarasan energi', table: { headings: ['Mode', 'Makna', 'Interpretasi'], rows: [['Source energy', 'Mempertahankan referensi numerik impor.', 'Gunakan bila konvensi sumber dipahami.'], ['Each Fermi = 0', 'Menggeser tiap dataset dengan Fermi masing-masing.', 'Membandingkan bentuk relatif, bukan offset band absolut.'], ['Each VBM = 0', 'Menggeser terhadap maksimum band valensi tercatat.', 'Bandingkan fitur relatif terhadap tepi valensi yang bermakna.'], ['Vacuum alignment', 'Memakai referensi vakum tercatat.', 'Perbandingan referensi bersama jika vakumnya dijustifikasi.'], ['Manual shift', 'Menerapkan offset energi eksplisit.', 'Catat metode dan besar offset yang digunakan.']] } },
      { title: 'Band + DOS', paragraphs: ['Pasangan terverifikasi memerlukan identitas geometri dan sumber elektronik yang sesuai serta data relatif Fermi yang kompatibel. Nama file atau rumus kimia sama belum cukup.', 'Layout pasangan memakai sumbu energi vertikal bersama, umumnya dengan rasio lebar 2:1. Batas energi yang terhubung diperbarui pada kedua panel.', 'Mengganti satu sumber dengan kalkulasi yang tidak terkait membatalkan klaim pasangan terverifikasi. Gunakan panel perbandingan biasa jika sumber memang berbeda.'] },
      { title: 'Kompatibilitas lintasan k', paragraphs: ['Label Γ, X, atau K tidak cukup untuk memastikan koordinat resiprok sama. Basis sel, titik ujung, dan koordinat segmen perlu diperiksa.', 'Normalisasi segmen dapat menyelaraskan titik ujung ketika metadata memadai, tetapi mengubah skala horizontal yang ditampilkan.', 'Cabang lintasan yang terputus harus tetap dipisahkan. Menghubungkan ujung cabang berbeda menghasilkan band kontinu yang tidak berasal dari data.'] },
      { title: 'DOS dan spin', bullets: ['DOS QE sering dinormalisasi per sel. Jangan menamainya per atom tanpa konversi.', 'Normalisasi per atom, satuan formula, atau volume membutuhkan metadata jumlah atau volume yang benar.', 'Pencerminan spin-down hanya cara visual membedakan channel; DOS fisik tidak menjadi negatif.', 'Bedakan total DOS, proyeksi orbital/atom, dan kolom numerik umum. Nama channel harus menjelaskan besaran sebenarnya.'] },
    ],
  },
  {
    id: 'studies', group: 'Hasil & Figure Lab', title: 'Studi banyak material dan variasi parameter',
    intro: 'Pilih layout berdasarkan perbandingan ilmiah, kemudian gunakan gaya yang konsisten. Tidak semua hasil perlu dipaksakan ke satu overlay yang padat.',
    blocks: [
      { title: 'Banyak material dalam paper', steps: ['Simpan struktur dalam satu project studi dengan identitas sumber jelas.', 'Dokumentasikan perbedaan dan pendekatan metode secara konsisten.', 'Jalankan band atau DOS untuk tiap material.', 'Gunakan grid ketika lintasan k atau skala energi sangat berbeda. Overlay hanya untuk koordinat dan referensi yang mendukung.', 'Namai layer berdasarkan material, gunakan sedikit warna yang jelas, dan tulis referensi energi.', 'Simpan layout sebagai template untuk material berikutnya.'] },
      { title: 'Satu material pada beberapa strain', steps: ['Duplikasikan struktur referensi sebelum memberi strain.', 'Catat apakah strain uniaksial, biaksial, volumetrik, atau tensor lain; satu angka persen tidak mewakili seluruh tensor.', 'Gunakan kendala relaksasi dan pengaturan elektronik yang konsisten.', 'Untuk tiap dataset, masukkan nama parameter kondisi, satuan, dan nilai numerik yang sejenis.', 'Pilih Parameter series untuk urutan numerik termasuk strain negatif.', 'Bandingkan memakai referensi energi yang dijustifikasi dan jelaskan normalisasi lintasan bila digunakan.'] },
      { title: 'Band berdampingan dengan DOS', steps: ['Pastikan geometri dan asumsi elektronik kedua kalkulasi sesuai.', 'Muat kedua dataset numerik ke Figure Lab.', 'Pilih Band + DOS pairs dan baca catatan kompatibilitas.', 'Tentukan interval energi vertikal bersama dan titik nolnya.', 'Atur kepadatan garis serta rentang horizontal DOS tanpa mengubah skala energi bersama.', 'Ekspor figur vektor dan Source package.'] },
      { title: 'Konvergensi dan temperatur', paragraphs: ['Gunakan dataset numerik umum untuk besaran turunan seperti energi per atom terhadap cutoff, atau dataset transport yang sesuai bila tersedia.', 'Catat parameter dan satuan dengan jelas. Tambahkan ketidakpastian serta asumsi metode pada caption atau metadata; banyak digit desimal bukan bukti presisi.', 'Template menjaga dimensi dan tipografi stabil di seluruh paper sementara provenance tiap dataset tetap tersimpan.'] },
    ],
  },
  {
    id: 'reuse', group: 'Hasil & Figure Lab', title: 'Template, penggantian sumber, dan histori',
    intro: 'Gunakan kembali pengaturan visual sambil mempertahankan identitas sumber numerik. Template menjelaskan layout; figur menghubungkan layout dengan dataset tertentu.',
    blocks: [
      { title: 'Memakai template', steps: ['Selesaikan layout, tipografi, susunan panel, dan gaya layer pada contoh figur.', 'Simpan sebagai template. Ikatan sumber menjadi slot yang dapat dipakai ulang.', 'Pilih dataset pengganti mengikuti urutan slot lalu terapkan template.', 'Periksa judul, besaran, dan channel setelah sumber dihubungkan.', 'Edit caption khusus sendiri; template tidak mengetahui kesimpulan ilmiah studi baru.'] },
      { title: 'Mengganti dataset', paragraphs: ['Gunakan Replace source pada layer terpilih. Warna, gaya garis, dan pengaturan channel yang kompatibel dipertahankan. Judul otomatis mengikuti sumber baru, sementara teks khusus tetap dapat diedit.', 'Mengubah metadata sumber menghasilkan identitas dataset baru. Figur lama tetap memakai sumber awal sampai diganti secara eksplisit.', 'Inset dapat memakai slot sumber yang sama dengan batas sendiri tanpa menyalin atau melakukan resampling data asli.'] },
      { title: 'Undo dan penyimpanan', bullets: ['Undo/redo mencakup sampai 50 langkah pada sesi Figure Lab saat ini.', 'Edit rutin disimpan otomatis; Ctrl/Cmd+S dapat membuat checkpoint eksplisit di History.', 'Edit otomatis memperbarui working copy sehingga tidak menghasilkan revisi permanen tanpa batas.', 'History menyediakan versi tersimpan untuk diperiksa dan dipulihkan menjadi figur aktif yang dapat diedit.', 'Jika tab atau perangkat lain mengubah revisi cloud, penimpaan otomatis berhenti. Periksa versi lokal dan cloud sebelum memilih.'] },
      { title: 'Arsip dan project lain', paragraphs: ['Archive menyembunyikan figur dari daftar aktif dan menyediakan Restore. Arsip bukan penghapusan dan tidak membebaskan kuota histori.', 'Include other projects menampilkan dataset milik akun Anda dari studi lain, bukan akses ke akun lain.', 'Impor Source package menyalin figur dan sumber ke project yang dipilih; hash sumber diperiksa ketika tersedia.'] },
    ],
  },
  {
    id: 'advanced', group: 'Hasil & Figure Lab', title: 'PDOS, unfolding, dan inset',
    intro: 'Gunakan fitur khusus ketika data yang diperlukan benar-benar tersedia. Pengaturan visual tidak dapat menghasilkan informasi fisik yang tidak dihitung oleh sumbernya.',
    blocks: [
      { title: 'Projected density of states', paragraphs: ['Pilih channel proyeksi yang tersedia pada dataset dan beri label atom, unsur, atau orbital sesuai metadata. Jangan menafsirkan kolom total DOS sebagai proyeksi.', 'Penjumlahan proyeksi dapat bergantung pada basis proyektor dan konvensi solver. Perbedaan terhadap DOS total tidak selalu merupakan kesalahan plot.', 'Gunakan warna dan legenda yang membedakan proyeksi; periksa satuan, normalisasi, dan spin sebelum menggabungkan channel.'] },
      { title: 'Band unfolding', paragraphs: ['Tampilan unfolding membutuhkan data spektral berbobot yang telah dihitung dengan pemetaan sel primitif dan supercell yang sesuai. Bobot menentukan intensitas titik atau representasi spektral.', 'Memuat band supercell biasa tidak otomatis menghasilkan unfolding. Simpan metode, pemetaan sel, koordinat k, dan makna bobot bersama dataset.', 'Periksa batas ukuran data serta koordinat lintasan sebelum ekspor. Transparansi visual bukan pengganti normalisasi bobot yang jelas.'] },
      { title: 'Inset', steps: ['Pilih panel induk yang memerlukan detail.', 'Tambahkan inset dan pilih sumber atau layer yang sesuai.', 'Atur posisi, ukuran, serta batas sumbu inset secara independen.', 'Periksa agar inset tidak menutupi legenda, label, atau fitur utama.', 'Jelaskan wilayah dan besaran yang diperbesar pada caption; ekspor pada ukuran akhir untuk memeriksa keterbacaan.'] },
      { title: 'Batas interpretasi', paragraphs: ['Metadata yang tidak diketahui harus tetap dinyatakan tidak diketahui. Jangan mengisi geometri, Fermi, degenerasi, atau bobot dengan nilai buatan agar suatu layout terlihat terverifikasi.', 'Gunakan dokumentasi solver pembentuk proyeksi atau unfolding untuk asumsi dan satuannya. Figure Lab mempertahankan data yang diimpor, bukan memvalidasi seluruh metode ilmiah hulu.'] },
    ],
  },
  {
    id: 'export', group: 'Hasil & Figure Lab', title: 'Ekspor dan reproduksibilitas figur',
    intro: 'Pilih format berdasarkan tujuan pemakaian. Simpan figur yang sudah dirender bersama data dan pengaturannya agar dapat dibuka kembali.',
    blocks: [
      { title: 'Format tersedia', table: { headings: ['Format', 'Pemakaian', 'Sifat'], rows: [['SVG', 'Pengeditan vektor dan web.', 'Path vektor; pertahankan informasi font yang diberikan.'], ['PDF', 'Pengiriman paper dan tata letak dokumen.', 'Vektor dengan teks yang dapat dipilih dan font publikasi tertanam.'], ['PNG', 'Slide, preview, dan alur raster.', 'Piksel ditentukan dari milimeter dan DPI; maksimal 40 megapiksel.'], ['Source package', 'Arsip, kolaborasi, dan pengeditan ulang.', 'JSON figur, dataset, SVG, lisensi font, identitas sumber, dan checksum.']] } },
      { title: 'Prosedur ekspor', steps: ['Gunakan lebar kolom jurnal; 85 mm dan 180 mm hanyalah contoh umum.', 'Tentukan ukuran huruf dalam point dan periksa label, legenda, serta huruf panel pada ukuran akhir.', 'Periksa batas minimum/maksimum, clipping, satuan, simbol Γ, dan referensi energi.', 'Pilih SVG atau PDF untuk grafik garis ketika penerbit menerima vektor.', 'Untuk PNG, tentukan DPI dan periksa dimensi piksel hasilnya.', 'Unduh Source package dan simpan bersama input eksekusi serta catatan metode.'] },
      { title: 'Fidelity dan batasnya', paragraphs: ['Renderer mempertahankan vertex garis. Penyelarasan, normalisasi, warna, dan pencerminan spin mengubah tampilan sementara sampel asli tetap disimpan.', 'Font publikasi harus dapat dimuat dari frontend atau cache browser. Ekspor menampilkan kegagalan ketika sumber wajib tidak tersedia; sambungkan internet dan coba lagi.', 'Source package mereproduksi figur. Mengulang simulasi juga membutuhkan lingkungan komputasi, pseudopotensial yang kompatibel, input lengkap, dan data antara yang diperlukan.'] },
    ],
  },
  {
    id: 'saving', group: 'Akun & komputasi', title: 'Penyimpanan otomatis dan banyak perangkat',
    intro: 'DFT Lab dan Figure Lab menampilkan status penyimpanan dokumen aktif. Aplikasi npm menyimpan project pada SQLite/filesystem; storage browser memuat draft pemulihan. Project lokal tidak diunggah otomatis dan tidak memiliki kuota tetap 10 GiB. Status cloud berikut berlaku untuk website hosted atau project dengan Cloud Sync aktif secara eksplisit.',
    blocks: [
      { title: 'Arti status editor', table: { headings: ['Label', 'Makna', 'Tindakan'], rows: [['Saving...', 'Draft atau sinkronisasi berlangsung.', 'Tunggu sebentar sebelum mengandalkan perangkat lain.'], ['Saved to cloud', 'Dokumen aktif dan sumber yang diperlukan dikonfirmasi tersimpan.', 'Dapat dibuka dengan akun yang sama.'], ['Saved on device / Offline', 'Salinan browser ada, unggah belum selesai.', 'Jangan hapus data browser; sambungkan kembali.'], ['Sync pending', 'Salinan lokal disimpan selama unggah dicoba lagi.', 'Periksa jaringan dan batas penyimpanan.'], ['Sync conflict', 'Revisi cloud berbeda dari revisi yang diedit.', 'Periksa History sebelum memilih versi.']] } },
      { title: 'Cakupan penyimpanan lokal', paragraphs: ['Workspace lokal default adalah ~/.phynite-lab dan dapat dipindahkan dengan phynite-lab --data-dir /path/to/workspace. SQLite menyimpan metadata, sedangkan filesystem menyimpan artefak project, instalasi runtime, dan log. Pengaturan → Penyimpanan hanya mengukur artefak project yang terinventarisasi; metadata database, instalasi solver/runtime, log, cache browser, dan file lain di disk berada di luar pengukuran.', 'Mode lokal dibatasi ruang kosong disk, bukan kuota hosted 10 GiB, dan artefak lokal tidak mendapat pembersihan otomatis tujuh hari. Installer runtime dan log tetap memakai disk. Ekspor/impor arsip project dan backup terpisah diperlukan untuk pekerjaan penting.'], table: { headings: ['Dihitung oleh Penyimpanan lokal', 'Tidak dihitung oleh Penyimpanan lokal'], rows: [['Struktur, input, konfigurasi, hasil selesai, trajectory, dan artefak project yang terinventarisasi.', 'Metadata SQLite, instalasi solver/runtime, log, cache browser, dan file lain di disk.'], ['State intermediate besar bila disimpan sebagai artefak project.', 'Ruang kosong sistem operasi atau data milik aplikasi lain.']] }, links: [{ label: 'Pengaturan penyimpanan', href: '/account/storage' }] },
      { title: 'Data intermediate Quantum ESPRESSO', paragraphs: ['Pilihan disk_io dan output intermediate QE dapat jauh lebih besar daripada hasil akhir. Data wavefunction/tmp mungkin diperlukan untuk band, DOS, fonon, workflow projected, atau interoperabilitas eksternal; jangan menghapusnya sebelum workflow lanjutan selesai. Simpan input eksak, identitas dan checksum pseudopotensial, provenance, serta artefak state bersama-sama.', 'Wannier90 adalah workflow eksternal/manual kecuali ada integrasi native yang didokumentasikan terpisah. Ikuti dokumentasi resmi Quantum ESPRESSO dan Wannier90; panduan ini tidak menyatakan adanya runner Wannier90 native.'], links: [{ label: 'Dokumentasi Quantum ESPRESSO', href: 'https://www.quantum-espresso.org/documentation/' }, { label: 'Dokumentasi Wannier90', href: 'https://wannier.org/documentation/' }] },
      { title: 'Perilaku Figure Lab', paragraphs: ['Figure Lab menyimpan draft lokal setelah sekitar 350 ms tanpa edit baru dan memulai sinkronisasi cloud sekitar 1,2 detik. Unggah dijalankan berurutan; edit selama unggah disimpan berikutnya.', 'Meninggalkan Figure Lab mem-flush draft yang masih tertunda. Kembali online atau memfokuskan halaman membantu mencoba lagi sinkronisasi yang tertunda. Kegagalan tetap ditampilkan sebagai kegagalan.', 'Tidak ada tombol Save revision yang wajib. Ctrl/Cmd+S merupakan checkpoint histori opsional.'] },
      { title: 'Batas saat ini', table: { headings: ['Sumber daya', 'Batas'], rows: [['Snapshot Workspace', '4,5 MB per snapshot.'], ['Dokumen riset', '4 MB per dataset, figur, atau template.'], ['Sampel dataset', '250.000 titik per dataset.'], ['Komposisi figur', '64 panel dan 32 layer per panel.'], ['Checkpoint figur', '100 revisi eksplisit ditambah working copy otomatis.'], ['Kuota Figure Lab', 'Berbagi kuota total cloud: Free 10 GiB atau kapasitas berbayar aktif. Revisi tersimpan dan reservasi upload dihitung.'], ['Impor data', '20 MB file input; dokumen hasil tetap mengikuti batasnya.'], ['Source package', '200 MB paket/JSON terpilih setelah ekstraksi, serta batas dokumen individual.']] } },
      { title: 'Salinan portabel', bullets: ['Ekspor Source package untuk figur penting dan arsip project untuk studi lokal.', 'Simpan struktur asli, input kalkulasi, identitas/checksum pseudopotensial, provenance, dan state intermediate yang dibutuhkan workflow lanjutan.', 'Penyimpanan browser memiliki kuota perangkat dan hilang bila data situs dibersihkan.', 'Archive mengatur daftar, bukan menghapus record atau membebaskan kuota.', 'Inventaris storage akun memisahkan objek cloud dari kuota dokumen riset. Login Cloud tidak mengunggah project lokal; Cloud Sync diaktifkan per project.'] },
    ],
  },
  {
    "id": "account",
    "group": "Akun & komputasi",
    "title": "Pengaturan, akun, profil, dan pemakaian",
    "intro": "Pengaturan memisahkan preferensi browser, compute ilmiah, akun provider AI, dan login Phynite Cloud opsional. Pemakaian berasal dari record eksekusi/provider nyata; pengukuran yang tidak ada tidak dibuat-buat.",
    "blocks": [
      {
        "title": "Memilih halaman pengaturan",
        "table": {
          "headings": [
            "Halaman",
            "Yang diatur"
          ],
          "rows": [
            [
              "Tampilan & bahasa",
              "Tema, aksen, kepadatan, ukuran teks antarmuka/kode, reduced motion, dan bahasa pada browser ini."
            ],
            [
              "Pintasan keyboard",
              "Binding aplikasi yang didukung dan disimpan pada browser ini."
            ],
            [
              "Notifikasi",
              "Alert job/runtime lokal dan izin desktop; preferensi pengiriman hosted pada website."
            ],
            [
              "Komputasi",
              "Instalasi runtime native serta CPU/RAM/job paralel lokal; worker dan default akun pada website."
            ],
            [
              "Akun provider AI",
              "Login AI sendiri, akun aktif, status koneksi/model, batas terlapor, dan waktu reset."
            ],
            [
              "Akun",
              "Login/logout Phynite Cloud opsional dan sync per project; terpisah dari login AI."
            ],
            [
              "Pemakaian / Penyimpanan",
              "Pengukuran job serta pemakaian provider / arsip project dan inventaris penyimpanan."
            ],
            [
              "Profil riset / Privasi & sesi",
              "Identitas Phynite terhubung / privasi serta sesi sesuai mode."
            ]
          ]
        }
      },
      {
        "title": "Navigasi tanpa menu ganda",
        "paragraphs": [
          "Pengaturan memakai satu sidebar kategori dan pencarian. Akun berada setelah Akun provider AI. Pada mobile, buka drawer navigasi; Escape, tombol tutup, atau backdrop menutupnya. Menu akun mendukung navigasi keyboard. Bookmark Runtime lokal & cloud lama diarahkan ke kategori yang sesuai.",
          "Workspace lokal yang belum login menampilkan aksi pengaturan serta koneksi tanpa profil pengguna palsu. Setelah akun Phynite terhubung, Profil membuka halaman profil tersendiri dengan aksi Edit profil."
        ]
      },
      {
        "title": "Mengedit profil riset terhubung",
        "steps": [
          "Hubungkan akun Phynite Cloud sebelum membuka Profil; project lokal tetap tersedia tanpa login itu.",
          "Pilih Edit profil lalu isi nama tampilan, institusi, peran, dan bidang riset.",
          "Pilih foto JPG, PNG, atau WebP hingga 20 MB. Crop, perbesar, dan putar foto; browser menyimpan gambar 256 piksel terkompresi.",
          "Periksa preview lalu Simpan profil. Penghapusan foto berlaku setelah disimpan. Draft akun yang belum disimpan memerlukan keputusan sebelum navigasi.",
          "Gunakan Tampilan & bahasa untuk tampilan perangkat. Pilihan langsung berlaku dan tidak menjadi default akun cloud."
        ]
      },
      {
        "title": "Menentukan username login cloud",
        "steps": [
          "Buat akun Phynite Cloud dengan email lalu verifikasi email, ketika pendaftaran tersedia.",
          "Buka editor profil riset. Nama tampilan boleh mengandung spasi dan tidak harus unik.",
          "Pada Username, masukkan 3–30 karakter dengan awalan huruf atau angka. Huruf, angka, titik, tanda hubung, dan garis bawah didukung; nama yang dicadangkan tidak dapat dipakai.",
          "Pilih Simpan username. Aksi ini terpisah dari menyimpan identitas riset; keunikan diperiksa tanpa membedakan huruf besar dan kecil.",
          "Saat login berikutnya, gunakan username atau email dengan password sama. Username lama berhenti berlaku setelah diganti dan dapat tersedia bagi akun lain. Pemulihan memakai email terverifikasi."
        ],
        "note": "Username tidak membuat akun lain, membagikan project, atau mengubah email. Pekerjaan lokal native tidak memerlukan username login."
      },
      {
        "title": "Mengatur compute sesuai lokasi eksekusi",
        "paragraphs": [
          "Pada aplikasi npm lokal, Komputasi memuat deteksi platform/kemampuan, instalasi runtime ilmiah, status isolasi, serta default CPU/RAM/job paralel. Pasang runtime sebelum menjalankan. Default baru berlaku bagi job berikutnya; override workspace berlaku untuk run terpilih. Compute native lokal tidak memerlukan Docker atau worker yang dipasangkan ke cloud.",
          "Pada website hosted, Komputasi mempertahankan default akun per workload, profil Cloud serta estimasi yang didukung, dan pairing worker pribadi. Simpan default adalah aksi eksplisit; Batal mengembalikan nilai tersimpan. MD tetap pada compute pribadi sampai layanan Cloud tersedia. Lebih banyak core belum tentu lebih cepat; bandingkan run pendek terkendali."
        ]
      },
      {
        "title": "Menghubungkan AI dan membaca batasnya",
        "paragraphs": [
          "Koneksi provider AI memakai CLI resmi Codex atau Antigravity dengan akun sendiri. Login ini terpisah dari Phynite Cloud. Setelah autentikasi, penemuan model serta pemeriksaan kemampuan berjalan otomatis. Tools dan attachment memerlukan dukungan terverifikasi; perubahan Canvas tetap memakai approval serta validasi. Aplikasi lokal menyimpan satu koneksi yang dikelola CLI untuk setiap provider; tidak ada pengganti akun atau setup gateway lokal.",
          "Pemakaian serta reset berasal dari provider: persentase, jendela waktu, dan tanggal ditampilkan hanya jika dilaporkan. Sisa token tidak disimpulkan. Provider terputus, rate-limit, atau tidak didukung menampilkan status nyata tanpa berpindah provider diam-diam."
        ]
      },
      {
        "title": "Notifikasi pada perangkat ini",
        "paragraphs": [
          "Atur alert job selesai, job gagal/dibatalkan, dan instalasi runtime secara terpisah. Alert lokal mengamati perubahan status nyata selama aplikasi terbuka. Alert desktop opsional memerlukan izin browser dan dapat diperiksa melalui Kirim notifikasi uji.",
          "Preferensi lokal ini tetap pada browser ini. Preferensi tidak menjadwalkan cloud push atau email setelah aplikasi ditutup. Pengiriman email serta inbox hosted dikelola terpisah."
        ]
      },
      {
        "title": "Membaca pemakaian dengan benar",
        "table": {
          "headings": [
            "Metrik",
            "Interpretasi"
          ],
          "rows": [
            [
              "Waktu run tercatat",
              "Interval mulai-selesai valid; run gagal/dibatalkan dihitung bila kedua timestamp tersedia. Persiapan serta penyimpanan/unggah hasil dapat termasuk."
            ],
            [
              "Jam CPU teralokasi",
              "Detik tercatat × core teralokasi / 3600. Ini alokasi, bukan aktivitas CPU nyata atau energi."
            ],
            [
              "File lokal / cloud",
              "Inventaris penyimpanan berbeda. Pengukuran objek cloud tidak mencakup disk native; storage lokal bukan langganan cloud."
            ],
            [
              "Run belum terukur",
              "Record tanpa waktu atau alokasi valid tetap tidak tersedia atau parsial, tidak dianggap nol."
            ],
            [
              "Batas AI dan reset",
              "Pengukuran yang dilaporkan akun provider terpilih; terpisah dari jam CPU ilmiah dan tagihan Phynite."
            ]
          ]
        }
      },
      {
        "title": "Riwayat dan salinan portabel",
        "paragraphs": [
          "Pemakaian menampilkan job serta catatan biaya tercatat dengan timestamp, status, tujuan, dan alokasi tersedia. Pagination mengubah baris terlihat; total seluruh akun tetap mencakup semua record terukur. Perbarui mengambil pengukuran baru.",
          "Penyimpanan memuat ekspor/impor arsip project native. Simpan struktur asli, input eksekusi, hasil tersedia, provenance, checksum, dan backup terpisah. Patuhi lisensi aset potensial. Draft browser membantu pemulihan dan bukan database native."
        ]
      },
      {
        "title": "Cloud opsional dan tagihan website",
        "paragraphs": [
          "Akun menghubungkan atau memutus Phynite Cloud. Login mempertahankan identitas lokal dan tidak mengunggah project. Aktifkan Cloud Sync per project setelah meninjau cakupan transfer; compute cloud meninjau transfer input terpisah tanpa mengaktifkan sync. Logout mempertahankan data lokal dan menghentikan sync.",
          "Tagihan pada mode lokal membuka https://phynitelab.com/billing. Akses, harga, kuota, dan kapasitas Cloud mengikuti katalog hosted serta akun saat ini. Pembelian tidak menjalankan job otomatis. MD Cloud belum tersedia sampai layanannya didukung."
        ],
        "note": "Eksekusi lokal memakai perangkat, listrik, dan disk sendiri. Setelah runtime serta potensial wajib terpasang, sains lokal dapat berjalan offline. AI provider, Cloud opsional, pencarian data eksternal, dan unduhan baru memerlukan koneksi masing-masing."
      }
    ]
  },
  localComputeGuide('id'),
  {
    id: 'shortcuts', group: 'Referensi', title: 'Pintasan keyboard dan pointer',
    intro: 'Primary berarti Command pada macOS dan Control pada Windows/Linux. Pintasan mengikuti editor aktif. Field teks mempertahankan perilaku edit teksnya.',
    blocks: [
      { title: 'Menyesuaikan pintasan aplikasi yang didukung', paragraphs: ['Buka Pengaturan → Pintasan keyboard. Atur ulang kombinasi yang didukung untuk membuka Pengaturan, menutup/membuka sidebar, memfokuskan chat AI terbuka, atau mengirim pesan. Perubahan langsung berlaku pada browser ini; kembalikan default bila perlu.', 'Tabel berikut menjelaskan default editor dan konteksnya. Binding aplikasi tidak mengganti penyuntingan teks native, operasi geometri, atau tombol aksesibilitas browser.'] },
      { title: 'DFT Lab', table: { headings: ['Pintasan', 'Aksi', 'Konteks'], rows: [['Primary + K / Space', 'Buka command menu', 'DFT Lab; Space di luar field edit.'], ['Primary + Z', 'Undo', 'Histori editor struktur.'], ['Primary + Shift + Z / Primary + Y', 'Redo', 'Histori editor struktur.'], ['V / G / A / M / F', 'Select / Move / Add / Measure / Focus', 'Viewport; Focus memerlukan pilihan.'], ['Delete / Backspace', 'Hapus pilihan', 'Di luar field teks.'], ['X / Y / Z', 'Kunci sumbu gerak', 'Mode Move.'], ['Shift + X / Y / Z', 'Kunci bidang YZ / XZ / XY', 'Mode Move.'], ['Enter / Escape', 'Terapkan / batalkan gerak', 'Mode Move.'], ['Arrow Left / Right', 'Ubah lebar sidebar 16 px', 'Separator resize yang terfokus.']] } },
      { title: 'Figure Lab', table: { headings: ['Pintasan', 'Aksi', 'Konteks'], rows: [['Primary + Z', 'Undo perubahan figur', 'Di luar kontrol editable.'], ['Primary + Shift + Z / Primary + Y', 'Redo perubahan figur', 'Di luar kontrol editable.'], ['Primary + S', 'Checkpoint eksplisit', 'Menerapkan draft angka terfokus; autosave tetap berjalan.'], ['Primary + Shift + E', 'Ekspor format terpilih', 'Figur siap di luar kontrol editable.'], ['+ atau = / - / 0', 'Zoom in / zoom out / Fit', 'Tampilan halaman.'], ['?', 'Buka/tutup bantuan pintasan', 'Figure Lab.'], ['Space + drag / Alt + drag / drag tengah', 'Geser kanvas', 'Kanvas Figure Lab.'], ['Primary + scroll', 'Zoom halaman', 'Kanvas Figure Lab.'], ['Escape', 'Tutup bantuan atau panel geser', 'Figure Lab.']] } },
      { title: 'Field dan menu', table: { headings: ['Pintasan', 'Aksi'], rows: [['Tab / Shift + Tab', 'Pindah fokus berikutnya / sebelumnya.'], ['Enter / Space', 'Aktifkan tombol atau opsi menu terpilih.'], ['Arrow Up / Down', 'Buka atau pindahkan pilihan menu.'], ['Home / End', 'Opsi aktif pertama / terakhir.'], ['Ketik huruf', 'Cari label pada menu terbuka atau isi pencarian command menu.'], ['Escape', 'Tutup menu atau batalkan draft angka.'], ['Enter / keluar field', 'Terapkan draft numerik valid.'], ['Primary + Z di teks', 'Undo teks, bukan struktur atau figur.'], ['Primary + K atau / di dokumentasi', 'Fokuskan pencarian saat di luar field.']] } },
      { title: 'Pointer dan layar kecil', paragraphs: ['Kontrol kamera memutar, menggeser, dan memperbesar struktur. Pilih alat atom yang sesuai sebelum melakukan drag.', 'Pada layar kecil, buka Results atau Inspector dari toolbar Figure Lab. Tutup dengan backdrop atau Escape.', 'Separator sidebar dapat diseret pada desktop atau diubah memakai tombol arah ketika terfokus. Browser atau sistem operasi dapat menangkap pintasan lebih dahulu; aksi utama juga tersedia melalui tombol.'] },
    ],
  },
  {
    id: 'troubleshooting', group: 'Referensi', title: 'Pemecahan masalah dan pemulihan',
    intro: 'Mulai dari pesan yang terlihat dan tahap pertama yang gagal. Simpan data lokal yang belum tersinkron sebelum mencoba pemulihan yang menghapus data browser.',
    blocks: [
      { title: 'Diagnosis run npm lokal', table: { headings: ['Tahap', 'Makna', 'Tempat memeriksa'], rows: [
        ['Sebelum solver dimulai', 'Setup, runtime, potential, validasi input, isolasi, atau kesiapan worker menolak job. Tidak ada output solver.', 'Run review, Pengaturan → Komputasi, phynite-lab doctor, dan log data directory terpilih.'],
        ['Queued', 'Job menunggu dependency atau worker lokal yang tersedia.', 'Status job, record dependency, status worker, dan histori notifikasi.'],
        ['Setelah solver dimulai', 'Solver atau analisis mengembalikan error atau terinterupsi.', 'Execution log, error solver pertama yang bermakna, input tersimpan, provenance, dan artefak.'],
        ['Persistence/upload', 'Kalkulasi mungkin selesai tetapi penyimpanan atau transfer gagal.', 'Status hasil, checksum/provenance, inventaris storage, jaringan, dan status transfer Cloud.'],
      ] }, paragraphs: ['Status Completed berarti proses dan persistence yang diwajibkan selesai; itu belum membuktikan konvergensi atau validitas scientific. Simpan input eksak dan log gagal sebelum mencoba ulang. Percobaan baru harus memakai perubahan yang ditinjau secara eksplisit.'] },
      { title: 'Urutan pemulihan launcher', steps: ['Jalankan phynite-lab status dengan --data-dir yang sama saat aplikasi dijalankan.', 'Jalankan phynite-lab doctor dan catat diagnosis distribusi, port, runtime, dan path data.', 'Baca log service serta worker terbaru di data directory terpilih.', 'Jika instance sehat, buka origin loopback yang dicetak dan jangan membuat workspace baru.', 'Jika aktivasi update atau runtime gagal, pertahankan runtime aktif sebelumnya, perbaiki penyebabnya, lalu coba lagi dari Pengaturan → Komputasi.', 'Setelah restart, periksa job yang terinterupsi; job lokal tidak dijalankan ulang otomatis.'] },
      { title: 'Masalah umum', table: { headings: ['Masalah', 'Tindakan'], rows: [['Tidak dapat masuk', 'Periksa koneksi, status akun, dan kredensial; ulangi login dari halaman resmi.'], ['Project belum muncul', 'Tunggu pemuatan akun dan sinkronisasi; pastikan akun yang digunakan sama.'], ['Struktur terlihat aneh', 'Periksa satuan, basis, jumlah atom, dan koordinat fraksional/Cartesian.'], ['Nonperiodik tetapi masih ada sel', 'QE memerlukan sel 3D; checkbox tampilan bukan penghapus kisi.'], ['Queued terlalu lama', 'Periksa tujuan compute, worker, kapasitas, dan dependensi.'], ['SCF tidak konvergen', 'Periksa geometri, okupansi, magnetisme, mixing, dan cutoff.'], ['Hasil lama tidak terbuka di Figure Lab', 'Cari dataset tersimpan atau impor file numerik asli; akses artefak lama dapat kedaluwarsa.'], ['Plot berbeda setelah alignment', 'Periksa referensi energi dan normalisasi yang dipilih.'], ['Cloud conflict', 'Bandingkan versi lokal dan cloud melalui History.'], ['Ekspor gagal', 'Periksa akses font, jaringan, batas dokumen, dan ukuran raster.']] } },
      { title: 'Informasi untuk dukungan', bullets: ['Halaman, tindakan, dan teks error yang persis.', 'Nama atau ID project dan kalkulasi yang memang boleh dibagikan.', 'Tahap kegagalan: sebelum submit, antrean, solver, unggah, atau Figure Lab.', 'Cuplikan log yang relevan serta perilaku yang diharapkan.', 'Jangan sertakan password, cookie browser, token, atau konfigurasi komputer privat.'] },
      { title: 'Urutan pemulihan', steps: ['Pertahankan tab yang menyimpan edit lokal.', 'Ekspor figur dan sumber penting bila masih dapat diakses.', 'Coba Retry atau sambungkan ulang jaringan.', 'Periksa konflik dan kuota sebelum mengganti data remote.', 'Bersihkan data situs hanya setelah sumber penting sudah disimpan di tempat lain.'] },
    ],
  },
  {
    id: 'roadmap', group: 'Referensi', title: 'Ketersediaan fitur dan rencana alur',
    intro: 'Label ketersediaan membedakan fungsi yang dapat dijalankan saat ini dari rencana produk. Gunakan kontrol aktif dan status akun sebagai acuan akses.',
    blocks: [
      { title: 'Molecular dynamics', paragraphs: ['MD Lab mendukung simulasi LAMMPS Guided dan input manual tervalidasi serta analisis OVITO pada komputer sendiri. Eksekusi MD Cloud belum tersedia sampai layanan itu didukung; pendanaan tidak mengaktifkannya.', 'Pilih resource pada drawer lab sebelum menjalankan. Input manual memerlukan isolasi terverifikasi. Input trajectory asli dipertahankan; frame hasil dimuat sesuai kebutuhan dengan proteksi memori browser.'] },
      { title: 'Komputasi terkelola', paragraphs: ['Free mencakup DFT Lab, MD Lab dan Figure Lab, impor, template, ekspor, total storage cloud 10 GiB, serta run DFT dan MD pada satu komputer pribadi yang terhubung per akun. Tidak ada biaya aktivasi Phynite atau biaya komputasi lokal per jam. Cloud memakai Quanta sebagai satuan utama; estimasi Rupiah adalah harga pembelian kredit merchant, saat ini Rp18.000 per Quanta, bukan konversi kurs.', 'Paid Cloud memakai kredit produksi terverifikasi; pembayaran sandbox tidak mendanai produksi. Tarif memakai profil AWS terpilih ditambah 10%, hanya untuk waktu solver/analisis, minimum 60 detik sekali per job. Persiapan, upload, cleanup, disk sementara, dan transfer compute ditanggung Phynite. Estimasi durasi bukan batas runtime paid. Pendanaan diperbarui maksimal lima menit sesuai saldo; top-up sebelum tenggat mempertahankan job tanpa restart. Kegagalan scientific menagih compute aktual; kegagalan platform mengembalikan biaya compute. Project dan hasil tetap dapat diakses setelah saldo habis. Penawaran total storage cloud menggantikan Free 10 GiB: 50 GiB Rp27.000, 100 GiB Rp55.000, 250 GiB Rp129.000, 500 GiB Rp259.000 dan 1 TiB Rp519.000 per 30 hari. Kapasitas lebih besar dan transfer besar melalui support@phynitelab.com, tanpa tagihan transfer otomatis. Perpanjangan manual. Paket sama menambah 30 hari; upgrade mengonversi nilai sisa harga dasar menjadi waktu tambahan tanpa biaya gateway; downgrade setelah kedaluwarsa. Kedaluwarsa mengembalikan Free tanpa menghapus file. Akun di atas kuota tetap dapat membaca, mengunduh, dan menghapus, sementara penambahan data diblokir. Lihat /pricing untuk estimasi dan ketentuan.'] },
      { title: 'Ruang lingkup dokumentasi', paragraphs: ['Panduan menjelaskan perilaku produk yang diimplementasikan. Dukungan suatu input ahli tidak berarti semua opsi solver telah divalidasi lewat formulir.', 'Gunakan catatan metode dan dokumentasi solver untuk penilaian fisik. Penyelesaian teknis job tetap perlu diikuti pemeriksaan konvergensi dan kesesuaian model.'] },
    ],
  },
  {
    id: 'reference', group: 'Referensi', title: 'Satuan, istilah, dan sumber ilmiah',
    intro: 'Selalu tulis satuan dan referensi yang menyertai angka. Istilah serupa pada tampilan, solver, dan publikasi dapat memiliki cakupan berbeda.',
    blocks: [
      { title: 'Istilah utama', table: { headings: ['Istilah', 'Makna'], rows: [['Å / bohr', 'Satuan panjang; baca satuan card input sebelum mengubah koordinat.'], ['Ry / eV', 'Satuan energi; cutoff QE umumnya Ry, plot energi dapat memakai eV.'], ['Ruang nyata', 'Kisi dan posisi atom yang ditampilkan DFT Lab.'], ['Ruang resiprok', 'Koordinat k/q untuk integrasi serta lintasan band/fonon.'], ['Γ', 'Pusat zona Brillouin, k = 0.'], ['DOS / PDOS', 'Kerapatan keadaan total / terproyeksi dengan normalisasi yang harus dijelaskan.'], ['SCF', 'Penyelesaian elektronik self-consistent.'], ['CPU-hour', 'Durasi dikalikan core alokasi untuk pengukuran akun; bukan utilisasi.'], ['DPI / mm / pt', 'Resolusi raster / dimensi halaman / ukuran tipografi.']] } },
      { title: 'Sumber yang dibaca bersama panduan', paragraphs: ['Dokumentasi resmi Quantum ESPRESSO menjelaskan pw.x, bands.x, dos.x, projwfc.x, ph.x, q2r.x, dan matdyn.x.', 'Dokumentasi Materials Project menjelaskan provenance serta konvensi database. SeeK-path menjelaskan standardisasi lintasan. BoltzTraP2 menjelaskan interpolasi dan asumsi transport.', 'Panduan antarmuka tidak menggantikan studi konvergensi, dokumentasi versi solver yang digunakan, atau validasi terhadap literatur ilmiah.'] },
    ],
  },
];

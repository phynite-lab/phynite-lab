import type { GuideSection, GuideVisual } from './guide-content.ts';
import type { Locale } from './locale.ts';
import { guidePath } from './guide-routing.ts';

/** Task walkthroughs follow the current module editor and local settings labels. */
export function handbookGuideSections(locale: Locale): GuideSection[] {
  const t = (en: string, id: string) => locale === 'id' ? id : en;
  const screenshot = (name: string, alt: string, caption: string): GuideVisual => ({
    kind: 'screenshot', src: `/docs/guide/${name}-desktop-dark.png`, alt, caption,
    lightSrc: `/docs/guide/${name}-desktop-light.png`, darkSrc: `/docs/guide/${name}-desktop-dark.png`,
  });
  const related = (id: string, en: string, idn: string) => ({ label: t(en, idn), href: guidePath(locale, id) });
  return [
    {
      id: 'getting-started', group: t('Start here', 'Mulai di sini'),
      title: t('Start here: from installation to your first local result', 'Mulai di sini: dari instalasi hingga hasil lokal pertama'),
      intro: t('Follow this checklist once before starting a large study. It separates the application, scientific runtimes, physical inputs, execution, and saved evidence so a missing prerequisite is easy to identify.', 'Ikuti checklist ini sekali sebelum memulai studi besar. Panduan memisahkan aplikasi, runtime ilmiah, input fisik, eksekusi, dan bukti tersimpan agar prasyarat yang belum tersedia mudah ditemukan.'),
      blocks: [
        {
          title: t('1. Install the application', '1. Instal aplikasi'),
          code: 'node --version\nnpm install -g phynite-lab@latest\nphynite-lab',
          paragraphs: [
            t('Use Node.js {{NODE_REQUIREMENT}} and a currently supported native package. macOS Apple Silicon and Linux ARM64/x64 are available; Linux requires glibc >=2.39. On Windows, use the Linux x64 environment inside WSL2. Read the release evidence for actual platform testing.', 'Gunakan Node.js {{NODE_REQUIREMENT}} dan paket native yang saat ini didukung. macOS Apple Silicon dan Linux ARM64/x64 tersedia; Linux memerlukan glibc >=2.39. Pada Windows, gunakan lingkungan Linux x64 di dalam WSL2. Baca bukti rilis untuk platform yang benar-benar diuji.'),
            t('Keep optional npm dependencies enabled. npm installs the app and matching native core; DFT and MD scientific solvers are installed in the next step. Docker, a global Python installation, a source checkout, and a Phynite login are not required for the published local app.', 'Biarkan optional dependencies npm aktif. npm memasang aplikasi dan core native yang cocok; solver ilmiah DFT dan MD dipasang pada langkah berikutnya. Aplikasi lokal publik tidak membutuhkan Docker, Python global, checkout source, atau login Phynite.'),
          ],
          note: t('Keep this terminal running. The browser is the interface; the launcher owns the local services. Follow the actual loopback URL printed by the launcher when port 3000 is occupied.', 'Biarkan terminal ini berjalan. Browser adalah antarmuka; launcher menjalankan layanan lokal. Ikuti URL loopback aktual yang dicetak launcher bila port 3000 sudah terpakai.'),
          links: [{ label: t('Current npm package metadata', 'Metadata paket npm saat ini'), href: 'https://www.npmjs.com/package/phynite-lab' }, { label: t('Published release source and evidence', 'Source rilis dan bukti pengujian'), href: 'https://github.com/phynite-lab/phynite-lab/releases' }],
        },
        {
          title: t('2. Recognize the workspace', '2. Kenali workspace'),
          visuals: [screenshot('onboarding-workspace', t('Local workspace before creating a project', 'Workspace lokal sebelum membuat project'), t('Begin with a new project. Cloud connection is optional.', 'Mulai dengan project baru. Koneksi Cloud bersifat opsional.'))],
          steps: [
            t('Open Workspace and choose New project. Name the study by the question or material, such as Silicon ground state.', 'Buka Workspace lalu pilih New project. Namai studi berdasarkan pertanyaan atau material, misalnya Silicon ground state.'),
            t('Open the project. Canvas connects scientific modules; opening a module shows its editor. Keep one coherent study in a project and name material variants clearly.', 'Buka project. Canvas menghubungkan modul ilmiah; membuka modul menampilkan editornya. Simpan satu studi yang koheren dalam satu project dan beri nama jelas pada varian material.'),
            t('Use Settings to configure this computer. A missing profile in an unsigned local workspace is expected; AI provider login and Phynite Cloud login are separate optional connections.', 'Gunakan Pengaturan untuk mengonfigurasi komputer ini. Tidak adanya profil saat workspace lokal belum login adalah normal; login provider AI dan Phynite Cloud merupakan koneksi opsional yang terpisah.'),
          ],
          links: [related('tools-reference', 'Learn the tools and icons', 'Kenali alat dan ikon'), related('project', 'Projects and calculation records', 'Project dan catatan kalkulasi')],
        },
        {
          title: t('3. Prepare this computer for science', '3. Siapkan komputer untuk komputasi ilmiah'),
          visuals: [screenshot('compute-runtime-setup', t('Compute settings with native runtime controls', 'Pengaturan Compute dengan kontrol runtime native'), t('Runtime installation, capability checks, and isolation belong to this data directory.', 'Instalasi runtime, pemeriksaan kemampuan, dan isolasi berlaku untuk data directory ini.'))],
          steps: [
            t('Open Settings → Compute. Confirm the detected operating system and architecture, available CPU/RAM, and the selected workspace location.', 'Buka Pengaturan → Compute. Pastikan sistem operasi dan arsitektur terdeteksi, CPU/RAM tersedia, dan lokasi workspace sesuai.'),
            t('Install DFT for Quantum ESPRESSO, MD/analysis for LAMMPS and native analysis, or both. Wait for the actual installation status and capability checks; a download finishing alone does not prove the solver is ready.', 'Instal DFT untuk Quantum ESPRESSO, MD/analysis untuk LAMMPS dan analisis native, atau keduanya. Tunggu status instalasi dan pemeriksaan kemampuan aktual; unduhan selesai saja belum membuktikan solver siap.'),
            t('Verify the isolation probe. If it is blocked, read the operating-system diagnostic and repair that prerequisite. Do not disable confinement or use an unverified runtime to bypass the message.', 'Verifikasi probe isolasi. Jika terblokir, baca diagnosis sistem operasi dan perbaiki prasyaratnya. Jangan mematikan isolasi atau memakai runtime belum terverifikasi untuk melewati pesan.'),
            t('For DFT, install the explicitly selected SSSP Precision or Efficiency library in DFT pseudopotentials, or provide the exact UPF files required by the input. For MD, select a compatible force field and verify element mapping, license, and model source.', 'Untuk DFT, instal pustaka SSSP Precision atau Efficiency yang dipilih secara eksplisit pada DFT pseudopotentials, atau sediakan file UPF eksak yang diperlukan input. Untuk MD, pilih force field yang kompatibel dan verifikasi pemetaan elemen, lisensi, serta sumber model.'),
            t('Set a modest CPU/RAM allocation and parallel-job count for the first exercise. Leave room for the operating system and temporary files. More cores do not guarantee faster execution.', 'Tetapkan alokasi CPU/RAM dan jumlah job paralel yang kecil untuk latihan pertama. Sisakan ruang bagi sistem operasi dan file sementara. Core lebih banyak tidak menjamin eksekusi lebih cepat.'),
          ],
          note: t('Runtimes belong to the selected --data-dir. Installing them in ~/.phynite-lab-dev does not install them in ~/.phynite-lab. Reopen the correct workspace instead of copying a native environment between paths.', 'Runtime mengikuti --data-dir terpilih. Menginstal di ~/.phynite-lab-dev tidak memasangnya di ~/.phynite-lab. Buka workspace yang benar alih-alih menyalin lingkungan native antarpath.'),
        },
        {
          title: t('4. Run one small, reviewable calculation', '4. Jalankan satu kalkulasi kecil yang dapat diperiksa'),
          steps: [
            t('Import a known small structure, inspect species, atom count, cell vectors, coordinates, and units, and retain its original file. Use the silicon tutorial for DFT or the argon tutorial for MD.', 'Impor struktur kecil yang diketahui, periksa spesies, jumlah atom, vektor sel, koordinat, dan satuan, lalu simpan file aslinya. Gunakan tutorial silikon untuk DFT atau argon untuk MD.'),
            t('Add the required module and connect its source. For a first DFT exercise, use SCF / Total energy; for MD, review one short Simple stage before adding a larger chain.', 'Tambahkan modul yang diperlukan dan hubungkan sumbernya. Untuk latihan DFT pertama, gunakan SCF / Total energy; untuk MD, periksa satu tahap Simple pendek sebelum menambahkan rangkaian lebih besar.'),
            t('Inspect the exact generated input, method, pseudopotential or force field, sampling, and output settings. Presets are starting points, not evidence of scientific convergence.', 'Periksa input eksak yang dihasilkan, metode, pseudopotensial atau force field, sampling, dan pengaturan output. Preset adalah titik awal, bukan bukti konvergensi ilmiah.'),
            t('Choose Your computer, then Run. In Review run, inspect the Compute plan and prerequisite list. Resolve blocked runtime, potential, isolation, input, or resource checks before Start run.', 'Pilih Your computer lalu Run. Pada Review run, periksa Compute plan dan daftar prasyarat. Selesaikan pemeriksaan runtime, potential, isolasi, input, atau resource yang terblokir sebelum Start run.'),
            t('Follow Run history and open the module’s Execution result. Queued means waiting; Running means work has started; Completed means retained results are available. Open Execution log and inspect the numerical result before accepting it.', 'Ikuti Run history lalu buka Execution result pada modul. Queued berarti menunggu; Running berarti pekerjaan dimulai; Completed berarti hasil tersimpan tersedia. Buka Execution log dan periksa hasil numerik sebelum menerimanya.'),
          ],
          links: [related('quickstart-silicon', 'Silicon DFT tutorial', 'Tutorial DFT silikon'), related('quickstart-md', 'Argon MD tutorial', 'Tutorial MD argon'), related('research-history', 'Run history and research evidence', 'Histori run dan bukti riset')],
        },
        {
          title: t('5. Save, reopen, and protect the result', '5. Simpan, buka kembali, dan lindungi hasil'),
          steps: [
            t('Retain the exact input, original structure, solver/runtime identity, potential checksums, provenance, and all artifacts needed by downstream calculations.', 'Pertahankan input eksak, struktur asli, identitas solver/runtime, checksum potential, provenance, dan seluruh artefak yang diperlukan kalkulasi lanjutan.'),
            t('Wait for the app’s save status. Finish or cancel active jobs, stop the launcher, and reopen the same data directory to verify the project and execution record remain available.', 'Tunggu status penyimpanan aplikasi. Selesaikan atau batalkan job aktif, hentikan launcher, dan buka data directory yang sama untuk memastikan project serta catatan eksekusi tetap tersedia.'),
            t('Export a project archive and keep an independent backup for important work. A browser draft, a figure image, and optional Cloud Sync each serve different purposes; none proves all scientific intermediate files were retained.', 'Ekspor arsip project dan simpan backup terpisah untuk pekerjaan penting. Draft browser, gambar figur, dan Cloud Sync opsional memiliki fungsi berbeda; tidak satu pun membuktikan seluruh file intermediate ilmiah tersimpan.'),
          ],
          table: { headings: [t('If this happens', 'Jika ini terjadi'), t('Next action', 'Langkah berikutnya')], rows: [
            [t('Start is blocked or the attempt fails immediately', 'Start terblokir atau percobaan langsung gagal'), t('Read the first setup/preflight reason. No solver log is expected if no solver process started.', 'Baca alasan setup/preflight pertama. Log solver tidak diharapkan bila proses solver belum dimulai.')],
            [t('A running solver fails', 'Solver yang berjalan gagal'), t('Keep the input, log tail, error, and available artifacts. Check the first solver error, disk, memory, and physical model.', 'Simpan input, log tail, error, dan artefak tersedia. Periksa error solver pertama, disk, memori, dan model fisik.')],
            [t('Project or runtime seems missing after restart', 'Project atau runtime seolah hilang setelah restart'), t('Check status, doctor, the actual port, and the original --data-dir before reinstalling or deleting anything.', 'Periksa status, doctor, port aktual, dan --data-dir awal sebelum memasang ulang atau menghapus apa pun.')],
          ] },
          links: [related('storage-backup', 'Storage and backups', 'Storage dan backup'), related('npm-local-app', 'Install, update, and diagnose', 'Instal, perbarui, dan diagnosis')],
        },
      ],
    },
    {
      id: 'md-workflows', group: t('MD & analysis', 'MD & analisis'),
      title: t('MD workflows: Simple, Advanced, and trajectory analysis', 'Alur MD: Simple, Advanced, dan analisis trajectory'),
      intro: t('LAMMPS simulation changes the physical system; trajectory inspection and analysis measure retained frames. The current simulation editor labels Guided mode “Simple” and the manual/block editor “Advanced”. Keep the source, potential, units, and evidence explicit in both modes.', 'Simulasi LAMMPS mengubah sistem fisik; inspeksi dan analisis trajectory mengukur frame tersimpan. Editor simulasi saat ini menamai Guided sebagai “Simple” dan editor manual/blok sebagai “Advanced”. Pertahankan sumber, potential, satuan, dan bukti yang eksplisit pada kedua mode.'),
      blocks: [
        {
          title: t('Prerequisites and source mapping', 'Prasyarat dan pemetaan sumber'),
          bullets: [
            t('Install MD/analysis in Settings → Compute and verify the required LAMMPS/analysis capabilities and native isolation. MD uses Your computer in the current workflow.', 'Instal MD/analysis pada Pengaturan → Compute dan verifikasi kemampuan LAMMPS/analisis serta isolasi native. MD memakai Your computer pada workflow saat ini.'),
            t('Use a structure or trajectory with a valid simulation cell, known coordinates, particle identities, and masses. A type-only dump is not enough to infer chemical elements or masses.', 'Gunakan struktur atau trajectory dengan sel simulasi valid, koordinat diketahui, identitas partikel, dan massa. Dump yang hanya memiliki nomor tipe tidak cukup untuk menyimpulkan elemen atau massa.'),
            t('Map every particle type before choosing a force field. Check that uploaded potential assets support all elements, the selected atom style, and the expected unit system.', 'Petakan setiap tipe partikel sebelum memilih force field. Periksa bahwa aset potential yang diunggah mendukung seluruh elemen, atom style terpilih, dan sistem satuan yang diperlukan.'),
            t('Pause trajectory playback and finish frame analysis before submitting a simulation. Retain the original trajectory and model citation; a successful integrity/runtime check does not establish physical accuracy.', 'Jeda playback trajectory dan selesaikan analisis frame sebelum mengirim simulasi. Simpan trajectory asli dan sitasi model; pemeriksaan integritas/runtime yang berhasil tidak membuktikan akurasi fisik.'),
          ],
        },
        {
          title: t('Build a Simple simulation stage', 'Susun tahap simulasi Simple'),
          steps: [
            t('Add an MD simulation module to the project and connect its structure, or open Simulation in MD Lab. Add stage chooses a recipe; keep the initial exercise short.', 'Tambahkan modul MD simulation ke project dan hubungkan strukturnya, atau buka Simulation di MD Lab. Add stage memilih resep; buat latihan awal tetap pendek.'),
            t('Open the stage configuration and select Simple. Review the recipe, potential, periodic boundary condition, ensemble, timestep, total steps, temperatures, pressure controls where relevant, and random seed.', 'Buka konfigurasi tahap lalu pilih Simple. Periksa resep, potential, periodic boundary condition, ensemble, timestep, total steps, temperatur, kontrol tekanan bila relevan, dan random seed.'),
            t('Inspect Output & Trajectory. Thermo interval and Trajectory interval are step counts, so choose intervals that produce useful data within the planned duration without excessive disk use.', 'Periksa Output & Trajectory. Thermo interval dan Trajectory interval adalah jumlah langkah; pilih interval yang menghasilkan data berguna selama durasi rencana tanpa penggunaan disk berlebihan.'),
            t('Choose Inspect in.lammps. Verify the complete generated input, source and potential mapping, fixed timestep, stage order, and output commands. Save to library stores a reusable setup; it does not execute the solver.', 'Pilih Inspect in.lammps. Verifikasi input lengkap yang dihasilkan, pemetaan sumber dan potential, timestep tetap, urutan tahap, dan perintah output. Save to library menyimpan setup yang dapat dipakai ulang; aksi ini tidak menjalankan solver.'),
            t('Choose Run step for one stage, or review Run selected/Run all for the intended ordered chain. Review the compute allocation and submit once.', 'Pilih Run step untuk satu tahap, atau periksa Run selected/Run all untuk rangkaian berurutan yang dimaksud. Periksa alokasi compute dan kirim satu kali.'),
          ],
          table: { headings: [t('UI quantity', 'Besaran UI'), t('Displayed unit', 'Satuan tampilan'), t('Interpretation', 'Interpretasi')], rows: [
            ['Timestep', 'fs', t('The generated metal-unit input converts this to ps. Retain the fixed timestep and stage durations.', 'Input dengan units metal yang dihasilkan mengonversinya ke ps. Simpan timestep tetap dan durasi tahap.')],
            [t('Temperature / damping', 'Temperatur / damping'), 'K / ps', t('Temperature and thermostat relaxation time are different controls.', 'Temperatur dan waktu relaksasi thermostat adalah kontrol berbeda.')],
            [t('Pressure / damping', 'Tekanan / damping'), 'bar / ps', t('Check the ensemble and periodic directions before pressure coupling.', 'Periksa ensemble dan arah periodik sebelum pengaturan kopling tekanan.')],
            [t('LJ epsilon / sigma / cutoff', 'LJ epsilon / sigma / cutoff'), 'eV / Å / Å', t('Model parameters must match the intended species and physical study.', 'Parameter model harus cocok dengan spesies dan studi fisik yang dimaksud.')],
            [t('Strain rate / safety limit', 'Strain rate / safety limit'), 's⁻¹ / ratio', t('A rate and total duration imply a planned strain; the safety limit is not a target unit conversion.', 'Laju dan durasi total menentukan strain rencana; safety limit bukan konversi satuan target.')],
          ] },
        },
        {
          title: t('Advanced: Blocks and Expert input', 'Advanced: Blocks dan input Expert'),
          steps: [
            t('Switch to Advanced. Blocks opens a Command library and an ordered Simulation commands rack. Add a supported block, edit its values, and review its command preview.', 'Beralih ke Advanced. Blocks membuka Command library dan rak Simulation commands berurutan. Tambahkan blok yang didukung, edit nilainya, dan periksa pratinjau perintahnya.'),
            t('Use the block On/Off control, arrows or drag handle to establish the execution order. Disabled blocks remain stored but are omitted from generated input.', 'Gunakan kontrol On/Off, panah, atau handle geser pada blok untuk menentukan urutan eksekusi. Blok nonaktif tetap disimpan tetapi tidak masuk input yang dihasilkan.'),
            t('Open Expert to inspect the compiled commands. Editing the raw text creates an override that controls that stage even if the block rack is later changed. Regenerate from Blocks removes that override explicitly.', 'Buka Expert untuk memeriksa perintah hasil kompilasi. Mengedit teks mentah membuat override yang mengendalikan tahap tersebut walaupun rak blok kemudian diubah. Regenerate from Blocks menghapus override secara eksplisit.'),
            t('Read browser validation before submission, then inspect in.lammps again. Manual commands must contain run or minimize and pass the native runtime validation and isolation probe.', 'Baca validasi browser sebelum submit, lalu periksa in.lammps lagi. Perintah manual harus memuat run atau minimize serta lulus validasi runtime native dan probe isolasi.'),
          ],
          paragraphs: [t('Advanced is a managed LAMMPS workflow, not an unrestricted shell or a full standalone input file. Phynite owns source loading, units, boundary, masses, force field, clock, and output paths. External execution, include/jump, arbitrary file paths, nested commands, and unmanaged output are rejected. Keep fixed timesteps per stage; adaptive timestep commands are not supported by the retained physical-time contract.', 'Advanced adalah workflow LAMMPS terkelola, bukan shell tanpa batas atau file input standalone penuh. Phynite mengelola pemuatan sumber, satuan, boundary, massa, force field, waktu, dan path output. Eksekusi eksternal, include/jump, path file arbitrer, perintah bertingkat, serta output tak terkelola ditolak. Gunakan timestep tetap per tahap; perintah timestep adaptif tidak didukung kontrak waktu fisik tersimpan.')],
          note: t('The npm app uses verified native isolation without Docker. Hosted personal workers have a separate runtime path. Follow Settings → Compute for the app you are actually running.', 'Aplikasi npm menggunakan isolasi native terverifikasi tanpa Docker. Worker pribadi hosted mempunyai jalur runtime terpisah. Ikuti Pengaturan → Compute pada aplikasi yang benar-benar Anda jalankan.'),
        },
        {
          title: t('Analyze retained frames', 'Analisis frame tersimpan'),
          steps: [
            t('Open the completed simulation’s Execution result and choose Inspect trajectory when a retained trajectory is available. Alternatively, import a known trajectory and preserve its original file.', 'Buka Execution result simulasi selesai dan pilih Inspect trajectory bila trajectory tersimpan tersedia. Alternatifnya, impor trajectory yang diketahui dan pertahankan file aslinya.'),
            t('In a project workflow, connect a trajectory to an MD analysis module. Choose Analysis: Radial distribution function, Common neighbor analysis, Polyhedral template matching, or Coordination number.', 'Dalam workflow project, hubungkan trajectory ke modul MD analysis. Pilih Analysis: Radial distribution function, Common neighbor analysis, Polyhedral template matching, atau Coordination number.'),
            t('Set the cutoff in Å where applicable and choose Start frame and Frame stride. Review run includes the actual source and analysis settings. MD Lab also offers a modifier pipeline; preserve modifier order when comparing results.', 'Tetapkan cutoff dalam Å bila berlaku, lalu pilih Start frame dan Frame stride. Review run menyertakan sumber serta pengaturan analisis aktual. MD Lab juga menyediakan pipeline modifier; pertahankan urutannya saat membandingkan hasil.'),
            t('Inspect the output table, distribution, structural classification, or retained analysis artifacts. Source time remains unknown if it was not declared; frame number alone is not elapsed physical time.', 'Periksa tabel output, distribusi, klasifikasi struktur, atau artefak analisis tersimpan. Waktu sumber tetap tidak diketahui bila tidak dideklarasikan; nomor frame saja bukan waktu fisik yang berlalu.'),
            t('Export the original numerical data and configuration along with any figure. Keep units, frame selection, cutoff, and potential identity in the method notes.', 'Ekspor data numerik asli dan konfigurasi bersama figur. Simpan satuan, pemilihan frame, cutoff, dan identitas potential dalam catatan metode.'),
          ],
          links: [{ label: 'LAMMPS documentation', href: 'https://docs.lammps.org/' }, { label: 'OVITO manual', href: 'https://www.ovito.org/docs/' }, related('figures', 'Scientific figures', 'Figur ilmiah')],
        },
        {
          title: t('Read the result and recover safely', 'Baca hasil dan pulihkan dengan aman'),
          table: { headings: [t('Observation', 'Pengamatan'), t('What to check', 'Yang diperiksa')], rows: [
            [t('Configuration ready', 'Configuration ready'), t('The current browser fields pass validation. Runtime, potential, and isolation still need successful execution checks.', 'Field browser saat ini lulus validasi. Runtime, potential, dan isolasi tetap perlu pemeriksaan eksekusi yang berhasil.')],
            [t('Run remains queued', 'Run tetap antre'), t('Worker readiness, earlier stages, resource capacity, and active jobs. Do not submit duplicates.', 'Kesiapan worker, tahap sebelumnya, kapasitas resource, dan job aktif. Jangan kirim duplikat.')],
            [t('LAMMPS exits or reports lost atoms', 'LAMMPS keluar atau melaporkan lost atoms'), t('Read the first meaningful log error; inspect geometry, boundary, force field, timestep, neighbor settings, and resources before changing a parameter.', 'Baca error log pertama yang bermakna; periksa geometri, boundary, force field, timestep, pengaturan neighbor, serta resource sebelum mengubah parameter.')],
            [t('No trajectory or metric is available', 'Trajectory atau metrik tidak tersedia'), t('Check retained artifacts and output intervals. Missing data is not zero and an empty view is not a physical result.', 'Periksa artefak tersimpan dan interval output. Data yang hilang bukan nol dan tampilan kosong bukan hasil fisik.')],
            [t('Cancelled or interrupted', 'Dibatalkan atau terinterupsi'), t('Wait for a final state, retain partial logs, and review the saved result before a new run. Recovery is offered only when verified saved output exists.', 'Tunggu status akhir, simpan log parsial, dan periksa hasil tersimpan sebelum run baru. Pemulihan hanya ditawarkan bila ada output tersimpan yang dapat diverifikasi.')],
          ] },
          note: t('Completed confirms process/result handling, not equilibration, force-field validity, timestep convergence, or a publication-ready conclusion. No universal target energy is assumed for the demo.', 'Completed mengonfirmasi penanganan proses/hasil, bukan ekuilibrasi, validitas force field, konvergensi timestep, atau kesimpulan siap publikasi. Tidak ada energi target universal yang diasumsikan untuk demo.'),
        },
      ],
    },
    {
      id: 'research-history', group: t('Results & figures', 'Hasil & figur'),
      title: t('Run history, research context, and evidence', 'Histori run, konteks riset, dan bukti'),
      intro: t('Use Run history for execution attempts and cancellation. Use Research context for the project timeline, compact run ledger, recent comparison, and read-only AI context. These panels report retained evidence; they do not replace solver logs or scientific validation.', 'Gunakan Run history untuk percobaan eksekusi dan pembatalan. Gunakan Research context untuk timeline project, ledger run ringkas, perbandingan terbaru, dan konteks AI read-only. Panel ini melaporkan bukti tersimpan; panel tidak menggantikan log solver atau validasi ilmiah.'),
      blocks: [
        {
          title: t('Find the record for the current project', 'Temukan catatan project saat ini'),
          steps: [
            t('Open a project’s Canvas. Choose the clock/history icon labeled Run history to see runs, their creation times, per-module attempt states, and recorded errors.', 'Buka Canvas project. Pilih ikon jam/histori berlabel Run history untuk melihat run, waktu pembuatannya, status percobaan tiap modul, dan error tercatat.'),
            t('Inspect a specific module’s Execution result for numerical summaries, Execution log, artifact downloads, and trajectory preview when available.', 'Periksa Execution result pada modul tertentu untuk ringkasan numerik, Execution log, unduhan artefak, dan pratinjau trajectory bila tersedia.'),
            t('Use Cancel branch for an active module branch or Cancel run for an active workflow. Wait for the terminal state before resubmitting; a cancellation request is not yet a completed stop.', 'Gunakan Cancel branch untuk cabang modul aktif atau Cancel run untuk workflow aktif. Tunggu status akhir sebelum mengirim ulang; permintaan pembatalan belum berarti proses selesai berhenti.'),
            t('Choose the activity-line icon labeled Research context. Refresh research context reloads recorded evidence for this project.', 'Pilih ikon garis aktivitas berlabel Research context. Refresh research context memuat ulang bukti tercatat untuk project ini.'),
          ],
        },
        {
          title: t('Read the ledger, timeline, and latest summary', 'Baca ledger, timeline, dan ringkasan terbaru'),
          paragraphs: [
            t('Run ledger shows up to the latest eight records with their names or kinds, timestamps, status, recorded failure category/reason, and input checksum where available. Timeline shows up to the latest eight recorded project events. Empty lists mean no evidence was returned, not that an unrecorded calculation succeeded.', 'Run ledger menampilkan hingga delapan catatan terbaru beserta nama atau jenis, timestamp, status, kategori/alasan kegagalan tercatat, dan checksum input bila tersedia. Timeline menampilkan hingga delapan event project terbaru yang tercatat. Daftar kosong berarti belum ada bukti yang dikembalikan, bukan bahwa kalkulasi tak tercatat berhasil.'),
            t('Summarize latest run displays the latest record’s status and available result summary, checksum, allocated CPU/RAM, and whether provenance was recorded. Missing values remain unavailable. The compact summary is assembled from saved records; it is not a new AI calculation.', 'Summarize latest run menampilkan status catatan terbaru dan ringkasan hasil yang tersedia, checksum, alokasi CPU/RAM, serta apakah provenance tercatat. Nilai yang hilang tetap tidak tersedia. Ringkasan singkat disusun dari catatan tersimpan; ini bukan kalkulasi AI baru.'),
            t('Allocated CPU and memory describe the job’s requested or effective budget. They are not measured CPU utilization or peak RAM. Use the actual execution record and logs for recorded timings and resource failures.', 'Alokasi CPU dan memori menggambarkan anggaran job yang diminta atau efektif. Nilai ini bukan utilisasi CPU terukur atau RAM puncak. Gunakan catatan eksekusi dan log aktual untuk waktu tercatat dan kegagalan resource.'),
          ],
        },
        {
          title: t('Compare recent runs without overinterpreting them', 'Bandingkan run terbaru tanpa interpretasi berlebihan'),
          steps: [
            t('Complete at least two runs in the project. Compare recent runs remains disabled until two completed records are available.', 'Selesaikan minimal dua run dalam project. Compare recent runs tetap nonaktif sampai tersedia dua catatan selesai.'),
            t('Choose Compare recent runs. The current compact comparison selects the two most recent completed runs and displays status, input checksum, and completion time.', 'Pilih Compare recent runs. Perbandingan ringkas saat ini memilih dua run selesai terbaru dan menampilkan status, checksum input, serta waktu selesai.'),
            t('Open the original input and result artifacts before comparing energies, convergence, trajectories, or runtimes. The panel does not automatically prove equal structures, force fields, pseudopotentials, normalization, or physical conditions.', 'Buka artefak input dan hasil asli sebelum membandingkan energi, konvergensi, trajectory, atau runtime. Panel tidak otomatis membuktikan kesamaan struktur, force field, pseudopotensial, normalisasi, atau kondisi fisik.'),
            t('For a scientific overlay or parameter series, prepare compatible numerical datasets in Figure Lab and record units and reference conventions. Use separate panels when the sources are not comparable.', 'Untuk overlay ilmiah atau seri parameter, siapkan dataset numerik kompatibel di Figure Lab dan catat satuan serta konvensi referensi. Gunakan panel terpisah jika sumber tidak sebanding.'),
          ],
          note: t('This is a recent-run metadata comparison, not an arbitrary multi-run plot or automatic convergence judgment. A different checksum signals different recorded input bytes; the same checksum alone is not proof of identical execution conditions.', 'Ini adalah perbandingan metadata run terbaru, bukan plot multi-run bebas atau penilaian konvergensi otomatis. Checksum berbeda menunjukkan byte input tercatat berbeda; checksum sama saja bukan bukti kondisi eksekusi identik.'),
          links: [related('convergence', 'Plan a convergence study', 'Rencanakan studi konvergensi'), related('alignment', 'Align scientific data', 'Selaraskan data ilmiah')],
        },
        {
          title: t('Give local AI traceable research context', 'Berikan konteks riset yang dapat ditelusuri ke AI lokal'),
          steps: [
            t('Connect an available local provider in Settings → AI provider accounts. Cloud login is not required for this connection.', 'Hubungkan provider lokal yang tersedia pada Pengaturan → AI provider accounts. Login Cloud tidak diperlukan untuk koneksi ini.'),
            t('In Research context, choose Add context to local AI. The project context appears as a read-only source in the AI workspace.', 'Pada Research context, pilih Add context to local AI. Konteks project muncul sebagai sumber read-only di workspace AI.'),
            t('Ask a bounded question, such as identifying the latest failure or explaining a recorded input difference. Ask the response to cite the run or artifact it uses, then inspect that evidence yourself.', 'Ajukan pertanyaan terbatas, misalnya mengidentifikasi kegagalan terbaru atau menjelaskan perbedaan input tercatat. Minta respons menyebut run atau artefak yang dipakai, lalu periksa buktinya sendiri.'),
            t('Review any proposed scientific change through the existing approval flow. Adding read-only evidence does not grant permission to edit a structure, execute a solver, or change a potential.', 'Periksa perubahan ilmiah yang diusulkan melalui alur approval yang ada. Menambahkan bukti read-only tidak memberi izin mengedit struktur, menjalankan solver, atau mengganti potential.'),
          ],
          paragraphs: [t('Local AI means the connection and credential handling run on your computer. The selected provider can process the submitted prompt and context under its own service terms. Keep confidential research out of a provider request unless you intend to share it with that provider.', 'AI lokal berarti koneksi dan pengelolaan kredensial berjalan di komputer Anda. Provider terpilih dapat memproses prompt dan konteks yang dikirim sesuai ketentuan layanannya. Jangan sertakan riset rahasia dalam permintaan provider kecuali Anda memang ingin membagikannya kepada provider tersebut.')],
          links: [related('ai-providers', 'Provider login and unavailable models', 'Login provider dan model tidak tersedia')],
        },
        {
          title: t('Failure evidence, notifications, and team visibility', 'Bukti kegagalan, notifikasi, dan visibilitas tim'),
          table: { headings: [t('Signal', 'Sinyal'), t('Interpretation', 'Interpretasi')], rows: [
            [t('Preflight or setup rejection', 'Penolakan preflight atau setup'), t('Fix runtime, isolation, source, potential, or validation prerequisites before a new run. No solver log exists if the solver never started.', 'Perbaiki prasyarat runtime, isolasi, sumber, potential, atau validasi sebelum run baru. Log solver tidak ada bila solver belum pernah dimulai.')],
            [t('Solver, resource, or artifact failure', 'Kegagalan solver, resource, atau artefak'), t('Read the recorded first cause and relevant log. A failure while saving artifacts does not imply the numerical process never ran.', 'Baca penyebab pertama yang tercatat dan log terkait. Kegagalan saat menyimpan artefak tidak berarti proses numerik belum pernah berjalan.')],
            [t('Recover saved result appears', 'Recover saved result muncul'), t('The local app found recoverable output. The action verifies and imports saved results; it does not rerun the solver.', 'Aplikasi lokal menemukan output yang dapat dipulihkan. Aksi memverifikasi dan mengimpor hasil tersimpan; tidak menjalankan ulang solver.')],
            [t('Local context only', 'Local context only'), t('No project sync is enabled. Signing in to Cloud alone does not publish this project.', 'Sync project belum aktif. Login Cloud saja tidak memublikasikan project ini.')],
            [t('Team visibility enabled', 'Team visibility enabled'), t('The project already has approved Cloud Sync scope and a reported revision. The panel does not create sharing permissions or upload additional files.', 'Project sudah memiliki cakupan Cloud Sync yang disetujui dan revisi tercatat. Panel tidak membuat izin berbagi atau mengunggah file tambahan.')],
          ] },
          paragraphs: [t('Enable local job/runtime alerts in Settings → Notifications to be informed of actual state changes while the app is open. An alert is a pointer to the saved record; keep the log and provenance before retrying.', 'Aktifkan alert job/runtime lokal pada Pengaturan → Notifications untuk mengetahui perubahan status aktual saat aplikasi terbuka. Alert adalah petunjuk menuju catatan tersimpan; simpan log dan provenance sebelum mencoba lagi.')],
          links: [related('diagnostics', 'Find the failing workflow stage', 'Temukan tahap workflow yang gagal'), related('cloud-sync', 'Cloud scope, conflicts, and account boundaries', 'Cakupan Cloud, konflik, dan batas akun')],
        },
      ],
    },
    {
      id: 'tools-reference', group: t('Reference', 'Referensi'),
      title: t('Tool and icon reference', 'Referensi alat dan ikon'),
      intro: t('Icons identify an action or workspace, not scientific validity. Hover an icon for its label, or focus it with the keyboard to use its accessible name. The same action can move into a menu on narrow screens.', 'Ikon mengenali aksi atau workspace, bukan validitas ilmiah. Arahkan pointer ke ikon untuk melihat label, atau fokuskan dengan keyboard untuk memakai nama aksesibelnya. Aksi yang sama dapat berpindah ke menu pada layar sempit.'),
      blocks: [
        {
          title: t('Research workspaces', 'Workspace riset'),
          table: { headings: [t('Icon / label', 'Ikon / label'), t('Purpose', 'Fungsi'), t('Keep in mind', 'Perhatikan')], rows: [
            [t('Flask — DFT Lab', 'Labu — DFT Lab'), t('Prepare structures and Quantum ESPRESSO calculation workflows.', 'Menyiapkan struktur dan workflow kalkulasi Quantum ESPRESSO.'), t('A setup is editable; an execution record preserves the submitted attempt.', 'Setup dapat diedit; catatan eksekusi menyimpan percobaan yang dikirim.')],
            [t('Three waves — MD Lab', 'Tiga gelombang — MD Lab'), t('Inspect trajectories, configure LAMMPS stages, and analyze frames.', 'Memeriksa trajectory, mengonfigurasi tahap LAMMPS, dan menganalisis frame.'), t('Frame display and actual physical time are different quantities.', 'Tampilan frame dan waktu fisik aktual adalah besaran berbeda.')],
            [t('Axes and line — Figure Lab', 'Sumbu dan garis — Figure Lab'), t('Compose numerical datasets into scientific figures and export sources.', 'Menyusun dataset numerik menjadi figur ilmiah dan mengekspor sumber.'), t('Figure styling never changes the executed scientific input.', 'Gaya figur tidak mengubah input ilmiah yang dijalankan.')],
            [t('Stepped spark — AI', 'Spark bertingkat — AI'), t('Open the project AI workspace and review proposed actions.', 'Membuka workspace AI project dan memeriksa aksi yang diusulkan.'), t('The Phynite AI entry icon is distinct from provider logos in Settings.', 'Ikon masuk AI Phynite berbeda dari logo provider di Pengaturan.')],
          ] },
          visuals: [
            { kind: 'icon', src: '/brand/ai/codex.png', alt: t('Codex provider logo', 'Logo provider Codex'), caption: t('Codex provider connection in Settings', 'Koneksi provider Codex di Pengaturan') },
            { kind: 'icon', src: '/brand/ai/antigravity.png', alt: t('Antigravity provider logo', 'Logo provider Antigravity'), caption: t('Antigravity provider connection in Settings', 'Koneksi provider Antigravity di Pengaturan') },
          ],
        },
        {
          title: t('Canvas and execution controls', 'Kontrol Canvas dan eksekusi'),
          table: { headings: [t('Control', 'Kontrol'), t('What it does', 'Fungsinya')], rows: [
            [t('Plus — Add module', 'Plus — Add module'), t('Opens the module catalogue. Add a source, scientific task, analysis, or Figure module and connect compatible ports.', 'Membuka katalog modul. Tambahkan sumber, tugas ilmiah, analisis, atau modul Figure lalu hubungkan port yang kompatibel.')],
            [t('Curved arrows — Undo / Redo', 'Panah melengkung — Undo / Redo'), t('Moves through supported editing history; it does not undo an already executed solver job.', 'Berpindah dalam histori penyuntingan yang didukung; tidak membatalkan job solver yang sudah dijalankan.')],
            [t('Play — Run / Run selected / Run all', 'Play — Run / Run selected / Run all'), t('Prepares Review run, includes prerequisites once, and reuses compatible retained results. Start run confirms the reviewed plan.', 'Menyiapkan Review run, menyertakan prasyarat sekali, dan memakai ulang hasil tersimpan yang kompatibel. Start run mengonfirmasi rencana yang ditinjau.')],
            [t('Clock — Run history', 'Jam — Run history'), t('Shows workflow attempts, per-module status, errors, and available cancellation actions.', 'Menampilkan percobaan workflow, status per modul, error, dan aksi pembatalan yang tersedia.')],
            [t('Activity line — Research context', 'Garis aktivitas — Research context'), t('Opens the project run ledger, timeline, recent comparison, and read-only AI context.', 'Membuka ledger run project, timeline, perbandingan terbaru, dan konteks AI read-only.')],
          ] },
          note: t('A disabled Run button needs its displayed validation or setup issue resolved. Adding a module does not install its solver or create a scientific result.', 'Tombol Run nonaktif memerlukan penyelesaian masalah validasi atau setup yang ditampilkan. Menambahkan modul tidak menginstal solver atau menghasilkan hasil ilmiah.'),
        },
        {
          title: t('Geometry and trajectory tools', 'Alat geometri dan trajectory'),
          table: { headings: [t('Tool / key', 'Alat / tombol'), t('Use', 'Penggunaan'), t('Scope', 'Cakupan')], rows: [
            ['Select / V', t('Select atoms or particles for inspection.', 'Memilih atom atau partikel untuk inspeksi.'), t('Active viewport.', 'Viewport aktif.')],
            ['Move / G', t('Move selected atoms; inspect the resulting coordinates before applying.', 'Memindahkan atom terpilih; periksa koordinat hasil sebelum menerapkan.'), t('Structure editor.', 'Editor struktur.')],
            ['Measure / M', t('Measure selected geometry using the current distance/angle mode.', 'Mengukur geometri terpilih dengan mode jarak/sudut aktif.'), t('Structure or trajectory viewport.', 'Viewport struktur atau trajectory.')],
            ['Slice cross-section / S', t('Inspect a cross-section of the displayed trajectory.', 'Memeriksa penampang trajectory yang ditampilkan.'), 'MD Lab'],
            ['Fit structure / F', t('Frame the structure in the camera; it does not resize the cell.', 'Memuat struktur dalam kamera; tidak mengubah ukuran sel.'), 'MD Lab'],
            ['View angle', t('Choose an orientation or supported multiple-view layout.', 'Memilih orientasi atau tata letak multiview yang didukung.'), t('Viewport camera.', 'Kamera viewport.')],
            ['Display overlays', t('Change display aids without rewriting the scientific source.', 'Mengubah bantuan tampilan tanpa menulis ulang sumber ilmiah.'), 'MD Lab'],
            ['Capture snapshot', t('Save a viewport image for illustration.', 'Menyimpan gambar viewport untuk ilustrasi.'), t('An image does not replace numerical export or provenance.', 'Gambar tidak menggantikan ekspor numerik atau provenance.')],
          ] },
          note: t('Keyboard shortcuts depend on focused context. Typing in a text field uses text editing; browser and operating-system shortcuts can take precedence. Check the Keyboard settings page for the actions that can actually be rebound.', 'Pintasan keyboard bergantung pada konteks fokus. Mengetik dalam field teks menggunakan penyuntingan teks; pintasan browser dan sistem operasi dapat didahulukan. Periksa halaman Keyboard untuk aksi yang benar-benar dapat diubah pintasannya.'),
          links: [related('edit', 'Edit atoms and cell geometry', 'Edit atom dan geometri sel'), related('shortcuts', 'Full keyboard reference', 'Referensi keyboard lengkap')],
        },
        {
          title: t('Read status and evidence icons', 'Baca ikon status dan bukti'),
          table: { headings: [t('Label', 'Label'), t('Meaning', 'Arti')], rows: [
            ['Ready / Configuration ready', t('The relevant checks passed at that stage. Still inspect execution prerequisites and scientific choices.', 'Pemeriksaan yang relevan lulus pada tahap itu. Tetap periksa prasyarat eksekusi dan pilihan ilmiah.')],
            ['Queued / Running', t('The job is waiting or executing. Wait for the final state and avoid duplicate submissions.', 'Job menunggu atau berjalan. Tunggu status akhir dan hindari pengiriman duplikat.')],
            ['Completed', t('The app retained the result. Inspect convergence, warnings, units, and physical assumptions.', 'Aplikasi menyimpan hasil. Periksa konvergensi, peringatan, satuan, dan asumsi fisik.')],
            ['Failed / Cancelled', t('Open the recorded reason and logs. Preserve partial evidence before a retry.', 'Buka alasan dan log tercatat. Pertahankan bukti parsial sebelum mencoba lagi.')],
            ['Integrity / Elements / Runtime', t('MD potential indicators identify separate checks. They do not validate a force field for your study.', 'Indikator potential MD menunjukkan pemeriksaan terpisah. Indikator tidak memvalidasi force field untuk studi Anda.')],
            ['Not recorded / unavailable', t('The source did not provide that measurement. Do not interpret it as zero.', 'Sumber tidak menyediakan pengukuran tersebut. Jangan menafsirkannya sebagai nol.')],
          ] },
          links: [related('research-history', 'Follow research evidence', 'Telusuri bukti riset'), related('settings-reference', 'Settings and preferences', 'Pengaturan dan preferensi')],
        },
      ],
    },
    {
      id: 'local-troubleshooting', group: t('Troubleshooting & recovery', 'Pemecahan masalah & pemulihan'),
      title: t('Local troubleshooting and recovery', 'Pemecahan masalah dan pemulihan lokal'),
      intro: t('Use this short recovery path when the local launcher opens but a runtime, job, browser, or saved workspace does not behave as expected. Preserve the data directory and logs until the cause is clear.', 'Gunakan jalur pemulihan singkat ini ketika launcher lokal terbuka tetapi runtime, job, browser, atau workspace tersimpan tidak bekerja seperti yang diharapkan. Pertahankan data directory dan log sampai penyebabnya jelas.'),
      blocks: [
        {
          title: t('Startup and browser', 'Startup dan browser'),
          code: 'phynite-lab status --data-dir ~/.phynite-lab\nphynite-lab doctor --data-dir ~/.phynite-lab\nphynite-lab --no-open --port 3000 --data-dir ~/.phynite-lab',
          table: { headings: [t('Symptom', 'Gejala'), t('Recovery', 'Pemulihan')], rows: [
            [t('A local service stopped during startup', 'Service lokal berhenti saat startup'), t('Run status and doctor with the same --data-dir. Read the startup logs printed or stored in the data directory; do not create a second workspace by changing paths.', 'Jalankan status dan doctor dengan --data-dir yang sama. Baca log startup yang dicetak atau disimpan di data directory; jangan membuat workspace kedua dengan mengganti path.')],
            [t('The browser did not open', 'Browser tidak terbuka'), t('Use --no-open and open the exact loopback URL printed by the launcher. Port 3000 may have been replaced with an available port.', 'Gunakan --no-open dan buka URL loopback eksak yang dicetak launcher. Port 3000 mungkin diganti port yang tersedia.')],
            [t('A second command shows the existing instance', 'Perintah kedua menunjukkan instance yang sudah ada'), t('Reuse the reported URL or stop the instance cleanly before starting a different data directory.', 'Gunakan URL yang dilaporkan atau hentikan instance dengan tertib sebelum memulai data directory berbeda.')],
            [t('Projects appear empty', 'Project tampak kosong'), t('Check the original --data-dir, status, and workspace identity. Reinstalling npm does not restore data from another directory.', 'Periksa --data-dir awal, status, dan identitas workspace. Memasang ulang npm tidak mengambil data dari directory lain.')],
          ] },
        },
        {
          title: t('Runtime and isolation', 'Runtime dan isolasi'),
          steps: [
            t('Open Settings → Compute and verify that the requested DFT or MD/analysis runtime is installed, started, and capability-checked for this workspace.', 'Buka Pengaturan → Compute dan verifikasi runtime DFT atau MD/analysis yang diminta sudah terinstal, berjalan, dan diperiksa kemampuannya untuk workspace ini.'),
            t('If a sandbox probe is unavailable, follow the operating-system remediation shown by the app. Do not disable user namespaces, bypass bubblewrap, or switch to an unverified runtime.', 'Jika probe sandbox tidak tersedia, ikuti perbaikan sistem operasi yang ditampilkan aplikasi. Jangan mematikan user namespace, melewati bubblewrap, atau mengganti ke runtime yang belum diverifikasi.'),
            t('For DFT, verify the selected pseudopotential library or exact UPF assets and their checksums. For MD, verify mapped elements, potential integrity, runtime validation, and the selected unit system.', 'Untuk DFT, verifikasi pustaka pseudopotential yang dipilih atau aset UPF eksak beserta checksum. Untuk MD, verifikasi pemetaan elemen, integritas potential, validasi runtime, dan sistem satuan yang dipilih.'),
            t('Run a small reference job once the Compute plan is ready. Keep the failed attempt and its first cause if it still fails.', 'Jalankan job referensi kecil setelah Compute plan siap. Pertahankan percobaan gagal dan penyebab pertamanya bila masih gagal.'),
          ],
          links: [related('local-compute', 'Local and hosted compute paths', 'Jalur compute lokal dan hosted'), related('getting-started', 'First local result checklist', 'Checklist hasil lokal pertama')],
        },
        {
          title: t('Read the correct failure log', 'Baca log kegagalan yang benar'),
          table: { headings: [t('First failing stage', 'Tahap gagal pertama'), t('Evidence', 'Bukti'), t('Next step', 'Langkah berikutnya')], rows: [
            [t('Preflight / setup', 'Preflight / setup'), t('Visible Compute plan or run-review reason; no solver log because the process never started.', 'Alasan pada Compute plan atau run-review; tidak ada log solver karena proses belum dimulai.'), t('Fix runtime, isolation, source, potential, resource, or input validation, then submit a new attempt.', 'Perbaiki validasi runtime, isolasi, sumber, potential, resource, atau input lalu kirim percobaan baru.')],
            [t('Solver execution', 'Eksekusi solver'), t('Execution log, log tail, exit status, and retained input/artifacts.', 'Execution log, log tail, status keluar, dan input/artefak tersimpan.'), t('Read the first meaningful solver error; inspect memory, disk, syntax, and physical settings.', 'Baca error solver pertama yang bermakna; periksa memori, disk, sintaks, dan pengaturan fisik.')],
            [t('Result persistence / artifact', 'Persistensi hasil / artefak'), t('Solver output may exist while result import or artifact verification fails.', 'Output solver mungkin ada ketika impor hasil atau verifikasi artefak gagal.'), t('Keep the attempt, check disk and checksums, and use Recover saved result only when offered.', 'Pertahankan percobaan, periksa disk dan checksum, lalu gunakan Recover saved result hanya jika ditawarkan.')],
            [t('AI provider', 'Provider AI'), t('Provider settings status, capability probe, and safe connection error.', 'Status Pengaturan provider, probe kemampuan, dan error koneksi aman.'), t('Fix the official CLI login or provider availability. There is no silent provider fallback.', 'Perbaiki login CLI resmi atau ketersediaan provider. Tidak ada fallback provider diam-diam.')],
          ] },
        },
        {
          title: t('Release identity, license, and update verification', 'Identitas rilis, lisensi, dan verifikasi update'),
          code: 'phynite-lab --version\nnpm view phynite-lab version',
          paragraphs: [
            t('The documentation release metadata currently resolves phynite-lab@{{LOCAL_NPM_VERSION}}. The first command reports your installed launcher; the second reads npm registry metadata. A newer registry version does not update an already running process.', 'Metadata rilis dokumentasi saat ini menunjukkan phynite-lab@{{LOCAL_NPM_VERSION}}. Perintah pertama melaporkan launcher terpasang; perintah kedua membaca metadata registry npm. Versi registry yang lebih baru tidak memperbarui proses yang masih berjalan.'),
            t('Open Source code and license in the app for its corresponding source. A published distribution records its exact public source commit and source archive; release assets provide package checksums and qualification evidence. Phynite-owned local code is AGPL-3.0-only; third-party solvers and potential files retain their own licenses.', 'Buka Source code and license pada aplikasi untuk corresponding source. Distribusi publik mencatat commit source publik dan arsip source eksaknya; aset rilis menyediakan checksum paket serta bukti kualifikasi. Kode lokal milik Phynite berlisensi AGPL-3.0-only; solver pihak ketiga dan file potential mempertahankan lisensinya sendiri.'),
            t('Finish or cancel active work, stop the app, update with npm install -g phynite-lab@latest, and reopen the same data directory. Verify the launcher version and Compute capabilities. Background update notices do not install packages automatically and a registry outage does not prevent local work.', 'Selesaikan atau batalkan pekerjaan aktif, hentikan aplikasi, perbarui dengan npm install -g phynite-lab@latest, lalu buka data directory yang sama. Verifikasi versi launcher dan kemampuan Compute. Notifikasi update latar tidak memasang paket otomatis dan gangguan registry tidak menghalangi pekerjaan lokal.'),
          ],
          links: [{ label: t('Source code and license', 'Source code dan lisensi'), href: '/source' }, related('npm-local-app', 'Update and startup recovery', 'Update dan pemulihan startup')],
        },
        {
          title: t('Restart, cancel, and recover', 'Restart, batalkan, dan pulihkan'),
          steps: [
            t('Cancel an active run from Run history and wait until it becomes Cancelled or another terminal state. Do not submit a replacement while the original is still active.', 'Batalkan run aktif dari Run history lalu tunggu hingga menjadi Cancelled atau status terminal lain. Jangan mengirim pengganti ketika run asli masih aktif.'),
            t('After a launcher or computer restart, inspect the run state and saved log. Interrupted work requires review; the app does not silently rerun a scientific job.', 'Setelah launcher atau komputer restart, periksa status run dan log tersimpan. Pekerjaan terinterupsi memerlukan pemeriksaan; aplikasi tidak diam-diam menjalankan ulang job ilmiah.'),
            t('Use Recover saved result only when the app reports verified saved output. Recovery imports that output; it does not claim the solver converged or rerun the job.', 'Gunakan Recover saved result hanya ketika aplikasi melaporkan output tersimpan yang terverifikasi. Pemulihan mengimpor output itu; tidak menyatakan solver konvergen atau menjalankan ulang job.'),
            t('Before disk cleanup or migration, export the project archive and make an independent backup of inputs, provenance, checksums, and required QE tmp/wavefunction state.', 'Sebelum membersihkan disk atau migrasi, ekspor arsip project dan buat backup terpisah input, provenance, checksum, serta state QE tmp/wavefunction yang diperlukan.'),
          ],
          note: t('Completed is an application state, not a scientific conclusion. Recheck convergence, units, method identity, and downstream artifact completeness before using a result.', 'Completed adalah status aplikasi, bukan kesimpulan ilmiah. Periksa kembali konvergensi, satuan, identitas metode, dan kelengkapan artefak lanjutan sebelum memakai hasil.'),
          links: [related('troubleshooting', 'General troubleshooting', 'Pemecahan masalah umum'), related('diagnostics', 'Failure-stage diagnosis', 'Diagnosis tahap kegagalan'), related('storage-backup', 'Storage and backup', 'Storage dan backup')],
        },
      ],
    },
  ];
}

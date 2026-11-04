import captureManifest from '../public/docs/guide/manifest.json' with { type: 'json' };
import diagramManifest from '../public/docs/guide/diagrams/manifest.json' with { type: 'json' };
import type { GuideSection, GuideVisual } from './guide-content.ts';
import type { Locale } from './locale.ts';

type Caption = [en: string, id: string];
type Placement = { block: number; image: string; alt: Caption; caption: Caption; diagram?: boolean };
const captured = captureManifest.captures as { file: string; width?: number; height?: number }[];

function visual(placement: Placement, locale: Locale): GuideVisual {
  const language = locale === 'id' ? 1 : 0;
  if (placement.diagram) {
    const name = `${placement.image}-${locale}`;
    const source = `/docs/guide/diagrams/${name}-light.png`;
    const size = diagramManifest.assets.find(asset => asset.file === `${name}-light.png`);
    return { kind: 'diagram', src: source, lightSrc: source, darkSrc: `/docs/guide/diagrams/${name}-dark.png`,
      alt: placement.alt[language], caption: placement.caption[language], width: size?.width, height: size?.height };
  }
  const name = placement.image;
  const size = captured.find(asset => asset.file === `${name}-desktop-light.png`);
  const mobile = captured.find(asset => asset.file === `${name}-mobile-dark.png`);
  return { kind: 'screenshot', src: `/docs/guide/${name}-desktop-light.png`,
    lightSrc: `/docs/guide/${name}-desktop-light.png`, darkSrc: `/docs/guide/${name}-desktop-dark.png`,
    mobileSrc: `/docs/guide/${name}-mobile-dark.png`, width: size?.width, height: size?.height,
    mobileWidth: mobile?.width, mobileHeight: mobile?.height,
    alt: placement.alt[language], caption: placement.caption[language] };
}

const workflow: Placement = { block: 0, diagram: true, image: 'research-lifecycle',
  alt: ['Structure, input, run, and evidence as separate research steps', 'Struktur, input, run, dan bukti sebagai langkah riset terpisah'],
  caption: ['Concept diagram: preserve each stage; a completed process still needs scientific review.', 'Diagram konsep: simpan setiap tahap; proses selesai tetap memerlukan pemeriksaan ilmiah.'] };
const cloud: Placement = { block: 0, diagram: true, image: 'local-cloud-paths',
  alt: ['Local workspace, project Cloud Sync, and cloud compute data boundaries', 'Batas data workspace lokal, Cloud Sync project, dan compute cloud'],
  caption: ['Concept diagram: login, project sync, and job transfer are separate choices.', 'Diagram konsep: login, sync project, dan transfer job adalah pilihan terpisah.'] };
const storage: Placement = { block: 0, diagram: true, image: 'storage-layers',
  alt: ['Project inventory, files outside inventory, and independent backup', 'Inventaris project, file di luar inventaris, dan backup terpisah'],
  caption: ['Concept diagram: project inventory is only part of disk usage.', 'Diagram konsep: inventaris project hanya sebagian penggunaan disk.'] };
const failure: Placement = { block: 0, diagram: true, image: 'failure-stages',
  alt: ['Diagnose preflight, solver execution, and result persistence separately', 'Diagnosis preflight, eksekusi solver, dan penyimpanan hasil secara terpisah'],
  caption: ['Concept diagram: investigate the first failing stage before retrying.', 'Diagram konsep: periksa tahap pertama yang gagal sebelum mencoba lagi.'] };
const shot = (image: string, block: number, alt: Caption, caption: Caption): Placement => ({ image, block, alt, caption });
const workspace = shot('onboarding-workspace', 0, ['Anonymous local workspace', 'Workspace lokal tanpa login'], ['Real local demo workspace. Start with New project; Cloud login is optional.', 'Workspace demo lokal nyata. Mulai dengan New project; login Cloud opsional.']);
const compute = shot('compute-runtime-setup', 1, ['Scientific runtime setup in Settings', 'Setup runtime ilmiah pada Pengaturan'], ['The current computer reports its own installed runtimes and isolation state. Your values may differ.', 'Komputer melaporkan runtime terpasang serta status isolasinya sendiri. Nilai Anda bisa berbeda.']);

const placements: Record<string, Placement[]> = {
  workflow: [workflow],
  'getting-started': [{ ...workspace, block: 1 }, { ...compute, block: 2 }],
  'npm-local-app': [workspace],
  'quickstart-silicon': [workflow],
  project: [shot('new-project', 0, ['Create a neutral demo project', 'Membuat project demo netral'], ['Use a name that identifies the study.', 'Gunakan nama yang mengidentifikasi studi.'])],
  structure: [shot('structure-editor', 1, ['Structure editor and cell inspection', 'Editor struktur dan pemeriksaan sel'], ['Inspect species, coordinates, and the simulation cell before running.', 'Periksa spesies, koordinat, dan sel simulasi sebelum run.'])],
  edit: [shot('structure-editor', 0, ['Atom editing tools in the structure editor', 'Alat edit atom pada editor struktur'], ['Tool icons act on the selected structure; visual repeats do not change the simulation cell.', 'Ikon alat bekerja pada struktur terpilih; pengulangan visual tidak mengubah sel simulasi.'])],
  periodicity: [workflow], 'slab-workflow': [workflow],
  calculation: [shot('workflow-canvas', 1, ['Scientific modules connected on Canvas', 'Modul ilmiah terhubung pada Canvas'], ['Connections describe dependencies. A draft module is not a completed run.', 'Koneksi menjelaskan dependensi. Modul draft bukan run selesai.'])],
  configure: [shot('dft-configuration', 0, ['DFT configuration and input controls', 'Konfigurasi DFT dan kontrol input'], ['This demo configuration illustrates the controls; converge settings for your own material.', 'Konfigurasi demo menunjukkan kontrol; konvergensikan pengaturan untuk material Anda sendiri.'])],
  convergence: [workflow], execution: [failure],
  'quickstart-md': [shot('md-guided', 1, ['Simple guided MD stage configuration', 'Konfigurasi tahap MD Simple'], ['Review the physical model, stage duration, and output intervals.', 'Periksa model fisik, durasi tahap, dan interval output.'])],
  'md-workflows': [
    shot('md-guided', 1, ['Simple MD configuration', 'Konfigurasi MD Simple'], ['Simple is the guided workflow in the current interface.', 'Simple adalah workflow Guided pada antarmuka saat ini.']),
    shot('md-manual', 2, ['Advanced MD blocks and manual input', 'Blok MD Advanced dan input manual'], ['Advanced retains managed input validation and isolation requirements.', 'Advanced tetap mempertahankan validasi input terkelola dan persyaratan isolasi.']),
    shot('md-analysis', 3, ['MD analysis controls for retained trajectory data', 'Kontrol analisis MD untuk data trajectory tersimpan'], ['Review source frames and analysis parameters before running.', 'Tinjau frame sumber dan parameter analisis sebelum menjalankan.'])],
  'local-compute': [cloud, compute],
  'ai-providers': [shot('ai-provider-accounts', 0, ['Local AI provider connection settings', 'Pengaturan koneksi provider AI lokal'], ['Signed-out demo: complete the official provider flow on your computer. No account or quota is simulated.', 'Demo belum login: selesaikan alur provider resmi pada komputer Anda. Tidak ada akun atau kuota yang disimulasikan.'])],
  'cloud-sync': [cloud, shot('cloud-account', 1, ['Optional Phynite Cloud sign-in', 'Login Phynite Cloud opsional'], ['Signed-out demo. Login does not enable project sync.', 'Demo belum login. Login tidak mengaktifkan sync project.'])],
  saving: [storage], billing: [cloud],
  'storage-backup': [storage, shot('storage-archives', 2, ['Storage inventory and project archives', 'Inventaris storage dan arsip project'], ['Export important projects and verify a separate backup.', 'Ekspor project penting dan verifikasi backup terpisah.'])],
  'settings-reference': [shot('appearance-settings', 0, ['Appearance and language preferences', 'Preferensi tampilan dan bahasa'], ['Device preferences are separate from Cloud account settings.', 'Preferensi perangkat terpisah dari pengaturan akun Cloud.'])],
  language: [shot('appearance-settings', 0, ['Language control in Appearance settings', 'Kontrol bahasa pada pengaturan tampilan'], ['Interface language changes labels, not scientific data or units.', 'Bahasa antarmuka mengubah label, bukan data atau satuan ilmiah.'])],
  account: [shot('cloud-account', 0, ['Cloud account settings without a signed-in profile', 'Pengaturan akun Cloud tanpa profil login'], ['A profile appears only after Cloud authentication.', 'Profil baru muncul setelah autentikasi Cloud.'])],
  shortcuts: [shot('keyboard-settings', 0, ['Customizable application shortcuts', 'Pintasan aplikasi yang dapat disesuaikan'], ['Supported bindings are stored on this device.', 'Binding yang didukung disimpan pada perangkat ini.'])],
  results: [workflow], figures: [workflow], alignment: [workflow], studies: [workflow], reuse: [storage], advanced: [workflow], export: [storage], publication: [workflow],
  'research-history': [shot('run-history', 0, ['Project run history and recorded attempts', 'Histori run project dan percobaan tercatat'], ['Inspect the selected project and first recorded cause; no solver output is invented.', 'Periksa project terpilih dan penyebab pertama yang tercatat; tidak ada output solver yang dibuat-buat.'])],
  troubleshooting: [failure], 'local-troubleshooting': [failure], diagnostics: [failure],
  'tools-reference': [shot('workflow-canvas', 0, ['Module tools and Canvas navigation', 'Alat modul dan navigasi Canvas'], ['Use tooltips and the tool reference to identify controls.', 'Gunakan tooltip dan referensi alat untuk mengenali kontrol.'])],
  'field-reference': [workflow], roadmap: [cloud], reference: [workflow],
};

/** Keep image selection identical in both languages; only captions and alt text differ. */
export function withGuideVisuals(section: GuideSection, locale: Locale): GuideSection {
  const selected = placements[section.id] ?? [];
  return { ...section, blocks: section.blocks.map((block, index) => ({ ...block,
    visuals: [
      ...selected.filter(item => item.block === index).map(item => visual(item, locale)),
      // Preserve source-owned provider/tool icons while replacing stale screenshots
      // with the current capture manifest. Conceptual diagrams are centralized above.
      ...(block.visuals ?? []).filter(item => item.kind === 'icon'),
    ],
  })) };
}

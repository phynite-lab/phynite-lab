/** Render conceptual diagrams, never scientific results, as portable PNGs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const output = 'public/docs/guide/diagrams';
const diagrams = [
  { id: 'research-lifecycle', title: ['From question to retained evidence', 'Dari pertanyaan ke bukti tersimpan'], subtitle: ['Every arrow is a deliberate research step.', 'Setiap panah adalah langkah riset yang disengaja.'], cards: [
    [['Structure', 'Struktur'], ['Cell, species, coordinates, units', 'Sel, spesies, koordinat, satuan']],
    [['Input', 'Input'], ['Method, potential, sampling', 'Metode, potential, sampling']],
    [['Run', 'Run'], ['Runtime, isolation, resources', 'Runtime, isolasi, resource']],
    [['Evidence', 'Bukti'], ['Log, numbers, provenance, checksum', 'Log, angka, provenance, checksum']],
  ], footer: ['Completed is a process state. Convergence and physical validity still need review.', 'Completed adalah status proses. Konvergensi dan validitas fisik tetap perlu diperiksa.'] },
  { id: 'local-cloud-paths', title: ['Three separate choices', 'Tiga pilihan yang terpisah'], subtitle: ['Choose the destination before data leaves the computer.', 'Pilih tujuan sebelum data meninggalkan komputer.'], cards: [
    [['Local workspace', 'Workspace lokal'], ['SQLite + project files on your disk. No login needed.', 'SQLite + file project di disk Anda. Tidak perlu login.']],
    [['Cloud Sync', 'Cloud Sync'], ['Opt in per project. Review revisions, files, quota, and conflicts.', 'Aktifkan per project. Tinjau revisi, file, kuota, dan konflik.']],
    [['Cloud compute', 'Compute Cloud'], ['Review job inputs and dependencies. Sync stays independent.', 'Tinjau input job dan dependensi. Sync tetap terpisah.']],
  ], footer: ['Cloud login alone uploads no project. AI provider authentication is a separate connection.', 'Login Cloud saja tidak mengunggah project. Autentikasi provider AI adalah koneksi terpisah.'] },
  { id: 'storage-layers', title: ['Inventory is not total disk usage', 'Inventaris bukan seluruh pemakaian disk'], subtitle: ['All local layers consume the same selected disk.', 'Semua lapisan lokal memakai disk terpilih yang sama.'], cards: [
    [['Project inventory', 'Inventaris project'], ['Structures, inputs, retained outputs, trajectories, state artifacts', 'Struktur, input, output tersimpan, trajectory, artefak state']],
    [['Outside inventory', 'Di luar inventaris'], ['SQLite metadata, runtimes, logs, browser cache, other files', 'Metadata SQLite, runtime, log, cache browser, file lain']],
    [['Independent backup', 'Backup terpisah'], ['Export + verify a copy on a separate device or storage medium', 'Ekspor + verifikasi salinan di perangkat atau media terpisah']],
  ], footer: ['Local: limited by free disk space. Cloud: account quota and retention apply separately.', 'Lokal: dibatasi ruang kosong disk. Cloud: kuota akun dan retensi berlaku terpisah.'] },
  { id: 'failure-stages', title: ['Find the first failing stage', 'Temukan tahap pertama yang gagal'], subtitle: ['Retain the original input before attempting a repair.', 'Simpan input asli sebelum mencoba perbaikan.'], cards: [
    [['Before solver', 'Sebelum solver'], ['Runtime, potential, input, isolation, resource admission', 'Runtime, potential, input, isolasi, alokasi resource']],
    [['During solver', 'Saat solver berjalan'], ['First log error, exit state, memory, disk, physical model', 'Error log pertama, status keluar, memori, disk, model fisik']],
    [['Saving results', 'Menyimpan hasil'], ['Artifact availability, checksums, import and recovery status', 'Ketersediaan artefak, checksum, status impor dan pemulihan']],
  ], footer: ['No solver process means no solver result. Missing telemetry is unknown, not zero.', 'Tanpa proses solver tidak ada hasil solver. Telemetri hilang berarti tidak diketahui, bukan nol.'] },
];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const assets = [];
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 530 }, deviceScaleFactor: 1 });
  for (const [language, locale] of ['en', 'id'].entries()) for (const theme of ['light', 'dark']) for (const diagram of diagrams) {
    const dark = theme === 'dark';
    await page.setContent(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:48px;background:${dark ? '#18181b' : '#fafafa'};color:${dark ? '#f4f4f5' : '#18181b'};font:18px/1.5 "Helvetica Neue",sans-serif}h1{font-size:32px;letter-spacing:-1px;margin:0 0 8px}header p{margin:0;color:${dark ? '#a1a1aa' : '#52525b'}}.cards{display:grid;grid-template-columns:repeat(${diagram.cards.length},1fr);gap:20px;margin:32px 0}.card{border:1px solid ${dark ? '#3f3f46' : '#d4d4d8'};border-top:3px solid ${dark ? '#93c5fd' : '#356ae6'};border-radius:8px;padding:22px 20px;background:${dark ? '#202024' : '#ffffff'};min-height:170px}.card h2{margin:0 0 12px;font-size:20px}.card p{margin:0;font-size:16px;color:${dark ? '#d4d4d8' : '#52525b'}}footer{border-top:1px solid ${dark ? '#3f3f46' : '#d4d4d8'};padding-top:20px;font-size:16px}small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:${dark ? '#93c5fd' : '#356ae6'};margin-bottom:12px}
      </style><body><header><small>Phynite Lab / ${locale === 'id' ? 'Diagram konsep' : 'Concept diagram'}</small><h1>${escape(diagram.title[language])}</h1><p>${escape(diagram.subtitle[language])}</p></header><div class="cards">${diagram.cards.map(card => `<section class="card"><h2>${escape(card[0][language])}</h2><p>${escape(card[1][language])}</p></section>`).join('')}</div><footer>${escape(diagram.footer[language])}</footer></body></html>`);
    const file = `${diagram.id}-${locale}-${theme}.png`;
    const bytes = await page.screenshot({ path: `${output}/${file}`, fullPage: true });
    assets.push({ file, locale, theme, kind: 'concept', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash('sha256').update(bytes).digest('hex') });
  }
} finally { await browser.close(); }
await writeFile(`${output}/manifest.json`, JSON.stringify({ format: 'phynite-guide-concept-diagrams', schemaVersion: 1, assets }, null, 2) + '\n');
console.log(`Rendered ${assets.length} bilingual concept diagrams.`);

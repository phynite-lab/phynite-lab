import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safe = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');

export function validateBundledNoticeReport(report) {
  if (!report || report.schemaVersion !== 1 || report.format !== 'phynite-bundled-js-notices' || report.complete !== true || report.missing?.length
      || !['client', 'rsc', 'ssr'].includes(report.environment) || !Array.isArray(report.packages) || report.packages.length > 1000
      || !Array.isArray(report.chunks) || !report.chunks.length || report.chunks.length > 10000 || !Array.isArray(report.assets)) throw new Error('Bundled dependency notice evidence is incomplete or unsupported.');
  const outputs = new Set();
  for (const entry of [...report.chunks, ...report.assets]) {
    if (!safe(entry?.path) || outputs.has(entry.path) || !validHash(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new Error('Invalid emitted chunk/asset notice binding.');
    outputs.add(entry.path);
  }
  const packages = new Set();
  for (const item of report.packages) {
    const key = `${item?.name}@${item?.version}`;
    if (typeof item?.name !== 'string' || typeof item.version !== 'string' || packages.has(key) || !Array.isArray(item.notices) || !item.notices.length
        || !Array.isArray(item.modules) || !item.modules.length || item.modules.some(module => !safe(module?.path) || !validHash(module.sha256))) throw new Error('Invalid rendered dependency source/notice record.');
    packages.add(key);
    for (const notice of item.notices) if (typeof notice?.name !== 'string' || typeof notice.text !== 'string' || !notice.text.trim() || !validHash(notice.sha256) || hash(notice.text) !== notice.sha256) throw new Error('Bundled original license notice checksum mismatch.');
  }
  return report;
}

export function validateBundledNoticeIndex(index) {
  if (!index || index.schemaVersion !== 1 || index.format !== 'phynite-bundled-js-notice-index' || !Array.isArray(index.reports) || index.reports.length !== 3
      || index.reports.map(report => report.environment).sort().join(',') !== 'client,rsc,ssr' || !Array.isArray(index.packages)
      || index.reports.some(report => !safe(report.path) || !report.path.startsWith('app/dist/') || !report.path.endsWith('/phynite-bundled-notices.json') || !validHash(report.sha256))) throw new Error('All emitted client and server bundled notice reports are required.');
  return index;
}

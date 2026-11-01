/** Validate build evidence, never infer a native component's license by filename. */
const HASH = /^[a-f0-9]{64}$/;
const text = value => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const relative = value => text(value) && !value.includes('\\') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

export function validateNativeInventory(document, executableSha256, noticesSha256) {
  const fail = () => { throw new Error('The frozen core native inventory or its notice/checksum binding is invalid.'); };
  if (!document || document.schemaVersion !== 1 || !HASH.test(executableSha256 ?? '') || document.executableSha256 !== executableSha256
      || !HASH.test(noticesSha256 ?? '') || document.noticesSha256 !== noticesSha256 || document.builder?.name !== 'PyInstaller' || !text(document.builder.version)
      || !Array.isArray(document.nativeFiles) || !document.nativeFiles.length || document.nativeFiles.length > 10000
      || !Array.isArray(document.components) || !document.components.length || document.components.length > 1000) fail();
  const providers = new Set(), names = new Set();
  for (const component of document.components) {
    if (!text(component?.id) || providers.has(component.id) || !['wheel', 'python', 'homebrew', 'debian'].includes(component.kind)
        || !text(component.name) || !text(component.version) || !component.provenance || typeof component.provenance !== 'object'
        || !Array.isArray(component.notices) || !component.notices.length
        || component.notices.some(notice => !relative(notice?.name) || !HASH.test(notice.sha256 ?? ''))) fail();
    providers.add(component.id);
    if (component.kind === 'wheel' && component.name.toLowerCase() === 'lxml') {
      const evidence = component.staticSourceEvidence;
      if (!evidence || evidence.manifest !== 'distribution/notices/native/lxml-static-sources.json' || !HASH.test(evidence.manifestSha256 ?? '')
          || evidence.rebuildScript !== 'scripts/rebuild-lxml-native.py' || !Array.isArray(evidence.archives) || evidence.archives.length !== 5
          || [...new Set(evidence.archives.map(entry => entry.name))].sort().join(',') !== 'libiconv,libxml2,libxslt,lxml,zlib') fail();
      for (const archive of evidence.archives) {
        if (!relative(archive.path) || !archive.path.startsWith('distribution/sources/native/') || !HASH.test(archive.sha256 ?? '')
            || !text(archive.version) || !Number.isSafeInteger(archive.bytes) || archive.bytes < 1) fail();
      }
    }
  }
  for (const file of document.nativeFiles) {
    if (!relative(file?.path) || names.has(file.path) || !HASH.test(file.sha256 ?? '') || !HASH.test(file.sourceSha256 ?? '')
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !providers.has(file.provider)) fail();
    names.add(file.path);
  }
  return document;
}

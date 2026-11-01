'use client';

import { useState } from 'react';
import { phyniteCalculations, type PhyniteResultArtifact } from '@/lib/phynite-api';
import { collectResultArtifacts } from '@/lib/result-artifacts';
import { buildStudyReplayPackage, studyModelDependencies } from '@/lib/study-evidence';
import { downloadMdFile } from '@/lib/md-workspace';

export function DftStudyDownload({ calculationId, name }: { calculationId: string; name: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [inventory, setInventory] = useState<PhyniteResultArtifact[] | null>(null);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const [response, submission] = await Promise.all([phyniteCalculations.get(calculationId), phyniteCalculations.files(calculationId)]);
      if (!response.result || response.artifactsExpired) throw new Error('Full run artifacts are unavailable. Use the retained research dataset and original study archive.');
      const artifacts = await collectResultArtifacts(cursor => phyniteCalculations.artifactPage(calculationId, cursor), response.result.artifactPagination?.manifestSha256);
      setInventory(artifacts);
      if (!artifacts.length || artifacts.some(file => !file.sha256 || file.sizeBytes === undefined || !file.downloadUrl)) throw new Error('This legacy result has no complete artifact checksum/size manifest. Download and audit its files separately.');
      if (artifacts.reduce((sum, file) => sum + file.sizeBytes!, 0) + submission.files.reduce((sum, file) => sum + file.sizeBytes, 0) > 200000000) throw new Error('This run exceeds the 200 MB browser package limit. Download large workspace archives separately and retain the manifest hashes.');
      const files = [];
      for (const artifact of artifacts) {
        const fetched = await fetch(artifact.downloadUrl, { cache: 'no-store', credentials: artifact.downloadUrl.startsWith('/api/') ? 'same-origin' : 'omit' });
        if (!fetched.ok) throw new Error(`Could not download ${artifact.path}.`);
        const bytes = new Uint8Array(await fetched.arrayBuffer());
        if (bytes.length !== artifact.sizeBytes) throw new Error(`Study artifact size mismatch: ${artifact.path}.`);
        files.push({ path: `executed/${artifact.path}`, bytes, sha256: artifact.sha256, role: artifact.role });
      }
      for (const file of submission.files) files.push({ path: `submitted/${file.path}`, bytes: new TextEncoder().encode(file.content), sha256: undefined, role: file.role });
      const manifest = { ...response.result, artifactPagination: undefined, artifacts: artifacts.map(file => Object.fromEntries(Object.entries(file).filter(([key]) => !['downloadUrl', 'viewUrl'].includes(key)))) };
      files.push({ path: 'runtime/result-manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), sha256: undefined, role: 'runtime' });
      const archive = await buildStudyReplayPackage(files, { domain: 'dft', name, runId: calculationId, dependencies: studyModelDependencies(response.result.provenance, files) });
      downloadMdFile(`${calculationId}-study.zip`, new Uint8Array(archive), 'application/zip');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Study package could not be downloaded.'); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 text-[10px]"><button type="button" className="lab-secondary-button" disabled={busy} onClick={() => void download()}>{busy ? 'Collecting study files…' : 'Download study files'}</button>{error && <p role="alert" className="mt-1 text-[var(--danger)]">{error}</p>}{inventory && <details className="mt-2"><summary>All {inventory.length.toLocaleString()} retained artifacts</summary><div className="mt-1 max-h-48 overflow-auto">{inventory.map(file => <div key={file.path} className="min-w-0 py-1">{file.downloadUrl ? <a className="break-all underline" href={file.downloadUrl} download>{file.path}</a> : file.path}<span className="block break-all text-[var(--muted-ink)]">{file.sizeBytes?.toLocaleString()} bytes · SHA-256 {file.sha256 ?? 'unavailable'}</span></div>)}</div></details>}</div>;
}

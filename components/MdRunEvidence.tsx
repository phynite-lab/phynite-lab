'use client';

import { useState } from 'react';
import { phyniteMdSimulations, type MdSimulationArtifact, type MdSimulationRun } from '@/lib/phynite-api';
import { buildStudyReplayPackage, readMdThermoEvidence, studyModelDependencies } from '@/lib/study-evidence';
import { downloadMdFile } from '@/lib/md-workspace';
import { mdCloudSha256 } from '@/lib/md-cloud-api';
import { MdThermoEvidencePlot, type MdEquilibrationWindow } from './MdThermoEvidencePlot';

type RunResult = { status?: string; error?: string; summary?: Record<string, unknown>; provenance?: Record<string, unknown>; workflow?: { stages?: Array<{ id: string; kind: string; qualityEvidence?: Record<string, unknown>; geometryConverged?: boolean | null; minimizations?: unknown[]; mechanicalDefinition?: string }> }; artifacts?: MdSimulationArtifact[] };

export function MdRunEvidence({ job }: { job: MdSimulationRun }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [thermo, setThermo] = useState<Array<Record<string, number>> | null>(null);
  const load = async () => {
    setBusy(true); setError('');
    try {
      const response = await phyniteMdSimulations.get(job.id);
      if (!response.result) throw new Error('Run evidence is unavailable. Retain solver logs and input before artifact expiry.');
      setResult(response.result as RunResult);
      setThermo(null);
      const file = response.result.artifacts?.find(artifact => artifact.path === 'thermo.json');
      if (file?.downloadUrl) {
        if (file.sizeBytes > 20000000) throw new Error('Thermo history is too large for the browser plot; download its verified file separately.');
        const fetched = await fetch(file.downloadUrl);
        if (!fetched.ok) throw new Error('The thermo evidence file could not be downloaded.');
        const bytes = await fetched.arrayBuffer();
        if (bytes.byteLength !== file.sizeBytes || await mdCloudSha256(bytes) !== file.sha256) throw new Error('Thermo evidence failed its size/checksum verification.');
        setThermo(readMdThermoEvidence(JSON.parse(new TextDecoder().decode(bytes))));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Run evidence could not be loaded.'); }
    finally { setBusy(false); }
  };
  const exportStudy = async () => {
    if (!result) return;
    setBusy(true); setError('');
    try {
      // Refresh access immediately before downloading; identity/hash checks are
      // performed against the server's current owner-scoped artifact manifest.
      const fresh = await phyniteMdSimulations.get(job.id);
      const artifacts = fresh.result?.artifacts ?? [];
      if (!artifacts.length || artifacts.some(file => !file.downloadUrl)) throw new Error('The run has no complete downloadable artifact list.');
      if (artifacts.reduce((sum, file) => sum + file.sizeBytes, 0) > 200000000) throw new Error('This run exceeds the 200 MB browser package limit. Download large trajectories separately and retain the manifest hashes.');
      const files = [];
      for (const artifact of artifacts) {
        const response = await fetch(artifact.downloadUrl!);
        if (!response.ok) throw new Error(`Could not download ${artifact.path}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== artifact.sizeBytes) throw new Error(`Study artifact size mismatch: ${artifact.path}.`);
        files.push({ path: artifact.path, bytes, sha256: artifact.sha256, role: artifact.role });
      }
      const cleanResult = { ...fresh.result, artifacts: artifacts.map(artifact => Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'downloadUrl'))) };
      files.push({ path: 'runtime/result-manifest.json', bytes: new TextEncoder().encode(JSON.stringify(cleanResult, null, 2)), role: 'runtime' });
      const archive = await buildStudyReplayPackage(files, { domain: 'md', name: job.name, runId: job.id, dependencies: studyModelDependencies((fresh.result as RunResult).provenance, files) });
      downloadMdFile(`${job.id}-study.zip`, new Uint8Array(archive), 'application/zip');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Study package could not be downloaded.'); }
    finally { setBusy(false); }
  };
  const windows: MdEquilibrationWindow[] = (result?.workflow?.stages ?? []).flatMap(stage => {
    const value = stage.qualityEvidence?.equilibrationDiagnostic as Record<string, unknown> | undefined;
    if (!value || typeof value.status !== 'string') return [];
    const range = value.stageRangePs as number[] | undefined;
    const candidate = value.candidateWindow as { startPs: number; endPs: number } | undefined;
    return [{ id: stage.id, kind: stage.kind, status: value.status,
      range: range?.length === 2 && range.every(Number.isFinite) ? range as [number, number] : undefined,
      candidate: candidate && Number.isFinite(candidate.startPs) && Number.isFinite(candidate.endPs) ? candidate : undefined,
      reason: typeof value.reason === 'string' ? value.reason : undefined }];
  });
  return <section className="grid gap-2 text-xs">
    <div className="flex flex-wrap gap-2"><button className="md-text-button" disabled={busy} onClick={() => void load()}>{busy ? 'Reading evidence…' : 'Run evidence'}</button>{result && <button className="md-text-button" disabled={busy} onClick={() => void exportStudy()}>Download study files</button>}</div>
    {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
    {thermo && <MdThermoEvidencePlot rows={thermo} windows={windows} />}
    {result?.artifacts?.length ? <details><summary>Retained files and checksums</summary><ul className="grid gap-1 pt-2">{result.artifacts.map(file => <li key={file.path} className="min-w-0">{file.downloadUrl ? <a href={file.downloadUrl} download className="underline">{file.label || file.path}</a> : file.path}<small className="block break-all text-[var(--surface-muted)]">{file.sizeBytes.toLocaleString()} bytes · SHA-256 {file.sha256}</small></li>)}</ul></details> : null}
    {result && <><p>{result.status === 'completed' ? 'Process completed. Numerical refinement and physical model validation require study evidence.' : `Run ${result.status ?? 'diagnostics'}. ${result.error ?? 'Inspect retained logs and recovery checkpoints before continuing.'}`}</p>{result.workflow?.stages?.map(stage => <details key={stage.id}><summary>{stage.kind} · {stage.id}{stage.geometryConverged !== undefined ? ` · geometry ${stage.geometryConverged === true ? 'converged' : stage.geometryConverged === false ? 'not converged' : 'unassessed'}` : ''}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-soft)] p-2">{JSON.stringify({ quality: stage.qualityEvidence ?? { status: 'unavailable' }, minimization: stage.minimizations, loading: stage.mechanicalDefinition }, null, 2)}</pre></details>)}<details><summary>Runtime, model and source provenance</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-soft)] p-2">{JSON.stringify(result.provenance ?? { status: 'unavailable' }, null, 2)}</pre></details></>}
  </section>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assessRefinementSeries, aggregateStudyReplicas, fitMsdDiffusion, validateStudyEvidence, type StudyEvidence } from '@/lib/study-evidence';
import { downloadMdFile } from '@/lib/md-workspace';
import { UiSelect } from './UiSelect';

export function StudyEvidenceDialog({ storageKey, onClose }: { storageKey: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  const [mode, setMode] = useState('refinement');
  const [source, setSource] = useState(() => {
    try { return typeof window === 'undefined' ? '' : localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
  const [error, setError] = useState('');
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const assess = () => {
    try {
      const parsed = JSON.parse(source);
      let measured: Record<string, unknown>;
      if (mode === 'diffusion') measured = fitMsdDiffusion(parsed.points, parsed.window, parsed.dimensions);
      else {
        const study: StudyEvidence = validateStudyEvidence(parsed);
        measured = mode === 'replicas' ? aggregateStudyReplicas(study) : assessRefinementSeries(study);
      }
      setReport({ schemaVersion: 1, analysisVersion: 'phynite-study-evidence-1', kind: mode, measured, source: parsed });
      setError('');
      try { localStorage.setItem(storageKey, source); } catch { setError('Device storage is unavailable. Export the evidence report to retain it.'); }
    } catch (cause) { setReport(null); setError(cause instanceof Error ? cause.message : 'Study evidence could not be assessed.'); }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="fixed inset-0 z-[115] grid place-items-center bg-black/50 p-4" role="presentation">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="study-evidence-title" className="workspace-dark-surface grid max-h-[90dvh] w-full max-w-2xl gap-3 overflow-auto rounded-xl border border-[var(--surface-border)] bg-[var(--surface-bg)] p-5 text-[var(--surface-text)]" onKeyDown={event => {
      if (event.currentTarget.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold" id="study-evidence-title">Study evidence</h2><button className="md-text-button" onClick={onClose} aria-label="Close study evidence">Close</button></div>
      <p className="text-xs text-[var(--surface-muted)]">Compare actual runs using a declared observable, model identity, physical unit and tolerance. Evidence is kept on this device for this account and project; export it with the study files.</p>
      <UiSelect value={mode} options={[{ value: 'refinement', label: 'Numerical refinement' }, { value: 'replicas', label: 'Independent replica means' }, { value: 'diffusion', label: 'MSD diffusion fit' }]} onChange={value => { setMode(value); setReport(null); }} />
      <label className="grid gap-1 text-xs">Import evidence JSON<input type="file" accept=".json" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 1000000) { setError('Evidence JSON may contain up to 1 MB.'); return; }
        setSource(await file.text()); setReport(null); setError(''); event.target.value = '';
      }} /></label>
      <details className="text-xs"><summary>Evidence fields</summary><p className="mt-2">{mode === 'diffusion' ? 'Provide points [{timePs, msdAngstrom2}], window {startPs, endPs}, and dimensions (1, 2 or 3). Use solver MSD or unwrapped positions. Choose the diffusive fitting regime; fit error does not establish sampling uncertainty.' : 'Provide schemaVersion=1, name, observable, unit, normalization, method, tolerance, refinementParameter, refinementDirection (increasing/decreasing), physicalValidation {status: unassessed or documented, reference, scope}, and runs [{runId, inputSha256, invariantSettingsSha256, modelIdentity, structureIdentity, observable, refinement, seed, initialStateSha256}]. The invariant settings hash excludes only the tested refinement parameter or replica seed/state; all other numerical and ensemble settings must agree. Refinement rows use distinct parameter values; replicas use identical settings and distinct seeds or initial states.'}</p></details>
      <label className="grid gap-1 text-xs">Measured evidence<textarea className="min-h-48 rounded border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2 font-mono text-xs" maxLength={1000000} value={source} onChange={event => { setSource(event.target.value); setReport(null); }} spellCheck={false} /></label>
      {error && <p role="alert" className="text-xs text-[var(--surface-danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2"><button className="md-text-button" disabled={!source.trim()} onClick={assess}>Assess evidence</button><button className="md-text-button" disabled={!report} onClick={() => downloadMdFile('study-evidence-report.json', JSON.stringify(report, null, 2), 'application/json')}>Export evidence report</button></div>
      {report && <pre className="max-h-64 overflow-auto rounded bg-[var(--surface-raised)] p-3 text-xs">{JSON.stringify(report.measured, null, 2)}</pre>}
    </section>
  </div>, document.body);
}

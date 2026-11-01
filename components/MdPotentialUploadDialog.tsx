'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiSelect } from './UiSelect';
import { meamLibraryOrder } from '@/lib/md-potential-mapping';

export type MdPotentialModelMetadata = {
  family: 'eam' | 'eam-alloy' | 'meam' | 'tersoff' | 'sw';
  citation: string;
  license: string;
  modelVersion: string;
  validityDomain: string;
  validationEvidence: string;
  libraryElementOrder?: string[];
};

export function MdPotentialUploadDialog({ files, family, elements, busy, onCancel, onSubmit }: {
  files: File[]; family: MdPotentialModelMetadata['family']; elements: string[]; busy: boolean;
  onCancel: () => void; onSubmit: (metadata: MdPotentialModelMetadata) => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  const [metadata, setMetadata] = useState<MdPotentialModelMetadata>({ family, citation: '', license: '', modelVersion: '', validityDomain: '', validationEvidence: '' });
  const [libraryOrderText, setLibraryOrderText] = useState('');
  let libraryElementOrder: string[] | undefined;
  let orderError = '';
  if (metadata.family === 'meam') {
    try { libraryElementOrder = meamLibraryOrder(libraryOrderText, elements); }
    catch (cause) { orderError = cause instanceof Error ? cause.message : 'Check the model element order.'; }
  }
  const required = ['citation', 'license', 'modelVersion', 'validityDomain'] as const;
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="fixed inset-0 z-[115] grid place-items-center bg-black/50 p-4" role="presentation">
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="potential-upload-title" className="workspace-dark-surface grid max-h-[90dvh] w-full max-w-lg gap-3 overflow-auto rounded-xl border border-[var(--surface-border)] bg-[var(--surface-bg)] p-5 text-[var(--surface-text)]" onSubmit={event => { event.preventDefault(); if (!orderError && required.every(key => metadata[key].trim())) onSubmit({ ...metadata, ...(libraryElementOrder ? { libraryElementOrder } : {}) }); }} onKeyDown={event => {
      if (event.currentTarget.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <button type="button" className="text-left text-xs underline" disabled={busy} onClick={() => { onCancel(); window.dispatchEvent(new Event('phynite:browse-potentials')); }}>Browse public repositories · NIST / OpenKIM</button>
      <h2 id="potential-upload-title" className="text-base font-semibold">Potential model details</h2>
      <p className="text-xs text-[var(--surface-muted)]">{files.map(file => file.name).join(' + ')} · element mapping: {elements.join(', ')}</p>
      <p className="text-xs text-[var(--surface-muted)]">The checksum verifies the uploaded file. Record its source and intended use so model suitability can be assessed for each study.</p>
      <label className="grid gap-1 text-xs">Potential family<UiSelect value={metadata.family} options={['eam', 'eam-alloy', 'meam', 'tersoff', 'sw'].map(value => ({ value, label: value.toUpperCase() }))} onChange={value => setMetadata(previous => ({ ...previous, family: value as MdPotentialModelMetadata['family'] }))} /></label>
      {metadata.family === 'meam' && <label className="grid gap-1 text-xs">MEAM parameter index order<input required aria-describedby="meam-order-help" className="rounded border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2" placeholder="For example: Ni Al" maxLength={160} value={libraryOrderText} onChange={event => setLibraryOrderText(event.target.value)} /><span id="meam-order-help" className="text-[var(--surface-muted)]">Enter all model elements in the order assigned to indices 1, 2, … by the published parameter file. Include model elements absent from this structure.</span>{libraryOrderText && orderError && <span role="alert" className="text-[var(--surface-danger)]">{orderError}</span>}</label>}
      {required.map(key => <label className="grid gap-1 text-xs" key={key}>{({ citation: 'Citation or source URL', license: 'License / usage terms', modelVersion: 'Model version or published identifier', validityDomain: 'Material, phases, properties and conditions covered' })[key]}<input required maxLength={key === 'license' ? 160 : 1000} className="rounded border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2" value={metadata[key]} onChange={event => setMetadata(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
      <label className="grid gap-1 text-xs">Validation references for the intended property (optional)<textarea maxLength={2000} className="rounded border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2" rows={3} value={metadata.validationEvidence} onChange={event => setMetadata(previous => ({ ...previous, validationEvidence: event.target.value }))} /></label>
      <p className="text-xs text-[var(--surface-muted)]">Absent validation is recorded as unassessed. A successful solver run establishes runtime compatibility.</p>
      <div className="flex justify-end gap-2"><button type="button" className="md-text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="md-text-button" disabled={busy || Boolean(orderError) || !required.every(key => metadata[key].trim())}>{busy ? 'Uploading…' : 'Upload potential'}</button></div>
    </form>
  </div>, document.body);
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import type { FigureMode } from '@/lib/research-figures';
import { LabCheckbox } from '@/components/LabControls';
import { UiSelect } from '@/components/UiSelect';

export type FigureSourceChoice = { id: string; title: string; detail: string; date: string; otherProject: boolean };

export function AddFigureDialog({ defaultName, choices, onClose, onCreate }: {
  defaultName: string;
  choices: FigureSourceChoice[];
  onClose: () => void;
  onCreate: (name: string, ids: string[], mode: FigureMode) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initialChoices] = useState(choices);
  const [name, setName] = useState(defaultName);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [allProjects, setAllProjects] = useState(false);
  const [mode, setMode] = useState<FigureMode>('grid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  const visible = initialChoices.filter((item) => (allProjects || !item.otherProject) && `${item.title} ${item.detail} ${item.date}`.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={dialog} className="research-dialog research-add-dialog" aria-labelledby="add-figure-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (busy || !selected.length || !name.trim()) return;
      setBusy(true); setError('');
      try { await onCreate(name.trim(), selected, selected.length === 1 ? 'single' : mode); onClose(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create figure. Try again.'); }
      finally { setBusy(false); }
    }}>
      <header className="research-add-heading"><span><FilePlus2 size={19} /><h2 id="add-figure-title">Add figure</h2></span><button type="button" aria-label="Close add figure" disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <p className="research-add-description">Select the results you want to plot together.</p>
      <fieldset disabled={busy}>
        <label>Figure name<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Find data<input type="search" placeholder="Search material, result or date" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <LabCheckbox className="research-picker-option research-picker-scope" checked={allProjects} onCheckedChange={setAllProjects}>Include other projects</LabCheckbox>
        <div className="research-picker-list" aria-label="Available results">
          {visible.map((item) => <LabCheckbox className="research-picker-option" key={item.id} data-selected={selected.includes(item.id)} checked={selected.includes(item.id)} onCheckedChange={() => setSelected((values) => values.includes(item.id) ? values.filter((id) => id !== item.id) : [...values, item.id])}><span><strong>{item.title}</strong><small>{item.detail}</small><small>{item.date}</small></span></LabCheckbox>)}
          {!visible.length && <div className="research-picker-empty"><strong>{query.trim() ? 'No matching results' : 'No results available'}</strong><p>{query.trim() ? 'Try a different material, result name or date.' : !allProjects && initialChoices.some((item) => item.otherProject) ? 'Enable “Include other projects” to see your other results.' : 'Complete a calculation or import data from the sidebar to get started.'}</p></div>}
        </div>
        <p className="research-picker-timezone">Run dates and times are shown in your local timezone.</p>
        {selected.length > 1 && <div><UiSelect label="Layout" value={mode} options={[{ value: 'grid', label: 'One panel per result' }, { value: 'overlay', label: 'Overlay selected results' }, { value: 'band-dos', label: 'Band + DOS pairs' }, { value: 'parameter', label: 'Parameter series' }]} onChange={(value) => setMode(value as FigureMode)} /></div>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <footer><span>{selected.length} selected</span><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="is-primary" disabled={busy || !selected.length || !name.trim()}>{busy ? 'Creating…' : 'Create figure'}</button></footer>
    </form>
  </dialog>;
}

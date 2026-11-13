'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Download, Copy, GitCompare } from 'lucide-react';
import { AiResponseContent } from './AiResponseContent';
import { AiArtifactEditing, AiArtifactPatchReview, type AiArtifactEditApi } from './AiArtifactEditing';
import { UiSelect } from './UiSelect';
import { useLocale } from '@/app/locale-provider';
import { aiArtifactComparable, aiArtifactEditableText, aiArtifactCsv, aiArtifactDiff, aiArtifactGroup, aiArtifactMarkdown } from '@/lib/ai-artifacts';
import { figureIssues, renderFigure, validateDataset, validateFigure } from '@/lib/research-figures';
import type { AiArtifact, AiArtifactSummary, AiArtifactDiff, AiArtifactFigure, AiArtifactInput, AiArtifactTable } from '@/lib/ai-workbench';

const tags = new Set(['svg', 'g', 'defs', 'clipPath', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
const attributes: Record<string, string> = Object.fromEntries(['viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'opacity', 'transform', 'id', 'role'].map(name => [name, name]));
Object.assign(attributes, { 'stroke-width': 'strokeWidth', 'stroke-dasharray': 'strokeDasharray', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', 'fill-opacity': 'fillOpacity', 'stroke-opacity': 'strokeOpacity', 'font-family': 'fontFamily', 'font-size': 'fontSize', 'font-weight': 'fontWeight', 'text-anchor': 'textAnchor', 'dominant-baseline': 'dominantBaseline', 'clip-path': 'clipPath', 'aria-label': 'aria-label' });
/** Parse inert XML and construct only reviewed SVG elements/attributes. Never insert HTML. */
function safeSvg(source: string): ReactNode {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('The figure SVG is invalid.');
  let count = 0;
  const convert = (node: Node, depth = 0): ReactNode => {
    if (++count > 100000 || depth > 40) throw new Error('The figure exceeds safe SVG rendering limits.');
    if (node.nodeType === 3) return node.textContent;
    if (!(node instanceof Element) || !tags.has(node.tagName)) return null;
    const props: Record<string, unknown> = { key: count };
    for (const attr of node.attributes) {
      const key = attributes[attr.name];
      if (key && !/javascript:|data:|https?:|expression\(|[<>]/i.test(attr.value) && (!/url\(/i.test(attr.value) || /^url\(#[A-Za-z0-9_-]+\)$/.test(attr.value))) props[key] = attr.value;
    }
    return createElement(node.tagName, props, ...Array.from(node.childNodes, child => convert(child, depth + 1)));
  };
  return convert(document.documentElement);
}
function download(text: string | Blob, filename: string, type: string) {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Code({ text }: { text: string }) {
  const lines = text.split('\n');
  return <><pre className="ai-artifact-code"><code>{lines.slice(0, 10000).map((line, i) => <span key={i} data-change={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : undefined}><small aria-hidden="true">{i + 1}</small><span className={/^\s*(?:[!#]|\/\/)/.test(line) ? 'ai-code-comment' : /^\s*&\w+/.test(line) ? 'ai-code-keyword' : undefined}>{line || ' '}</span>{'\n'}</span>)}</code></pre>{lines.length > 10000 && <p role="status">Preview limited to 10,000 lines; export retains the complete text.</p>}</>;
}
function Table({ table }: { table: AiArtifactTable }) {
  const [sort, setSort] = useState<{ key: string; direction: number }>();
  const rows = useMemo(() => !sort ? table.rows : table.rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = a.row[sort.key], right = b.row[sort.key];
    if (left == null || right == null) return left == null ? right == null ? a.index - b.index : 1 : -1;
    return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))) * sort.direction || a.index - b.index;
  }).map(item => item.row), [table, sort]);
  return <><div className="ai-table-scroll" tabIndex={0}><table><thead><tr>{table.columns.map(column => <th key={column.key} aria-sort={sort?.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort(current => ({ key: column.key, direction: current?.key === column.key ? -current.direction : 1 }))}>{column.label}{column.unit ? ` (${column.unit})` : ''}</button></th>)}</tr></thead><tbody>{rows.slice(0, 500).map((row, i) => <tr key={i}>{table.columns.map(column => <td key={column.key}>{row[column.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>{rows.length > 500 && <p>Preview: 500 of {rows.length} rows. CSV contains every row.</p>}<p>{table.sourceIds.join(' · ')}</p></>;
}

export function AiArtifactViewer({ summaries, selected, load, onSelect, onClose, onContinue, onImplement, locked, editApi, onSaved }: {
  editApi?: AiArtifactEditApi; onSaved?: (artifact: AiArtifact) => void; locked?: boolean; summaries: AiArtifactSummary[]; selected: string; load: (id: string) => Promise<AiArtifact>; onSelect: (id: string) => void; onClose: () => void; onContinue: (artifact: AiArtifact) => void; onImplement: (artifact: AiArtifact) => void;
}) {
  const { t } = useLocale();
  const root = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<{ id: string; artifact?: AiArtifact; error?: string }>();
  const [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const guard = (action: () => void) => { if (dirtyRef.current) setNotice(t('Save or discard your edits before leaving this version.', 'Simpan atau buang perubahan sebelum meninggalkan versi ini.')); else action(); };
  const saved = (artifact: AiArtifact) => { markDirty(false); setEditing(false); setNotice(''); onSaved?.(artifact); };
  const [compare, setCompare] = useState(false), [previous, setPrevious] = useState<AiArtifact>();
  const [sheet, setSheet] = useState(false), [svg, setSvg] = useState<{ id: string; text: string; node: ReactNode; error?: string }>(), [notice, setNotice] = useState('');
  const artifact = data?.id === selected ? data.artifact : undefined;
  const summary = summaries.find(item => item.id === selected);
  const versions = useMemo(() => summaries.filter(item => aiArtifactGroup(item) === (summary ? aiArtifactGroup(summary) : selected)).sort((a, b) => (a.version ?? 1) - (b.version ?? 1)), [summaries, summary, selected]);
  useEffect(() => { let live = true; void load(selected).then(artifact => { if (live) setData({ id: selected, artifact }); }).catch(error => { if (live) setData({ id: selected, error: error instanceof Error ? error.message : 'Artifact could not be read.' }); }); return () => { live = false; }; }, [selected, load]);
  useEffect(() => {
    const element = root.current, workspace = element?.closest('.ai-workspace'); if (!element || !workspace) return;
    const observer = new ResizeObserver(() => setSheet(workspace.clientWidth < 900 || window.innerWidth < 1024)); observer.observe(workspace); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null; close.current?.focus();
    return () => { if (focused?.isConnected) focused.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!sheet || !root.current) return;
    const workspace = root.current.closest('.ai-workspace');
    const siblings: HTMLElement[] = [];
    let element: HTMLElement | null = root.current;
    while (element && element !== workspace) {
      for (const sibling of Array.from(element.parentElement?.children ?? [])) if (sibling !== element && sibling instanceof HTMLElement) siblings.push(sibling);
      element = element.parentElement;
    }
    const before = siblings.map(element => element.inert); siblings.forEach(element => { element.inert = true; });
    return () => siblings.forEach((element, i) => { element.inert = before[i]; });
  }, [sheet]);
  useEffect(() => {
    let live = true;
    const index = versions.findIndex(item => item.id === selected), id = versions[index - 1]?.id;
    if (compare && id) void load(id).then(value => { if (live) setPrevious(value); }).catch(() => { if (live) setPrevious(undefined); });
    return () => { live = false; };
  }, [compare, selected, summaries, load, versions]); // Version identities are immutable.
  useEffect(() => {
    if (artifact?.kind !== 'figure_preview') return;
    let live = true;
    queueMicrotask(() => { if (!live) return; try {
      const data = artifact.structuredData as AiArtifactFigure, figure = validateFigure(data.figure), datasets = data.datasets.map(validateDataset);
      const issues = figureIssues(figure, datasets); if (issues.length) throw new Error(issues.join(' '));
      const text = renderFigure(figure, datasets); setSvg({ id: artifact.id, text, node: safeSvg(text) });
    } catch (error) { setSvg({ id: artifact.id, text: '', node: null, error: error instanceof Error ? error.message : 'Figure is invalid.' }); } });
    return () => { live = false; };
  }, [artifact]);
  const canEdit = artifact && editApi && aiArtifactEditableText(artifact) !== null, latest = versions.at(-1)?.id === artifact?.id;
  const content = artifact?.content ?? artifact?.text ?? '';
  const exportArtifact = async (png = false) => {
    if (!artifact) return;
    try {
      const name = `phynite-${artifact.id}-v${artifact.version ?? 1}`;
      if (artifact.kind === 'table') download(aiArtifactCsv(artifact.structuredData as AiArtifactTable), name + '.csv', 'text/csv');
      else if (artifact.kind === 'input_file') { const data = artifact.structuredData as AiArtifactInput; download(data.text, data.filename, 'text/plain'); }
      else if (artifact.kind === 'diff') { const data = artifact.structuredData as AiArtifactDiff; download(aiArtifactDiff(data.before, data.after, Number.MAX_SAFE_INTEGER).text, data.filename + '.diff', 'text/plain'); }
      else if (artifact.kind === 'figure_preview' && svg?.id === artifact.id && svg.text) {
        if (!png) download(svg.text, name + '.svg', 'image/svg+xml');
        else {
          const image = new Image(), url = URL.createObjectURL(new Blob([svg.text], { type: 'image/svg+xml' }));
          try { await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG conversion failed. Export SVG instead.')); image.src = url; });
            const canvas = document.createElement('canvas'); canvas.width = Math.min(5000, image.naturalWidth * 2); canvas.height = Math.min(5000, image.naturalHeight * 2); const context = canvas.getContext('2d'); if (!context) throw new Error('PNG export unavailable.'); context.drawImage(image, 0, 0, canvas.width, canvas.height); const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNG export failed.'); download(blob, name + '.png', 'image/png');
          } finally { URL.revokeObjectURL(url); }
        }
      } else download(aiArtifactMarkdown(artifact), name + '.md', 'text/markdown');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.'); }
  };
  let body: ReactNode = artifact ? <AiResponseContent text={content} /> : <p role="status">{t('Reading saved artifact…', 'Membaca artifact tersimpan…')}</p>;
  if (artifact && compare && previous && aiArtifactGroup(previous) === aiArtifactGroup(artifact) && (previous.version ?? 1) === (artifact.version ?? 1) - 1) body = <Code text={aiArtifactDiff(aiArtifactComparable(previous), aiArtifactComparable(artifact)).text} />;
  else if (artifact?.kind === 'table') body = <Table table={artifact.structuredData as AiArtifactTable} />;
  else if (artifact?.kind === 'input_file') { const input = artifact.structuredData as AiArtifactInput; body = <><Code text={input.text} />{input.validation && <p>{input.validation.note} {input.validation.issues.join(' ')}</p>}</>; }
  else if (artifact?.kind === 'diff') { const diff = artifact.structuredData as AiArtifactDiff; body = <Code text={aiArtifactDiff(diff.before, diff.after).text} />; }
  else if (artifact?.kind === 'figure_preview') body = svg?.id !== artifact.id ? <p role="status">Rendering saved figure…</p> : svg?.error ? <p role="alert">{svg.error}</p> : <div className="ai-artifact-figure">{svg?.node}</div>;
  return <aside ref={root} className="ai-artifact-viewer" data-ui-portal data-sheet={sheet} role={sheet ? 'dialog' : 'complementary'} aria-modal={sheet || undefined} aria-label={t('Research artifact', 'Artifact riset')} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); guard(onClose); }
    if (sheet && event.key === 'Tab') { const focusable = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"], select') ?? []).filter(element => element.getClientRects().length); const index = focusable.indexOf(document.activeElement as HTMLElement); if (event.shiftKey && index <= 0 || !event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus(); } }
  }}><header><div><strong>{artifact?.title ?? summary?.title ?? t('Research artifact', 'Artifact riset')}</strong><small>{artifact?.kind ?? summary?.kind} · {artifact?.status ?? summary?.status}</small></div><button ref={close} type="button" onClick={() => guard(onClose)} aria-label={t('Close artifact', 'Tutup artifact')}><X size={18} /></button></header>
    <div className="ai-artifact-toolbar"><UiSelect compact ariaLabel={t('Artifact version', 'Versi artifact')} value={selected} options={versions.map(item => ({ value: item.id, label: `v${item.version ?? 1} · ${item.status}` }))} onChange={id => guard(() => { setEditing(false); onSelect(id); })} />
      {canEdit && <button type="button" disabled={editing || !latest} onClick={() => { setCompare(false); setEditing(true); }}>{t('Edit', 'Edit')}</button>}<button type="button" disabled={editing || versions.findIndex(item => item.id === selected) < 1} aria-pressed={compare} onClick={() => setCompare(value => !value)}><GitCompare size={15} />{t('Compare', 'Bandingkan')}</button><button type="button" disabled={!artifact} onClick={() => void exportArtifact()}><Download size={15} />{t('Export', 'Ekspor')}</button>{artifact?.kind === 'figure_preview' && <button type="button" onClick={() => void exportArtifact(true)}>PNG</button>}
      <button type="button" disabled={!artifact} onClick={() => { void navigator.clipboard.writeText(artifact?.kind === 'input_file' ? (artifact.structuredData as AiArtifactInput).text : content).then(() => setNotice(t('Copied', 'Disalin'))).catch(() => setNotice(t('Copy unavailable; use Export.', 'Salin tidak tersedia; gunakan Ekspor.'))); }} aria-label={t('Copy artifact', 'Salin artifact')}><Copy size={15} /></button></div>
    <div className="ai-artifact-body">{data?.id === selected && data.error ? <p role="alert">{data.error}</p> : editing && canEdit ? <AiArtifactEditing key={artifact.id} artifact={artifact} latest={latest} api={editApi} onSaved={saved} onDirty={markDirty} onPreview={() => setEditing(false)} /> : body}{artifact && canEdit && <AiArtifactPatchReview key={artifact.artifactGroupId ?? artifact.id} artifact={artifact} api={editApi} disabled={dirty} onSaved={saved} />}{notice && <p role="status">{notice}</p>}{artifact && <details><summary>{t('Sources and provenance', 'Sumber dan provenance')}</summary><pre>{JSON.stringify({ sha256: artifact.sha256, sourceStamp: artifact.sourceStamp, modelId: artifact.modelId, author: artifact.author, change: artifact.change, context: artifact.contextManifest, evidence: artifact.evidence }, null, 2)}</pre></details>}</div>
    <footer><span>{t('Saved deliverable · does not apply or execute inputs', 'Hasil tersimpan · tidak menerapkan atau menjalankan input')}</span>{artifact?.kind === 'plan' && artifact.status === 'complete' && <button type="button" disabled={locked || dirty} onClick={() => guard(() => onImplement(artifact))}>{t('Implement plan', 'Terapkan rencana')}</button>}{artifact && ['research', 'report'].includes(artifact.kind) && <button type="button" disabled={locked || dirty} onClick={() => guard(() => onContinue(artifact))}>{t('Continue research', 'Lanjutkan riset')}</button>}</footer>
  </aside>;
}

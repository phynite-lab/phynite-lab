'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronRight, CircleDashed, Download, FileCode2, GitCompareArrows, Layers, Play, X } from 'lucide-react';
import { MlipJobStatus } from './MlipJobStatus';
import { useLocale } from '@/app/locale-provider';
import { aiFieldChanges, aiFieldLabel } from '@/lib/ai-action-summary';
import type { AiAction } from '@/lib/ai-contract';
import type { FigureDocument, ResearchDataset } from '@/lib/research-figures';

/** Values remain exact, including scientific input whitespace, units and identifiers. */
function DataValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === undefined) return <span className="ai-value-empty">—</span>;
  if (value === null || typeof value !== 'object') {
    const text = typeof value === 'string' ? value : String(value);
    return text.includes('\n') || text.length > 120 ? <pre>{text}</pre> : <span className="ai-value">{text || '""'}</span>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <code>{Array.isArray(value) ? '[]' : '{}'}</code>;
  if (depth >= 3) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return <dl className="ai-data-grid">{entries.slice(0, 40).map(([key, item]) => <div key={key}><dt title={key}>{Array.isArray(value) ? Number(key) + 1 : aiFieldLabel(key)}</dt><dd><DataValue value={item} depth={depth + 1} /></dd></div>)}{entries.length > 40 && <div><dt>…</dt><dd><details><summary>{entries.length - 40} more</summary><pre>{JSON.stringify(Object.fromEntries(entries.slice(40)), null, 2)}</pre></details></dd></div>}</dl>;
}
function PreviewValues({ value }: { value: unknown }) {
  const changes = value && typeof value === 'object' && 'changes' in value ? value.changes : null;
  if (!Array.isArray(changes)) return <DataValue value={value} />;
  return <div className="ai-preview-modules">{changes.map((change, index) => {
    const node = change && typeof change === 'object' ? change.after : null;
    return <section key={index}>{node && typeof node === 'object' && typeof node.name === 'string' && <strong>{node.name}</strong>}<DataValue value={node && typeof node === 'object' && 'configuration' in node ? node.configuration : change} /></section>;
  })}</div>;
}
function Disclosure({ title, icon, children, open = false }: { title: string; icon: ReactNode; children: ReactNode; open?: boolean }) {
  return <details className="ai-action-disclosure" open={open || undefined}><summary>{icon}<span>{title}</span><ChevronRight className="ai-disclosure-chevron" size={15} /></summary><div className="ai-action-detail">{children}</div></details>;
}
async function actionRequest<T>(conversation: string, action: string, query = ''): Promise<T> {
  const response = await fetch(`/api/ai/conversations/${conversation}/actions/${action}${query}`, { cache: 'no-store' });
  const data = await response.json() as T & { error?: string; code?: string; requestId?: string };
  if (!response.ok) throw new Error(`${data.error ?? 'The action could not be read.'}${data.code ? ` [${data.code}]` : ''}${data.requestId ? ` · ${data.requestId}` : ''}`);
  return data;
}
export function AiActionCard({ action, conversationId, locked, onDecision, onCanvas }: { action: AiAction; conversationId: string; locked: boolean; onDecision: (action: AiAction, decision: 'approve' | 'reject') => Promise<void>; onCanvas?: (ids: string[]) => void }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<unknown>(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const pending = action.status === 'pending';
  const rawChanges = (action.after as { changes?: unknown } | null)?.changes;
  const changes = Array.isArray(rawChanges) ? rawChanges.filter((item): item is { nodeId: string; name?: string; operation: string; before: unknown; after: unknown } => !!item && typeof item === 'object' && typeof item.nodeId === 'string') : [];
  const review = async () => { setLoading(true); setError(''); try { setPreview((await actionRequest<{ preview: unknown }>(conversationId, action.id)).preview); } catch (failure) { setError((failure as Error).message); } finally { setLoading(false); } };
  const download = async () => {
    setLoading(true); setError('');
    try {
      const { exportDocument } = await actionRequest<{ exportDocument: { figure: FigureDocument; datasets: ResearchDataset[]; format: 'svg' | 'png' | 'pdf' | 'zip'; revision: number } }>(conversationId, action.id, '?export=1');
      const { exportFigure } = await import('@/lib/figure-export');
      await exportFigure(exportDocument.figure, exportDocument.datasets, exportDocument.format, exportDocument.figure.rasterDpi ?? 600, exportDocument.revision);
    } catch (failure) { setError((failure as Error).message); } finally { setLoading(false); }
  };
  const status = { pending: t('Awaiting approval', 'Menunggu persetujuan'), executing: t('Executing', 'Mengeksekusi'), succeeded: t('Action completed', 'Aksi selesai'), failed: t('Action failed', 'Aksi gagal'), rejected: t('Rejected', 'Ditolak'), expired: t('Approval expired', 'Persetujuan kedaluwarsa'), superseded: t('Replaced by new direction', 'Digantikan arahan baru') }[action.status];
  return <section className="ai-action" data-status={action.status} aria-label={t('Research action', 'Aksi riset')}>
    <header><span className="ai-action-status">{action.status === 'succeeded' ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}{status}</span><code title={`SHA-256: ${action.payloadHash}`}>{action.payloadHash.slice(0, 12)}</code></header>
    <div className="ai-action-heading"><strong>{action.title}</strong><p>{action.kind === 'mcp_call' ? t('Tool on this computer · exact arguments below', 'Tool di komputer ini · argumen lengkap di bawah') : action.kind.startsWith('run_') ? t('Compute: Your computer', 'Komputasi: Komputer Anda') : t('Changes in this project', 'Perubahan dalam project ini')}</p></div>
    {!!changes.length && <div className="ai-action-modules">{changes.map((change, index) => <div key={`${change.nodeId}:${index}`}><Layers size={14} /><span>{change.name ?? change.nodeId}</span><small>{change.operation === 'add' ? t('Add module', 'Tambah modul') : change.operation === 'remove' ? t('Remove module', 'Hapus modul') : t('Update module', 'Ubah modul')}</small></div>)}</div>}
    <div className="ai-action-sections">
      <Disclosure title={t('Before and after', 'Sebelum dan sesudah')} icon={<GitCompareArrows size={15} />}>
        <div className="ai-diff-scroll"><table className="ai-diff-table"><thead><tr><th>{t('Parameter', 'Parameter')}</th><th>{t('Before', 'Sebelum')}</th><th><ArrowRight size={12} aria-hidden="true" />{t('After', 'Sesudah')}</th></tr></thead><tbody>{(changes.length ? changes : [{ nodeId: '', name: '', before: action.before, after: action.after }]).flatMap(change => aiFieldChanges(change.before, change.after).filter(field => change.before != null || !['kind','name','position.x','position.y','resources'].includes(field.path)).map(field => <tr key={`${change.nodeId}:${field.path}`}><th title={field.path}>{change.name && <small>{change.name}</small>}{aiFieldLabel(field.path) || t('Value', 'Nilai')}</th><td data-change={field.before !== undefined ? "removed" : undefined}>{field.before !== undefined && <span className="ai-diff-marker" aria-hidden="true">−</span>}<DataValue value={field.before} /></td><td data-change={field.after !== undefined ? "added" : undefined}>{field.after !== undefined && <span className="ai-diff-marker" aria-hidden="true">+</span>}<DataValue value={field.after} /></td></tr>))}</tbody></table></div>
        <details className="ai-raw-data"><summary>{t('Exact source data', 'Data sumber lengkap')}</summary><pre>{JSON.stringify({ before: action.before, after: action.after }, null, 2)}</pre></details>
      </Disclosure>
      {preview !== undefined && <Disclosure title={t('Input and parameters', 'Input dan parameter')} icon={<FileCode2 size={15} />} open><PreviewValues value={preview} /><details className="ai-raw-data"><summary>{t('Exact payload · SHA-256', 'Payload lengkap · SHA-256')}</summary><code>{action.payloadHash}</code><pre>{JSON.stringify(preview, null, 2)}</pre></details></Disclosure>}
      {action.result && <Disclosure title={t('Execution result', 'Hasil eksekusi')} icon={<Play size={15} />}><DataValue value={action.result} /></Disclosure>}
    </div>
    {action.status === 'succeeded' && action.kind === 'run_mlip' && typeof action.result?.mlipId === 'string' && <MlipJobStatus conversationId={conversationId} jobId={action.result.mlipId} />}
    <footer className="ai-action-footer"><button className="ai-review-button" onClick={() => void review()} disabled={loading}><FileCode2 size={14} />{t('Review exact input', 'Tinjau input lengkap')}</button>
      {action.status === 'succeeded' && action.kind === 'save_workflow' && Array.isArray(action.result?.nodeIds) && <button className="ai-review-button" onClick={() => onCanvas?.((action.result!.nodeIds as unknown[]).filter((id): id is string => typeof id === 'string'))}>{t('Show changes on Canvas', 'Lihat perubahan di Kanvas')}<ArrowRight size={14} /></button>}
      {action.status === 'succeeded' && action.kind === 'export_figure' && <button className="ai-button" disabled={loading} onClick={() => void download()}><Download size={14} />{t('Download figure', 'Unduh figure')}</button>}
    </footer>
    {pending && <div className="ai-action-buttons"><button className="ai-button" disabled={locked || loading || preview === undefined} onClick={() => void onDecision(action, 'approve')}><Check size={14} />{t('Approve action', 'Setujui aksi')}</button><button className="ai-button ai-button-secondary" disabled={locked || loading} onClick={() => void onDecision(action, 'reject')}><X size={14} />{t('Reject', 'Tolak')}</button></div>}
    {action.error && <p className="ai-action-error" role="alert">{action.error}</p>}{error && <p className="ai-action-error" role="alert">{error}</p>}
  </section>;
}

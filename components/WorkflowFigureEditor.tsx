'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Check, CircleAlert, LoaderCircle, Network, RefreshCw } from 'lucide-react';
import { FiguresWorkspace } from './FiguresWorkspace';
import { WorkspaceLoading } from './WorkspaceLoading';
import { createFigure, researchHash } from '@/lib/research-figures';
import { loadFigureDrafts, loadResearch, saveFigureDraft, saveResearch } from '@/lib/research-storage';
import { applyWorkflowFigureStyle, workflowFigureStyle, workflowFigureDatasets } from '@/lib/workflow-figure';
import { workflowFigureBinding, workflowFigureInputs, workflowFigurePhase } from '@/lib/workflow-figure-state';
import type { ProjectWorkflow, WorkflowAttempt, WorkflowNode } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';

export function WorkflowFigureEditor({ owner, projectId, projectName, node, graph, attempts, attempt, onClose, onCanvas, onOpenSource, onRun, runDisabled, onStyleChange }: {
  owner: string; projectId: string; projectName: string; node: WorkflowNode; graph: ProjectWorkflow; attempts: WorkflowAttempt[];
  attempt?: WorkflowAttempt; onClose: () => void; onCanvas: () => void; onOpenSource?: (id: string) => void;
  onRun: () => void; runDisabled: boolean; onStyleChange: (style: Record<string, unknown>) => void;
}) {
  const { t } = useLocale(), { theme } = useSiteTheme();
  const [loaded, setLoaded] = useState<{ key: string; figureId?: string; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const styleRef = useRef(node.configuration.style);
  useEffect(() => { styleRef.current = node.configuration.style; }, [node.configuration.style]);
  const presentation = useEffectEvent(() => ({ name: node.name, style: styleRef.current }));
  const phase = workflowFigurePhase(attempt);
  const resultJson = JSON.stringify(attempt?.result ?? null);
  const bindingKey = JSON.stringify([owner, projectId, node.id, resultJson, retry]);
  const current = loaded?.key === bindingKey ? loaded : null;
  const inputs = workflowFigureInputs(graph, node.id, attempts);

  useEffect(() => {
    if (phase !== 'ready') return;
    let live = true;
    void (async () => {
      const binding = workflowFigureBinding(JSON.parse(resultJson));
      const stableId = `wf_${(await researchHash(`${projectId}:${node.id}:${binding.figureRevision}`)).slice(0, 40)}`;
      // Open a local revision immediately; check cloud before creating a replacement.
      const [local, drafts] = await Promise.all([loadResearch(owner, false), loadFigureDrafts(owner, projectId)]);
      if (!live) return;
      const hasLocalFigure = local.records.some(record => record.collection === 'figures' && record.document.id === stableId) || drafts.some(draft => draft.id === stableId);
      const { records } = hasLocalFigure ? local : await loadResearch(owner);
      if (!live) return;
      if (!records.some(record => record.collection === 'figures' && record.document.id === stableId) && !drafts.some(draft => draft.id === stableId)) {
        const sources = await workflowFigureDatasets(projectId, binding.sources);
        if (!live) return;
        for (const dataset of sources) {
          dataset.id = `wfds_${(await researchHash(`${projectId}:${dataset.source.calculationId ?? dataset.metadata.provenance?.analysisId ?? 'input'}:${dataset.source.sha256}:${dataset.source.filename}`)).slice(0, 40)}`;
          if (!records.some(record => record.collection === 'datasets' && record.document.id === dataset.id)) await saveResearch(owner, 'datasets', dataset);
        }
        if (!live) return;
        const { name, style } = presentation();
        const figure = applyWorkflowFigureStyle({ ...createFigure(projectId, sources, 'grid', name), id: stableId }, style);
        await saveFigureDraft(owner, figure);
      }
      if (live) setLoaded({ key: bindingKey, figureId: stableId });
    })().catch(failure => { if (live) setLoaded({ key: bindingKey, error: failure instanceof Error ? failure.message : 'Figure data could not be loaded.' }); });
    return () => { live = false; };
  }, [owner, projectId, node.id, phase, resultJson, bindingKey]);

  if (phase === 'ready' && current?.figureId) return <div className="workflow-bound-figure">
    {attempt?.outdated && <p className="workflow-editor-notice">{t('Sources changed. You are viewing the previous Figure revision.', 'Sumber berubah. Anda melihat revisi Figure sebelumnya.')} <button disabled={runDisabled} onClick={onRun}>{t('Review update', 'Tinjau pembaruan')}</button></p>}
    <FiguresWorkspace key={current.figureId} embedded ownerId={owner} projectId={projectId} projectName={projectName} jobs={[]} initialFigureId={current.figureId} onWorkflowFigureChange={figure => { const style = workflowFigureStyle(figure); if (JSON.stringify(style) !== JSON.stringify(styleRef.current)) { styleRef.current = style; onStyleChange(style); } }} onClose={onClose} theme={theme} />
  </div>;

  const loading = phase === 'ready' && !current;
  const failed = phase === 'failed' || Boolean(current?.error);
  const running = phase === 'running';
  const title = loading ? t('Opening your figure', 'Membuka Figure Anda') : current?.error ? t('Couldn’t load figure data', 'Data Figure belum dapat dimuat') : failed ? t('Figure data isn’t ready', 'Data Figure belum siap') : running ? t('Preparing connected results', 'Menyiapkan hasil terhubung') : !inputs.length ? t('Add data to your figure', 'Tambahkan data ke Figure') : t('Prepare your figure', 'Siapkan Figure Anda');
  const description = loading ? t('Loading numerical sources and restoring your figure settings.', 'Memuat sumber numerik dan memulihkan pengaturan Figure.') : current?.error ? t('Retry loading the retained data, or review the connected results.', 'Coba muat ulang data tersimpan, atau tinjau hasil terhubung.') : failed ? t('Check the source results, then review preparation again.', 'Periksa hasil sumber, lalu tinjau persiapannya kembali.') : running ? t('This figure will open when its source results are ready.', 'Figure akan terbuka saat hasil sumbernya siap.') : !inputs.length ? t('Connect Bands, DOS / PDOS, Phonon, BTP2 or MD analysis on Canvas to get started.', 'Hubungkan Bands, DOS / PDOS, Phonon, BTP2 atau analisis MD di Canvas untuk memulai.') : t('Prepare the connected datasets to arrange, style and export your figure. Any required runs are reviewed first.', 'Siapkan dataset terhubung untuk menata, mengatur gaya dan mengekspor Figure. Eksekusi yang diperlukan ditinjau terlebih dahulu.');

  return <section className="workflow-figure-state" aria-label={t('Figure data', 'Data Figure')} aria-busy={loading || running}>
    <header className="workflow-figure-heading"><ChartNoAxesCombined size={16} aria-hidden="true" /><strong>{node.name}</strong><span>{t('Data & presentation', 'Data & tampilan')}</span></header>
    <div className="workflow-figure-state-body"><div className="workflow-figure-empty" data-state={loading ? 'loading' : failed ? 'error' : running ? 'running' : inputs.length ? 'connected' : 'empty'}>
      <div className="workflow-figure-empty-icon" aria-hidden="true">{failed ? <CircleAlert size={24} /> : <ChartNoAxesCombined size={24} />}</div>
      <h2>{title}</h2><p>{description}</p>
      {(loading || running) && <WorkspaceLoading layout="inline" label={loading ? t('Loading figure data…', 'Memuat data Figure…') : t('Waiting for results…', 'Menunggu hasil…')} />}
      {failed && <div className="workflow-figure-error" role="alert">{current?.error || attempt?.error || t('Preparation did not finish. Review the source results before trying again.', 'Persiapan belum selesai. Tinjau hasil sumber sebelum mencoba lagi.')}</div>}
      {!!inputs.length && <div className="workflow-figure-sources"><h3>{t('Connected sources', 'Sumber terhubung')}<span>{inputs.length}</span></h3><ul>{inputs.map(({ node: source, attempt: sourceAttempt }) => {
        const state = sourceAttempt?.outdated ? 'outdated' : sourceAttempt?.status;
        const active = state && ['running', 'queued', 'pending'].includes(state);
        const ready = state && ['completed', 'ready', 'reused'].includes(state);
        const label = state === 'outdated' ? t('Needs update', 'Perlu pembaruan') : ready ? t('Completed', 'Selesai') : active ? t('In progress', 'Diproses') : state === 'failed' ? t('Failed', 'Gagal') : state === 'blocked' ? t('Blocked', 'Terhambat') : state === 'cancelled' ? t('Cancelled', 'Dibatalkan') : t('Not run yet', 'Belum dijalankan');
        return <li key={source.id}><button type="button" disabled={!onOpenSource} onClick={() => onOpenSource?.(source.id)}><span className="workflow-figure-source-icon" aria-hidden="true">{ready ? <Check size={15} /> : active ? <LoaderCircle size={15} /> : <Network size={15} />}</span><span className="workflow-figure-source-name">{source.name}<small>{label}</small></span><ArrowUpRight size={14} aria-hidden="true" /></button></li>;
      })}</ul></div>}
      <div className="workflow-figure-state-actions">
        {current?.error && <button type="button" className="workflow-primary" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />{t('Retry loading', 'Muat ulang')}</button>}
        {!loading && !running && !!inputs.length && <button type="button" className={current?.error ? '' : 'workflow-primary'} disabled={runDisabled} onClick={onRun}>{t('Review preparation', 'Tinjau persiapan')}</button>}
        <button type="button" className={!inputs.length && !loading ? 'workflow-primary' : ''} onClick={onCanvas}><Network size={14} />{t('Open Canvas', 'Buka Canvas')}</button>
      </div>
      <small className="workflow-figure-export-note">{t('Style your plots · Export SVG, PDF or PNG', 'Atur gaya plot · Ekspor SVG, PDF atau PNG')}</small>
    </div></div>
  </section>;
}

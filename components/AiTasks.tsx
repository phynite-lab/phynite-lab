'use client';
import { useCallback, useEffect, useState, useId } from 'react';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { type AgentTask, type AiOrchestrationState } from '@/lib/ai-orchestration';
import type { AiStrategy } from '@/lib/ai-contract';
import { AiResponseContent } from './AiResponseContent';
import { aiModelLabel } from '@/lib/ai-model-selection';
import './AiTasks.css';

export function useAiOrchestration(conversationId: string | undefined, enabled: boolean, modelId: string) {
  const scope = `${conversationId ?? ''}:${modelId}`;
  const [saved, setSaved] = useState<{ scope: string; state: AiOrchestrationState | null; error: string }>({ scope: '', state: null, error: '' });
  const state = enabled && saved.scope === scope ? saved.state : null;
  const error = enabled && saved.scope === scope ? saved.error : '';
  const refresh = useCallback(async () => {
    if (!enabled || !conversationId) return;
    const next = await localRequest<AiOrchestrationState>(`orchestration/${conversationId}/status`);
    setSaved({ scope, state: next, error: '' });
  }, [enabled, conversationId, scope]);
  useEffect(() => {
    if (!enabled || !conversationId) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await localRequest<AiOrchestrationState>(`orchestration/${conversationId}/status`);
        if (live) setSaved({ scope, state: next, error: '' });
      } catch (failure) { if (live) setSaved(current => ({ scope, state: current.scope === scope ? current.state : null, error: failure instanceof Error ? failure.message : 'Tasks unavailable.' })); }
      if (live) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, conversationId, scope]);
  const action = async (operation: 'stop' | 'retry' | 'continue', task?: AgentTask) => {
    if (!conversationId) return;
    try {
      const next = await localRequest<AiOrchestrationState>(`orchestration/${conversationId}/${operation}`, 'POST', {
        parentId: state?.parent?.id, ...(task ? { taskId: task.id, taskGeneration: task.generation } : {}),
      });
      setSaved({ scope, state: next, error: '' });
    } catch (failure) { setSaved(current => ({ scope, state: current.scope === scope ? current.state : null, error: failure instanceof Error ? failure.message : 'Task action failed.' })); }
  };
  return { state, error, refresh, action };
}

export function AiStrategySettings({ value, onChange, qualified, disabled }: { value: AiStrategy; onChange: (value: AiStrategy) => void; qualified: boolean; disabled: boolean }) {
  const { t } = useLocale(), radioName = useId();
  return <fieldset className="ai-strategy-settings" disabled={disabled}><legend>{t('Strategy', 'Strategi')}</legend>
    <div>{(['auto', 'solo', 'team'] as const).map(strategy => <label key={strategy}>
      <input type="radio" name={radioName} value={strategy} checked={value === strategy} disabled={strategy === 'team' && !qualified} title={strategy === 'team' && !qualified ? t('Unavailable for this model on this device', 'Belum tersedia untuk model ini di perangkat ini') : undefined} onChange={() => onChange(strategy)} />
      {strategy === 'auto' ? 'Auto' : strategy === 'solo' ? 'Solo' : 'Team'}
    </label>)}</div>
    <p>{value === 'team' ? t('Split independent work between specialists.', 'Bagi pekerjaan independen ke beberapa specialist.') : value === 'solo' ? t('Use a single agent.', 'Gunakan satu agent.') : t('Let AI choose when to split the work.', 'AI memilih kapan tugas perlu dibagi.')}</p>
  </fieldset>;
}

export function AiTasks({ state, error, action, onReview }: { state: AiOrchestrationState | null; error: string; action: (operation: 'stop' | 'retry' | 'continue', task?: AgentTask) => Promise<void>; onReview: () => void }) {
  const { t } = useLocale(), [busy, setBusy] = useState('');
  const perform = async (operation: 'stop' | 'retry' | 'continue', task?: AgentTask) => {
    if (busy) return;
    setBusy(task?.id ?? 'parent');
    try { await action(operation, task); } finally { setBusy(''); }
  };
  const names: Record<AgentTask['status'], string> = {
    queued: t('Queued', 'Mengantre'), running: t('Running', 'Berjalan'), completed: t('Completed', 'Selesai'),
    failed: t('Failed', 'Gagal'), cancelled: t('Cancelled', 'Dibatalkan'), stale: t('Superseded', 'Digantikan'),
    stopped: t('Stopped', 'Dihentikan'), interrupted: t('Interrupted', 'Terputus'),
  };
  return <section className="ai-tasks" aria-label={t('AI tasks', 'Tugas AI')}>
    {error && <p className="ai-tasks-error" role="alert">{error}</p>}
    {!state?.parent ? <p>{t('Send a goal to see the plan, evidence and task results here.', 'Kirim tujuan untuk melihat rencana, bukti, dan hasil tugas di sini.')}</p> : <>
      {['interrupted', 'failed', 'awaiting_approval'].includes(state.parent.status) && <div className="ai-task-controls"><button type="button" disabled={!!busy} onClick={() => void perform('continue')}>{t('Continue retained work', 'Lanjutkan pekerjaan tersimpan')}</button><button type="button" onClick={onReview}>{t('Review decisions', 'Tinjau keputusan')}</button></div>}
      {state.tasks.length === 0 && <p>{t('This request has no separate tasks.', 'Permintaan ini tidak memiliki tugas terpisah.')}</p>}
      {state.tasks.map(task => <details key={task.id} className="ai-task-card"><summary><span>{task.goal}</span><small>{names[task.status]}</small></summary>
        <p className="ai-task-model">{aiModelLabel(task.modelId)}</p>
        <p>{t('Dependencies', 'Dependensi')}: {task.dependencies.length ? task.dependencies.map(index => state.tasks.find(item => item.index === index)?.goal ?? t('Unavailable', 'Belum tersedia')).join('; ') : t('Independent task', 'Tugas independen')}</p>
        {task.sources.length > 0 && <details><summary>{t('Selected sources', 'Sumber pilihan')}</summary><ul>{task.sources.map(source => <li key={source.sourceId}>{source.label}<code>{source.sha256}</code></li>)}</ul></details>}
        {task.evidence.length > 0 && <details><summary>{t('Evidence read', 'Bukti yang dibaca')}</summary><ul>{task.evidence.map(source => <li key={source.id}>{source.id} · {source.operation}<code>{source.sha256}</code><time>{source.capturedAt}</time></li>)}</ul></details>}
        {task.error && <p className="ai-tasks-error">{task.error}</p>}
        {task.result?.text ? <AiResponseContent text={task.result.text} /> : task.messages?.some(message => message.role === 'assistant') ? <AiResponseContent text={task.messages.filter(message => message.role === 'assistant').map(message => message.text).join('\n')} /> : null}
        {task.result?.uncertainties.map((uncertainty, index) => <p key={index}>{uncertainty}</p>)}
        <div className="ai-task-controls">{['queued', 'running'].includes(task.status) && <button type="button" disabled={!!busy} onClick={() => void perform('stop', task)}>{t('Stop task', 'Hentikan tugas')}</button>}{['failed', 'interrupted'].includes(task.status) && <button type="button" disabled={!!busy} onClick={() => void perform('retry', task)}>{t('Retry with remaining budget', 'Coba dengan sisa budget')}</button>}</div>
      </details>)}
      <details className="ai-task-diagnostics"><summary>{t('Technical details', 'Detail teknis')}</summary><p>{aiModelLabel(state.parent.modelId)} · {state.parent.status}</p>
      <dl className="ai-task-budget"><dt>{t('Provider calls', 'Panggilan provider')}</dt><dd>{state.parent.providerCalls}/30</dd><dt>{t('Tool calls', 'Panggilan tool')}</dt><dd>{state.parent.toolCalls}/40</dd><dt>{t('Token usage', 'Pemakaian token')}</dt><dd>{t('Not available', 'Belum tersedia')}</dd><dt>{t('Cost', 'Biaya')}</dt><dd>{t('Not available', 'Belum tersedia')}</dd></dl></details>
    </>}
  </section>;
}

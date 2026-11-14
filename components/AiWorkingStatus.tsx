'use client';

import { CirclePause, LoaderCircle, WifiOff } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { aiActivityText } from '@/lib/ai-presentation';
import type { AiOrchestrationState } from '@/lib/ai-orchestration';

export function AiWorkingStatus({ state, activity, writing, awaitingApproval, seconds, disconnected, onTasks, compact = false }: {
  state: AiOrchestrationState | null; activity: string; writing: boolean; awaitingApproval: boolean;
  seconds: number; disconnected: boolean; onTasks: () => void; compact?: boolean;
}) {
  const { locale, t } = useLocale();
  const waiting = awaitingApproval || state?.parent?.status === 'awaiting_approval';
  const label = disconnected ? t('Reconnecting to the saved response…', 'Menyambungkan kembali ke respons tersimpan…') : aiActivityText(state, activity, writing, waiting, locale);
  const Icon = disconnected ? WifiOff : waiting ? CirclePause : LoaderCircle;
  return <div className="ai-working-status" data-paused={waiting || disconnected} data-compact={compact} role="status">
    <Icon size={16} aria-hidden="true" />
    <span>{label}</span>
    <time aria-live="off" aria-label={t(`${seconds} seconds elapsed`, `${seconds} detik berlalu`)}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>
    {!!state?.tasks.length && <button type="button" onClick={onTasks}>{t('View tasks', 'Lihat tugas')}</button>}
  </div>;
}

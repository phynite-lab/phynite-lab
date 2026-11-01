'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale } from '../locale-provider';
import { useUnsavedSettings } from '../use-unsaved-settings';
import { LabComputeDestination } from '@/components/ComputeDestination';
import { SettingsSaveActions, SettingsSection } from '@/components/SettingsPage';
import { UiSelect } from '@/components/UiSelect';
import { accountRequest, type AccountResponse, type LabAccount, type ComputeWorkload } from '@/lib/account-api';
import type { ComputeSelection } from '@/lib/compute-selection';
import { validPersonalAllocation } from '@/lib/compute-preferences';

type Defaults = Pick<LabAccount, 'computeTarget' | 'cloudMode' | 'computeProfileId' | 'estimatedComputeSeconds' | 'personalDefaults'>;
const snapshot = (account: LabAccount): Defaults => ({ computeTarget: account.computeTarget, cloudMode: account.cloudMode ?? 'paid', computeProfileId: account.computeProfileId, estimatedComputeSeconds: account.estimatedComputeSeconds ?? 3600, personalDefaults: structuredClone(account.personalDefaults ?? {}) });
const workloads = ['qe', 'md-simulation', 'md-analysis'] as const;

export function ComputeDefaults({ account, onSaved, onNotice }: { account: LabAccount; onSaved: (account: LabAccount) => void; onNotice: (notice: string) => void }) {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const search = useSyncExternalStore(listener => { window.addEventListener('popstate', listener); window.addEventListener('phynite:navigation-change', listener); return () => { window.removeEventListener('popstate', listener); window.removeEventListener('phynite:navigation-change', listener); }; }, () => window.location.search, () => searchParams.toString());
  const requested = new URLSearchParams(search).get('workload');
  const [selected, setSelected] = useState<ComputeWorkload>('qe');
  const workload = workloads.includes(requested as ComputeWorkload) ? requested as ComputeWorkload : selected;
  const [draft, setDraft] = useState(() => snapshot(account)), [saved, setSaved] = useState(() => snapshot(account));
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedSettings(dirty);
  const latest = JSON.stringify(snapshot(account));
  useEffect(() => { if (!dirty && latest !== JSON.stringify(saved)) { let active = true; queueMicrotask(() => { if (active) { const next = JSON.parse(latest) as Defaults; setDraft(next); setSaved(next); setRevision(value => value + 1); } }); return () => { active = false; }; } }, [latest, saved, dirty]);
  const valid = Number.isFinite(draft.estimatedComputeSeconds) && draft.estimatedComputeSeconds! > 0
    && (draft.computeTarget !== 'shared' || Boolean(draft.computeProfileId))
    && Object.entries(draft.personalDefaults ?? {}).every(([kind, allocation]) => validPersonalAllocation(allocation, account.personalLimits?.[kind as ComputeWorkload]));
  const selection: ComputeSelection = { computeTarget: draft.computeTarget, cloudMode: draft.cloudMode, computeProfileId: draft.computeProfileId, estimatedComputeSeconds: draft.estimatedComputeSeconds, ...draft.personalDefaults?.[workload] };
  const change = (next: ComputeSelection) => {
    setError('');
    setDraft(current => ({ ...current,
      ...(workload === 'qe' ? { computeTarget: next.computeTarget ?? current.computeTarget, cloudMode: next.cloudMode, computeProfileId: next.computeProfileId, estimatedComputeSeconds: next.estimatedComputeSeconds } : {}),
      ...(next.computeTarget === 'personal' && next.vcpus !== undefined && next.memoryMiB !== undefined ? { personalDefaults: { ...current.personalDefaults, [workload]: { vcpus: next.vcpus, memoryMiB: next.memoryMiB } } } : {}),
    }));
  };
  const chooseWorkload = (value: string) => {
    setSelected(value as ComputeWorkload);
    const url = new URL(window.location.href); url.searchParams.delete('workload');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event('phynite:navigation-change'));
  };
  return <form data-settings-dirty={dirty || undefined} onSubmit={async event => {
    event.preventDefault(); if (!valid || !dirty || busy) return;
    setBusy(true); setError('');
    try {
      const changes = Object.fromEntries(Object.keys(draft).filter(key => JSON.stringify(draft[key as keyof Defaults]) !== JSON.stringify(saved[key as keyof Defaults])).map(key => [key, draft[key as keyof Defaults]]));
      const changedPersonal = Object.fromEntries(workloads.filter(kind => JSON.stringify(draft.personalDefaults?.[kind]) !== JSON.stringify(saved.personalDefaults?.[kind])).map(kind => [kind, draft.personalDefaults?.[kind]]));
      const current = snapshot(account);
      const payload = { ...current, ...changes, personalDefaults: { ...current.personalDefaults, ...changedPersonal } };
      const result = await accountRequest<AccountResponse>('/compute', 'PUT', payload);
      onSaved(result.account); const next = snapshot(result.account); setDraft(next); setSaved(next); setRevision(value => value + 1);
      window.dispatchEvent(new Event('phynite:compute-target-change'));
      onNotice(t('Defaults saved for new runs.', 'Default tersimpan untuk run baru.'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('Defaults could not be saved. Your draft is still here.', 'Default belum tersimpan. Draft Anda tetap tersedia.')); }
    finally { setBusy(false); }
  }}>
    <SettingsSection id="compute-defaults" title={t('Defaults for new jobs', 'Default untuk job baru')} description={t('Compare resources before your next run. Existing jobs keep their recorded allocation.', 'Bandingkan resource sebelum run berikutnya. Job yang sudah ada mempertahankan alokasi tercatat.')}>
      <fieldset className="settings-fields" disabled={busy}>
        <UiSelect label={t('Workload', 'Workload')} value={workload} options={[{ value: 'qe', label: 'DFT · Quantum ESPRESSO' }, { value: 'md-simulation', label: 'MD · LAMMPS' }, { value: 'md-analysis', label: t('MD analysis · OVITO', 'Analisis MD · OVITO') }]} onChange={chooseWorkload} />
        <LabComputeDestination key={`${workload}:${revision}`} scope="draft" status={null} account={{ ...account, ...draft }} requiredCapability={workload} sharedAvailable={workload === 'qe'} selection={selection} onChange={change} />
      </fieldset>
    </SettingsSection>
    {!valid && dirty && <p className="settings-notice" role="alert">{t('Check CPU, RAM, duration, and Cloud profile before saving.', 'Periksa CPU, RAM, durasi, dan profil Cloud sebelum menyimpan.')}</p>}
    {error && <p className="settings-notice" role="alert">{error}</p>}
    <SettingsSaveActions dirty={dirty} busy={busy} valid={valid} label={t('Save defaults', 'Simpan default')} onCancel={() => { setDraft(structuredClone(saved)); setError(''); setRevision(value => value + 1); }} />
  </form>;
}

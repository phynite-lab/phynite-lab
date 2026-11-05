'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useLocale } from '@/app/locale-provider';
import { useSession } from '@/app/use-session';
import { accountRequest, type AccountResponse, type LabAccount } from '@/lib/account-api';
import { phyniteCompute, type LocalWorkerCapability, type PhyniteComputeStatus } from '@/lib/phynite-api';
import { computeCapacityChoices, estimateQuanta, type ComputeSelection } from '@/lib/compute-selection';
import { affordableComputeHours, computeDurationSeconds, computeDurationValue, personalComputeRequest, validPersonalAllocation, type ComputeDurationUnit, type PersonalComputeAllocation, type PersonalComputeLimit, type PersonalComputePreferences } from '@/lib/compute-preferences';
import { useComputeCatalog } from '@/app/use-compute-catalog';
import { ComputeResourcePicker } from './ComputeResourcePicker';
import { startBrowserPoll } from '@/lib/browser-poll';
import { UiSelect } from './UiSelect';
import { LocalComputeReadiness } from './LocalComputeReadiness';
import './compute-destination.css';

type ComputeTarget = 'shared' | 'personal';
const subscribeReturnPath = (listener: () => void) => {
  const events = ['popstate', 'hashchange', 'phynite:navigation-change'];
  events.forEach(event => window.addEventListener(event, listener));
  return () => events.forEach(event => window.removeEventListener(event, listener));
};
const returnPathSnapshot = () => window.location.pathname + window.location.search + window.location.hash;
export type LabComputeDestinationProps = {
  sharedAvailable?: boolean; requiredCapability?: LocalWorkerCapability; fixedTarget?: ComputeTarget;
  status?: PhyniteComputeStatus['compute'] | null;
  onStatus?: (status: PhyniteComputeStatus['compute'] | null) => void; ariaLabel?: string;
  scope?: 'run' | 'defaults' | 'draft'; selection?: ComputeSelection; onChange?: (selection: ComputeSelection) => void;
  account?: LabAccount | null; onAccount?: (account: LabAccount) => void;
};

function PersonalResourceFields({ allocation, limit, disabled, onApply, live = false }: {
  allocation: Partial<PersonalComputeAllocation>; limit?: PersonalComputeLimit; disabled: boolean;
  onApply: (allocation: PersonalComputeAllocation) => void; live?: boolean;
}) {
  const { t, intlLocale } = useLocale();
  const [cpu, setCpu] = useState(allocation.vcpus === undefined ? '' : String(allocation.vcpus));
  const [memory, setMemory] = useState(allocation.memoryMiB === undefined ? '' : String(allocation.memoryMiB / 1024));
  const next = { vcpus: Number(cpu), memoryMiB: Number(memory) * 1024 };
  const valid = cpu.trim() !== '' && memory.trim() !== '' && validPersonalAllocation(next, limit);
  const changed = next.vcpus !== allocation.vcpus || next.memoryMiB !== allocation.memoryMiB;
  const minimumMemory = limit ? Math.max(limit.minimumMemoryMiB ?? 2048, (Number.isSafeInteger(next.vcpus) && next.vcpus > 0 ? next.vcpus : 1) * (limit.memoryMiBPerVcpu ?? 0)) : null;
  return <div className="compute-personal-fields">
    <div className="compute-resource-picker">
      <label className="compute-number-field"><span>vCPU</span><input aria-label={t('CPU allocation', 'Alokasi CPU')} type="number" inputMode="numeric" min="1" max={limit?.vcpus} step="1" placeholder={t('Service default', 'Default layanan')} value={cpu} disabled={disabled || !limit} aria-invalid={live && changed && !valid || undefined} onChange={event => { setCpu(event.target.value); if (live) onApply({ vcpus: Number(event.target.value), memoryMiB: Number(memory) * 1024 }); }} /></label>
      <label className="compute-number-field"><span>{t('RAM limit (GiB)', 'Batas RAM (GiB)')}</span><input aria-label={t('RAM allocation in GiB', 'Alokasi RAM dalam GiB')} type="number" inputMode="decimal" min={minimumMemory === null ? undefined : minimumMemory / 1024} max={limit ? limit.memoryMiB / 1024 : undefined} step="any" placeholder={t('Service default', 'Default layanan')} value={memory} disabled={disabled || !limit} aria-invalid={live && changed && !valid || undefined} onChange={event => { setMemory(event.target.value); if (live) onApply({ vcpus: Number(cpu), memoryMiB: Number(event.target.value) * 1024 }); }} /></label>
    </div>
    {limit ? <p>{t('Service limits', 'Batas layanan')}: {limit.vcpus.toLocaleString(intlLocale)} vCPU · {minimumMemory === null ? '—' : (minimumMemory / 1024).toLocaleString(intlLocale)}–{(limit.memoryMiB / 1024).toLocaleString(intlLocale)} GiB RAM. {t('Allocation limits are separate from installed hardware.', 'Batas alokasi berbeda dari kapasitas perangkat terpasang.')}</p> : <p role="status">{t('Resource limits are unavailable for this workload. Refresh before changing allocations.', 'Batas resource workload ini belum tersedia. Muat ulang sebelum mengubah alokasi.')}</p>}
    {!allocation.vcpus && !allocation.memoryMiB && <p>{t('No explicit allocation saved. The service applies this workload’s existing defaults.', 'Belum ada alokasi eksplisit tersimpan. Layanan memakai default workload yang berlaku.')}</p>}
    {/* Say why a value cannot be applied instead of silently keeping the previous allocation. */}
    {limit && changed && !valid && cpu.trim() !== '' && memory.trim() !== '' && <p role="alert">{t(`This allocation cannot be saved. Choose 1–${limit.vcpus.toLocaleString(intlLocale)} whole vCPU and ${minimumMemory === null ? '—' : (minimumMemory / 1024).toLocaleString(intlLocale)}–${(limit.memoryMiB / 1024).toLocaleString(intlLocale)} GiB RAM in whole MiB.`, `Alokasi ini tidak bisa disimpan. Pilih 1–${limit.vcpus.toLocaleString(intlLocale)} vCPU bulat dan RAM ${minimumMemory === null ? '—' : (minimumMemory / 1024).toLocaleString(intlLocale)}–${(limit.memoryMiB / 1024).toLocaleString(intlLocale)} GiB dalam MiB bulat.`)}</p>}
    {!live && changed && <button type="button" className="lab-button" disabled={disabled || !valid} onClick={() => { if (valid) onApply(next as PersonalComputeAllocation); }}>{t('Apply CPU and RAM', 'Terapkan CPU dan RAM')}</button>}
  </div>;
}

function ComputeDuration({ seconds, disabled, onChange, live = false }: { seconds: number; disabled: boolean; onChange: (seconds: number) => void; live?: boolean }) {
  const { t } = useLocale();
  const [unit, setUnit] = useState<ComputeDurationUnit>(seconds >= 3600 ? 'hours' : 'minutes');
  const [value, setValue] = useState(() => computeDurationValue(seconds, unit));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setValue(computeDurationValue(seconds, unit)); }, [seconds, unit]);
  const converted = computeDurationSeconds(value, unit);
  return <div className="compute-duration-control">
    <label className="compute-number-field"><span>{t('Estimated duration', 'Perkiraan durasi')}</span><input type="number" inputMode="decimal" min="0" step="any" aria-label={t('Estimated compute duration', 'Perkiraan durasi compute')} aria-invalid={converted === null} value={value} disabled={disabled} onFocus={() => { editing.current = true; }} onChange={event => { setValue(event.target.value); if (live) onChange(computeDurationSeconds(event.target.value, unit) ?? 0); }} onBlur={() => { editing.current = false; if (converted !== null && converted !== seconds) onChange(converted); }} /></label>
    <UiSelect label={t('Unit', 'Satuan')} compact ariaLabel={t('Duration unit', 'Satuan durasi')} value={unit} disabled={disabled} options={[{ value: 'minutes', label: t('Minutes', 'Menit') }, { value: 'hours', label: t('Hours', 'Jam') }]} onChange={next => { const nextUnit = next as ComputeDurationUnit; if (converted !== null) setValue(computeDurationValue(converted, nextUnit)); setUnit(nextUnit); }} />
    {converted === null && <p role="status">{t('Enter a duration equivalent to positive whole seconds.', 'Masukkan durasi setara detik bulat positif.')}</p>}
  </div>;
}

export function LabComputeDestination({
  sharedAvailable = true, requiredCapability = 'qe', fixedTarget, status: suppliedStatus, onStatus,
  ariaLabel = 'Compute destination', scope = 'defaults', selection, onChange,
  account: suppliedAccount, onAccount,
}: LabComputeDestinationProps) {
  const { t, intlLocale } = useLocale();
  const { session } = useSession();
  const desktop = session?.mode === 'local';
  const returnPath = useSyncExternalStore(subscribeReturnPath, returnPathSnapshot, () => '');
  const [loadedAccount, setAccount] = useState<LabAccount | null>(null);
  const account = suppliedAccount === undefined ? loadedAccount : suppliedAccount;
  const preferences = account as (LabAccount & PersonalComputePreferences) | null;
  const [runSelection, setRunSelection] = useState<ComputeSelection>({});
  const run = scope === 'run', draft = scope === 'draft';
  const local = run || draft ? selection ?? runSelection : {};
  const localOnly = requiredCapability.startsWith('md-');
  const target = localOnly ? 'personal' : fixedTarget ?? local.computeTarget ?? account?.computeTarget ?? 'personal';
  const mode = local.cloudMode ?? account?.cloudMode ?? 'paid';
  const profileId = local.computeProfileId ?? account?.computeProfileId;
  const seconds = local.estimatedComputeSeconds ?? account?.estimatedComputeSeconds ?? 3600;
  const allocation = personalComputeRequest({ vcpus: local.vcpus, memoryMiB: local.memoryMiB }, preferences?.personalDefaults?.[requiredCapability]);
  const limit = preferences?.personalLimits?.[requiredCapability] ?? (requiredCapability === 'qe' && account ? { ...account.limits, minimumMemoryMiB: 2048 } : undefined);
  const { catalog, error: catalogError } = useComputeCatalog(target === 'shared');
  const [polledStatus, setPolledStatus] = useState<PhyniteComputeStatus['compute'] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const grant = account?.pilotCompute;
  const status = suppliedStatus === undefined ? polledStatus : suppliedStatus;
  const format = (value: number) => value.toLocaleString(intlLocale, { maximumFractionDigits: 6 });
  const profiles = computeCapacityChoices(catalog?.profiles ?? [], { selectedId: profileId,
    ...(mode === 'pilot' ? { vcpus: grant?.limits.vcpus ?? 2, memoryMiB: grant?.limits.memoryMiB ?? 6144 } : {}) });
  const selected = profiles.find(item => item.id === profileId);
  const available = account?.quanta.available ?? account?.quanta.balance;
  const estimate = selected ? estimateQuanta(selected, seconds) : null;
  const affordable = affordableComputeHours(available, selected?.hourlyQuanta, catalog?.minimumSeconds ?? 60);
  const resolved: ComputeSelection = { computeTarget: target, cloudMode: mode, computeProfileId: profileId, estimatedComputeSeconds: seconds, ...allocation };

  const refresh = useCallback(async () => {
    const [accountResult, compute] = await Promise.all([
      suppliedAccount === undefined ? accountRequest<AccountResponse>() : Promise.resolve(null),
      suppliedStatus === undefined ? phyniteCompute.status() : Promise.resolve(null),
    ]);
    if (accountResult) setAccount(accountResult.account);
    if (compute) {
      const next = requiredCapability.startsWith('md-') ? (compute.mdCompute ?? compute.compute) : compute.compute;
      setPolledStatus(next); onStatus?.(next);
    }
    setError('');
  }, [onStatus, requiredCapability, suppliedAccount, suppliedStatus]);

  useEffect(() => {
    if (suppliedAccount !== undefined && suppliedStatus !== undefined) return;
    let active = true;
    const stop = startBrowserPoll(async () => {
      try { if (active) await refresh(); }
      catch { if (active) setError(t('Compute status unavailable. Refresh to retry.', 'Status compute belum tersedia. Muat ulang untuk mencoba.')); }
    }, 60_000);
    const listener = () => { void refresh().catch(() => {}); };
    window.addEventListener('phynite:compute-target-change', listener);
    window.addEventListener('phynite:balance-change', listener);
    return () => { active = false; stop(); window.removeEventListener('phynite:compute-target-change', listener); window.removeEventListener('phynite:balance-change', listener); };
  }, [refresh, suppliedAccount, suppliedStatus, t]);

  async function persist(next: ComputeSelection) {
    if (!account || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const hasAllocation = next.computeTarget === 'personal' && next.vcpus !== undefined && next.memoryMiB !== undefined;
      const result = await accountRequest<AccountResponse>('/compute', 'PUT', {
        computeTarget: localOnly ? account.computeTarget : next.computeTarget, cloudMode: next.cloudMode,
        computeProfileId: next.computeProfileId, estimatedComputeSeconds: next.estimatedComputeSeconds,
        ...(hasAllocation ? { personalDefaults: { ...preferences?.personalDefaults, [requiredCapability]: { vcpus: next.vcpus, memoryMiB: next.memoryMiB } } } : {}),
      });
      setAccount(result.account); onAccount?.(result.account);
      window.dispatchEvent(new Event('phynite:compute-target-change'));
      setNotice(t('Defaults saved for new runs.', 'Default tersimpan untuk run baru.'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('Selection could not be saved.', 'Pilihan belum tersimpan.')); }
    finally { setBusy(false); }
  }
  function change(changes: Partial<ComputeSelection>) {
    const next = { ...resolved, ...changes };
    setError(''); setNotice('');
    if (run || draft) { setRunSelection(next); onChange?.(next); }
    else void persist(next);
  }

  return <div className="workspace-compute-destination" data-compute-scope={scope}>
    <div className="workspace-compute-heading"><span>{t('Compute resources', 'Resource compute')}</span><Link href="/account/compute#your-computer">{t('Computer setup →', 'Hubungkan komputer →')}</Link></div>
    <UiSelect ariaLabel={ariaLabel} compact disabled={!account || busy || Boolean(fixedTarget)} value={target}
      options={[
        { value: 'personal', label: t('Your computer', 'Komputer Anda'), detail: (status?.status ?? account?.computer.status) === 'connected' ? t('Connected', 'Terhubung') : (status?.status ?? account?.computer.status) === 'offline' ? t('Worker offline', 'Worker offline') : t('Connect your worker', 'Hubungkan worker') },
        { value: 'shared', label: 'Phynite Cloud', disabled: desktop || !sharedAvailable || requiredCapability.startsWith('md-'), detail: requiredCapability.startsWith('md-') ? t('Not available for MD yet', 'Belum tersedia untuk MD') : desktop ? t('Submit through the optional Cloud connection in Settings', 'Kirim melalui koneksi Cloud opsional di Pengaturan') : t('Choose CPU and RAM for this job', 'Pilih CPU dan RAM untuk job') },
      ]} onChange={value => change({ computeTarget: value as ComputeTarget })} />
    {target === 'personal' && <>
      {desktop && <LocalComputeReadiness capability={requiredCapability} />}
      <PersonalResourceFields live={draft} key={draft ? requiredCapability : `${requiredCapability}:${allocation.vcpus ?? ''}:${allocation.memoryMiB ?? ''}`} allocation={allocation} limit={limit} disabled={!account || busy} onApply={next => change(next)} />
      <p>{t('Uses your connected computer. No Quanta charge.', 'Memakai komputer yang terhubung. Tanpa biaya Quanta.')}</p>
    </>}
    {target === 'shared' && <>
      {desktop && <p role="alert">{t('This workflow runs on Your computer. Choose it below, or submit online through the Cloud connection in Settings.', 'Workflow ini berjalan di Komputer Anda. Pilih di bawah, atau kirim online melalui koneksi Cloud di Pengaturan.')} <button type="button" className="lab-button" onClick={() => change({ computeTarget: 'personal' })}>{t('Use Your computer', 'Gunakan Komputer Anda')}</button></p>}
      <UiSelect label={t('Funding', 'Pendanaan')} compact value={mode} disabled={busy} options={[
        { value: 'paid', label: t('Paid · Quanta', 'Paid · Quanta'), detail: t('Verified balance and regional capacity', 'Saldo terverifikasi dan kapasitas region') },
        { value: 'pilot', label: t('Pilot · admin grant', 'Pilot · grant admin'), detail: t('Separate operating budget', 'Budget operasional terpisah') },
      ]} onChange={value => change({ cloudMode: value as 'paid' | 'pilot', computeProfileId: undefined })} />
      <ComputeResourcePicker profiles={profiles} value={selected?.id} compact showRates={mode === 'paid'} disabled={busy} onChange={value => change({ computeProfileId: value })} />
      {mode === 'paid' ? <div className="compute-resource-receipt">
        <ComputeDuration live={draft} seconds={seconds} disabled={busy || !account} onChange={value => change({ estimatedComputeSeconds: value })} />
        <dl>
          <div><dt>{t('Rate', 'Tarif')}</dt><dd>{selected ? format(selected.hourlyQuanta) + ' Q/h' : '—'}</dd></div>
          <div><dt>{t('Estimate', 'Estimasi')}</dt><dd>{estimate === null ? '—' : format(estimate) + ' Quanta'}</dd></div>
          <div><dt>{t('Available / reserved', 'Tersedia / reservasi')}</dt><dd>{available === undefined ? '—' : format(available)} / {account?.quanta.reserved === undefined ? '—' : format(account.quanta.reserved)} Q</dd></div>
          <div><dt>{t('Estimated affordable time', 'Perkiraan waktu dari saldo')}</dt><dd>{affordable === null ? '—' : format(affordable) + ' h'}</dd></div>
        </dl>
        <p>{t('Affordable time is for one new job at this profile’s rate, not a completion ETA. Estimated duration is not an execution timeout. Only solver/analysis time is billed, with one 60-second minimum per job.', 'Perkiraan waktu dari saldo berlaku untuk satu job baru pada tarif profil ini, bukan ETA selesai. Perkiraan durasi bukan batas waktu eksekusi. Hanya waktu solver/analisis ditagih, minimum 60 detik sekali per job.')}</p>
        <Link href={`/billing?returnTo=${encodeURIComponent(returnPath || '/account/compute')}`}>{t('Top up Quanta', 'Top-up Quanta')} →</Link>
      </div> : <div className="compute-resource-receipt compute-pilot-receipt"><dl>
        <div><dt>{t('Jobs remaining', 'Job tersisa')}</dt><dd>{grant?.remainingJobs ?? '—'}</dd></div>
        <div><dt>{t('Operating budget', 'Budget operasional')}</dt><dd>{grant ? format(grant.budgetRemainingMicros / 1_000_000) + ' USD' : '—'}</dd></div>
        <div><dt>{t('Compute time limit per job', 'Batas waktu compute per job')}</dt><dd>{grant ? format(grant.limits.timeoutSeconds / 60) + ' min' : '—'}</dd></div>
        <div><dt>{t('Expires', 'Berlaku hingga')}</dt><dd>{grant?.expiresAtEpoch ? new Date(grant.expiresAtEpoch * 1000).toLocaleString(intlLocale) : '—'}</dd></div>
      </dl><p>{grant?.available ? t('One global slot. No Quanta charge.', 'Satu slot global. Tanpa biaya Quanta.') : t('Ask an admin for a pilot grant.', 'Minta grant pilot kepada admin.')}</p></div>}
    </>}
    <dl className="compute-accelerator-status"><div><dt>GPU</dt><dd>{t('Not supported by this runtime', 'Belum didukung runtime ini')}</dd></div><div><dt>VRAM</dt><dd>{t('Not reported', 'Belum dilaporkan')}</dd></div></dl>
    {run && <div className="compute-scope-actions"><p>{t('Changes apply to this run configuration.', 'Perubahan berlaku untuk konfigurasi run ini.')}</p><button type="button" className="lab-button" disabled={!account || busy || (target === 'personal' && (allocation.vcpus !== undefined || allocation.memoryMiB !== undefined) && !validPersonalAllocation(allocation, limit))} onClick={() => void persist(resolved)}>{t('Make default', 'Jadikan default')}</button></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}<button type="button" className="lab-button" onClick={() => void refresh().catch(() => {})}>{t('Refresh', 'Perbarui')}</button></p>}
    {target === 'shared' && catalogError && <p role="alert">{t('Cloud prices are unavailable. Refresh before running.', 'Tarif Cloud belum tersedia. Muat ulang sebelum menjalankan.')}</p>}
  </div>;
}

export function ComputeDestination() { return <LabComputeDestination requiredCapability="qe" />; }

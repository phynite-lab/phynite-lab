'use client';

import { Clock, Cpu, Database, ExternalLink, X, Zap } from 'lucide-react';
import { QuantaMark } from '@/components/QuantaMark';
import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useLabAccount } from '@/app/use-lab-account';
import { useLocale } from '@/app/locale-provider';
import { accountUsageRequest, formatBytes, type AccountUsage } from '@/lib/account-api';
import { useComputeCatalog } from '@/app/use-compute-catalog';
import { displayDuration } from '@/lib/usage-display';
import { computeCapacityLabel } from '@/lib/compute-selection';

type Props = { userId?: string; variant: 'sidebar' | 'header'; unlimited?: boolean };
type Level = 'normal' | 'warning' | 'critical' | 'unknown';

const usageCache = new Map<string, { usage: AccountUsage; measuredAt: number }>();
const pendingUsage = new Map<string, Promise<AccountUsage>>();
const CACHE_MS = 30_000;

function requestUsage(userId: string) {
  const cached = usageCache.get(userId);
  if (cached && Date.now() - cached.measuredAt < CACHE_MS) return Promise.resolve(cached.usage);
  const existing = pendingUsage.get(userId);
  if (existing) return existing;
  const request = accountUsageRequest().then((usage) => {
    usageCache.set(userId, { usage, measuredAt: Date.now() });
    return usage;
  }).finally(() => pendingUsage.delete(userId));
  pendingUsage.set(userId, request);
  return request;
}

function quantaLevel(balance: number | null): Level {
  if (balance === null) return 'unknown';
  if (balance < 1) return 'critical';
  if (balance < 5) return 'warning';
  return 'normal';
}

function storageLevel(percent: number | null): Level {
  if (percent === null) return 'unknown';
  if (percent > 95) return 'critical';
  if (percent > 80) return 'warning';
  return 'normal';
}

function hours(seconds: number, locale: string, unit = 'h') {
  return `${(seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
}

function quanta(value: number, locale: string, digits = 1) {
  return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function ResourceUsageSummary({ userId, variant, unlimited = false }: Props) {
  const { t, intlLocale } = useLocale();
  const { account, loading: accountLoading, error: accountError } = useLabAccount(userId);
  const { catalog } = useComputeCatalog(Boolean(account?.computeProfileId));
  const selected = catalog?.profiles.find(item => item.id === account?.computeProfileId);
  const selectedCapacity = computeCapacityLabel(selected ? { ...selected, memoryMiB: account?.cloudMode === 'pilot' ? Math.min(selected.memoryMiB, account.pilotCompute?.limits.memoryMiB ?? 6144) : selected.memoryMiB } : undefined, intlLocale);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(Boolean(userId));
  const [usageError, setUsageError] = useState('');
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    queueMicrotask(() => {
      setUsageLoading(true);
      void requestUsage(userId).then((next) => {
        if (cancelled) return;
        setUsage(next);
        setUsageError('');
      }).catch((failure) => {
        if (cancelled) return;
        setUsageError(failure instanceof Error ? failure.message : t('Usage is unavailable.', 'Pemakaian belum tersedia.'));
      }).finally(() => { if (!cancelled) setUsageLoading(false); });
    });
    return () => { cancelled = true; };
  }, [t, userId]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const balance = account?.quanta.available ?? account?.quanta.balance ?? null;
  const measuredQuota = usage?.storage.researchQuotaBytes;
  const quota = measuredQuota && measuredQuota > 0 ? measuredQuota : account?.limits.researchBytes ?? null;
  const storageBytes = usage?.storage.bytes ?? null;
  const storagePercent = storageBytes !== null && quota !== null && quota > 0 ? storageBytes / quota * 100 : null;
  const meterPercent = storagePercent === null ? 0 : Math.min(100, storagePercent);
  const balanceState = unlimited ? 'normal' : quantaLevel(balance);
  const storageState = unlimited ? 'normal' : storageLevel(storagePercent);
  const cloudSeconds = usage ? Math.max(0, usage.compute.wallSeconds - usage.compute.personalSeconds) : 0;
  const unavailable = accountError || usageError;
  const storageIncomplete = Boolean(usage && !usage.storage.complete);
  const storageValue = storageBytes === null ? null : `${formatBytes(storageBytes, intlLocale)}${storageIncomplete ? '+' : ''}`;
  const storageAriaText = storageValue === null
    ? t('Storage usage is unavailable', 'Pemakaian penyimpanan belum tersedia')
    : unlimited
      ? `${storageValue} · ${t('unlimited storage', 'penyimpanan tanpa batas')}`
      : quota === null
        ? t('Storage quota is unavailable', 'Kuota penyimpanan belum tersedia')
        : `${storageValue} / ${formatBytes(quota, intlLocale)}${storageIncomplete ? ` · ${t('lower bound', 'batas bawah')}` : ''}`;
  const meterNow = storageBytes === null || quota === null ? undefined : Math.min(storageBytes, Math.max(quota, 1));

  if (variant === 'sidebar') {
    if (unlimited) {
      return <section className="resource-usage-sidebar" data-unlimited aria-label={t('Unlimited developer resources', 'Sumber daya developer tanpa batas')} aria-busy={accountLoading || usageLoading || undefined}>
        <header><span><Zap size={13} aria-hidden="true" /><span>{t('Resources', 'Sumber daya')}</span></span><b>{t('Developer', 'Developer')}</b></header>
        <div className="resource-sidebar-access">
          <strong>{t('No resource limits', 'Tanpa batas sumber daya')}</strong><small>{t('Compute · Quanta · Storage', 'Komputasi · Quanta · Penyimpanan')}</small>
        </div>
        <footer><span>{usage ? `${hours(usage.compute.wallSeconds, intlLocale, t('h', 'jam'))} · ${usage.compute.totalRuns.toLocaleString(intlLocale)} ${t('runs', 'run')}` : '—'}</span><a href="/billing">{t('Details', 'Detail')}<ExternalLink size={10} aria-hidden="true" /></a></footer>
      </section>;
    }
    return <section className="resource-usage-sidebar" data-unlimited={unlimited || undefined} aria-label={t('Account resources', 'Sumber daya akun')} aria-busy={accountLoading || usageLoading || undefined}>
      <header><span><Zap size={13} aria-hidden="true" /><span>{t('Resources', 'Sumber daya')}</span></span>{unavailable && <i title={unavailable} aria-label={t('Some resource data is unavailable', 'Sebagian data sumber daya belum tersedia')} />}</header>
      <div className="resource-sidebar-quanta" data-level={balanceState} title={balance === null ? t('Quanta balance unavailable', 'Saldo Quanta belum tersedia') : `${quanta(balance, intlLocale, 2)} Quanta`}>
        <QuantaMark variant="mini" size={20} className="resource-sidebar-quanta-mark" />
        <span>{t('Available Quanta', 'Quanta tersedia')}</span>
        <strong>{balance === null ? '—' : `${quanta(balance, intlLocale, 2)} Quanta`}</strong>
      </div>
      <div className="resource-sidebar-storage" data-level={storageState}>
        <div><span>{t('Storage', 'Penyimpanan')}</span><strong>{storageValue === null || quota === null ? '—' : `${storageValue} / ${formatBytes(quota, intlLocale)}`}</strong></div>
        <div className="lab-meter" role="meter" aria-label={t('Cloud storage used', 'Penyimpanan cloud terpakai')} aria-valuemin={0} aria-valuemax={quota ?? 1} aria-valuenow={meterNow} aria-valuetext={storageAriaText}><span style={{ width: `${meterPercent}%` }} /></div>
        <small>{storagePercent === null ? (usageError ? t('Unavailable', 'Belum tersedia') : t('Reading usage…', 'Membaca pemakaian…')) : `${Math.round(storagePercent)}%${storageIncomplete ? '+' : ''}`}</small>
      </div>
      <footer><span className="resource-sidebar-runtime"><Cpu size={13} aria-hidden="true" />{usage ? `${hours(usage.compute.wallSeconds, intlLocale, t('h', 'jam'))} · ${usage.compute.totalRuns.toLocaleString(intlLocale)} ${usage.compute.totalRuns === 1 ? t('run', 'run') : t('runs', 'run')}` : '—'}</span><a href="/billing">{t('Details', 'Detail')}<ExternalLink size={10} aria-hidden="true" /></a></footer>
    </section>;
  }

  const togglePopover = (event: ReactMouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    setOpen((current) => !current);
  };
  const closePopover = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const popoverProps = { 'aria-controls': popoverId, 'aria-expanded': open, 'aria-haspopup': 'dialog' as const, onClick: togglePopover };
  const compactStorage = storageBytes === null
    ? '—'
    : unlimited
      ? '∞'
      : quota === null
        ? '—'
        : `${formatBytes(storageBytes, intlLocale)}${storageIncomplete ? '+' : ''} / ${formatBytes(quota, intlLocale)}`;
  const recordedRuntime = usage ? displayDuration(usage.compute.wallSeconds, intlLocale) : '—';
  const computeDetail = usage
    ? `${t('Local', 'Lokal')} ${hours(usage.compute.personalSeconds, intlLocale, t('h', 'jam'))} · ${t('Cloud', 'Cloud')} ${hours(cloudSeconds, intlLocale, t('h', 'jam'))}`
    : '—';
  const storageBreakdown = usage
    ? `${t('DFT', 'DFT')} ${formatBytes(usage.storage.categories.calculations ?? 0, intlLocale)} · ${t('MD', 'MD')} ${formatBytes(usage.storage.categories.trajectories ?? 0, intlLocale)}`
    : '—';

  return <div className="resource-usage-header" data-unlimited={unlimited || undefined} ref={rootRef} aria-busy={accountLoading || usageLoading || undefined} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button
      type="button"
      className="resource-status-chip resource-status-summary"
      data-unlimited={unlimited || undefined}
      aria-label={`${t('Account resources', 'Sumber daya akun')}: ${unlimited ? t('unlimited Quanta', 'Quanta tanpa batas') : `${balance === null ? t('unavailable', 'belum tersedia') : `${quanta(balance, intlLocale)} Quanta`}`}; ${t('Storage', 'Penyimpanan')}: ${storageAriaText}`}
      title={unlimited ? t('Resources · Unlimited Quanta & Storage', 'Sumber daya · Quanta & Penyimpanan tanpa batas') : `${balance === null ? '—' : quanta(balance, intlLocale)} Quanta · ${compactStorage}`}
      {...popoverProps}
    >
      <span className="resource-quanta-logo" aria-hidden="true"><QuantaMark variant="mini" size={20} /></span>
    </button>
    {open && <section id={popoverId} ref={panelRef} className="resource-usage-popover" data-unlimited={unlimited || undefined} role="dialog" aria-modal="false" aria-labelledby={`${popoverId}-title`} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closePopover(); } }}>
      <header>
        <div className="resource-popover-title-row">
          <h2 id={`${popoverId}-title`}>{t('Resources', 'Sumber daya')}</h2>
          {unlimited && <strong className="resource-popover-access">∞ {t('Unlimited', 'Tanpa batas')}</strong>}
        </div>
        <button type="button" className="resource-popover-close" onClick={closePopover} aria-label={t('Close resource details', 'Tutup detail sumber daya')}>
          <X size={15} />
        </button>
      </header>
      {unavailable && <p className="resource-popover-error" role="status">{t('Some measurements are temporarily unavailable.', 'Sebagian pengukuran sementara belum tersedia.')}</p>}
      <dl className="resource-popover-ledger">
        <div>
          <dt>
            <QuantaMark variant="mini" size={20} className="resource-ledger-quanta-mark" />
            {t('Quanta', 'Quanta')}
          </dt>
          <dd>
            <strong>{unlimited ? '∞' : balance === null ? '—' : `${quanta(balance, intlLocale, 2)} Q`}</strong>
            <small>{account ? `${quanta(account.quanta.usedThisMonth, intlLocale, 2)} Q ${t('used this month', 'terpakai bulan ini')}` : '—'}</small>
          </dd>
        </div>
        <div>
          <dt>
            <Clock size={14} aria-hidden="true" />
            {t('Compute', 'Komputasi')}
          </dt>
          <dd>
            <strong>{unlimited ? t('Unlimited', 'Tanpa batas') : account?.computeTarget === 'personal' ? t('Your computer', 'Komputer Anda') : selectedCapacity ?? '—'}</strong>
            <small>{`${recordedRuntime} ${t('recorded', 'tercatat')} · ${computeDetail}`}</small>
          </dd>
        </div>
        <div className="resource-popover-storage">
          <dt>
            <Database size={14} aria-hidden="true" />
            {t('Storage', 'Penyimpanan')}
          </dt>
          <dd>
            <strong>{storageValue === null ? '—' : unlimited ? `${storageValue} / ∞` : quota === null ? '—' : `${storageValue} / ${formatBytes(quota, intlLocale)}`}</strong>
            {!unlimited && <div className="lab-meter" data-level={storageState} role="meter" aria-label={t('Cloud storage used', 'Penyimpanan cloud terpakai')} aria-valuemin={0} aria-valuemax={quota ?? 1} aria-valuenow={meterNow} aria-valuetext={storageAriaText}><span style={{ width: `${meterPercent}%` }} /></div>}
            <small>{storageBreakdown}</small>
          </dd>
        </div>
      </dl>
      <footer>
        <div className="resource-popover-actions">
          {!unlimited && <a href="/billing#payments">{t('Top Up', 'Isi Ulang')}</a>}
          <a href="/billing">{unlimited ? t('Usage details', 'Detail pemakaian') : t('Billing', 'Billing')}<ExternalLink size={11} aria-hidden="true" /></a>
        </div>
      </footer>
    </section>}
  </div>;
}

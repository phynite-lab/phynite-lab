/* eslint-disable @next/next/no-html-link-for-pages -- Vinext uses full document navigation on Cloudflare. */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, FileText, RefreshCw } from 'lucide-react';
import { useSettingsAnchor } from '../use-settings-anchor';
import { useAccountUsage } from '../use-account-usage';
import { SettingsPage } from '@/components/SettingsPage';
import { useSession } from '../use-session';
import { useLabAccount } from '../use-lab-account';
import { useLocale } from '../locale-provider';
import { PlanOptions } from '../plan-options';
import { accountRequest, type AccountResponse, type PlanId } from '@/lib/account-api';
import { localizedPlans, publicPlanId } from '@/lib/plans';
import { BillingPaymentsPanel } from '@/components/BillingPaymentsPanel';
import { computeReturnPath } from '@/lib/billing-return';
import { ResearchOrganizationsPanel } from '@/components/ResearchOrganizationsPanel';
import { useComputeCatalog } from '../use-compute-catalog';
import { computeCapacityLabel } from '@/lib/compute-selection';
import { QuantaMark } from '@/components/QuantaMark';

export function BillingExperience() {
  const { session, ready } = useSession();
  const { account, setAccount, error, refresh } = useLabAccount(session?.user.id);
  const { t, locale, intlLocale } = useLocale();
  const { catalog } = useComputeCatalog(Boolean(account?.computeProfileId));
  const selected = catalog?.profiles.find(item => item.id === account?.computeProfileId);
  const selectedCapacity = computeCapacityLabel(selected ? { ...selected, memoryMiB: account?.cloudMode === 'pilot' ? Math.min(selected.memoryMiB, account.pilotCompute?.limits.memoryMiB ?? 6144) : selected.memoryMiB } : undefined, intlLocale);
  const { usage, error: usageError, loading, stale: usageStale, refresh: refreshUsage } = useAccountUsage(session?.user.id, true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useSettingsAnchor(Boolean(session && ready));
  useEffect(() => {
    if (!session) return;
    const destination = computeReturnPath(new URL(window.location.href).searchParams.get('returnTo'));
    if (destination) sessionStorage.setItem('phynite:compute-return:' + session.user.id, destination);
  }, [session]);
  useEffect(() => {
    if (ready && !session) window.location.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
  }, [ready, session]);
  const refreshPaidAccount = useCallback(async () => { await refresh(); }, [refresh]);
  const choose = async (planId: PlanId) => {
    setBusy(planId); setNotice('');
    try {
      const result = await accountRequest<AccountResponse>('/plan', 'PUT', { planId }); setAccount(result.account);
      setNotice(planId !== 'free' ? t('Activation requested. The team will confirm payment and access; your active plan has not changed.', 'Aktivasi diajukan. Tim akan mengonfirmasi pembayaran dan akses; paket aktif belum berubah.') : t('Your plan has been updated. Review your compute destination in Account before starting a new run.', 'Paket diperbarui. Periksa tujuan komputasi di Akun sebelum menjalankan kalkulasi baru.'));
    } catch { setNotice(t('Your plan could not be updated. Try again.', 'Paket belum dapat diperbarui. Coba lagi.')); }
    finally { setBusy(''); }
  };
  if (!ready || !session) return <main className="workspace-loading">{t('Opening billing...', 'Membuka tagihan...')}</main>;
  const plan = localizedPlans(locale).find(item => item.id === publicPlanId(account?.planId));
  return <SettingsPage session={session} title={t('Billing', 'Tagihan')} description={t('Manage Quanta, storage purchases, and your research plan.', 'Kelola Quanta, pembelian storage, dan paket riset Anda.')} actions={<a className="lab-button" href="/pricing"><FileText size={16} />{t('Pricing details', 'Detail harga')}</a>}><div className="settings-billing-adapter studio-billing">
    <nav className="studio-tabs" aria-label={t('Billing sections', 'Bagian tagihan')}><a href="#overview">{t('Overview', 'Ringkasan')}</a><a href="#payments">{t('Quanta & storage', 'Quanta & storage')}</a><a href="/billing/history">{t('Purchase history', 'Riwayat pembelian')}</a><a href="#plans">{t('Plans', 'Paket')}</a></nav>
    {notice && <div className="lab-notice" role="status">{notice}</div>}
    {error && <div className="lab-notice" role="alert">{t('Account details are unavailable.', 'Detail akun belum tersedia.')}<button onClick={() => void refresh()}>{t('Retry', 'Coba lagi')}</button></div>}
    <section className="billing-overview" id="overview"><div><span className="lab-eyebrow">{t('Active plan', 'Paket aktif')}</span><h2>{plan?.name ?? t('Loading...', 'Memuat...')}</h2><p>{plan?.description}</p><a className="lab-text-link" href="#plans">{t('Compare plans', 'Bandingkan paket')}<ArrowUpRight size={14} /></a></div><dl><div><dt>{t('Subscription', 'Langganan')}</dt><dd>{!account ? '—' : account.billingStatus === 'free' ? t('No subscription charge', 'Tanpa biaya langganan') : account.billingStatus}</dd></div><div><dt>{t('Compute destination', 'Tujuan komputasi')}</dt><dd>{!account ? '—' : account.computeTarget === 'personal' ? t('Your computer', 'Komputer Anda') : t('Shared compute', 'Komputasi bersama')}</dd></div><div><dt>{t('Selected resources', 'Resource terpilih')}</dt><dd>{account ? account.computeTarget === 'shared' ? (selectedCapacity ?? t('Choose in the lab drawer', 'Pilih di drawer lab')) : <a href="/account/compute">{t('View workload defaults', 'Lihat default workload')}</a> : '—'}</dd></div></dl></section>
    <BillingPaymentsPanel ownerId={session.user.id} account={account} usage={usage} inventoryStale={usageStale} onPaid={refreshPaidAccount} />
    <section className="billing-section" id="usage"><header className="studio-section-title"><div><h2>{t('Research usage', 'Pemakaian riset')}</h2><p>{t('Compute time and job receipts live in Usage; storage details live in Storage.', 'Waktu compute dan rincian job tersedia di Pemakaian; detail penyimpanan tersedia di Penyimpanan.')}</p></div><div className="lab-actions"><a className="lab-button" href="/account/usage">{t('Open usage', 'Buka pemakaian')}<ArrowUpRight size={14} /></a><a className="lab-button" href="/account/storage">{t('Open storage', 'Buka penyimpanan')}<ArrowUpRight size={14} /></a></div></header>{usageError && <p role="alert" className="lab-notice">{t('Storage measurements could not be refreshed.', 'Pengukuran penyimpanan belum dapat diperbarui.')}<button type="button" className="lab-button" onClick={() => void refreshUsage().catch(() => undefined)} disabled={loading}><RefreshCw size={14} />{t('Retry', 'Coba lagi')}</button></p>}</section>
    <section className="billing-section billing-compute-ledger" aria-labelledby="compute-ledger-title"><header className="studio-section-title"><div><h2 id="compute-ledger-title">{t('Compute ledger', 'Ledger compute')}</h2><p>{t('Your available credit, current reservations and actual job charges.', 'Kredit tersedia, reservasi berjalan, dan biaya job aktual.')}</p></div><a className="lab-button" href="#payments"><QuantaMark size={20} />{t('Top up Quanta', 'Top-up Quanta')}<ArrowUpRight size={14} /></a></header>
      <dl className="billing-quanta-summary">{[
        [t('Available Quanta', 'Quanta tersedia'), account?.quanta.available ?? account?.quanta.balance],
        [t('Reserved', 'Direservasi'), account?.quanta.reserved],
        [t('Used this month', 'Terpakai bulan ini'), account?.quanta.usedThisMonth],
        [t('Refunded this month', 'Refund bulan ini'), account?.quanta.refundedThisMonth],
      ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{typeof value === 'number' ? value.toLocaleString(intlLocale, { maximumFractionDigits:6 }) : '—'} <small>Quanta</small></dd></div>)}</dl>
      <p className="lab-caption"><a href="/account/usage">{t('View job charges and refunds in Usage', 'Lihat biaya job dan refund di Pemakaian')} →</a></p>
    </section>
    <ResearchOrganizationsPanel />
    <section className="billing-section" id="plans"><header className="studio-section-title"><div><h2>{t('Choose how you compute', 'Pilih cara komputasi')}</h2><p>{t('Personal compute is free. Verified production Quanta funds all cloud workflows according to available balance and capacity. Pilot grants use a separate operating budget.', 'Compute personal gratis. Quanta produksi terverifikasi mendanai seluruh workflow Cloud sesuai saldo dan kapasitas. Grant pilot memakai budget operasional terpisah.')}</p></div></header><PlanOptions account={account} busy={busy} onChoose={planId => void choose(planId)} />{account?.requestedPlan && account.requestedPlan !== 'personal' && <p className="lab-caption">{t('Registered interest', 'Minat terdaftar')}: {account.requestedPlan}. {t('Your active plan continues until new terms are agreed.', 'Paket aktif tetap berlaku hingga ketentuan baru disepakati.')}</p>}</section>
  </div></SettingsPage>;
}

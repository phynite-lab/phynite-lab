'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, HardDrive, RefreshCw } from 'lucide-react';
import { QuantaMark } from '@/components/QuantaMark';
import { UiSelect } from '@/components/UiSelect';
import { useLocale } from '@/app/locale-provider';
import type { AccountUsage, LabAccount } from '@/lib/account-api';
import { billingPaymentsRequest, checkoutRequestKey, type BillingPayments, type PaymentStatus } from '@/lib/billing-api';
import { quantaPurchase, quantaQuantityFromSearch } from '@/lib/quanta-purchase';
import { supportEmail, supportHref } from '@/lib/support';

export function BillingPaymentsPanel({ ownerId, account, usage, inventoryStale = false, onPaid }: { inventoryStale?: boolean; ownerId: string; account?: LabAccount | null; usage?: AccountUsage | null; onPaid: () => Promise<void> }) {
  const { t, intlLocale } = useLocale();
  const amountId = useId();
  const [data, setData] = useState<BillingPayments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState('5');
  const initializedQuantityOwner = useRef<string | null>(null);
  const [storageId, setStorageId] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await billingPaymentsRequest(); setData(result);
      if (result.available && initializedQuantityOwner.current !== ownerId) {
        initializedQuantityOwner.current = ownerId;
        const suggestedQuantity = quantaQuantityFromSearch(window.location.search, result);
        if (suggestedQuantity !== null) setQuantity(suggestedQuantity);
      }
      for (const order of result.payments) if (order.paymentMethod && ['PAID', 'EXPIRED', 'REJECTED'].includes(order.status)) sessionStorage.removeItem(checkoutRequestKey(ownerId, order.environment, order.offerId, order.paymentMethod));
    } catch { setError(t('Payments could not be loaded. Try refreshing.', 'Pembayaran belum dapat dimuat. Coba perbarui.')); }
    finally { setLoading(false); }
  }, [t, ownerId]);
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('payment');
    if (id && /^PL[A-F0-9]{26}$/.test(id)) { window.location.replace(`/billing/payments/${id}`); return; }
    queueMicrotask(() => void refresh());
  }, [refresh]);
  const money = (amount: number) => new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
  const number = (value: number) => value.toLocaleString(intlLocale, { maximumFractionDigits: 6 });
  const size = (bytes: number) => bytes === 1024 ** 4 ? '1 TiB' : `${number(bytes / 1024 ** 3)} GiB`;
  const purchase = data ? quantaPurchase(quantity, data) : null;
  const storageOffers = data?.offers.filter(offer => offer.kind === 'storage') ?? [];
  const subscription = data?.subscription?.active ? data.subscription : null;
  const canChoose = (bytes: number) => !subscription || bytes >= subscription.storageBytes;
  const storage = storageOffers.find(offer => offer.id === storageId && canChoose(offer.storageBytes ?? 0)) ?? storageOffers.find(offer => canChoose(offer.storageBytes ?? 0));
  const allowance = account?.limits.researchBytes ?? usage?.storage.cloudQuotaBytes ?? subscription?.storageBytes;
  const balance = account?.quanta.available ?? account?.quanta.balance;
  const statuses: Record<PaymentStatus, string> = { INITIALIZING: t('Awaiting confirmation', 'Menunggu konfirmasi'), PENDING: t('Awaiting payment', 'Menunggu pembayaran'), PAID: t('Paid', 'Lunas'), EXPIRED: t('Expired', 'Kedaluwarsa'), REJECTED: t('Could not be started', 'Belum dapat dimulai') };

  return <section className="billing-section billing-purchases" id="payments" aria-labelledby="billing-purchases-title">
    <header className="studio-section-title"><div><h2 id="billing-purchases-title">{t('Quanta & storage', 'Quanta & storage')}</h2><p>{t('Add credit for your next run, or more room for your results.', 'Tambah kredit untuk job berikutnya, atau ruang untuk hasil riset.')}</p></div><div className="lab-actions"><a className="lab-button" href="/billing/history">{t('Purchase history', 'Riwayat pembelian')}<ArrowUpRight size={14} /></a><button className="lab-button" onClick={() => { void refresh(); void onPaid(); }} disabled={loading} aria-label={t('Refresh payments and balance', 'Perbarui pembayaran dan saldo')}><RefreshCw size={14} /></button></div></header>
    {error && <p className="lab-notice" role="alert">{error}</p>}
    {loading && !data && <p role="status">{t('Loading payments…', 'Memuat pembayaran…')}</p>}
    {data && !data.available && <p className="lab-notice">{t('Payment setup is being completed. New purchases are not available yet.', 'Konfigurasi pembayaran sedang diselesaikan. Pembelian baru belum tersedia.')}</p>}
    {data?.environment === 'sandbox' && <p className="lab-notice">{t('DOKU sandbox: test purchases do not activate real storage or spendable credit.', 'Sandbox DOKU: pembelian uji tidak mengaktifkan storage atau credit sungguhan.')}</p>}
    {data?.available && <div className="billing-purchase-grid">
      <article className="billing-purchase-card billing-topup" aria-labelledby="billing-topup-title">
        <header className="billing-card-heading"><span className="billing-card-icon"><QuantaMark variant="tile" size={32} /></span><div><h3 id="billing-topup-title">{t('Top up Quanta', 'Top-up Quanta')}</h3><p>{t('One balance for DFT, MD and analysis.', 'Satu saldo untuk DFT, MD, dan analisis.')}</p></div></header>
        <div className="billing-balance-line"><span>{t('Available balance', 'Saldo tersedia')}</span><strong>{balance === undefined ? '—' : number(balance)} <small>Quanta</small></strong></div>
        <form onSubmit={event => { event.preventDefault(); if (purchase && !loading) window.location.assign(`/billing/checkout?offer=${purchase.offerId}`); }}>
          <label className="billing-amount-label" htmlFor={amountId}>{t('Quanta amount', 'Jumlah Quanta')}</label>
          <div className="billing-amount-control" data-invalid={!purchase}><input id={amountId} type="text" inputMode="decimal" autoComplete="off" maxLength={12} value={quantity} onChange={event => setQuantity(event.target.value)} aria-invalid={!purchase} aria-describedby={`${amountId}-hint`} disabled={loading} /><span>Quanta</span></div>
          <p className="billing-amount-hint" id={`${amountId}-hint`}>{!purchase ? data.customQuanta ? t(`Enter ${number(data.customQuanta.minimum)}–${number(data.customQuanta.maximum)} Quanta, with up to 2 decimal places.`, `Masukkan ${number(data.customQuanta.minimum)}–${number(data.customQuanta.maximum)} Quanta, maksimal 2 angka desimal.`) : t('Choose an available amount below.', 'Pilih nominal yang tersedia di bawah.') : t('Enter your own amount, or choose a quick amount.', 'Tulis nominal sendiri, atau pilih nominal cepat.')}</p>
          <div className="billing-quanta-presets" role="group" aria-label={t('Quick Quanta amounts', 'Nominal Quanta cepat')}>{data.offers.filter(offer => offer.kind === 'quanta').map(offer => <button type="button" key={offer.id} aria-pressed={purchase?.quanta === offer.quanta} disabled={loading} onClick={() => setQuantity(String(offer.quanta))}>{number(offer.quanta ?? 0)} <span>Q</span></button>)}</div>
          <dl className="billing-purchase-quote" aria-live="polite" aria-atomic="true"><div><dt>{t('Top-up value', 'Nilai top-up')}</dt><dd>{purchase ? money(purchase.baseAmountIdr) : '—'}</dd></div>{data.idrPerQuanta && <div><dt>{t('Price per Quanta', 'Harga per Quanta')}</dt><dd>{money(data.idrPerQuanta)}</dd></div>}</dl>
          <button type="submit" className="lab-button billing-purchase-submit" disabled={!purchase || loading}>{t('Continue to checkout', 'Lanjut ke checkout')}<ArrowRight size={16} /></button>
        </form>
        <p className="billing-purchase-footnote"><Check size={14} />{t('Credit added after verified payment. You choose when to run.', 'Kredit masuk setelah pembayaran terverifikasi. Anda pilih kapan job berjalan.')}</p>
      </article>
      <article className="billing-purchase-card billing-storage" aria-labelledby="billing-storage-title">
        <header className="billing-card-heading"><span className="billing-card-icon"><HardDrive size={22} /></span><div><h3 id="billing-storage-title">{t('Cloud storage', 'Storage cloud')}</h3><p>{t('Structures, trajectories and results, together.', 'Struktur, trajectory, dan hasil dalam satu kuota.')}</p></div></header>
        <div className="billing-storage-current"><div><span>{t('Current allowance', 'Kuota saat ini')}</span><strong>{allowance === undefined ? '—' : size(allowance)} <small>{subscription ? t('Paid', 'Berbayar') : 'Free'}</small></strong></div>{usage && allowance !== undefined && <><div className="lab-meter" role="meter" aria-label={t('Total cloud storage used', 'Total storage cloud terpakai')} aria-valuemin={0} aria-valuemax={Math.max(allowance, usage.storage.bytes)} aria-valuenow={usage.storage.bytes}><span style={{ width: `${Math.min(100, usage.storage.bytes / Math.max(1, allowance) * 100)}%` }} /></div><p>{size(usage.storage.bytes)}{!usage.storage.complete && '+'} {t('used', 'terpakai')}{Boolean(usage.storage.uploadReservedBytes) && ` · ${size(usage.storage.uploadReservedBytes!)} ${t('reserved', 'direservasi')}`}</p></>}{usage && <p className="lab-caption">{t('Measured', 'Diukur')} {new Date(usage.measuredAt).toLocaleString(intlLocale)}{!usage.storage.complete && ` · ${t('Partial inventory', 'Inventaris parsial')}`}{inventoryStale && ` · ${t('May have changed', 'Mungkin telah berubah')}`}</p>}{subscription && <p>{t('Active until', 'Aktif sampai')} {new Date(subscription.expiresAt).toLocaleDateString(intlLocale)}</p>}</div>
        {storage ? <><UiSelect label={t('Total storage allowance', 'Kuota total storage')} value={storage.id} options={storageOffers.map(offer => ({ value: offer.id, label: size(offer.storageBytes ?? 0), detail: `${money(offer.baseAmountIdr ?? offer.amountIdr)} / 30 ${t('days', 'hari')}${canChoose(offer.storageBytes ?? 0) ? '' : ' · ' + t('After expiry', 'Setelah kedaluwarsa')}`, disabled: !canChoose(offer.storageBytes ?? 0) }))} onChange={setStorageId} disabled={loading} />
          <dl className="billing-purchase-quote"><div><dt>{t('Storage price', 'Harga storage')}</dt><dd>{money(storage.baseAmountIdr ?? storage.amountIdr)}<small>/ 30 {t('days', 'hari')}</small></dd></div><div><dt>{t('Renewal', 'Perpanjangan')}</dt><dd>{t('Manual', 'Manual')}</dd></div></dl>
          <a className="lab-button billing-storage-submit" href={`/billing/checkout?offer=${storage.id}`}>{subscription?.storageBytes === storage.storageBytes ? t('Renew storage', 'Perpanjang storage') : t('Upgrade storage', 'Tambah storage')}<ArrowRight size={16} /></a>
        </> : <p className="lab-notice">{t('Storage purchases are not available. Contact support for more capacity.', 'Pembelian storage belum tersedia. Hubungi support untuk tambahan kapasitas.')}</p>}
        <p className="billing-storage-terms">{t('Free includes 10 GiB. Paid tiers replace the total allowance. Remaining paid value adds extra time when upgrading.', 'Free mencakup 10 GiB. Paket berbayar menggantikan kuota total. Nilai sisa pembayaran menambah waktu saat upgrade.')}</p>
        <p className="billing-storage-support">{t('Above 1 TiB?', 'Di atas 1 TiB?')} <a href={supportHref}>{supportEmail}</a></p>
      </article>
    </div>}
    {data?.available && <div className="billing-payment-method-note"><span>{t('Payments by', 'Pembayaran melalui')} <strong>DOKU</strong></span><p>{data.paymentMethods?.includes('QRIS') && t('QRIS has no extra fee. ', 'QRIS tanpa biaya tambahan. ')}{data.paymentMethods?.includes('VIRTUAL_ACCOUNT_DOKU') && t('Virtual Account adds Rp4,000. ', 'Virtual Account menambah Rp4.000. ')}{t('Review the exact total at checkout.', 'Periksa total pasti di checkout.')}</p></div>}
    {(data?.payments.length ?? 0) > 0 && <div className="billing-payment-history"><h3>{t('Recent orders', 'Pesanan terbaru')}</h3><ul>{data!.payments.slice(0, 5).map(order => <li key={order.id}><div><strong>{order.name}</strong><p>{money(order.amountIdr)} · {statuses[order.status]}</p><small>{new Date(order.createdAt).toLocaleDateString(intlLocale)}</small></div><a className="lab-button" href={`/billing/payments/${order.id}`}>{t('Order details', 'Detail pesanan')}<ArrowUpRight size={14} /></a></li>)}</ul></div>}
  </section>;
}

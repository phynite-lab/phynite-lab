'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Clock, Copy, CreditCard, HardDrive, RefreshCw } from 'lucide-react';
import { QuantaMark } from '@/components/QuantaMark';
import { SettingsPage } from '@/components/SettingsPage';
import { resourceAccountStore } from '@/lib/resource-account-store';
import { invalidateResourceUsageStores } from '@/lib/resource-usage-store';
import { useSession } from '../use-session';
import { useLocale } from '../locale-provider';
import { UiSelect } from '@/components/UiSelect';
import { computeReturnPath } from '@/lib/billing-return';
import { AccountRequestError } from '@/lib/account-api';
import { billingPaymentsRequest, checkoutRequest, checkoutRequestKey, paymentHistoryRequest, paymentRequest, reconcilePaymentRequest, trustedCheckoutUrl, type BillingPayments, type PaymentMethod, type PaymentOffer, type PaymentOrder, type PaymentStatus } from '@/lib/billing-api';
import { supportEmail, supportHref } from '@/lib/support';

function BillingShell({ children }: { children: (owner: string) => ReactNode }) {
  const { session, ready } = useSession();
  const { t } = useLocale();
  useEffect(() => {
    if (ready && !session) window.location.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [ready, session]);
  if (!ready || !session) return <main className="workspace-loading">{t('Opening billing…', 'Membuka tagihan…')}</main>;
  return <SettingsPage hideHeading session={session} title={t('Billing', 'Tagihan')} description={t('Your purchases and payments.', 'Pembelian dan pembayaran Anda.')}><div className="settings-payment-adapter">{children(session.user.id)}</div></SettingsPage>;
}

function usePaymentLabels() {
  const { t, intlLocale } = useLocale();
  return {
    money: (amount: number) => new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount),
    date: (value: string) => new Date(value).toLocaleString(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }),
    product: (offer: PaymentOffer) => offer.kind === 'storage' ? `${(offer.storageBytes ?? 0) / 1024 ** 3 === 1024 ? '1 TiB' : `${(offer.storageBytes ?? 0) / 1024 ** 3} GiB`} ${t('cloud storage', 'storage cloud')}` : `${offer.quanta} Quanta`,
    status: (value: PaymentStatus) => ({ INITIALIZING: t('Awaiting confirmation', 'Menunggu konfirmasi'), PENDING: t('Awaiting payment', 'Menunggu pembayaran'), PAID: t('Paid', 'Lunas'), EXPIRED: t('Expired', 'Kedaluwarsa'), REJECTED: t('Could not be started', 'Belum dapat dimulai') })[value],
  };
}

function PaymentLinks() {
  const { t } = useLocale();
  return <nav className="payment-links" aria-label={t('Billing navigation', 'Navigasi tagihan')}><a href="/billing"><ArrowLeft size={14} />{t('Billing & usage', 'Tagihan & pemakaian')}</a><a href="/billing/history">{t('Purchase history', 'Riwayat pembelian')}<ArrowUpRight size={14} /></a></nav>;
}

function PaymentSupport() {
  const { t } = useLocale();
  return <p className="payment-support">{t('Need help with this purchase?', 'Butuh bantuan untuk pembelian ini?')} <a href={supportHref}>{supportEmail}</a></p>;
}

function Receipt({ offer, price, method }: { offer: PaymentOffer; price: { baseAmountIdr: number; paymentFeeIdr: number; amountIdr: number }; method?: PaymentMethod }) {
  const { t } = useLocale();
  const { money, product } = usePaymentLabels();
  return <aside className="payment-receipt" aria-label={t('Order summary', 'Ringkasan pesanan')}><p className="lab-eyebrow">{t('Your resource', 'Sumber daya Anda')}</p><div className="payment-resource-icon">{offer.kind === 'storage' ? <HardDrive size={24} /> : <QuantaMark variant="tile" size={40} />}</div><h2>{product(offer)}</h2><p className="payment-resource-note">{offer.kind === 'storage' ? t('Total account allowance · 30 days', 'Kuota total akun · 30 hari') : t('Credit for all Cloud workflows', 'Kredit untuk seluruh workflow Cloud')}</p><dl className="payment-price-lines"><div><dt>{t('Base price', 'Harga dasar')}</dt><dd>{money(price.baseAmountIdr)}</dd></div><div><dt>{method === 'VIRTUAL_ACCOUNT_DOKU' ? t('Virtual Account fee', 'Biaya Virtual Account') : t('Payment fee', 'Biaya pembayaran')}</dt><dd>{money(price.paymentFeeIdr)}</dd></div><div className="payment-total"><dt>{t('Total payment', 'Total pembayaran')}</dt><dd>{money(price.amountIdr)}</dd></div></dl><p className="lab-caption">{t('Payment processed by DOKU', 'Pembayaran diproses oleh DOKU')}</p></aside>;
}

export function CheckoutExperience() {
  return <BillingShell>{owner => <Checkout owner={owner} />}</BillingShell>;
}

function Checkout({ owner }: { owner: string }) {
  const { t } = useLocale();
  const { money, product } = usePaymentLabels();
  const [catalog, setCatalog] = useState<BillingPayments | null>(null);
  const [offerId, setOfferId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('QRIS');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const chosenOffer = new URL(window.location.href).searchParams.get('offer') ?? '';
      const result = await billingPaymentsRequest(chosenOffer);
      setCatalog(result); setOfferId(chosenOffer);
      const selected = result.offers.find(item => item.id === chosenOffer);
      const storedMethod = sessionStorage.getItem(`phynite:checkout-method:${owner}:${result.environment}:${chosenOffer}`) as PaymentMethod | null;
      setMethod(storedMethod && selected?.prices?.[storedMethod] && result.paymentMethods?.includes(storedMethod) ? storedMethod : selected?.prices?.QRIS ? 'QRIS' : result.paymentMethods?.find(value => selected?.prices?.[value]) ?? 'VIRTUAL_ACCOUNT_DOKU');
    } catch { setError(t('Checkout could not be loaded. Try again.', 'Checkout belum dapat dimuat. Coba lagi.')); }
    finally { setLoading(false); }
  }, [t, owner]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const offer = catalog?.offers.find(item => item.id === offerId);
  const price = offer?.prices?.[method];
  const downgrade = Boolean(offer?.kind === 'storage' && catalog?.subscription?.active && (offer.storageBytes ?? 0) < catalog.subscription.storageBytes);
  const submit = async () => {
    if (submitting.current || !offer || !price || downgrade) return;
    submitting.current = true; setBusy(true); setError('');
    const key = checkoutRequestKey(owner, catalog!.environment!, offer.id, method);
    try {
      const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID();
      sessionStorage.setItem(key, requestId);
      const { payment } = await checkoutRequest(offer.id, requestId, method);
      if (['PAID', 'EXPIRED', 'REJECTED'].includes(payment.status)) sessionStorage.removeItem(key);
      window.location.assign(`/billing/payments/${payment.id}`);
    } catch (failure) {
      if (failure instanceof AccountRequestError && failure.code === 'PAYMENT_INITIALIZING') {
        setError(t('This order is awaiting confirmation. Open purchase history before retrying; your request has been saved.', 'Pesanan ini menunggu konfirmasi. Buka riwayat pembelian sebelum mencoba lagi; identitas permintaan tersimpan.'));
      } else setError(failure instanceof Error ? failure.message : t('The order could not be created. Try again with the same selection.', 'Pesanan belum dapat dibuat. Coba lagi dengan pilihan yang sama.'));
    } finally { submitting.current = false; setBusy(false); }
  };
  return <><PaymentLinks /><header className="studio-heading"><div><p className="lab-eyebrow">{t('A little more room to research', 'Tambah ruang untuk riset')}</p><h1>{t('Checkout', 'Checkout')}</h1><p>{t('Review your resource and choose how to pay.', 'Periksa sumber daya dan pilih cara pembayaran.')}</p></div></header>
    {error && <div className="lab-notice" role="alert">{error} {!catalog && <button className="lab-button" onClick={() => void load()}>{t('Retry', 'Coba lagi')}</button>}</div>}
    {loading ? <p role="status">{t('Loading checkout…', 'Memuat checkout…')}</p> : !catalog?.available ? <div className="payment-empty"><CreditCard size={28} /><h2>{t('Purchases are not available yet', 'Pembelian belum tersedia')}</h2><p>{t('Payment setup is being completed. Your Free account includes 10 GiB.', 'Konfigurasi pembayaran sedang diselesaikan. Akun Free mencakup 10 GiB.')}</p><a className="lab-button" href="/billing">{t('Back to billing', 'Kembali ke tagihan')}</a></div> : !offer ? <div className="payment-empty"><h2>{t('Choose a resource first', 'Pilih sumber daya dahulu')}</h2><p>{t('This offer is unavailable for new purchases. Existing orders remain in your history.', 'Penawaran ini tidak tersedia untuk pembelian baru. Pesanan sebelumnya tetap ada di riwayat.')}</p><a className="lab-button" href="/billing#payments">{t('View available offers', 'Lihat penawaran tersedia')}</a></div> : <>
    {catalog.environment === 'sandbox' && <p className="lab-notice" role="status">{t('Sandbox test: this purchase will not activate real storage or spendable credit.', 'Uji sandbox: pembelian ini tidak mengaktifkan storage atau credit sungguhan.')}</p>}
    <div className="payment-columns payment-columns--checkout"><section className="payment-form"><h2>{t('Payment method', 'Metode pembayaran')}</h2><fieldset className="payment-methods" disabled={busy}><legend className="sr-only">{t('Choose a payment method', 'Pilih metode pembayaran')}</legend>{[...(catalog.paymentMethods ?? [])].sort((a, b) => Number(b === 'QRIS') - Number(a === 'QRIS')).map(value => <label key={value} data-selected={method === value}><input type="radio" name="payment-method" value={value} disabled={!offer.prices?.[value]} checked={method === value} onChange={() => { setMethod(value); sessionStorage.setItem(`phynite:checkout-method:${owner}:${catalog.environment}:${offer.id}`, value); }} /><span><strong>{value === 'QRIS' ? 'QRIS' : 'DOKU Virtual Account'}</strong><small>{value === 'QRIS' ? t('Banking and wallet apps · processed by DOKU', 'Aplikasi bank dan dompet · diproses oleh DOKU') : t('Pay the exact amount via Virtual Account', 'Bayar nominal persis melalui Virtual Account')}</small></span><span className="payment-method-fee">{!offer.prices?.[value] ? t('Amount above limit', 'Nominal di atas batas') : offer.prices?.[value]?.paymentFeeIdr === 0 ? t('No extra fee', 'Tanpa biaya tambahan') : '+' + money(offer.prices?.[value]?.paymentFeeIdr ?? 0)}<small>{t('Payment fee', 'Biaya pembayaran')}</small></span></label>)}</fieldset>
    <div className="payment-terms"><h3>{t('What happens after payment', 'Setelah pembayaran')}</h3><p>{offer.kind === 'storage' ? t('Your paid allowance replaces the Free 10 GiB across all projects. The same tier adds 30 days. An upgrade starts immediately, with the remaining paid base value converted into extra time. Gateway fees are excluded.', 'Kuota berbayar menggantikan Free 10 GiB di semua project. Paket yang sama menambah 30 hari. Upgrade langsung aktif dan nilai sisa harga dasar dikonversi menjadi tambahan waktu, tanpa biaya gateway.') : t('Verified production payment adds Quanta once and funds all cloud workflows according to balance and capacity. Return to your configuration and choose when to run.', 'Pembayaran produksi terverifikasi menambah Quanta tepat sekali untuk seluruh workflow Cloud sesuai saldo dan kapasitas. Kembali ke konfigurasi dan pilih kapan menjalankan job.')}</p><p>{offer.kind === 'storage' ? t('Manual renewal. A downgrade can start after expiry. Over-quota accounts can still read, download and delete files; new data is blocked. Large transfers are reviewed through support, with no automatic charge.', 'Perpanjangan manual. Downgrade setelah masa aktif habis. Akun melebihi kuota tetap dapat membaca, mengunduh, dan menghapus file; data baru diblokir. Transfer besar ditinjau melalui support tanpa tagihan otomatis.') : t('No automatic top-up. Local DFT and MD remain free on your connected computer.', 'Tanpa top-up otomatis. DFT dan MD lokal tetap gratis di komputer terhubung.')}</p></div>
    {downgrade && <p className="lab-notice" role="status">{t('Choose this smaller tier after your active storage period expires.', 'Pilih paket yang lebih kecil setelah periode storage aktif berakhir.')}</p>}
    <button className="lab-button payment-submit" disabled={busy || !price || downgrade} onClick={() => void submit()}>{busy ? t('Recording order…', 'Mencatat pesanan…') : t('Create order', 'Buat pesanan')}<ArrowUpRight size={16} /></button><p className="lab-caption">{t('You will receive payment instructions here and an order notification in your inbox.', 'Instruksi pembayaran tampil di sini dan notifikasi pesanan masuk ke inbox Anda.')}</p><PaymentSupport /></section>{price && <Receipt offer={offer} price={price} method={method} />}</div><span className="sr-only">{product(offer)}</span></>}
  </>;
}

function QrisCode({ content }: { content: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const { t } = useLocale();
  useEffect(() => {
    let active = true;
    void import('qrcode').then(module => {
      if (active && canvas.current) return module.default.toCanvas(canvas.current, content, { width: 288, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [content]);
  return failed ? <p role="alert">{t('The QR code could not be rendered. Refresh this order or contact support.', 'QR belum dapat ditampilkan. Perbarui pesanan atau hubungi support.')}</p> : <canvas ref={canvas} className="payment-qr" role="img" aria-label={t('QRIS payment code', 'Kode pembayaran QRIS')} />;
}

export function PaymentExperience({ id }: { id: string }) {
  return <BillingShell>{owner => <PaymentDetail id={id} owner={owner} />}</BillingShell>;
}

function PaymentDetail({ id, owner }: { id: string; owner: string }) {
  const { t, locale } = useLocale();
  const { money, date, product, status } = usePaymentLabels();
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [cooldown, setCooldown] = useState(0);
  const [returnTo, setReturnTo] = useState('/workspace');
  useEffect(() => {
    queueMicrotask(() => setReturnTo(computeReturnPath(sessionStorage.getItem('phynite:compute-return:' + owner)) ?? '/workspace'));
  }, [owner]);
  useEffect(() => {
    if (order?.status !== 'PAID' || order.environment !== 'production') return;
    if (order.kind === 'storage') invalidateResourceUsageStores(owner);
    void resourceAccountStore(owner).refresh().catch(() => {});
    window.dispatchEvent(new Event('phynite:balance-change'));
  }, [order?.status, order?.environment, order?.kind, owner]);
  const terminal = order && ['PAID', 'EXPIRED', 'REJECTED'].includes(order.status);
  const accept = useCallback((payment: PaymentOrder) => {
    setOrder(payment);
    if (payment.paymentMethod && ['PAID', 'EXPIRED', 'REJECTED'].includes(payment.status)) sessionStorage.removeItem(checkoutRequestKey(owner, payment.environment, payment.offerId, payment.paymentMethod));
  }, [owner]);
  const refresh = useCallback(async () => {
    try { const value = await paymentRequest(id); accept(value.payment); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Order could not be loaded.', 'Pesanan belum dapat dimuat.')); }
  }, [id, accept, t]);
  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 8000);
    return () => window.clearInterval(timer);
  }, [refresh, terminal]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil(Math.max(order?.nextCheckAt ?? 0, cooldown) - now));
  const reconcile = async () => {
    if (busy || remaining || !order) return;
    setBusy(true); setError(''); setCooldown(Math.floor(Date.now() / 1000) + 60);
    try { accept((await reconcilePaymentRequest(id)).payment); }
    catch (failure) {
      if (failure instanceof AccountRequestError && failure.retryAfter) setCooldown(Math.floor(Date.now() / 1000) + failure.retryAfter);
      setError(failure instanceof Error ? failure.message : t('Payment is awaiting confirmation.', 'Pembayaran menunggu konfirmasi.'));
    } finally { setBusy(false); }
  };
  const copy = async (number: string) => {
    try { await navigator.clipboard.writeText(number); setCopied(true); }
    catch { setError(t('Copy is unavailable. Select the account number and copy it manually.', 'Salin belum tersedia. Pilih nomor rekening dan salin secara manual.')); }
  };
  const instructions = order?.instructions;
  const deadline = order?.expiresAt;
  const elapsed = deadline && Date.parse(deadline) <= now * 1000;
  return <><PaymentLinks /><header className="studio-heading"><div><p className="lab-eyebrow">{t('Purchase details', 'Detail pembelian')}</p><h1>{t('Your order', 'Pesanan Anda')}</h1><p className="payment-order-id">{id}</p></div><button className="lab-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />{t('Refresh', 'Perbarui')}</button></header>
    {error && <p className="lab-notice" role="alert">{error}</p>}
    {!order ? !error && <p role="status">{t('Loading order…', 'Memuat pesanan…')}</p> : <>
      {order.environment === 'sandbox' && <p className="lab-notice">{t('Sandbox test: real storage and credit are unchanged.', 'Uji sandbox: storage dan credit sungguhan tidak berubah.')}</p>}
      <div className="payment-columns"><section className="payment-form"><div className="payment-status" data-status={order.status} role="status">{order.status === 'PAID' ? <Check size={18} /> : <Clock size={18} />}<strong>{status(order.status)}</strong></div>
      {order.status === 'PAID' ? <><h2>{t('Ready for your research', 'Siap untuk riset Anda')}</h2><p>{order.environment === 'sandbox' ? t('Test fulfillment was recorded in the sandbox ledger.', 'Aktivasi uji tercatat di ledger sandbox.') : order.kind === 'storage' ? t('Your storage allowance is active.', 'Kuota storage Anda sudah aktif.') : t('Your Quanta has been added to your account.', 'Quanta sudah ditambahkan ke akun Anda.')}</p>{order.fulfilledUntil && <p>{t('Active until', 'Aktif sampai')}: <strong>{date(order.fulfilledUntil)}</strong></p>}{Boolean(order.convertedSeconds) && <p>{t('Extra time from the remaining paid value', 'Tambahan waktu dari nilai sisa pembayaran')}: {((order.convertedSeconds ?? 0) / 86400).toFixed(2)} {t('days', 'hari')}</p>}<p>{t('Payment never starts a job automatically.', 'Pembayaran tidak otomatis menjalankan job.')}</p><a className="lab-button lab-button-primary" href={returnTo}>{t('Return to configuration', 'Kembali ke konfigurasi')}<ArrowUpRight size={14} /></a><a className="lab-button" href="/md">MD Lab</a><a className="lab-button" href="/calculation">DFT Lab</a><a className="lab-button" href="/billing">{t('View balance', 'Lihat saldo')}</a></> : order.status === 'EXPIRED' || order.status === 'REJECTED' ? <><h2>{order.status === 'EXPIRED' ? t('Payment instruction expired', 'Instruksi pembayaran kedaluwarsa') : t('Payment could not be started', 'Pembayaran belum dapat dimulai')}</h2><p>{t('This order does not have confirmed fulfillment. Create a new order using an available method, or contact support if you have already paid.', 'Belum ada aktivasi terkonfirmasi untuk pesanan ini. Buat pesanan baru memakai metode tersedia, atau hubungi support jika sudah membayar.')}</p><a className="lab-button" href={`/billing/checkout?offer=${encodeURIComponent(order.offerId)}`}>{t('Start a new purchase', 'Buat pembelian baru')}<ArrowUpRight size={14} /></a></> : <>
      {order.lastAttemptStatus === 'FAILED' && <p className="lab-notice">{t('A payment attempt failed. This order is still awaiting payment confirmation.', 'Satu percobaan pembayaran gagal. Pesanan ini masih menunggu konfirmasi pembayaran.')}</p>}
      {order.status === 'INITIALIZING' ? <><h2>{t('Checking payment setup', 'Memeriksa pembuatan pembayaran')}</h2><p>{t('The provider has not confirmed the payment instructions yet. Keep this order number and check again before creating another purchase.', 'Penyedia belum mengonfirmasi instruksi pembayaran. Simpan nomor pesanan ini dan periksa kembali sebelum membuat pembelian lain.')}</p></> : instructions?.type === 'virtual-account' ? <><h2>DOKU Virtual Account</h2><p>{t('Pay exactly', 'Bayar tepat')} <strong>{money(order.amountIdr)}</strong></p><div className="payment-va"><span>{t('Virtual Account number', 'Nomor Virtual Account')}</span><strong>{instructions.number}</strong><button className="lab-button" onClick={() => void copy(instructions.number)}><Copy size={14} />{copied ? t('Copied', 'Tersalin') : t('Copy number', 'Salin nomor')}</button></div><ol className="payment-steps">{(locale === 'id' ? instructions.stepsId ?? instructions.steps : instructions.steps).map(step => <li key={step}>{step}</li>)}</ol></> : instructions?.type === 'qris' ? <><h2>{t('Scan to pay with QRIS', 'Pindai untuk membayar dengan QRIS')}</h2><p>{t('Check the merchant and amount in your banking or wallet app.', 'Periksa merchant dan nominal di aplikasi bank atau dompet Anda.')}</p>{!elapsed && <QrisCode content={instructions.qrContent} />}<p><strong>{money(order.amountIdr)}</strong> · {t('No QRIS surcharge', 'Tanpa surcharge QRIS')}</p></> : order.checkoutUrl ? <LegacyCheckout order={order} /> : <p>{t('Instructions are being confirmed. Check the order before retrying.', 'Instruksi sedang dikonfirmasi. Periksa pesanan sebelum mencoba lagi.')}</p>}
      {deadline && <p className="payment-deadline">{t('Payment instruction valid until', 'Instruksi pembayaran berlaku sampai')}: <time dateTime={deadline}>{date(deadline)}</time></p>}
      {elapsed && <p className="lab-notice">{t('The displayed payment window has ended. Check with DOKU for the confirmed status before paying.', 'Waktu pembayaran yang ditampilkan sudah lewat. Cek ke DOKU untuk status terkonfirmasi sebelum membayar.')}</p>}
      <p className="lab-caption">{t('This page updates after verified payment confirmation. If you have paid, keep the receipt and wait for the status.', 'Halaman diperbarui setelah konfirmasi pembayaran terverifikasi. Jika sudah membayar, simpan bukti dan tunggu statusnya.')}</p><button className="lab-button" disabled={busy || remaining > 0} onClick={() => void reconcile()}><RefreshCw size={14} />{remaining > 0 ? t(`Check in ${remaining}s`, `Cek dalam ${remaining} dtk`) : busy ? t('Checking…', 'Memeriksa…') : t('Check with DOKU', 'Cek ke DOKU')}</button></>}
      <dl className="payment-record"><div><dt>{t('Created', 'Dibuat')}</dt><dd>{date(order.createdAt)}</dd></div>{order.paidAt && <div><dt>{t('Verified', 'Terverifikasi')}</dt><dd>{date(order.paidAt)}</dd></div>}</dl><PaymentSupport /></section><Receipt offer={order} price={{ baseAmountIdr: order.baseAmountIdr ?? order.amountIdr - (order.paymentFeeIdr ?? 0), paymentFeeIdr: order.paymentFeeIdr ?? 0, amountIdr: order.amountIdr }} method={order.paymentMethod} /></div><span className="sr-only">{product(order)}</span></>}
  </>;
}

function LegacyCheckout({ order }: { order: PaymentOrder }) {
  const { t } = useLocale();
  let url = '';
  try { url = trustedCheckoutUrl(order.checkoutUrl!, order.environment); } catch { /* Fail closed on untrusted historical links. */ }
  return <div className="payment-provider-panel"><div className="payment-provider-heading"><CreditCard size={22} aria-hidden="true" /><span>{order.paymentMethod === 'QRIS' ? 'QRIS · DOKU' : 'DOKU'}</span></div><h2>{order.integration === 'hosted' ? t('Pay with QRIS', 'Bayar dengan QRIS') : t('Continue your existing payment', 'Lanjutkan pembayaran sebelumnya')}</h2><p>{order.integration === 'hosted' ? t('DOKU provides your QRIS code. Check the merchant and amount, then scan with your banking or wallet app.', 'DOKU menyediakan kode QRIS Anda. Periksa merchant dan nominal, lalu pindai melalui aplikasi bank atau dompet.') : t('This earlier order uses DOKU’s hosted instructions and keeps its original price.', 'Pesanan lama ini menggunakan instruksi hosted DOKU dan mempertahankan harga aslinya.')}</p>{url ? <a className="lab-button payment-provider-cta" href={url}>{order.integration === 'hosted' && order.paymentMethod === 'QRIS' ? t('Open QRIS in DOKU', 'Buka QRIS di DOKU') : t('Continue payment', 'Lanjutkan pembayaran')}<ArrowUpRight size={16} /></a> : <p role="alert">{t('The payment link is unavailable. Contact support with this order number.', 'Tautan pembayaran tidak tersedia. Hubungi support dengan nomor pesanan ini.')}</p>}<p className="payment-provider-return">{t('Return here after paying. Your balance updates after payment is verified.', 'Kembali ke sini setelah membayar. Saldo diperbarui setelah pembayaran terverifikasi.')}</p></div>;
}

export function PaymentHistoryExperience() {
  return <BillingShell>{() => <PaymentHistory />}</BillingShell>;
}

function PaymentHistory() {
  const { t } = useLocale();
  const { money, date, product, status } = usePaymentLabels();
  const [filter, setFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async (next?: string) => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await paymentHistoryRequest(filter, next);
      if (request !== generation.current) return;
      setOrders(prior => next ? [...prior, ...result.payments.filter(item => !prior.some(old => old.id === item.id))] : result.payments);
      setCursor(result.nextCursor);
    } catch { if (request === generation.current) setError(t('History could not be loaded. Try again.', 'Riwayat belum dapat dimuat. Coba lagi.')); }
    finally { if (request === generation.current) setLoading(false); }
  }, [filter, t]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  return <><PaymentLinks /><header className="studio-heading"><div><p className="lab-eyebrow">{t('Your resource purchases', 'Pembelian sumber daya Anda')}</p><h1>{t('Purchase history', 'Riwayat pembelian')}</h1><p>{t('Orders, payments and activation in one record. Newest first.', 'Pesanan, pembayaran, dan aktivasi dalam satu catatan. Terbaru dahulu.')}</p></div></header><div className="payment-history-toolbar"><UiSelect label={t('Payment status', 'Status pembayaran')} value={filter} onChange={value => { setOrders([]); setCursor(null); setFilter(value as PaymentStatus | 'ALL'); }} options={(['ALL', 'PENDING', 'PAID', 'EXPIRED', 'REJECTED'] as const).map(value => ({ value, label: value === 'ALL' ? t('All orders', 'Semua pesanan') : status(value) }))} /><button className="lab-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} />{t('Refresh', 'Perbarui')}</button></div>
    {error && <p className="lab-notice" role="alert">{error}<button className="lab-button" onClick={() => void load(cursor ?? undefined)}>{t('Retry', 'Coba lagi')}</button></p>}
    {orders.length > 0 ? <ol className="payment-history-list">{orders.map(order => <li key={order.id}><div className="payment-history-top"><div><h2><a href={`/billing/payments/${order.id}`}>{product(order)}<ArrowUpRight size={14} /></a></h2><time dateTime={order.createdAt}>{date(order.createdAt)}</time></div><span className="payment-status" data-status={order.status}>{status(order.status)}</span></div><p className="payment-order-id">{order.id}{order.environment === 'sandbox' && ' · Sandbox'}</p><dl className="payment-history-prices"><div><dt>{t('Base price', 'Harga dasar')}</dt><dd>{money(order.baseAmountIdr ?? order.amountIdr - (order.paymentFeeIdr ?? 0))}</dd></div><div><dt>{t('Gateway fee', 'Biaya gateway')}</dt><dd>{money(order.paymentFeeIdr ?? 0)}</dd></div><div><dt>{t('Total', 'Total')}</dt><dd>{money(order.amountIdr)}</dd></div></dl><p className="payment-fulfillment">{order.status !== 'PAID' ? t('Activation awaiting verified payment', 'Aktivasi menunggu pembayaran terverifikasi') : order.environment === 'sandbox' ? t('Test activation recorded · sandbox only', 'Aktivasi uji tercatat · hanya sandbox') : order.kind === 'quanta' ? t(`${order.quanta} Quanta added`, `${order.quanta} Quanta ditambahkan`) : order.fulfilledUntil ? `${t('Storage activated until', 'Storage diaktifkan sampai')} ${date(order.fulfilledUntil)}` : t('Storage activation recorded', 'Aktivasi storage tercatat')}</p></li>)}</ol> : loading ? <p role="status">{t('Loading history…', 'Memuat riwayat…')}</p> : !error && <div className="payment-empty"><CreditCard size={28} /><h2>{t('No orders in this view', 'Belum ada pesanan pada tampilan ini')}</h2><p>{t('Your purchases will be recorded here.', 'Pembelian Anda akan tercatat di sini.')}</p><a className="lab-button" href="/billing#payments">{t('View resources', 'Lihat sumber daya')}</a></div>}
    {cursor && <button className="lab-button payment-load-more" disabled={loading} onClick={() => void load(cursor)}>{loading ? t('Loading…', 'Memuat…') : t('Load older orders', 'Muat pesanan sebelumnya')}</button>}<p className="lab-caption">{t('20 transactions per page. Each order retains its agreed price. This history is a payment record, not a tax invoice.', '20 transaksi per halaman. Setiap pesanan mempertahankan harga yang disepakati. Riwayat ini adalah catatan pembayaran, bukan faktur pajak.')}</p><PaymentSupport /></>;
}

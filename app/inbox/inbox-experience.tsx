'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Inbox, LoaderCircle } from 'lucide-react';
import { phyniteInbox, type PhyniteInboxItem } from '@/lib/phynite-api';
import type { PhyniteSession } from '../auth-client';
import { StudioMobileHeader } from '../lab-header';
import { useLocale } from '../locale-provider';
import { StudioNavigation } from '../studio-navigation';
import { useSession } from '../use-session';

export function InboxExperience() {
  const { session, ready } = useSession();
  const { t } = useLocale();
  useEffect(() => {
    if (ready && !session) window.location.replace('/login?returnTo=/inbox');
  }, [ready, session]);
  if (!ready || !session) return <main className="workspace-loading">{t('Opening inbox…', 'Membuka kotak masuk…')}</main>;
  return <InboxWorkspace key={session.user.id} session={session} />;
}

function InboxWorkspace({ session }: { session: PhyniteSession }) {
  const { t, intlLocale, locale } = useLocale();
  const owner = useRef<string | null>(session.user.id);
  const [items, setItems] = useState<PhyniteInboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [hasUnread, setHasUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [readingId, setReadingId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (nextCursor = '') => {
    const accountId = owner.current;
    if (!accountId) return;
    if (nextCursor) setLoadingMore(true); else setLoading(true);
    setLoadError(false);
    try {
      const result = await phyniteInbox.list(nextCursor, 30);
      if (owner.current !== accountId) return;
      setItems(current => nextCursor
        ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))]
        : result.items);
      if (!nextCursor) setSelectedId(current => result.items.some(item => item.id === current) ? current : '');
      setCursor(result.nextCursor);
      setHasUnread(result.hasUnread);
    } catch {
      if (owner.current === accountId) setLoadError(true);
    } finally {
      if (owner.current === accountId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    owner.current = session.user.id;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; owner.current = null; };
  }, [load, session.user.id]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      if ((event as CustomEvent<{ source?: string }>).detail?.source !== 'inbox-page') void load();
    };
    window.addEventListener('phynite:inbox-updated', onUpdate);
    return () => window.removeEventListener('phynite:inbox-updated', onUpdate);
  }, [load]);

  const selectItem = async (item: PhyniteInboxItem) => {
    setSelectedId(item.id);
    setActionError(false);
    if (item.readAt || item.legacy) return;
    const accountId = owner.current;
    setReadingId(item.id);
    try {
      const result = await phyniteInbox.markRead(item.id);
      if (owner.current !== accountId) return;
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, readAt: result.readAt } : entry));
      window.dispatchEvent(new CustomEvent('phynite:inbox-updated', { detail: { source: 'inbox-page' } }));
      const status = await phyniteInbox.list('', 1);
      if (owner.current === accountId) setHasUnread(status.hasUnread);
    } catch {
      if (owner.current === accountId) setActionError(true);
    } finally {
      if (owner.current === accountId) setReadingId('');
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    setActionError(false);
    try {
      let next = '';
      do {
        const result = await phyniteInbox.markAllRead(next);
        next = result.nextCursor ?? '';
        if (result.completed) break;
      } while (next);
      await load();
      window.dispatchEvent(new CustomEvent('phynite:inbox-updated', { detail: { source: 'inbox-page' } }));
    } catch {
      setActionError(true);
    } finally {
      setMarkingAll(false);
    }
  };

  const selected = items.find(item => item.id === selectedId) ?? null;
  return <main className="lab-page studio-page studio-shell-page">
    <div className="studio-layout">
      <StudioNavigation active="inbox" standalone />
      <div className="studio-body">
        <StudioMobileHeader session={session} />
        <div className="studio-main studio-inbox-main">
          <header className="studio-heading studio-inbox-heading">
            <div>
              <p className="lab-eyebrow">{t('Workspace messages', 'Pesan workspace')}</p>
              <h1>{t('Inbox', 'Kotak masuk')}</h1>
              <p>{t('Read messages and announcements in full.', 'Baca pesan dan pengumuman secara lengkap.')}</p>
            </div>
            {hasUnread && <button type="button" className="lab-button studio-inbox-mark-all" onClick={() => void markAll()} disabled={markingAll}>
              {markingAll ? <LoaderCircle className="studio-spin" size={16} /> : <CheckCheck size={16} />}
              {t('Mark all as read', 'Tandai semua sudah dibaca')}
            </button>}
          </header>
          {actionError && <p className="studio-inbox-alert" role="alert">{t('Read status could not be updated. Try again.', 'Status baca belum dapat diperbarui. Coba lagi.')}</p>}
          <div className="studio-inbox-layout">
            <section className="studio-inbox-list-panel" aria-label={t('Messages', 'Pesan')}>
              <div className="studio-inbox-panel-heading"><span>{t('Messages', 'Pesan')}</span><small>{hasUnread ? t('Unread messages', 'Ada pesan belum dibaca') : t('All read', 'Semua sudah dibaca')}</small></div>
              {items.length ? <>
                <ol className="studio-inbox-list">{items.map(item => <li key={item.id} data-selected={selectedId === item.id || undefined} data-unread={!item.readAt || undefined}>
                  <button type="button" onClick={() => void selectItem(item)} aria-current={selectedId === item.id ? 'true' : undefined}>
                    <span className="studio-inbox-item-top"><span>{item.kind === 'broadcast' ? t('Announcement', 'Pengumuman') : t('Message', 'Pesan')}</span><time dateTime={item.sentAt}>{new Date(item.sentAt).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</time></span>
                    <strong>{item.legacy ? t('Announcement', 'Pengumuman') : locale === 'id' ? item.titleId ?? item.title : item.title}</strong>
                    <span className="studio-inbox-preview">{locale === 'id' ? item.bodyId ?? item.body : item.body}</span>
                    {readingId === item.id && <span className="studio-inbox-reading">{t('Marking as read…', 'Menandai sudah dibaca…')}</span>}
                  </button>
                </li>)}</ol>
                {cursor && <button type="button" className="studio-inbox-load-more" onClick={() => void load(cursor)} disabled={loadingMore}>{loadingMore ? t('Loading…', 'Memuat…') : t('Load older messages', 'Muat pesan sebelumnya')}</button>}
                {loadError && <p className="studio-inbox-inline-error" role="alert">{cursor ? t('Older messages could not be loaded.', 'Pesan sebelumnya belum dapat dimuat.') : t('Messages could not be refreshed.', 'Pesan belum dapat diperbarui.')} <button type="button" onClick={() => void load(cursor ?? '')}>{t('Retry', 'Coba lagi')}</button></p>}
              </> : <div className="studio-inbox-empty">{loading ? <><LoaderCircle className="studio-spin" size={22} /><span>{t('Loading messages…', 'Memuat pesan…')}</span></> : loadError ? <><Inbox size={22} /><span>{t('Inbox could not be loaded.', 'Kotak masuk belum dapat dimuat.')}</span><button type="button" onClick={() => void load()}>{t('Try again', 'Coba lagi')}</button></> : <><Inbox size={22} /><span>{t('No messages yet.', 'Belum ada pesan.')}</span><p>{t('Messages about your workspace will appear here.', 'Pesan tentang workspace Anda akan muncul di sini.')}</p></>}</div>}
            </section>
            <section className="studio-inbox-detail-panel" aria-label={t('Message details', 'Detail pesan')}>
              {selected ? <article className="studio-inbox-detail">
                <div className="studio-inbox-detail-meta"><span><Bell size={15} />{selected.kind === 'broadcast' ? t('Announcement', 'Pengumuman') : t('Message', 'Pesan')}</span><span className="studio-inbox-read-state" data-unread={!selected.readAt || undefined}>{selected.readAt ? t('Read', 'Sudah dibaca') : t('Unread', 'Belum dibaca')}</span></div>
                <h2>{selected.legacy ? t('Announcement', 'Pengumuman') : locale === 'id' ? selected.titleId ?? selected.title : selected.title}</h2>
                <time dateTime={selected.sentAt}>{new Date(selected.sentAt).toLocaleString(intlLocale, { dateStyle: 'long', timeStyle: 'short' })}</time>
                <div className="studio-inbox-message-body">{locale === 'id' ? selected.bodyId ?? selected.body : selected.body}</div>
                {selected.paymentId && /^PL[A-F0-9]{26}$/.test(selected.paymentId) && <a className="lab-button" href={`/billing/payments/${selected.paymentId}`}>{t('View order', 'Lihat pesanan')}</a>}
              </article> : <div className="studio-inbox-detail-empty"><Inbox size={28} /><h2>{items.length ? t('Choose a message', 'Pilih pesan') : t('Your messages will appear here', 'Pesan Anda akan muncul di sini')}</h2><p>{items.length ? t('Select a message to read it in full.', 'Pilih pesan untuk membacanya secara lengkap.') : t('Open the inbox again when you receive a message.', 'Buka kembali kotak masuk saat ada pesan baru.')}</p></div>}
            </section>
          </div>
        </div>
      </div>
    </div>
  </main>;
}

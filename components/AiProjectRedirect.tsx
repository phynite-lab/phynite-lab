'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/app/locale-provider';
import { projectAiHref } from '@/lib/project-ai';
import type { AiDetail } from '@/lib/ai-contract';
import { WorkspaceLoading } from './WorkspaceLoading';

/** Compatibility for bookmarked AI URLs; new research always starts in a project. */
export function AiProjectRedirect() {
  const router = useRouter(), { t } = useLocale();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      const query = new URLSearchParams(location.search), chat = query.get('chat');
      let projectKey = query.get('project');
      if (chat && /^aic_[a-z0-9]+$/.test(chat)) {
        const result = await fetch(`/api/ai/conversations/${chat}`, { cache: 'no-store', signal: abort.signal });
        if (!result.ok) throw new Error(t('This conversation could not be opened. Choose its project to continue.', 'Percakapan belum dapat dibuka. Pilih project-nya untuk melanjutkan.'));
        const detail = await result.json() as AiDetail;
        projectKey = detail.conversation.projectKey;
      }
      if (!abort.signal.aborted) router.replace(projectAiHref(projectKey, chat) ?? '/workspace');
    })().catch(failure => { if (!abort.signal.aborted) setError((failure as Error).message); });
    return () => abort.abort();
  }, [router, t]);
  return error ? <main className="workspace-loading"><p role="alert">{error}</p><Link href="/workspace">{t('Open projects', 'Buka project')}</Link></main>
    : <WorkspaceLoading layout="panel" label={t('Opening AI in your project…', 'Membuka AI di dalam project Anda…')} />;
}

'use client';

import Link from 'next/link';
import { ArrowUpRight, BookOpen, FlaskConical, LayoutGrid } from 'lucide-react';
import { WorkspacePageHeading } from './WorkspacePageHeading';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { useLocale } from '@/app/locale-provider';

export function AiWorkspaceWelcome({ local, configured, catalogLoaded, refreshing, providerConnected, onDraft }: {
  local: boolean; configured: boolean; catalogLoaded: boolean; refreshing: boolean; providerConnected: boolean;
  onDraft: (prompt: string) => void;
}) {
  const { t } = useLocale();
  const starters = [
    { label: t('Review this project', 'Tinjau project ini'), prompt: t('Review my Canvas and suggest the next step.', 'Tinjau Kanvas dan sarankan langkah berikutnya.'), icon: LayoutGrid },
    { label: t('Plan a study', 'Rencanakan studi'), prompt: t('Help me set up a strain study.', 'Bantu siapkan studi strain.'), icon: FlaskConical },
    { label: t('Explore the literature', 'Telusuri literatur'), prompt: t('Find papers on thermoelectric materials.', 'Cari paper tentang material termoelektrik.'), icon: BookOpen },
  ];
  return <section className="ai-welcome"><WorkspacePageHeading eyebrow={<span className="ai-welcome-mark"><PhyniteAiIcon size={18} />{t('AI workspace', 'Workspace AI')}</span>} title={t('What are we investigating?', 'Apa yang kita teliti?')} description={t('Work with your project, prepare a study, or explore the literature.', 'Telusuri project Anda, siapkan studi, atau jelajahi literatur.')} />
    {local && !configured && <aside className="ai-welcome-setup" aria-label={t('AI setup', 'Setup AI')}>
      <strong>{refreshing ? t('Checking your models', 'Memeriksa model Anda') : !catalogLoaded ? t('Model status unavailable', 'Status model belum tersedia') : providerConnected ? t('Choose an available model', 'Pilih model yang tersedia') : t('Connect your AI provider', 'Hubungkan provider AI Anda')}</strong>
      <p>{refreshing ? t('Models will appear automatically when ready. You can prepare a draft while waiting.', 'Model akan muncul otomatis setelah siap. Anda dapat menyiapkan draf sambil menunggu.') : !catalogLoaded ? t('Open AI provider settings to check your connections.', 'Buka pengaturan provider AI untuk memeriksa koneksi Anda.') : providerConnected ? t('Open the model picker below to choose a verified model.', 'Buka pilihan model di bawah untuk memilih model terverifikasi.') : t('Sign in with Codex, Claude Code or Antigravity, then choose a model to start.', 'Login dengan Codex, Claude Code, atau Antigravity, lalu pilih model untuk memulai.')}</p>
      <Link href="/account/ai-providers">{t('Open AI provider settings', 'Buka pengaturan provider AI')}<ArrowUpRight size={14} aria-hidden="true" /></Link>
    </aside>}
    <div className="ai-welcome-starters">{starters.map(starter => <button type="button" key={starter.label} onClick={() => onDraft(starter.prompt)}><starter.icon size={18} aria-hidden="true" /><span><strong>{starter.label}</strong><small>{starter.prompt}</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>)}</div>
    <p className="ai-welcome-hint">{t('Choose a starting point to draft a message. Review it before sending.', 'Pilih langkah awal untuk menyusun draf pesan. Tinjau sebelum mengirim.')}</p>
  </section>;
}

'use client';
import { CornerDownRight, X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import type { AiMessageQuote } from '@/lib/ai-message-quote';
import { AiResponseContent } from './AiResponseContent';

export function AiQuotePreview({ quote, onRemove, onSource }: { quote: AiMessageQuote; onRemove?: () => void; onSource?: () => void }) {
  const { t } = useLocale();
  return <div className="ai-quote-preview"><details><summary><CornerDownRight size={14} /><strong>{t('Quoted response', 'Kutipan jawaban')}</strong><span>{quote.quote}</span></summary><blockquote><AiResponseContent text={quote.quote} /></blockquote></details>
    {onSource && <button type="button" className="ai-quote-source" onClick={onSource}>{t('View source', 'Lihat sumber')}</button>}
    {onRemove && <button type="button" className="ai-quote-remove" onClick={onRemove} aria-label={t('Remove quoted response', 'Hapus kutipan jawaban')}><X size={14} /></button>}
  </div>;
}

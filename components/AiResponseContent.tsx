'use client';

import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { aiMarkdownUrl, normalizeAiMath } from '@/lib/ai-markdown';
import 'katex/dist/katex.min.css';

/** The same renderer serves streamed text and persisted history. HTML stays disabled. */
export const AiResponseContent = memo(function AiResponseContent({ text }: { text: string }) {
  const source = useMemo(() => normalizeAiMath(text), [text]);
  return <div className="ai-response-text"><Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: 'warn', throwOnError: false, maxExpand: 1000, maxSize: 20 }]]}
    urlTransform={value => aiMarkdownUrl(value) ?? ''}
    components={{
      a: ({ href, children }) => href ? <a href={href} target={href.startsWith('https:') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ src, alt }) => typeof src === 'string' && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'Image'}</a> : <span>{alt}</span>,
      table: ({ children }) => <div className="ai-table-scroll" tabIndex={0}><table>{children}</table></div>,
      input: ({ checked }) => <input type="checkbox" checked={checked} disabled readOnly />,
    }}>{source}</Markdown></div>;
});

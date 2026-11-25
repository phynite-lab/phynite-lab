import type { AiMessage } from './ai-contract.ts';
import type { AiContextItem, AiContextRef } from './ai-workbench.ts';

export type AiMessageQuote = Extract<AiContextRef, { kind: 'message' }>;
const maxQuote = 4000;

/** Store offsets in Unicode code points, shared with the native Python authority. */
export function quoteAiMessage(message: AiMessage, selected: string, occurrence = 0): AiContextItem | null {
  if (message.role !== 'assistant' || !selected.trim() || Array.from(selected).length > maxQuote || !Number.isInteger(occurrence) || occurrence < 0) return null;
  let start = -1, end = -1;
  for (let index = 0, from = 0; index <= occurrence; index++) {
    start = message.text.indexOf(selected, from);
    if (start < 0) break;
    from = start + selected.length;
  }
  if (start >= 0) end = start + selected.length;
  // Rendered inline emphasis/code and line wraps may differ from the source.
  // Match in order, retaining the original Markdown and exact scientific text.
  const visible: string[] = [], offsets: number[] = [];
  for (let i = 0; i < message.text.length; i++) {
    const char = message.text[i];
    if ('*_`~'.includes(char)) continue;
    if (/\s/.test(char)) { if (visible.at(-1) === ' ') continue; visible.push(' '); }
    else visible.push(char);
    offsets.push(i);
  }
  const needle = selected.replace(/\s+/g, ' '), haystack = visible.join('');
  let found = -1, from = 0;
  for (let index = 0; index <= occurrence; index++) { found = haystack.indexOf(needle, from); if (found < 0) break; from = found + needle.length; }
  // Count rendered occurrences before choosing an exact raw match: an earlier
  // formatted passage must not resolve to a later unformatted duplicate.
  if (found >= 0) { start = offsets[found]; end = offsets[found + needle.length - 1] + 1; }
  if (start < 0) return null;
  const quote = message.text.slice(start, end);
  if (Array.from(quote).length > maxQuote) return null;
  return { ref: { kind: 'message', id: message.id, conversationId: message.conversationId,
    start: Array.from(message.text.slice(0, start)).length, end: Array.from(message.text.slice(0, end)).length, quote },
    label: 'Phynite AI · ' + selected.trim().slice(0, 72), detail: quote };
}

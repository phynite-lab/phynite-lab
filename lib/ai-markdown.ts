/** Accept common LaTeX delimiters without changing code examples or stored messages. */
export function normalizeAiMath(source: string): string {
  let result = '', fence = '', i = 0;
  while (i < source.length) {
    if (i === 0 || source[i - 1] === '\n') {
      const end = source.indexOf('\n', i), lineEnd = end < 0 ? source.length : end + 1;
      const line = source.slice(i, lineEnd), marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
        result += line; i = lineEnd; continue;
      }
      if (marker || /^(?: {4}|\t)/.test(line)) {
        if (marker) fence = marker[1];
        result += line; i = lineEnd; continue;
      }
    }
    if (source[i] === '`') {
      let count = 1;
      while (source[i + count] === '`') count++;
      const ticks = '`'.repeat(count);
      let end = source.indexOf(ticks, i + count);
      while (end >= 0 && (source[end - 1] === '`' || source[end + count] === '`')) end = source.indexOf(ticks, end + count);
      if (end >= 0) { result += source.slice(i, end + count); i = end + count; continue; }
      result += ticks; i += count; continue;
    }
    if (source[i] === '\\') {
      if (source[i + 1] === '\\') { result += '\\\\'; i += 2; continue; }
      const bracket = source[i + 1];
      if (bracket === '(' || bracket === '[') {
        const close = bracket === '(' ? '\\)' : '\\]';
        let end = source.indexOf(close, i + 2);
        while (end >= 0 && source[end - 1] === '\\') end = source.indexOf(close, end + 2);
        if (end >= 0) {
          const math = source.slice(i + 2, end);
          if (bracket === '[' || !math.includes('\n')) {
            result += bracket === '[' ? `\n\n$$\n${math.trim()}\n$$\n\n` : `$${math}$`;
            i = end + 2; continue;
          }
        }
      }
    }
    result += source[i++];
  }
  return result;
}

/** No executable URLs, remote image fetches, or provider-controlled HTML. */
export function aiMarkdownUrl(value: string): string | undefined {
  if (/^\/(?!\/)/.test(value) || value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Invalid links stay readable as text. */ }
  return undefined;
}

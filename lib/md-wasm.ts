import type { ParseNumericRows } from './md-parser';

type ParserExports = {
  memory: WebAssembly.Memory;
  reserve_input: (length: number) => number;
  parse_rows: (rows: number, width: number, idColumn: number, typeColumn: number) => number;
};

export async function loadMdWasm(): Promise<ParseNumericRows | undefined> {
  try {
    const response = await fetch('/_next/static/native/md-parser.wasm', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return;
    const compiled = await WebAssembly.compile(await response.arrayBuffer());
    const instance = await WebAssembly.instantiate(compiled);
    const parser = instance.exports as ParserExports;
    const encoder = new TextEncoder();
    return (lines, cursor, count, width, idColumn, typeColumn) => {
      if (count * width > 4_000_000 || cursor + count > lines.length) return;
      try {
        const bytes = encoder.encode(lines.slice(cursor, cursor + count).join('\n'));
        const input = parser.reserve_input(bytes.length);
        if (!input) return;
        new Uint8Array(parser.memory.buffer, input, bytes.length).set(bytes);
        const values = parser.parse_rows(count, width, idColumn, typeColumn);
        if (values) return new Float64Array(parser.memory.buffer, values, count * width);
      } catch {
        // The ordinary reader also handles input outside the native parser's limits.
      }
    };
  } catch {
    // The standard web distribution uses the TypeScript parser.
  }
}

import type { MdParseResult } from './md-parser.ts';

const DEFAULT_BUDGET_BYTES = 96 * 1024 * 1024;

function stringBytes(value: string) {
  return value.length * 2;
}

/** Conservative in-memory estimate for the eagerly decoded legacy frame form. */
export function estimateMdParseResultBytes(result: MdParseResult): number {
  return result.frames.reduce((total, frame) => {
    const stringData = frame.ids.reduce((sum, value) => sum + stringBytes(value), 0)
      + frame.species.reduce((sum, value) => sum + stringBytes(value), 0);
    const scalarData = Object.entries(frame.properties).reduce(
      (sum, [name, values]) => sum + stringBytes(name) + values.length * 8,
      0,
    );
    const sourceLabels = Object.entries(frame.stringProperties ?? {}).reduce((sum, [name, values]) => sum + stringBytes(name) + values.length * 8 + values.reduce((bytes, value) => bytes + stringBytes(value), 0), 0);
    return total + frame.positions.length * 8 + stringData + scalarData + sourceLabels + 512;
  }, result.warnings.reduce((sum, warning) => sum + stringBytes(warning), 0) + 256);
}

/**
 * Byte-budgeted LRU used while the frame-indexed trajectory reader is rolled
 * out. Oversized trajectories stay active in React but are not retained a
 * second time in this cache.
 */
export class MdParseResultCache {
  readonly maxBytes: number;
  private bytes = 0;
  private entries = new Map<string, { result: MdParseResult; bytes: number }>();

  constructor(maxBytes = DEFAULT_BUDGET_BYTES) {
    this.maxBytes = Math.max(0, maxBytes);
  }

  get sizeBytes() {
    return this.bytes;
  }

  get(key: string): MdParseResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, result: MdParseResult): boolean {
    this.delete(key);
    if (result.loadFrame) return false;
    const bytes = estimateMdParseResultBytes(result);
    if (bytes > this.maxBytes) return false;
    this.entries.set(key, { result, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
    return true;
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

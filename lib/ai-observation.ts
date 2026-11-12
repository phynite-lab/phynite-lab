import { AI_OBSERVATION_CHAR_BUDGET } from './ai-contract.ts';

const priority = ['error', 'code', 'status', 'id', 'name', 'sha256', 'revision', 'warnings', 'truncated', 'nextLine', 'nextOffset', 'nextCursor', 'issues', 'metadata'];
const rank = (key: string) => { const index = priority.indexOf(key); return index < 0 ? priority.length : index; };
const encode = (value: unknown): string => JSON.stringify(value) ?? 'null';
const size = (value: unknown) => encode(value).length;
const arraySummary = (totalItems: number) => ({ _compacted: true, totalItems, sampleHead: [] as unknown[], sampleTail: [] as unknown[] });

function shortened(value: string, budget: number): string {
  const marked = (end: number) => `${value.slice(0, end)}…[truncated ${value.length - end} chars]`;
  let low = 0, high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size(marked(middle)) <= budget) low = middle; else high = middle - 1;
  }
  // Prefer a nearby word/line boundary and never split a UTF-16 surrogate pair.
  const boundary = value.slice(0, low).search(/\s+\S*$/u);
  if (boundary >= low * 0.8) low = boundary;
  if (low > 0 && /[\uD800-\uDBFF]/u.test(value[low - 1])) low--;
  return marked(low);
}

function minimum(value: unknown, key = ''): number {
  if (typeof value === 'string') return rank(key) < priority.length && size(value) <= 512 ? size(value) : Math.min(size(value), size(`…[truncated ${value.length} chars]`));
  if (Array.isArray(value)) return Math.min(size(value), size(arraySummary(value.length)));
  if (value && typeof value === 'object') return Math.min(size(value), size({ truncated: true, _omittedFields: Object.keys(value).length }));
  return size(value);
}

function compact(value: unknown, budget: number): unknown {
  if (size(value) <= budget) return value;
  if (typeof value === 'string') return shortened(value, budget);
  if (Array.isArray(value)) {
    const result = arraySummary(value.length);
    const samples: Array<{ index: number; tail: boolean; minimum: number }> = [];
    let available = budget - size(result);
    // Alternate ends so a small budget can still show both the first and last rows.
    for (let offset = 0; offset < Math.min(3, Math.ceil(value.length / 2)); offset++) {
      for (const index of [offset, value.length - 1 - offset]) {
        if (samples.some(sample => sample.index === index)) continue;
        const needed = minimum(value[index]);
        if (needed + 1 > available) continue;
        samples.push({ index, tail: index >= Math.ceil(value.length / 2), minimum: needed }); available -= needed + 1;
      }
    }
    let spare = available;
    const values = new Map<number, unknown>();
    samples.forEach((sample, index) => {
      const item = compact(value[sample.index], sample.minimum + Math.floor(spare / (samples.length - index)));
      spare -= size(item) - sample.minimum; values.set(sample.index, item);
    });
    for (const sample of samples.sort((a, b) => a.index - b.index)) (sample.tail ? result.sampleTail : result.sampleHead).push(values.get(sample.index));
    return result;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => key !== 'truncated').sort(([a], [b]) => rank(a) - rank(b));
    const selected: Array<{ key: string; value: unknown; minimum: number }> = [];
    let available = budget - size({ truncated: true, _omittedFields: entries.length });
    for (const [key, child] of entries) {
      const needed = minimum(child, key), overhead = size(key) + 2;
      if (needed + overhead > available) continue;
      selected.push({ key, value: child, minimum: needed }); available -= needed + overhead;
    }
    // A null prototype also keeps data keys such as __proto__ inert.
    const result: Record<string, unknown> = Object.assign(Object.create(null), { truncated: true });
    if (selected.length < entries.length) result._omittedFields = entries.length - selected.length;
    let spare = budget - size(result) - selected.reduce((sum, item) => sum + size(item.key) + 2 + item.minimum, 0);
    selected.forEach((item, index) => {
      const child = compact(item.value, item.minimum + Math.floor(spare / (selected.length - index)));
      result[item.key] = child; spare -= size(child) - item.minimum;
    });
    return result;
  }
  return value;
}

/** Bounded JSON evidence: shorten leaves, sample arrays, and retain priority fields first. */
export function compactObservation(value: unknown, maximum = AI_OBSERVATION_CHAR_BUDGET): string {
  if (!Number.isInteger(maximum) || maximum < 128) throw new RangeError('Observation budgets must be integers of at least 128 characters.');
  const text = encode(value);
  return text.length <= maximum ? text : encode(compact(JSON.parse(text), maximum));
}

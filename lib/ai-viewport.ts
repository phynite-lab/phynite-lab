import type { AiContextRef } from './ai-workbench.ts';

export type ViewportScope = { owner: string; projectKey: string; ref: AiContextRef; saved: boolean; runId?: string };
export type ViewportSnapshot = { blob: Blob; metadata: Record<string, unknown> };
type Entry = { scope: ViewportScope; element: HTMLElement; capture: (signal: AbortSignal) => Promise<ViewportSnapshot> };
/** Only scientific renderers register here. Hidden editors and arbitrary page screenshots are excluded. */
export class ViewportRegistry {
  private entries = new Map<symbol, Entry>();
  register(entry: Entry) { const key = Symbol(); this.entries.set(key, entry); return () => { this.entries.delete(key); }; }
  async capture(owner: string, projectKey: string, ref: AiContextRef, signal: AbortSignal) {
    signal.throwIfAborted();
    const entry = [...this.entries.values()].reverse().find(item => item.scope.owner === owner && item.scope.projectKey === projectKey && item.scope.ref.kind === ref.kind && item.scope.ref.id === ref.id && !item.element.closest('[hidden]') && item.element.isConnected && item.element.getBoundingClientRect().width > 0 && item.element.getBoundingClientRect().height > 0);
    if (!entry) throw new Error('AI_VIEWPORT_UNAVAILABLE: Open this source in a visible scientific viewport.');
    if (!entry.scope.saved) throw new Error('AI_VIEWPORT_UNSAVED: Save the source before capturing it.');
    const result = await entry.capture(signal);
    signal.throwIfAborted();
    if (![...this.entries.values()].includes(entry)) throw new Error('AI_VIEWPORT_CHANGED: The displayed source changed during capture.');
    if (result.blob.type !== 'image/png' || !result.blob.size || result.blob.size > 10 * 1024 ** 2) throw new Error('AI_VIEWPORT_LIMIT: Use a PNG viewport below 10 MiB.');
    return result;
  }
}
export const activeViewports = new ViewportRegistry();
export async function viewportChecksum(value: unknown) {
  const bytes = value instanceof Blob ? await value.arrayBuffer() : new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}

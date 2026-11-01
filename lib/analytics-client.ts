import { analyticsPage, safeCampaign, type AnalyticsEventName } from './analytics-schema.ts';

export const ANALYTICS_CHOICE_EVENT = 'phynite:analytics-choice';
export const ANALYTICS_PREFERENCES_EVENT = 'phynite:analytics-preferences';
export type AnalyticsChoice = 'accepted' | 'rejected';

const TRANSPORT_LOCK = 'phynite:analytics-transport';
const SYNC_CHANNEL = 'phynite:analytics-privacy';
const INTENT_KEY = 'phynite:analytics-privacy-intent';
const SAVED_KEY = 'phynite:analytics-privacy-saved';
const REVOCATION_KEY = 'phynite:analytics-privacy-revocation';
const PAUSE_KEY = 'phynite:analytics-privacy-paused';
const TIMEOUT_MS = 10_000;
const SAVE_ERROR = 'Your privacy choice could not be saved. Please try again.';

type Intent = { id: string; choice: AnalyticsChoice; startedAt: number };
type Saved = Intent & { revocation: string | null };
type Coordination = { intent: Intent | null; saved: Saved | null; revocation: string | null };

let sharedStorageAvailable = true;
const seenRevocations = new Set<string>();
let coordination: Coordination = { intent: null, saved: null, revocation: null };
let paused = false;
let pauseIntent: Intent | null = null;
let initialized = false;
let generation = 0;
let lastStamp = '';
let pendingEvent: Promise<unknown> = Promise.resolve();
let pendingPrivacy: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
let syncUsers = 0;
let stopSync: (() => void) | null = null;

export function analyticsChoice(): AnalyticsChoice | null {
  if (typeof document === 'undefined') return null;
  const value = document.cookie.match(/(?:^|;\s*)phynite-analytics-consent=(accepted|rejected)(?:;|$)/)?.[1];
  return value === 'accepted' || value === 'rejected' ? value : null;
}

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try { return typeof window === 'undefined' ? null : window[kind]; }
  catch { return null; }
}

function parseIntent(raw: string | null): Intent | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !('choice' in value)
      || (value.choice !== 'accepted' && value.choice !== 'rejected') || !('startedAt' in value) || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) return null;
    return value as Intent;
  } catch { return null; }
}

function observeRevocation(candidate: string | null): string | null {
  // Clock skew cannot make a previously unseen rejection safe to ignore. Old
  // tokens already covered by a subsequent grant never replace the current one.
  if (candidate && !seenRevocations.has(candidate)) { seenRevocations.add(candidate); return candidate; }
  return coordination.revocation;
}

function readCoordination(): Coordination {
  try {
    const local = sharedStorageAvailable ? storage('localStorage') : null;
    if (local) {
      const rawSaved = local.getItem(SAVED_KEY);
      const savedIntent = parseIntent(rawSaved);
      const candidate: unknown = savedIntent && rawSaved ? JSON.parse(rawSaved) : null;
      const saved = savedIntent && candidate && typeof candidate === 'object' && 'revocation' in candidate
        && (candidate.revocation === null || typeof candidate.revocation === 'string') ? { ...savedIntent, revocation: candidate.revocation } : null;
      const intent = parseIntent(local.getItem(INTENT_KEY));
      const revocation = observeRevocation(local.getItem(REVOCATION_KEY));
      // A broadcast can be newer than storage when another tab hit its quota.
      // Never replace that intent or its verified acknowledgement with older data.
      if (!coordination.intent || (intent && (intent.id === coordination.intent.id || intent.startedAt > coordination.intent.startedAt
        || (intent.startedAt === coordination.intent.startedAt && intent.id > coordination.intent.id)))) {
        coordination = { intent, saved: coordination.saved?.id === intent?.id && saved?.id !== intent?.id ? coordination.saved : saved, revocation };
      } else coordination.revocation = revocation;
    }
  } catch { sharedStorageAvailable = false; }
  return coordination;
}

function persistPause(value: boolean) {
  paused = value;
  if (value && coordination.intent && (!pauseIntent || coordination.intent.startedAt >= pauseIntent.startedAt)) pauseIntent = coordination.intent;
  if (!value) pauseIntent = null;
  try {
    if (value) storage('sessionStorage')?.setItem(PAUSE_KEY, pauseIntent ? JSON.stringify(pauseIntent) : '1');
    else storage('sessionStorage')?.removeItem(PAUSE_KEY);
  } catch { /* The in-memory pause still applies for this tab. */ }
}

function hasLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

function currentState() {
  const choice = analyticsChoice();
  const shared = readCoordination();
  if (!initialized) {
    initialized = true;
    try {
      const savedPause = storage('sessionStorage')?.getItem(PAUSE_KEY) ?? null;
      paused = savedPause !== null;
      pauseIntent = parseIntent(savedPause);
    } catch { paused = false; }
  }
  const committed = shared.intent && shared.saved?.id === shared.intent.id && shared.saved.choice === shared.intent.choice;
  const accepted = committed && shared.saved?.choice === 'accepted' && shared.saved.revocation === shared.revocation && choice === 'accepted';
  if ((shared.intent && !committed) || (shared.revocation && !accepted)) persistPause(true);
  else if (accepted && (!paused || (pauseIntent && shared.saved!.startedAt >= pauseIntent.startedAt))) persistPause(false);
  return { choice, paused, allowed: choice === 'accepted' && !paused && hasLocks() };
}

function refresh() {
  const state = currentState();
  if (typeof window !== 'undefined') (window as typeof window & { phyniteAnalyticsAllowed?: boolean }).phyniteAnalyticsAllowed = state.allowed;
  const stamp = JSON.stringify([state.choice, state.paused, state.allowed, coordination.intent?.id, coordination.saved?.id, coordination.revocation]);
  if (lastStamp !== stamp) {
    const previous = lastStamp;
    lastStamp = stamp;
    generation++;
    if (previous && typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
  }
  return state;
}

export function analyticsPrivacyState(): { choice: AnalyticsChoice | null; paused: boolean; allowed: boolean } {
  return refresh();
}

export function openAnalyticsPreferences() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ANALYTICS_PREFERENCES_EVENT));
}

function broadcast() {
  try { channel?.postMessage(coordination); } catch { /* Storage events and lifecycle reads remain available. */ }
}

function writeShared(key: string, value: unknown) {
  try { storage('localStorage')?.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { sharedStorageAvailable = false; }
}

/** Shares consent changes without ever trusting a message as proof of an accepted cookie. */
export function startAnalyticsPrivacySync(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  syncUsers++;
  if (syncUsers === 1) {
    const update = () => { refresh(); };
    const visible = () => { if (!document.hidden) refresh(); };
    const changed = (event: StorageEvent) => {
      if (event.key === null || [INTENT_KEY, SAVED_KEY, REVOCATION_KEY].includes(event.key)) refresh();
    };
    try {
      if (typeof window.BroadcastChannel === 'function') {
        channel = new window.BroadcastChannel(SYNC_CHANNEL);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          // The shared storage is authoritative. When blocked, use only well-formed,
          // newer intents and verify their cookie before releasing a local pause.
          const message = event.data;
          if (message && typeof message === 'object' && 'intent' in message && 'saved' in message && 'revocation' in message) {
            const intent = parseIntent(JSON.stringify(message.intent));
            const revocation = observeRevocation(typeof message.revocation === 'string' ? message.revocation : null);
            const newer = intent && (!coordination.intent || intent.startedAt > coordination.intent.startedAt
              || (intent.startedAt === coordination.intent.startedAt && intent.id >= coordination.intent.id));
            if (newer) {
              const saved = parseIntent(JSON.stringify(message.saved));
              coordination = { intent, saved: saved && message.saved && typeof message.saved === 'object' && 'revocation' in message.saved
                && (typeof message.saved.revocation === 'string' || message.saved.revocation === null) ? { ...saved, revocation: message.saved.revocation } : null,
                revocation };
            } else {
              coordination.revocation = revocation;
            }
          }
          refresh();
        };
      }
    } catch { channel = null; }
    refresh();
    window.addEventListener('storage', changed);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', visible);
    stopSync = () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
      channel = null;
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--syncUsers === 0) { stopSync?.(); stopSync = null; }
  };
}

async function locked<T>(run: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await navigator.locks.request(TRANSPORT_LOCK, { mode: 'exclusive', signal: controller.signal }, async () => {
      clearTimeout(timeout);
      if (controller.signal.aborted) throw new Error(SAVE_ERROR);
      return run();
    });
  } finally { clearTimeout(timeout); }
}

async function request<T>(url: string, body: string, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
    const result = await consume(response);
    if (controller.signal.aborted) throw new Error(SAVE_ERROR);
    return result;
  } finally { clearTimeout(timeout); }
}

function isCurrent(intent: Intent, revocation: string | null): boolean {
  const shared = readCoordination();
  return shared.intent?.id === intent.id && shared.revocation === revocation;
}

export async function setAnalyticsChoice(choice: AnalyticsChoice): Promise<void> {
  if (choice !== 'accepted' && choice !== 'rejected') throw new Error(SAVE_ERROR);
  refresh();
  const now = typeof performance === 'undefined' ? Date.now() : performance.timeOrigin + performance.now();
  const intent: Intent = { id: crypto.randomUUID(), choice, startedAt: Math.max(now, (coordination.intent?.startedAt ?? 0) + 0.001, (pauseIntent?.startedAt ?? 0) + 0.001) };
  // A separate revocation marker cannot be overwritten by a late acceptance.
  // The accepted acknowledgement must refer to the same marker it started with.
  if (choice === 'rejected') {
    coordination.revocation = intent.id;
    seenRevocations.add(intent.id);
    writeShared(REVOCATION_KEY, intent.id);
  }
  const revocation = coordination.revocation;
  coordination.intent = intent;
  writeShared(INTENT_KEY, intent);
  persistPause(true);
  refresh();
  broadcast();
  const save = async () => {
    if (!isCurrent(intent, revocation)) throw new Error(SAVE_ERROR);
    await request('/api/analytics/privacy', JSON.stringify({ choice }), async response => {
      if (!response.ok) throw new Error(SAVE_ERROR);
      const acknowledgement: unknown = await response.json();
      if (!acknowledgement || typeof acknowledgement !== 'object' || !('choice' in acknowledgement) || acknowledgement.choice !== choice) throw new Error(SAVE_ERROR);
      if (analyticsChoice() !== choice) throw new Error('Your browser could not save this cookie. Check your cookie settings and try again.');
    });
    if (!isCurrent(intent, revocation)) throw new Error(SAVE_ERROR);
    coordination.saved = { ...intent, revocation };
    writeShared(SAVED_KEY, coordination.saved);
    if (!isCurrent(intent, revocation)) throw new Error(SAVE_ERROR);
    if (choice === 'accepted') persistPause(false);
    refresh();
    broadcast();
  };
  try {
    if (hasLocks()) await locked(save);
    else {
      // Browsers without Web Locks never send analytics; their privacy saves can
      // still use a local queue without racing an analytics response.
      const operation = pendingPrivacy.then(save);
      pendingPrivacy = operation.catch(() => undefined);
      await operation;
    }
  } catch (error) {
    refresh();
    broadcast();
    throw error;
  }
}

function referrerHost(): string {
  try { return document.referrer ? new URL(document.referrer).hostname.toLowerCase().slice(0, 100) : ''; }
  catch { return ''; }
}

export function emitAnalytics(event: AnalyticsEventName, extra: { feature?: string; durationMs?: number; metricMs?: number; metricName?: 'LCP' | 'CLS' | 'INP'; metricValue?: number; path?: string } = {}) {
  if (typeof window === 'undefined' || !analyticsPrivacyState().allowed) return;
  const { path = location.pathname, ...dimensions } = extra;
  const page = analyticsPage(path);
  if (!page || document.body.classList.contains('dev-sandbox-active') || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  const query = new URLSearchParams(location.search);
  const payload = JSON.stringify({ event, path, referrer: referrerHost(),
    utmSource: safeCampaign(query.get('utm_source')), utmMedium: safeCampaign(query.get('utm_medium')),
    utmCampaign: safeCampaign(query.get('utm_campaign')), ...dimensions });
  const epoch = generation;
  pendingEvent = pendingEvent.then(async () => {
    if (!analyticsPrivacyState().allowed || generation !== epoch) return;
    await locked(async () => {
      if (!analyticsPrivacyState().allowed || generation !== epoch) return;
      await request('/api/analytics/events', payload, async response => { await response.arrayBuffer(); });
    });
  }).catch(() => undefined);
}

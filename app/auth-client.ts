import { sessionHome } from '../lib/auth-routing.ts';
import { clearResourceAccountStores } from '../lib/resource-account-store.ts';
import { clearResourceUsageStores } from '../lib/resource-usage-store.ts';
import { invalidateSessionRequest } from '../lib/session-request.ts';

export { sessionHome } from '../lib/auth-routing.ts';

export const SESSION_EVENT = "phynite:session-change";

export type PhyniteSession = {
  mode?: 'local';
  cloud?: { authenticated: boolean; account?: string };
  user: {
    id: string;
    email: string;
    name: string;
    groups: string[];
    isDeveloper: boolean;
  };
  expiresAt?: string;
};

/**
 * Local workspaces always have a stable device identity, but that identity is
 * not a user profile. Only a hosted session or an explicitly connected local
 * cloud account may expose profile/avatar controls.
 */
export function hasUserProfile(session: PhyniteSession | null | undefined): boolean {
  return Boolean(session && (session.mode !== 'local' || session.cloud?.authenticated === true));
}

export function notifySessionChange() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

let lastSessionEvent: Event | undefined;
export function subscribeToSession(listener: () => void) {
  const changed = (event: Event) => {
    if (event !== lastSessionEvent) { lastSessionEvent = event; invalidateSessionRequest(); }
    listener();
  };
  window.addEventListener(SESSION_EVENT, changed);
  return () => window.removeEventListener(SESSION_EVENT, changed);
}

export async function signOut(options: { mode?: PhyniteSession['mode'] } = {}) {
  // A local workspace is already authenticated by its loopback launcher. Its
  // sign-out action only disconnects the optional Phynite Cloud account; it
  // must not redirect to the hosted login page or invalidate local storage.
  const local = options.mode === 'local';
  // Workers expose even an empty POST as a body stream, so use the JSON contract.
  const response = await fetch(local ? "/api/local/cloud/logout" : "/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const result = await response.json() as { signedOut?: boolean; connected?: boolean } | null;
  const acknowledged = local ? result?.connected === false : result?.signedOut === true;
  if (!response.ok || !acknowledged) {
    throw new Error("Could not log out. Try again.");
  }
  if (!local) {
    clearResourceUsageStores();
    clearResourceAccountStores();
  }
  notifySessionChange();
}

export function getAuthReturnPath() {
  const fallback = sessionHome(false);
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return fallback;
  const destination = new URL(returnTo, window.location.origin);
  if (destination.origin !== window.location.origin) return fallback;
  const allowed = ['/workspace', '/projects', '/calculation', '/md', '/storage', '/inbox', '/billing', '/account', '/profile', '/local'].some(prefix => destination.pathname === prefix || destination.pathname.startsWith(`${prefix}/`));
  return allowed ? `${destination.pathname}${destination.search}${destination.hash}` : fallback;
}

'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, FolderOpen, Home, Menu, Monitor, PanelLeftClose, PanelLeftOpen, Pin, Search, SquarePen, X } from 'lucide-react';
import { useSession } from '@/app/use-session';
import { useLabAccount } from '@/app/use-lab-account';
import { ResearchAccessGate } from '@/app/research-access-gate';
import { useLocale } from '@/app/locale-provider';
import { useNavigationPreferences } from '@/app/use-navigation-preferences';
import { useCalculationWorkspace } from '@/app/use-calculation-workspace';
import { useWorkspaceCloudSync, WorkspaceCloudSyncContext } from '@/app/use-workspace-cloud-sync';
import { useInboxUnread } from '@/app/use-inbox-unread';
import { useSiteTheme } from '@/app/use-site-theme';
import { SettingsNavigation } from './SettingsNavigation';
import { CalculationIcon, FiguresIcon, MdLabIcon } from '@/app/tool-icons';
import { navigationSection, researchShellRoute, hasContextualSidebar, type NavigationAction, type NavigationFeature, type NavigationSection } from '@/lib/navigation-preferences';
import { mergeStudioProjects, type StudioProjectItem } from '@/lib/project-navigation';
import { phyniteProjects, type PhyniteProject } from '@/lib/phynite-api';
import { AccountMenu } from './AccountMenu';
import { AiWorkspaceChangeNotice } from './AiWorkspaceChangeNotice';
import { LocalNotificationObserver } from './LocalNotificationObserver';
import { LocalUpdateNotice } from './LocalUpdateNotice';
import { BrandLockup } from './BrandLockup';
import { ResearchShellContext, type ResearchShellState, type SidebarSearch } from './ResearchShellContext';
import { matchesShortcut } from '@/lib/keyboard-preferences';
import { observeBrowserNavigation } from '@/lib/browser-navigation';
import '@/app/research-shell.css';
import '@/app/workspace-motion.css';

export const researchFeatures = {
  projects: { href: '/workspace', en: 'Projects', id: 'Project', Icon: FolderOpen },
  dft: { href: '/calculation', en: 'DFT Lab', id: 'DFT Lab', Icon: CalculationIcon },
  md: { href: '/md', en: 'MD Lab', id: 'MD Lab', Icon: MdLabIcon },
  figures: { href: '/calculation?view=figures', en: 'Figure Lab', id: 'Figure Lab', Icon: FiguresIcon },
  inbox: { href: '/inbox', en: 'Inbox', id: 'Kotak masuk', Icon: Bell },
  computer: { href: '/account/compute#your-computer', en: 'Your computer', id: 'Komputer Anda', Icon: Monitor },
} as const;


const subscribeLocation = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener('phynite:navigation-change', listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener('phynite:navigation-change', listener); };
};
const locationSnapshot = () => `${window.location.pathname}${window.location.search}`;

export function ResearchShellBoundary({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (!researchShellRoute(path)) return <>{children}</>;
  return <ResearchAccessGate><ResearchShellOwner>{children}</ResearchShellOwner></ResearchAccessGate>;
}
function ResearchShellOwner({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return session ? <ResearchApplicationShell key={session.user.id}>{children}</ResearchApplicationShell> : null;
}

function ResearchApplicationShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const owner = session!.user.id;
  useLabAccount(owner);
  const { t } = useLocale();
  const { theme } = useSiteTheme();
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams().toString();
  const currentLocation = useSyncExternalStore(subscribeLocation, locationSnapshot, () => `${path}?${search}`);
  const section = navigationSection(path, currentLocation.split('?')[1] ?? search);
  const projectWorkspace = path.startsWith('/projects/');
  const prefs = useNavigationPreferences(owner);
  const changePreferences = (action: NavigationAction) => {
    try { prefs.change(action); }
    catch { setNavigationError(t('You can pin up to 256 projects. Unpin a project before adding another.', 'Anda dapat mengepin hingga 256 project. Lepas satu pin sebelum menambahkan project lain.')); }
  };
  const cloud = useWorkspaceCloudSync(owner, section === 'ai');
  const local = useCalculationWorkspace();
  const [remote, setRemote] = useState<PhyniteProject[]>([]);
  const [remoteReady, setRemoteReady] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [navigationError, setNavigationError] = useState('');
  const [historyAvailability, setHistoryAvailability] = useState({ back: false, forward: false });
  const browserNavigation = useRef<ReturnType<typeof observeBrowserNavigation> | null>(null);
  const traversingHistory = useRef(false);
  useEffect(() => {
    const controller = observeBrowserNavigation(window, setHistoryAvailability);
    browserNavigation.current = controller;
    return () => { browserNavigation.current = null; controller.dispose(); };
  }, []);
  useEffect(() => { browserNavigation.current?.sync(); }, [currentLocation]);
  const [sidebarHost, setSidebarHost] = useState<HTMLDivElement | null>(null);
  const [sidebarHeaderHost, setSidebarHeaderHost] = useState<HTMLDivElement | null>(null);
  const [sidebarStatusHost, setSidebarStatusHost] = useState<HTMLDivElement | null>(null);
  const [workspaceResourcesHost, setWorkspaceResourcesHost] = useState<HTMLDivElement | null>(null);
  const [workspaceHeaderHost, setWorkspaceHeaderHost] = useState<HTMLDivElement | null>(null);
  const [slotSections, setSlotSections] = useState<Record<string, NavigationSection>>({});
  const [preview, setPreviewState] = useState<NavigationSection | null>(null);
  const [previewSection, setPreviewSection] = useState<NavigationSection | null>(null);
  const setPreview = useCallback((next: NavigationSection | null) => {
    // Direct destinations have their own full page, with no hover panel.
    if (next && !hasContextualSidebar(next)) next = null;
    // Keep the same contents while an outgoing preview fades, including on re-entry.
    if (next !== null) setPreviewSection(next);
    setPreviewState(next);
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(false);
  const [width, setWidth] = useState(280);
  const [contentWidth, setContentWidth] = useState(0);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const closeSidebarSearch = useCallback(() => {
    setSearchOpen(false);
    searchTrigger.current?.focus({ preventScroll: true });
  }, []);
  const [sidebarSearch, setSidebarSearch] = useState<(SidebarSearch & { id: string }) | null>(null);
  const registerSidebarSearch = useCallback((id: string, metadata: SidebarSearch) => {
    setSidebarSearch({ id, ...metadata });
    return () => setSidebarSearch(current => current?.id === id ? null : current);
  }, []);
  const content = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileOpener = useRef<HTMLElement | null>(null);
  const compactControlFocus = useRef<'account' | 'resources' | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardFocus = useRef(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const handlers = useRef(new Map<NavigationSection, Set<(target: NavigationSection, href: string) => boolean | Promise<boolean>>>());
  const request = useRef(0);
  const unread = useInboxUnread(owner);
  const refreshProjects = useCallback((event?: unknown) => {
    const removedId = event instanceof CustomEvent ? event.detail?.removedProjectId : undefined;
    if (typeof removedId === 'string') setRemote(items => items.filter(item => item.id !== removedId));
    const token = ++request.current;
    void phyniteProjects.list().then(result => {
      if (request.current === token) { setRemote(result.projects); setRemoteReady(true); setInventoryError(''); }
    }).catch(() => { if (request.current === token) setInventoryError(t('Projects could not be loaded.', 'Project belum dapat dimuat.')); });
  }, [t]);
  useEffect(() => {
    queueMicrotask(() => refreshProjects());
    window.addEventListener('phynite:project-inventory-change', refreshProjects);
    window.addEventListener('focus', refreshProjects);
    return () => { window.removeEventListener('phynite:project-inventory-change', refreshProjects); window.removeEventListener('focus', refreshProjects); };
  }, [refreshProjects, path]);
  useEffect(() => {
    const target = content.current;
    if (!target) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = target.clientWidth;
        // Keep observer delivery passive when CSS/layout did not actually
        // change the available content width.
        setContentWidth(previous => previous === width ? previous : width);
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    // CSS can hide the old host before matchMedia fires, leaving activeElement
    // at body. Remember the last intentional focus/pointer target until it moves.
    const remember = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || event.type === 'focusin' && target === document.body) return;
      compactControlFocus.current = target.closest('.lab-account-menu') ? 'account' : target.closest('.workspace-resources-meter') ? 'resources' : null;
    };
    const clear = () => { compactControlFocus.current = null; };
    document.addEventListener('focusin', remember, true);
    document.addEventListener('pointerdown', remember, true);
    window.addEventListener('blur', clear);
    return () => { document.removeEventListener('focusin', remember, true); document.removeEventListener('pointerdown', remember, true); window.removeEventListener('blur', clear); };
  }, []);
  useEffect(() => { compactControlFocus.current = null; }, [path]);
  useEffect(() => {
    try { const saved = Number(localStorage.getItem('phynite:research-sidebar-width')); if (saved >= 240 && saved <= 360) queueMicrotask(() => setWidth(saved)); } catch {}
    const media = matchMedia('(max-width: 960px)');
    queueMicrotask(() => setMobileLayout(media.matches));
    const change = () => {
      const accountFocused = compactControlFocus.current === 'account';
      const resourceFocused = compactControlFocus.current === 'resources';
      const navigationFocused = navigation.current?.contains(document.activeElement);
      setMobileLayout(media.matches); setMobileOpen(false); setPreview(null);
      requestAnimationFrame(() => {
        if (resourceFocused) document.querySelector<HTMLElement>('.workspace-resources-meter')?.focus({ preventScroll: true });
        else if (accountFocused) document.querySelector<HTMLElement>(media.matches ? '.lab-account-menu--mobile .lab-account-toggle' : '.lab-account-menu--rail .lab-account-toggle')?.focus({ preventScroll: true });
        else if (navigationFocused) (media.matches ? document.querySelector<HTMLElement>('.workflow-history-controls button[aria-controls="research-navigation"]') ?? mobileTrigger.current : document.querySelector<HTMLElement>('.research-icon-rail > a'))?.focus({ preventScroll: true });
      });
    };
    media.addEventListener('change', change);
    return () => { media.removeEventListener('change', change); resizeCleanup.current?.(); if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, [setPreview]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    const trigger = mobileOpener.current ?? mobileTrigger.current;
    document.body.style.overflow = 'hidden';
    Array.from(navigation.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled)') ?? []).find(element => element.getClientRects().length > 0)?.focus();
    return () => { document.body.style.overflow = previous; if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus(); };
  }, [mobileOpen]);
  // Only expose the device snapshot after its owner has been verified. Keep
  // those local projects even when a linked ID is absent from the inventory;
  // stale remote metadata must not hide the preserved research project.
  const projects = useMemo(() => mergeStudioProjects(cloud.ready ? local.projects : [], remote, cloud.ready ? local.trashProjects : []), [cloud.ready, local.projects, local.trashProjects, remote]);
  const registerSlot = useCallback((id: string, value: NavigationSection) => {
    setSlotSections(current => ({ ...current, [id]: value }));
    return () => setSlotSections(current => { const next = { ...current }; delete next[id]; return next; });
  }, []);
  const registerNavigation = useCallback((value: NavigationSection, handler: (target: NavigationSection, href: string) => boolean | Promise<boolean>) => {
    const registered = handlers.current.get(value) ?? new Set();
    registered.add(handler); handlers.current.set(value, registered);
    return () => { registered.delete(handler); if (!registered.size) handlers.current.delete(value); };
  }, []);
  const openSidebar = useCallback(() => {
    // An explicit open must outlive a hover-exit timer from the previous panel.
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (matchMedia('(max-width: 960px)').matches) { mobileOpener.current = document.activeElement as HTMLElement; setMobileOpen(true); } else setPreview(section);
  }, [section, setPreview]);
  const settingsSidebar = section === 'account' || section === 'billing';
  const docked = hasContextualSidebar(section) && (settingsSidebar || prefs.preferences.sidebarDocked);
  const sidebarOpen = mobileLayout ? mobileOpen : docked || Boolean(preview);
  const toggleSidebar = (trigger?: HTMLElement) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setPreview(null);
    if (matchMedia('(max-width: 960px)').matches) {
      if (!mobileOpen) mobileOpener.current = trigger ?? document.activeElement as HTMLElement;
      setMobileOpen(!mobileOpen);
    } else if (!settingsSidebar) prefs.change({ type: 'dock', docked: !sidebarOpen });
  };
  const closeMobileNavigation = useCallback(() => setMobileOpen(false), []);
  const focusKeepsPreview = useCallback(() => {
    const focused = document.activeElement;
    return navigation.current?.contains(focused) && (keyboardFocus.current || focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement);
  }, []);
  const navigate = useCallback((target: NavigationSection, href: string) => {
    void (async () => {
      try {
        setNavigationError('');
        let handled = false;
        for (const callback of [...(handlers.current.get(section) ?? [])]) if (await callback(target, href)) handled = true;
        if (!handled) {
          if (cloud.ready && cloud.status === 'syncing') await cloud.flush();
          if (new URL(href, window.location.href).pathname === window.location.pathname && (section === 'dft' || section === 'figures' || section === 'md')) {
            window.history.pushState(window.history.state, '', href);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } else router.push(href);
        }
        const focused = document.activeElement;
        const keepFocus = navigation.current?.contains(focused) && (keyboardFocus.current || focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement);
        const keepPreview = !matchMedia('(max-width: 960px)').matches && (navigation.current?.matches(':hover') || keepFocus);
        setMobileOpen(false); setPreview(keepPreview ? target : null); setQuery(''); setSearchOpen(false);
      } catch { setNavigationError(t('Your changes could not be saved. Retry before leaving this workspace.', 'Perubahan belum dapat disimpan. Coba lagi sebelum meninggalkan workspace ini.')); }
    })();
  }, [section, cloud, router, t, setPreview]);
  const traverseHistory = (direction: -1 | 1) => {
    if (traversingHistory.current || !(direction === -1 ? historyAvailability.back : historyAvailability.forward)) return;
    traversingHistory.current = true;
    void (async () => {
      try {
        setNavigationError('');
        if (!('navigation' in window) && document.querySelector('[data-settings-dirty="true"]') && !window.confirm(t('Discard unsaved settings changes?', 'Abaikan perubahan pengaturan yang belum disimpan?'))) return;
        const href = browserNavigation.current?.target(direction) ?? window.location.href;
        const url = new URL(href, window.location.href), target = navigationSection(url.pathname, url.search.slice(1));
        for (const callback of [...(handlers.current.get(section) ?? [])]) await callback(target, href);
        if (cloud.ready && cloud.status === 'syncing') await cloud.flush();
        setMobileOpen(false); setPreview(null);
        window.history.go(direction);
      } catch { setNavigationError(t('Your changes could not be saved. Retry before leaving this workspace.', 'Perubahan belum dapat disimpan. Coba lagi sebelum meninggalkan workspace ini.')); }
      finally { traversingHistory.current = false; }
    })();
  };
  const value: ResearchShellState = { section, location: currentLocation, sidebarHost, sidebarHeaderHost, sidebarStatusHost, workspaceResourcesHost, inboxUnread: unread, workspaceHeaderHost, contentWidth, projects, projectsReady: remoteReady && (cloud.ready || cloud.status === 'error'), projectsError: inventoryError, projectSearchOpen: searchOpen, closeSidebarSearch, projectQuery: query, setProjectQuery: setQuery,
    preferences: prefs.preferences, preferencesStatus: prefs.status, changePreferences, openSidebar, sidebarOpen, toggleSidebar, canGoBack: historyAvailability.back, canGoForward: historyAvailability.forward, traverseHistory, closeMobileNavigation, navigate, refreshProjects, registerSlot, registerSidebarSearch, registerNavigation };
  const shownSection = mobileOpen && !hasContextualSidebar(section) ? 'home' : docked || mobileOpen ? section : preview ?? (previewSection === section ? previewSection : section);
  const hasSlot = Object.values(slotSections).includes(shownSection) && shownSection === section;
  const workflowSidebar = shownSection === 'projects' && path.startsWith('/projects/');
  const canBrowse = !hasSlot && !workflowSidebar && ['home', 'projects', 'dft', 'md', 'figures'].includes(shownSection);
  const shownProjects = projects.filter(project => (shownSection !== 'dft' && shownSection !== 'figures' || project.kind === 'dft') && (shownSection !== 'md' || project.kind === 'md'));
  const visibleProjects = shownProjects.filter(project => `${project.name} ${project.description}`.toLowerCase().includes(query.toLowerCase()));
  const pinned = prefs.preferences.pinnedProjectKeys.flatMap(key => visibleProjects.filter(project => project.key === key));
  const label = (id: NavigationSection) => id === 'home' ? 'Home' : id === 'profile' ? t('Profile', 'Profil') : id === 'account' ? t('Settings', 'Pengaturan') : id === 'billing' ? t('Billing', 'Tagihan') : id === 'ai' ? 'Phynite AI' : t(researchFeatures[id].en, researchFeatures[id].id);
  const leave = useCallback(() => { if (!docked && !mobileOpen) { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => { if (!navigation.current?.matches(':hover') && !focusKeepsPreview() && !document.querySelector('[data-research-sidebar-interaction]')) setPreview(null); }, 180); } }, [docked, mobileOpen, focusKeepsPreview, setPreview]);
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    // Native DOM events include lab portals, whose React ancestry stays in the editor.
    const enterPanel = (event: PointerEvent) => { keyboardFocus.current = false; if (closeTimer.current) clearTimeout(closeTimer.current); if (!docked && !mobileOpen && !preview && previewSection === section && hasContextualSidebar(section) && event.clientX >= element.getBoundingClientRect().right) setPreview(previewSection); };
    const pointerDown = () => { keyboardFocus.current = false; };
    const focusIn = (event: FocusEvent) => { if (event.target instanceof Element && event.target.matches(':focus-visible')) keyboardFocus.current = true; };
    const focusOut = (event: FocusEvent) => { if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) leave(); };
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const inside = element.contains(document.activeElement);
      if (inside) keyboardFocus.current = true;
      if (!inside && document.activeElement instanceof Element && document.activeElement.closest('dialog[open],[role="dialog"][aria-modal="true"],[data-research-sidebar-interaction]')) return;
      if (event.key === 'Escape' && (inside || !docked && preview || mobileOpen)) {
        event.preventDefault(); setPreview(null); setMobileOpen(false);
        // Return focus outside the hidden panel without reopening a rail hover preview.
        (mobileLayout ? mobileTrigger.current : element.querySelector<HTMLAnchorElement>('.research-rail-button'))?.focus();
      }
      if (mobileOpen && event.key === 'Tab') {
        const items = Array.from(element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, [tabindex="0"]')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        // Opening the drawer and its first key event can precede initial focus.
        if (!inside || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    element.addEventListener('pointerenter', enterPanel);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('focusin', focusIn);
    element.addEventListener('focusout', focusOut);
    window.addEventListener('keydown', keyDown);
    return () => { element.removeEventListener('pointerenter', enterPanel); element.removeEventListener('pointerleave', leave); element.removeEventListener('pointerdown', pointerDown); element.removeEventListener('focusin', focusIn); element.removeEventListener('focusout', focusOut); window.removeEventListener('keydown', keyDown); };
  }, [leave, docked, mobileOpen, preview, previewSection, section, mobileLayout, setPreview]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || (event.target instanceof Element && event.target.closest('dialog[open],[role="dialog"],input,select,[contenteditable="true"]'))) return;
      if (matchesShortcut(event, 'focus-chat')) {
        const composer = Array.from(document.querySelectorAll<HTMLTextAreaElement>('.ai-composer-box textarea')).find(element => element.getClientRects().length && !element.disabled);
        if (composer) { event.preventDefault(); composer.focus(); }
      } else if (!(event.target instanceof HTMLTextAreaElement) && matchesShortcut(event, 'open-settings')) { event.preventDefault(); navigate('account', '/account/appearance'); }
      else if (!(event.target instanceof HTMLTextAreaElement) && matchesShortcut(event, 'toggle-sidebar')) {
        event.preventDefault();
        if (mobileLayout) setMobileOpen(current => !current);
        else if (!settingsSidebar) prefs.change({ type: 'dock', docked: !sidebarOpen });
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [navigate, mobileLayout, settingsSidebar, sidebarOpen, prefs]);
  const railLink = (id: 'home' | NavigationFeature) => {
    const item = id === 'home' ? { href: '/workspace', Icon: Home } : researchFeatures[id];
    const Icon = item.Icon;
    return <Link key={id} className="research-rail-button" href={item.href} title={label(id)} aria-label={label(id)} aria-current={section === id ? 'page' : undefined} onPointerEnter={() => setPreview(null)} onFocus={() => setPreview(null)} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); navigate(id, item.href);
    }}>{id === 'home' && section === 'home'
      ? <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2z" /></svg>
      : <Icon size={18} strokeWidth={2} />}{id === 'inbox' && unread && <i className="research-unread-dot" />}</Link>;
  };
  const projectRows = (items: StudioProjectItem[]) => items.map(project => <div className="research-project-shortcut" key={project.key} data-pinned={prefs.preferences.pinnedProjectKeys.includes(project.key)}>
    <Link href={shownSection === 'figures' ? `${project.href}?view=figures` : project.href} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); navigate(shownSection === 'figures' ? 'figures' : project.kind, shownSection === 'figures' ? `${project.href}?view=figures` : project.href);
    }}><FolderOpen size={18} /><span>{project.name}</span></Link>
    <button type="button" aria-label={prefs.preferences.pinnedProjectKeys.includes(project.key) ? t(`Unpin ${project.name}`, `Lepas pin ${project.name}`) : t(`Pin ${project.name}`, `Pin ${project.name}`)} onClick={() => changePreferences({ type: 'project', key: project.key, pinned: !prefs.preferences.pinnedProjectKeys.includes(project.key) })}><Pin size={13} fill={prefs.preferences.pinnedProjectKeys.includes(project.key) ? 'currentColor' : 'none'} /></button>
  </div>);
  return <ResearchShellContext.Provider value={value}><WorkspaceCloudSyncContext.Provider value={{ owner, state: cloud }}>
    <div className="research-app-shell" data-project-header={projectWorkspace} data-research-theme={theme} data-docked={docked} data-settings={settingsSidebar} data-preview={Boolean(preview)} data-mobile-open={mobileOpen} style={{ '--research-sidebar-width': `${settingsSidebar ? 280 : width}px` } as CSSProperties}>
      {session?.mode === 'local' && <><LocalNotificationObserver owner={owner} /><LocalUpdateNotice inert={mobileOpen} /></>}
      <div ref={setWorkspaceHeaderHost} className="research-workspace-header" hidden={!projectWorkspace} inert={mobileOpen}>
        {mobileLayout && projectWorkspace && <div className="research-project-account-actions"><div ref={setWorkspaceResourcesHost} className="research-resources-host" /><AccountMenu session={session!} variant="mobile" /></div>}
      </div>
      <header className="research-mobile-header" hidden={projectWorkspace} inert={mobileOpen}><button ref={mobileTrigger} type="button" aria-label={t('Open navigation', 'Buka navigasi')} aria-expanded={mobileOpen} aria-controls="research-navigation" onClick={() => { mobileOpener.current = mobileTrigger.current; setPreview(null); setMobileOpen(true); }}><Menu size={21} /></button><strong>{label(section)}</strong>{mobileLayout && !projectWorkspace && <div className="research-home-account-actions"><div ref={setWorkspaceResourcesHost} className="research-resources-host" /><AccountMenu session={session!} variant="mobile" /></div>}</header>
      {mobileOpen && <button className="research-mobile-backdrop" aria-label={t('Close navigation', 'Tutup navigasi')} onClick={() => setMobileOpen(false)} />}
      <div ref={navigation} id="research-navigation" className="research-navigation" inert={mobileLayout && !mobileOpen} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label={t('Research navigation', 'Navigasi riset')}>
        {!settingsSidebar && <nav className="research-icon-rail" aria-label={t('Workspace features', 'Fitur workspace')}>
          {railLink('home')}
          {!mobileLayout && <div className="research-rail-account"><div ref={setWorkspaceResourcesHost} className="research-resources-host" /><AccountMenu session={session!} variant="rail" /></div>}
        </nav>}
        <aside className="research-context-sidebar" aria-label={`${label(shownSection)} sidebar`} inert={!sidebarOpen} aria-hidden={!sidebarOpen}>
          <header className="research-sidebar-heading">
            <Link className="research-sidebar-brand" href="/workspace" aria-label={t('Phynite Lab home', 'Beranda Phynite Lab')} onClick={event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate('home','/workspace');}}><BrandLockup /></Link>
            {(canBrowse||workflowSidebar)&&<button type="button" ref={searchTrigger} data-sidebar-search aria-label={workflowSidebar ? sidebarSearch?.label ?? t('Search modules','Cari modul') : t('Search projects','Cari project')} aria-expanded={searchOpen} aria-controls={workflowSidebar ? sidebarSearch?.controls ?? 'workflow-project-search' : 'research-project-search'} onClick={()=>setSearchOpen(current=>!current)}><Search size={18}/></button>}
            {hasContextualSidebar(section) && !workflowSidebar && !settingsSidebar && <button type="button" className="research-sidebar-dock" aria-label={docked?t('Unlock sidebar','Lepas kunci sidebar'):t('Lock sidebar open','Kunci sidebar terbuka')} aria-pressed={docked} onClick={()=>{prefs.change({type:'dock',docked:!docked});setPreview(docked?section:null);}}>{docked?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</button>}
            <button className="research-drawer-close" aria-label={t('Close navigation','Tutup navigasi')} onClick={()=>setMobileOpen(false)}><X size={19}/></button>
          </header>
          <div ref={setSidebarHeaderHost} className="research-sidebar-lab-header" hidden={shownSection !== section} />
          {canBrowse && <Link className="research-sidebar-new research-sidebar-create" href="/workspace?create=1" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate('home', '/workspace?create=1'); }}><SquarePen size={18} />{t('New project', 'Project baru')}</Link>}
          {!!pinned.length && canBrowse && !workflowSidebar && <section className="research-sidebar-pinned"><h2>{t('Pinned', 'Dipin')}</h2>{projectRows(pinned)}</section>}
          <div ref={setSidebarHost} className="research-sidebar-host" hidden={!hasSlot} />
          {!hasSlot && (shownSection === 'account' || shownSection === 'billing') && <SettingsNavigation onNavigate={() => setMobileOpen(false)} />}
          {canBrowse && <div className="research-sidebar-browse">
            {searchOpen && <label id="research-project-search" className="research-sidebar-search"><Search size={15} /><input autoFocus type="search" aria-label={t('Search projects', 'Cari project')} placeholder={t('Search projects', 'Cari project')} value={query} onChange={event => setQuery(event.target.value)} /></label>}
            <h2>{shownSection === 'home' ? t('Recents', 'Terakhir dibuka') : t('Projects', 'Project')}</h2>
            {inventoryError && <p className="research-sidebar-empty" role="alert">{inventoryError} <button type="button" onClick={refreshProjects}>{t('Retry', 'Coba lagi')}</button></p>}
            {!(cloud.ready && remoteReady) && !inventoryError && <div className="research-sidebar-loading"><WorkspaceLoading layout="list" label={t('Loading projects…', 'Memuat project…')} /></div>}
            {(cloud.ready && remoteReady) && !visibleProjects.length && <p className="research-sidebar-empty">{query ? t('No matching projects.', 'Tidak ada project yang cocok.') : t('No projects yet. Create your first study.', 'Belum ada project. Buat riset pertama Anda.')}</p>}
            {projectRows((shownSection === 'home' ? visibleProjects.filter(project => !pinned.includes(project)).slice(0, 8) : visibleProjects))}
          </div>}
          <div ref={setSidebarStatusHost} className="research-sidebar-lab-status" hidden={shownSection !== section} />
          {prefs.status === 'pending' && <div className="research-preference-notice" role="status"><span>{prefs.preferences.pinnedProjectKeys.length > 256 ? t('Unpin a project to sync.', 'Lepas satu pin untuk sinkronisasi.') : t('Sync pending', 'Menunggu sinkronisasi')}</span><button type="button" onClick={prefs.retry}>{t('Retry', 'Coba lagi')}</button></div>}
          {!settingsSidebar && <div role="separator" aria-label={t('Resize sidebar', 'Ubah lebar sidebar')} aria-orientation="vertical" aria-valuemin={240} aria-valuemax={360} aria-valuenow={width} tabIndex={0} className="research-sidebar-resizer" onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = Math.min(360, Math.max(240, width + (event.key === 'ArrowRight' ? 10 : -10))); setWidth(next); try { localStorage.setItem('phynite:research-sidebar-width', String(next)); } catch {} } }} onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); const start = event.clientX, initial = width;
            const move = (pointer: PointerEvent) => { const next = Math.min(360, Math.max(240, initial + pointer.clientX - start)); setWidth(next); try { localStorage.setItem('phynite:research-sidebar-width', String(next)); } catch {} };
            const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); resizeCleanup.current = null; };
            resizeCleanup.current?.(); resizeCleanup.current = stop; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
          }} />}
        </aside>
      </div>
      <div ref={content} className="research-app-content" inert={mobileOpen}><AiWorkspaceChangeNotice owner={owner} visible={section !== 'ai' && !path.startsWith('/projects/')} />{navigationError && <div className="research-navigation-error" role="alert">{navigationError}<button onClick={() => setNavigationError('')} aria-label={t('Dismiss', 'Tutup')}><X size={16} /></button></div>}{children}</div>
    </div>
  </WorkspaceCloudSyncContext.Provider></ResearchShellContext.Provider>;
}

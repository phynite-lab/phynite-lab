'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { NavigationAction, NavigationSection, NavigationSnapshot } from '@/lib/navigation-preferences';
import type { StudioProjectItem } from '@/lib/project-navigation';

export type SidebarSearch = { label: string; controls: string };

export type ResearchShellState = {
  section: NavigationSection;
  location: string;
  sidebarHost: HTMLElement | null;
  sidebarHeaderHost: HTMLElement | null;
  sidebarStatusHost: HTMLElement | null;
  workspaceResourcesHost: HTMLElement | null;
  inboxUnread?: boolean;
  workspaceHeaderHost: HTMLElement | null;
  contentWidth: number;
  projects: StudioProjectItem[];
  projectsReady: boolean;
  projectsError: string;
  projectSearchOpen: boolean;
  closeSidebarSearch: () => void;
  projectQuery: string;
  setProjectQuery: (query: string) => void;
  preferences: NavigationSnapshot['preferences'];
  preferencesStatus: NavigationSnapshot['status'];
  changePreferences: (action: NavigationAction) => void;
  openSidebar: () => void;
  sidebarOpen: boolean;
  toggleSidebar: (trigger?: HTMLElement) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  traverseHistory: (direction: -1 | 1) => void;
  closeMobileNavigation: () => void;
  navigate: (section: NavigationSection, href: string) => void;
  refreshProjects: () => void;
  registerSlot: (id: string, section: NavigationSection) => () => void;
  registerSidebarSearch: (id: string, search: SidebarSearch) => () => void;
  registerNavigation: (section: NavigationSection, handler: (target: NavigationSection, href: string) => boolean | Promise<boolean>) => () => void;
};
export const ResearchShellContext = createContext<ResearchShellState | null>(null);
export const useResearchShell = () => useContext(ResearchShellContext);

/** The active workspace names the shared search trigger without moving its focus. */
export function useResearchSidebarSearch({ label, controls }: SidebarSearch) {
  const register = useResearchShell()?.registerSidebarSearch;
  const id = useId();
  useLayoutEffect(() => register?.(id, { label, controls }), [register, id, label, controls]);
}

/** Project tabs belong to the application frame; editor viewports stay mounted below. */
export function ResearchWorkspaceHeaderSlot({ children }: { children: ReactNode }) {
  const shell = useResearchShell();
  if (!shell) return <>{children}</>;
  return shell.workspaceHeaderHost ? createPortal(children, shell.workspaceHeaderHost) : null;
}

export function useResearchNavigation(section: NavigationSection, handler: (target: NavigationSection, href: string) => boolean | Promise<boolean>) {
  const register = useResearchShell()?.registerNavigation;
  useLayoutEffect(() => register?.(section, handler), [register, section, handler]);
}

/** The lab stays mounted; only its sidebar content is moved into the shared host. */
export function ResearchSidebarSlot({ section, children, className = '', inline = false }: { section: NavigationSection; children: ReactNode; className?: string; inline?: boolean }) {
  const shell = useResearchShell();
  const id = useId();
  const register = shell?.registerSlot;
  useEffect(() => inline ? undefined : register?.(id, section), [id, section, register, inline]);
  if (!shell || inline) return <>{children}</>;
  if (!shell.sidebarHost) return null;
  return createPortal(<div className={`research-sidebar-slot ${className}`} data-slot-section={section} hidden={shell.section !== section}>{children}</div>, shell.sidebarHost);
}

export function ResearchSidebarHeaderSlot({ section, children }: { section: NavigationSection; children: ReactNode }) {
  const shell = useResearchShell();
  if (!shell) return <>{children}</>;
  return shell.sidebarHeaderHost ? createPortal(<div hidden={shell.section !== section}>{children}</div>, shell.sidebarHeaderHost) : null;
}

export function ResearchSidebarStatusSlot({ section, children }: { section: NavigationSection; children: ReactNode }) {
  const shell = useResearchShell();
  if (!shell) return <>{children}</>;
  return shell.sidebarStatusHost ? createPortal(<div hidden={shell.section !== section}>{children}</div>, shell.sidebarStatusHost) : null;
}

export function ResearchResourcesSlot({ section, children }: { section: NavigationSection; children: ReactNode }) {
  const shell = useResearchShell();
  return shell?.workspaceResourcesHost ? createPortal(<div hidden={shell.section !== section}>{children}</div>, shell.workspaceResourcesHost) : null;
}

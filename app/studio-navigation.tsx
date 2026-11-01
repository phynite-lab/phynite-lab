'use client';

import type { ReactNode } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLocale } from './locale-provider';
import type { AccountSection } from './account-navigation';
import type { PhyniteSession } from './auth-client';
import { useResearchShell } from '@/components/ResearchShellContext';

export function StudioNavigationProvider({ children }: { children: ReactNode }) { return <>{children}</>; }

export function StudioNavigationToggle({ placement = 'header' }: { placement?: 'header' | 'rail' }) {
  const shell = useResearchShell();
  const { t } = useLocale();
  if (!shell) return null;
  const label = shell.sidebarOpen ? t('Collapse sidebar', 'Ciutkan sidebar') : t('Expand sidebar', 'Perluas sidebar');
  return <button type="button" className={`studio-navigation-toggle studio-toggle-${placement}`} aria-expanded={shell.sidebarOpen} aria-label={label} onClick={event => shell.toggleSidebar(event.currentTarget)}>
    <span className="studio-toggle-desktop" aria-hidden="true">{shell.sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</span><span className="studio-toggle-mobile" aria-hidden="true"><Menu size={19} /></span>
  </button>;
}

/** The local ResearchApplicationShell owns the single navigation rail. */
export function StudioNavigation(props: { active: 'workspace' | 'projects' | 'inbox' | 'billing' | 'account' | 'calculation' | 'md'; accountSection?: AccountSection | 'billing'; standalone?: boolean; sessionOverride?: PhyniteSession; forceExpanded?: boolean; onNavigate?: () => void }) {
  void props;
  return null;
}

export function StudioLabOperations(props: { session: PhyniteSession; active: 'calculation' | 'md' }) {
  void props;
  return null;
}

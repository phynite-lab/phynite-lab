'use client';

import type { CSSProperties, ReactNode } from 'react';
import { CalculationIcon, FiguresIcon, MdLabIcon } from '@/app/tool-icons';
import { cn } from '@/lib/utils';
import { ResourceUsageSummary } from './ResourceUsageSummary';
import { WorkspaceIdentity, type WorkspaceSaveState } from './WorkspaceIdentity';
import { ResearchSidebarHeaderSlot, useResearchShell } from './ResearchShellContext';

export type WorkspaceProduct = 'crystal' | 'figures' | 'md';

export type WorkspaceProductDestination = {
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
};

type HeaderProps = {
  inline?: boolean;
  activeProduct: WorkspaceProduct;
  saveState: WorkspaceSaveState;
  saveLabel: string;
  saveDetail?: string;
  hideSave?: boolean;
  destinations?: Partial<Record<WorkspaceProduct, WorkspaceProductDestination>>;
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  resourceOwnerId?: string;
  resourceUnlimited?: boolean;
};

const products = [
  { id: 'crystal' as const, label: 'DFT Lab', href: '/calculation', Icon: CalculationIcon },
  { id: 'md' as const, label: 'MD Lab', href: '/md', Icon: MdLabIcon },
  { id: 'figures' as const, label: 'Figure Lab', href: '/calculation?view=figures', Icon: FiguresIcon },
];

export function WorkspaceProductSwitcher({ activeProduct, destinations }: Pick<HeaderProps, 'activeProduct' | 'destinations'>) {
  const shell = useResearchShell();
  if (shell) return null;
  return <nav className="workspace-product-switcher" aria-label="Research workspaces">
    {products.map(({ id, label, href, Icon }) => {
      const destination = destinations?.[id];
      const content = <><Icon size={15} /><span className="workspace-product-label">{label}</span></>;
      const common = {
        className: 'workspace-product-switcher-item',
        'data-product': id,
        title: destination?.title ?? label,
      };
      if (id === activeProduct) return <span key={id} {...common} aria-current="page">{content}</span>;
      if (destination?.onSelect) return <button key={id} type="button" {...common} disabled={destination.disabled} onClick={destination.onSelect}>{content}</button>;
      return <a key={id} {...common} href={destination?.href ?? href} aria-disabled={destination?.disabled || undefined} onClick={destination?.disabled ? event => event.preventDefault() : undefined}>{content}</a>;
    })}
  </nav>;
}

export function WorkspaceProductHeader({ inline = false, activeProduct, saveState, saveLabel, saveDetail, hideSave, destinations, context, actions, className, style, hidden, resourceOwnerId, resourceUnlimited }: HeaderProps) {
  const contextShell = useResearchShell();
  const shell = inline ? null : contextShell;
  const showResources = Boolean(!shell && resourceOwnerId && (activeProduct === 'crystal' || activeProduct === 'md'));
  const header = <header className={cn('workspace-product-header', className)} style={style} hidden={hidden}>
    {!shell && <WorkspaceIdentity state={saveState} label={saveLabel} detail={saveDetail} hideSave={hideSave} />}
    <WorkspaceProductSwitcher activeProduct={activeProduct} destinations={destinations} />
    {context && <div className="workspace-product-context">{context}</div>}
    {(showResources || actions) && (
      <div className="workspace-product-commandbar">
        {showResources && <ResourceUsageSummary userId={resourceOwnerId} variant="header" unlimited={resourceUnlimited} />}
        {showResources && actions && <span className="workspace-product-divider" aria-hidden="true" />}
        {actions}
      </div>
    )}
  </header>;
  return shell ? <ResearchSidebarHeaderSlot section={activeProduct === 'crystal' ? 'dft' : activeProduct}>{header}</ResearchSidebarHeaderSlot> : header;
}

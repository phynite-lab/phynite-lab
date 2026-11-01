'use client';

import type { ReactNode } from 'react';
import { Files, FolderKanban } from 'lucide-react';
import { cn } from '@/lib/utils';

type WorkspaceProjectGateProps = {
  theme: 'light' | 'dark';
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
  className?: string;
};

export function WorkspaceProjectGate({ theme, description, actionLabel, onAction, children, className }: WorkspaceProjectGateProps) {
  const isLight = theme === 'light';

  return <section className={cn('workspace-project-gate grid place-items-center px-6 py-12 text-center', className)}>
    <div className="flex w-full max-w-[560px] flex-col items-center text-center">
      <FolderKanban size={28} strokeWidth={1.6} className="mx-auto text-[var(--panel-muted)]" />
      <h1 className={cn('mt-5 text-[18px] font-semibold tracking-[-.015em] text-center', isLight ? 'text-[#303a46]' : 'text-[#ededed]')}>Choose a project</h1>
      <p className={cn('mx-auto mt-2 max-w-[520px] text-center text-[12px] leading-5', isLight ? 'text-[#737e8b]' : 'text-[#919199]')}>{description}</p>
      {actionLabel && onAction && <button
        type="button"
        onClick={onAction}
        className={cn('mt-5 h-9 rounded-[5px] border px-4 text-[11px] font-medium transition-colors', isLight ? 'border-[#d7dce2] bg-white text-[#394553] hover:bg-[#f3f5f7]' : 'border-[#343434] bg-[#151515] text-[#e5e5e7] hover:bg-[#202020]')}
      >{actionLabel}</button>}
      {children}
    </div>
  </section>;
}

type WorkspaceAssetGateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function WorkspaceAssetGate({ title, description, actionLabel, onAction, className }: WorkspaceAssetGateProps) {
  return <section className={cn('workspace-asset-gate grid place-items-center bg-[var(--workspace-viewport)] px-6 py-12 text-center', className)}>
    <div className="flex w-full max-w-[380px] flex-col items-center text-center">
      <Files size={26} strokeWidth={1.5} className="text-[var(--panel-muted)]" />
      <h1 className="mt-4 text-[14px] font-medium tracking-[-.01em] text-[var(--panel-text)]">{title}</h1>
      <p className="mt-1.5 max-w-[340px] text-[11px] leading-5 text-[var(--panel-muted)]">{description}</p>
      {actionLabel && onAction && <button
        type="button"
        onClick={onAction}
        className="mt-4 h-8 rounded-[5px] bg-[var(--panel-accent)] px-3 text-[11px] font-semibold text-white hover:brightness-110"
      >{actionLabel}</button>}
    </div>
  </section>;
}

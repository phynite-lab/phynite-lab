'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Copy,
  DatabaseSearch,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { labSidebarProjectCount } from '@/lib/lab-sidebar';
import { cn } from '@/lib/utils';
import { navigationProjectKey, type NavigationSection } from '@/lib/navigation-preferences';
import { ResearchSidebarSlot, useResearchShell } from './ResearchShellContext';

export interface LabSidebarProject {
  id: string;
  name: string;
  description?: string;
  count?: number | null;
}

export interface LabSidebarAsset {
  id: string;
  projectId: string;
  name: string;
  formula: string;
  kind: string;
  atomCount?: number | null;
  atoms?: { length: number }[] | unknown[];
}

type ItemActionMenu = {
  key: string;
  kind: 'project' | 'structure';
  id: string;
  left: number;
  top: number;
};

export interface LabProjectAssetSidebarProps<T extends LabSidebarAsset = LabSidebarAsset> {
  shellSection?: NavigationSection;
  projects: LabSidebarProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;

  assets: T[];
  activeAssetId: string | null;
  onSelectAsset: (material: T) => void;
  onCreateAsset?: () => void;
  onImportFile: () => void;
  onOpenMaterialsProject?: () => void;
  onRenameAsset: (id: string, name: string) => void;
  onDuplicateAsset: (id: string) => void;
  onDeleteAsset: (id: string) => void;

  width: number;
  onWidthChange: (width: number) => void;
  initialCreateProjectOpen?: boolean;
  assetSectionLabel?: string;
  assetSingularLabel?: string;
  emptyAssetLabel?: string;
  createAssetLabel?: string;
  importLabel?: string;
  canAddAsset?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

const clampWidth = (width: number) => Math.min(420, Math.max(190, width));

export function LabProjectAssetSidebar<T extends LabSidebarAsset = LabSidebarAsset>({
  shellSection = 'dft',
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,

  assets,
  activeAssetId,
  onSelectAsset,
  onCreateAsset,
  onImportFile,
  onOpenMaterialsProject,
  onRenameAsset,
  onDuplicateAsset,
  onDeleteAsset,

  width,
  onWidthChange,
  initialCreateProjectOpen = false,
  assetSectionLabel = 'Structures',
  assetSingularLabel = 'structure',
  emptyAssetLabel = 'No structures',
  createAssetLabel = 'New structure',
  importLabel = 'Import file',
  canAddAsset = true,
  isOpen,
  onClose,
}: LabProjectAssetSidebarProps<T>) {
  const shell = useResearchShell();
  const [newProjectOpen, setNewProjectOpen] = useState(initialCreateProjectOpen);
  const [newProjectName, setNewProjectName] = useState('');
  const [structureAddOpen, setStructureAddOpen] = useState(false);
  const [itemMenuOpen, setItemMenuOpen] = useState<ItemActionMenu | null>(null);
  const [itemMenuMode, setItemMenuMode] = useState<'actions' | 'rename'>('actions');
  const [renameValue, setRenameValue] = useState('');
  const [isResizing, setIsResizing] = useState(false);
  const resizeCleanup = useRef<(() => void) | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectAssets = assets.filter((record) => record.projectId === activeProjectId);

  useEffect(() => () => resizeCleanup.current?.(), []);

  useEffect(() => {
    if (!itemMenuOpen) return;
    const closeMenu = () => setItemMenuOpen(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [itemMenuOpen]);

  const toggleItemMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    key: string,
    kind: ItemActionMenu['kind'],
    id: string,
  ) => {
    event.stopPropagation();
    setStructureAddOpen(false);
    const trigger = event.currentTarget.getBoundingClientRect();
    const menuWidth = 156;
    const menuHeight = 106;
    const viewportGap = 8;
    const triggerGap = 4;
    const openToRight = trigger.right + triggerGap + menuWidth <= window.innerWidth - viewportGap;
    const left = openToRight
      ? trigger.right + triggerGap
      : Math.max(viewportGap, trigger.left - menuWidth - triggerGap);
    const top = Math.max(
      viewportGap,
      Math.min(window.innerHeight - menuHeight - viewportGap, trigger.top - triggerGap),
    );

    setItemMenuMode('actions');
    setRenameValue('');
    setItemMenuOpen((current) => (current?.key === key ? null : { key, kind, id, left, top }));
  };

  const closeItemMenu = () => {
    setItemMenuOpen(null);
    setItemMenuMode('actions');
    setRenameValue('');
  };

  const beginRename = () => {
    if (!itemMenuOpen) return;
    const name =
      itemMenuOpen.kind === 'project'
        ? projects.find((project) => project.id === itemMenuOpen.id)?.name
        : assets.find((record) => record.id === itemMenuOpen.id)?.name;
    if (!name) return;
    setRenameValue(name);
    setItemMenuMode('rename');
  };

  const commitRename = () => {
    if (!itemMenuOpen) return;
    const name = renameValue.trim();
    if (!name) return;
    if (itemMenuOpen.kind === 'project') {
      onRenameProject(itemMenuOpen.id, name);
    } else {
      onRenameAsset(itemMenuOpen.id, name);
    }
    closeItemMenu();
  };

  const handleDuplicate = () => {
    if (!itemMenuOpen) return;
    const { kind, id } = itemMenuOpen;
    closeItemMenu();
    if (kind === 'project') onDuplicateProject(id);
    else onDuplicateAsset(id);
  };

  const handleDelete = () => {
    if (!itemMenuOpen) return;
    const { kind, id } = itemMenuOpen;
    closeItemMenu();
    if (kind === 'project') onDeleteProject(id);
    else onDeleteAsset(id);
  };

  const handleCreateProject = () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    onCreateProject(trimmed);
    setNewProjectName('');
    setNewProjectOpen(false);
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    setIsResizing(true);
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      onWidthChange(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      resizeCleanup.current = null;
      setIsResizing(false);
    };
    resizeCleanup.current?.();
    resizeCleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <>
      <ResearchSidebarSlot section={shellSection} className="calculation-shell">
      <aside
        style={{ width: `min(${width}px, calc(100vw - 44px))` }}
        data-open={isOpen}
        className={cn(
          'md-sidebar workspace-panel-left workspace-sidebar absolute bottom-0 left-0 top-0 z-30 shrink-0 border-r border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-xl xl:relative xl:block xl:shadow-none',
          isOpen ? 'block' : 'hidden xl:block',
        )}
      >
        <div className="relative flex h-11 items-center border-b border-[var(--panel-border)] px-3 pr-10">
          <span className="text-[11px] font-semibold text-[var(--panel-text)]">Project</span>
          <button
            type="button"
            aria-label="Close project panel"
            onClick={onClose}
            className="workspace-compact-panel-close absolute right-1 top-1 grid h-9 w-8 place-items-center rounded-[5px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] xl:hidden"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex h-[calc(100%-44px)] flex-col">
          {/* Projects Section Header */}
          <div className="flex h-10 shrink-0 items-center border-b border-[var(--panel-border)] px-3">
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-[11px] font-semibold text-[var(--panel-muted)]">
              <FolderKanban className="h-3.5 w-3.5" />
              Projects
            </span>
            <button
              type="button"
              onClick={() => setNewProjectOpen((current) => !current)}
              aria-label="Create project"
              className="grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {newProjectOpen && (
            <div className="workspace-inline-reveal flex shrink-0 items-center gap-1 border-b border-[var(--panel-border)] bg-[var(--panel-raised)] p-1.5">
              <FolderKanban className="ml-1 h-3.5 w-3.5 shrink-0 text-[var(--panel-muted)]" />
              <input
                autoFocus
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleCreateProject();
                  if (event.key === 'Escape') setNewProjectOpen(false);
                }}
                placeholder="Name this project"
                className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-[11px] text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-muted)]"
              />
              <button
                type="button"
                onClick={handleCreateProject}
                className="h-7 rounded-[4px] px-2 text-[10px] font-semibold text-[var(--panel-accent)] hover:bg-[var(--panel-hover)]"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setNewProjectOpen(false)}
                aria-label="Cancel new project"
                className="grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Projects List */}
          <div className="max-h-[34%] min-h-[76px] shrink-0 overflow-y-auto border-b border-[var(--panel-border)] px-2 py-1">
            {projects.length ? (
              projects.map((project) => {
                const structureCount = labSidebarProjectCount(project, assets);
                const menuKey = `project:${project.id}`;
                const pinKey = shellSection === 'md' ? `md:${project.id.replace(/^cloud:/, '')}` : `dft:${project.id}`;
                const canPin = shell && navigationProjectKey(pinKey) && !project.id.startsWith('device:');
                return (
                  <div
                    key={project.id}
                    data-selected={activeProjectId === project.id}
                    className={cn(
                      'workspace-selection-row group flex h-9 items-center pr-1 transition-colors hover:bg-[var(--panel-hover)]',
                      activeProjectId === project.id && 'bg-[var(--panel-selected)]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => { closeItemMenu(); setStructureAddOpen(false); onSelectProject(project.id); }}
                      aria-pressed={activeProjectId === project.id}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                    >
                      <FolderKanban className="h-3.5 w-3.5 shrink-0 text-[var(--panel-muted)]" />
                      <span
                        data-selection-label
                        className={cn(
                          'min-w-0 flex-1 truncate text-[11px]',
                          activeProjectId === project.id
                            ? 'font-semibold text-[var(--panel-text)]'
                            : 'font-medium text-[var(--panel-muted)]',
                        )}
                      >
                        {project.name}
                      </span>
                      <span className="shrink-0 text-[9px] tabular-nums text-[var(--panel-muted)]">{structureCount ?? '—'}</span>
                    </button>
                    {canPin && <button type="button" aria-label={shell.preferences.pinnedProjectKeys.includes(pinKey) ? `Unpin ${project.name}` : `Pin ${project.name}`} onClick={() => shell.changePreferences({ type: 'project', key: pinKey, pinned: !shell.preferences.pinnedProjectKeys.includes(pinKey) })} className="grid h-7 w-7 shrink-0 place-items-center text-[var(--panel-muted)]"><Pin size={12} fill={shell.preferences.pinnedProjectKeys.includes(pinKey) ? 'currentColor' : 'none'} /></button>}
                    <button
                      type="button"
                      onClick={(event) => toggleItemMenu(event, menuKey, 'project', project.id)}
                      aria-label={`More actions for ${project.name}`}
                      aria-expanded={itemMenuOpen?.key === menuKey}
                      className={cn(
                        'workspace-item-action grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)]',
                        itemMenuOpen?.key === menuKey && 'is-open',
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-2 py-4 text-center">
                <p className="text-[11px] font-medium text-[var(--panel-muted)]">No projects yet</p>
                <button
                  type="button"
                  onClick={() => setNewProjectOpen(true)}
                  className="mt-1 text-[10px] font-medium text-[var(--panel-accent)] hover:text-[var(--panel-text)]"
                >
                  Create a project
                </button>
              </div>
            )}
          </div>

          {/* Structures Section Header */}
          <div className="relative flex h-10 shrink-0 items-center border-b border-[var(--panel-border)] px-3">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--panel-muted)]">{assetSectionLabel}</span>
            <button
              type="button"
              disabled={!activeProject || !canAddAsset}
              aria-label={activeProject && canAddAsset ? `Add ${assetSingularLabel}` : 'Create a project first'}
              aria-expanded={structureAddOpen}
              onClick={() => setStructureAddOpen((current) => !current)}
              className={cn(
                'grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] disabled:cursor-not-allowed disabled:opacity-35',
                structureAddOpen && 'bg-[var(--panel-hover)] text-[var(--panel-accent)]',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {structureAddOpen && (
              <div className="workspace-popover-motion absolute right-2 top-9 z-50 w-[190px] overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-raised)] p-1 shadow-[0_10px_28px_rgba(0,0,0,.24)]">
                {onCreateAsset && <button
                  type="button"
                  onClick={() => {
                    setStructureAddOpen(false);
                    onCreateAsset();
                  }}
                  className="flex h-9 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--panel-muted)]" />
                  {createAssetLabel}
                </button>}
                <button
                  type="button"
                  onClick={() => {
                    setStructureAddOpen(false);
                    onImportFile();
                  }}
                  className="flex h-9 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"
                >
                  <Upload className="h-3.5 w-3.5 text-[var(--panel-muted)]" />
                  {importLabel}
                </button>
                {onOpenMaterialsProject && <button
                  type="button"
                  onClick={() => {
                    setStructureAddOpen(false);
                    onOpenMaterialsProject();
                  }}
                  className="flex h-9 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--panel-text)] hover:bg-[var(--panel-hover)]"
                >
                  <DatabaseSearch className="h-3.5 w-3.5 text-[var(--panel-muted)]" />
                  Materials Project
                </button>}
              </div>
            )}
          </div>

          {/* Structures List */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {projectAssets.length ? (
              projectAssets.map((record) => {
                const menuKey = `structure:${record.id}`;
                return (
                  <div
                    key={record.id}
                    data-selected={activeAssetId === record.id}
                    className={cn(
                      'workspace-selection-row group flex h-9 items-center pr-1 transition-colors hover:bg-[var(--panel-hover)]',
                      activeAssetId === record.id && 'bg-[var(--panel-selected)]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => { closeItemMenu(); setStructureAddOpen(false); onSelectAsset(record); }}
                      aria-pressed={activeAssetId === record.id}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                      title={record.formula ? `${record.name} (${record.formula})` : record.name}
                    >
                      <Box className="h-3.5 w-3.5 shrink-0 text-[var(--panel-muted)]" />
                      <span
                        data-selection-label
                        className={cn(
                          'min-w-0 flex-1 truncate text-[11px]',
                          activeAssetId === record.id
                            ? 'font-semibold text-[var(--panel-text)]'
                            : 'font-medium text-[var(--panel-muted)]',
                        )}
                      >
                        {record.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => toggleItemMenu(event, menuKey, 'structure', record.id)}
                      aria-label={`More actions for ${record.name}`}
                      aria-expanded={itemMenuOpen?.key === menuKey}
                      className={cn(
                        'workspace-item-action grid h-7 w-7 place-items-center rounded-[4px] text-[var(--panel-muted)]',
                        itemMenuOpen?.key === menuKey && 'is-open',
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            ) : activeProject ? (
              <div className="mx-3 mt-3 rounded-[7px] border border-dashed border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-4 text-center">
                <p className="text-[11px] font-medium text-[var(--panel-muted)]">{emptyAssetLabel}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Separator Drag Handle */}
        <div
          role="separator"
          aria-label="Resize project panel"
          aria-orientation="vertical"
          aria-valuemin={190}
          aria-valuemax={420}
          aria-valuenow={width}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            onWidthChange(clampWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
          }}
          onPointerDown={beginResize}
          onDoubleClick={() => onWidthChange(232)}
          title="Drag to resize (190px – 420px) · Double click to reset"
          className="group absolute -right-1.5 top-0 z-50 h-full w-3 cursor-col-resize touch-none outline-none"
        >
          <span
            className={cn(
              'absolute bottom-0 left-1/2 top-0 w-0.5 -translate-x-1/2 bg-transparent transition-colors',
              'group-hover:bg-[var(--panel-accent)] group-focus-visible:bg-[var(--panel-accent)]',
              isResizing && 'bg-[var(--panel-accent)]',
            )}
          />
        </div>
      </aside>
      </ResearchSidebarSlot>

      {/* Action Menu Portal */}
      {itemMenuOpen &&
        createPortal(
          <>
            <div aria-hidden="true" onPointerDown={closeItemMenu} className="fixed inset-0 z-[90]" />
            {itemMenuMode === 'rename' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename();
                }}
                aria-label={`Rename ${itemMenuOpen.kind}`}
                style={{ left: itemMenuOpen.left, top: itemMenuOpen.top }}
                className="workspace-popover-motion workspace-dark-surface fixed z-[100] w-[156px] rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-2 shadow-[0_10px_26px_rgba(0,0,0,.34)]"
              >
                <label className="block text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--surface-muted)]">
                  Rename {itemMenuOpen.kind}
                </label>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeItemMenu();
                    }
                  }}
                  className="mt-1.5 h-8 w-full rounded-[4px] border border-[var(--surface-focus)] bg-[var(--surface-raised)] px-2 text-[10px] font-medium text-[var(--surface-text)] outline-none ring-2 ring-blue-500/10"
                />
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={closeItemMenu}
                    className="h-7 rounded-[4px] text-[9px] font-medium text-[var(--surface-muted)] hover:bg-[var(--surface-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-7 rounded-[4px] bg-[var(--surface-focus)] text-[9px] font-semibold text-white hover:brightness-95"
                  >
                    Rename
                  </button>
                </div>
              </form>
            ) : (
              <div
                role="menu" data-research-sidebar-interaction
                aria-label={`${itemMenuOpen.kind === 'project' ? 'Project' : 'Structure'} actions`}
                style={{ left: itemMenuOpen.left, top: itemMenuOpen.top }}
                className="workspace-popover-motion workspace-dark-surface fixed z-[100] w-[156px] rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-1 shadow-[0_10px_26px_rgba(0,0,0,.34)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={beginRename}
                  className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--surface-text)] outline-none hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
                >
                  <Pencil className="h-3 w-3 text-[var(--surface-muted)]" />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDuplicate}
                  className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--surface-text)] outline-none hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
                >
                  <Copy className="h-3 w-3 text-[var(--surface-muted)]" />
                  Duplicate
                </button>
                <div className="mx-1 border-t border-[var(--surface-border)]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDelete}
                  className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] font-medium text-[var(--surface-danger)] outline-none hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}

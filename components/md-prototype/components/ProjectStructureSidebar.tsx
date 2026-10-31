'use client';

import React, { useMemo } from 'react';
import { LabProjectAssetSidebar, type LabSidebarAsset } from '@/components/LabProjectAssetSidebar';
import type { TrajectorySummary } from '../types/trajectory';

type SidebarProject = {
  id: string;
  name: string;
  count: number | null;
  storage: 'cloud' | 'device';
};

interface ProjectStructureSidebarProps {
  trajectories: TrajectorySummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenImport: () => void;
  onOpenMaterialsProject?: () => void;
  canImport: boolean;
  formulaMap?: Record<string, string>;
  projects: SidebarProject[];
  activeProject: string;
  onProjectChange: (id: string) => void;
  onCreateProject: (name: string) => boolean | Promise<boolean>;
  onRenameProject: (id: string, name: string) => boolean | Promise<boolean>;
  onDuplicateProject?: (id: string) => void;
  onRemoveProject: (id: string) => void;
  onRename: (id: string, name: string) => boolean | Promise<boolean>;
  onDuplicate?: (id: string) => void;
  onRemove: (id: string) => void;
  busy?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose?: () => void;
}

type MdSidebarAsset = LabSidebarAsset & { source: TrajectorySummary };

export const ProjectStructureSidebar: React.FC<ProjectStructureSidebarProps> = ({
  trajectories,
  selectedId,
  onSelect,
  onOpenImport,
  onOpenMaterialsProject,
  canImport,
  formulaMap = {},
  projects,
  activeProject,
  onProjectChange,
  onCreateProject,
  onRenameProject,
  onDuplicateProject,
  onRemoveProject,
  onRename,
  onDuplicate,
  onRemove,
  busy = false,
  width,
  onWidthChange,
  onClose,
}) => {
  const assets = useMemo<MdSidebarAsset[]>(() => trajectories.map((trajectory) => ({
    id: trajectory.id,
    // `trajectories` is already scoped by the MD adapter. The shared sidebar
    // compares against its namespaced row id (`cloud:…` / `device:…`).
    projectId: activeProject,
    name: trajectory.filename,
    formula: formulaMap[trajectory.id] || 'MD',
    kind: trajectory.format ? `${trajectory.format.toUpperCase()} trajectory` : 'Trajectory',
    source: trajectory,
  })), [activeProject, formulaMap, trajectories]);

  return (
    <LabProjectAssetSidebar
      shellSection="md"
      projects={projects}
      activeProjectId={activeProject}
      onSelectProject={onProjectChange}
      onCreateProject={(name) => { if (!busy) void onCreateProject(name); }}
      onRenameProject={(id, name) => { if (!busy) void onRenameProject(id, name); }}
      onDuplicateProject={(id) => { if (!busy) onDuplicateProject?.(id); }}
      onDeleteProject={(id) => { if (!busy) onRemoveProject(id); }}
      assets={assets}
      activeAssetId={selectedId || null}
      onSelectAsset={(asset) => onSelect(asset.id)}
      onImportFile={onOpenImport}
      onOpenMaterialsProject={onOpenMaterialsProject}
      onRenameAsset={(id, name) => { if (!busy) void onRename(id, name); }}
      onDuplicateAsset={(id) => { if (!busy) onDuplicate?.(id); }}
      onDeleteAsset={(id) => { if (!busy) onRemove(id); }}
      assetSectionLabel="Trajectories"
      assetSingularLabel="trajectory"
      emptyAssetLabel="No trajectories"
      importLabel="Import trajectory"
      canAddAsset={canImport && !busy}
      width={width}
      onWidthChange={onWidthChange}
      isOpen
      onClose={onClose ?? (() => {})}
    />
  );
};

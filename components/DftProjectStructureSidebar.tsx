'use client';

import React from 'react';
import {
  LabProjectAssetSidebar,
  type LabProjectAssetSidebarProps,
  type LabSidebarAsset,
  type LabSidebarProject,
} from '@/components/LabProjectAssetSidebar';

export type DftSidebarProject = LabSidebarProject;
export type DftSidebarMaterial = LabSidebarAsset;
export type DftProjectStructureSidebarProps<T extends DftSidebarMaterial = DftSidebarMaterial> =
  Omit<LabProjectAssetSidebarProps<T>,
    'assets' | 'activeAssetId' | 'onSelectAsset' | 'onCreateAsset' |
    'onRenameAsset' | 'onDuplicateAsset' | 'onDeleteAsset'
  > & {
    materials: T[];
    activeMaterialId: string | null;
    onSelectMaterial: (material: T) => void;
    onCreateStructure: () => void;
    onRenameMaterial: (id: string, name: string) => void;
    onDuplicateMaterial: (id: string) => void;
    onDeleteMaterial: (id: string) => void;
  };

export function DftProjectStructureSidebar<T extends DftSidebarMaterial = DftSidebarMaterial>({
  materials,
  activeMaterialId,
  onSelectMaterial,
  onCreateStructure,
  onRenameMaterial,
  onDuplicateMaterial,
  onDeleteMaterial,
  ...props
}: DftProjectStructureSidebarProps<T>) {
  return (
    <LabProjectAssetSidebar
      {...props}
      assets={materials}
      activeAssetId={activeMaterialId}
      onSelectAsset={onSelectMaterial}
      onCreateAsset={onCreateStructure}
      onRenameAsset={onRenameMaterial}
      onDuplicateAsset={onDuplicateMaterial}
      onDeleteAsset={onDeleteMaterial}
      assetSectionLabel="Structures"
      assetSingularLabel="structure"
      emptyAssetLabel="No structures"
      createAssetLabel="New structure"
    />
  );
}

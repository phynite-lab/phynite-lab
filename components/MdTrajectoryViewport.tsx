'use client';
import { useMemo, type RefObject } from 'react';
import { TrajectoryCanvas } from './md-prototype/components/TrajectoryCanvas';
import { toPrototypeFrame } from '@/lib/md-prototype-adapter';
import type { MdAnalysis, MdSettings } from '@/lib/md-types';
import type { MdSceneExport } from '@/lib/md-scene-export';
export type { MdSceneExport } from '@/lib/md-scene-export';

export function MdTrajectoryViewport({ analysis, settings, sourceId, theme, exportRef, onSelection, totalFrames = 1 }: {
  analysis: MdAnalysis; settings: MdSettings; sourceId: string; theme: 'light' | 'dark'; exportRef: RefObject<MdSceneExport | null>; totalFrames?: number; selection: string[]; onSelection: (ids: string[]) => void;
}) {
  const data = useMemo(() => toPrototypeFrame(analysis, settings, totalFrames), [analysis, settings, totalFrames]);
  return (
    <TrajectoryCanvas
      key={sourceId}
      frameData={data}
      selectedTrajId={sourceId}
      theme={theme}
      exportRef={exportRef}
      onSelectionChange={onSelection}
      hideBulkCrystal={settings.hideBulk}
      showCellBox={settings.showCell && analysis.frame.hasCell}
      showBonds={settings.showBonds}
      showDislocations={analysis.dislocations.length > 0}
      showSurfaceMesh={!!analysis.surface}
      atomScale={settings.atomScale}
    />
  );
}

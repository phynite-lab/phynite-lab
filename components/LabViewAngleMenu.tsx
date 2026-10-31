'use client';

import { motion } from 'framer-motion';
import { Axis3D, Grid2X2, X } from 'lucide-react';
import { useEffect } from 'react';
import { LAB_VIEW_PRESETS, type LabViewPresetId } from '@/lib/lab-camera';
import { cn } from '@/lib/utils';

type QuadViewAction = {
  active: boolean;
  onToggle: () => void;
  shortcut?: string;
};

export type LabViewAngleMenuProps = {
  activeView: LabViewPresetId;
  onSelect: (view: LabViewPresetId) => void;
  onClose: () => void;
  className?: string;
  quadView?: QuadViewAction;
};

export function LabViewAngleMenu({
  activeView,
  onSelect,
  onClose,
  className,
  quadView,
}: LabViewAngleMenuProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <motion.div
      role="menu"
      aria-label="Camera view angles"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className={cn('workspace-toolbar-popover lab-view-angle-menu', className)}
    >
      <div className="lab-view-angle-header">
        <span className="lab-view-angle-icon"><Axis3D aria-hidden="true" /></span>
        <strong>View angle</strong>
        <button type="button" aria-label="Close view angle menu" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="lab-view-angle-grid">
        {LAB_VIEW_PRESETS.map((view) => (
          <button
            key={view.id}
            type="button"
            role="menuitemradio"
            aria-checked={activeView === view.id}
            className={view.id === 'isometric' ? 'is-wide' : undefined}
            onClick={() => onSelect(view.id)}
          >
            <span className="lab-view-angle-axis">{view.axis}</span>
            <span className="lab-view-angle-label">
              <strong>{view.label}</strong>
              <small>{view.id === 'isometric' ? 'Interactive 3D' : `${view.axis} normal`}</small>
            </span>
          </button>
        ))}
        {quadView && (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={quadView.active}
            className="lab-view-angle-quad"
            onClick={quadView.onToggle}
          >
            <Grid2X2 aria-hidden="true" />
            <strong>Quad view</strong>
            {quadView.shortcut && <kbd>{quadView.shortcut}</kbd>}
          </button>
        )}
      </div>
    </motion.div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { zipSync } from 'fflate';
import { useLocale } from '@/app/locale-provider';
import { cn } from '@/lib/utils';

export type CalculationArtifact = {
  path: string;
  downloadUrl?: string;
  label?: string;
  role?: string;
  contentType?: string;
};

interface CalculationDownloadDropdownProps {
  artifacts: CalculationArtifact[];
  calculation: string;
  materialName?: string;
  className?: string;
}

function triggerDownloadUrl(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export function CalculationDownloadDropdown({
  artifacts,
  calculation,
  materialName,
  className,
}: CalculationDownloadDropdownProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!artifacts || artifacts.length === 0) return null;

  const validArtifacts = artifacts.filter((a) => Boolean(a.downloadUrl));
  if (validArtifacts.length === 0) return null;

  const cleanStem = [
    (materialName || '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase(),
    calculation.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase(),
  ]
    .filter(Boolean)
    .join('_') || 'calculation';

  // 1. Data CSV artifact
  const csvArtifact = validArtifacts.find(
    (a) => a.path.toLowerCase().endsWith('.csv'),
  );
  const csvLabel =
    calculation === 'Band structure'
      ? 'Band Data (CSV)'
      : calculation === 'Density of states'
      ? 'DOS Data (CSV)'
      : calculation === 'Phonon dispersion'
      ? 'Phonon Data (CSV)'
      : 'Data (CSV)';

  // 2. Figures artifacts (PNG and PDF only, excluding SVG per user request)
  const figureArtifacts = validArtifacts.filter((a) => {
    const lower = a.path.toLowerCase();
    return lower.endsWith('.png') || lower.endsWith('.pdf');
  });

  // 3. Inputs & Outputs artifacts (*.in, *.out, *.xml)
  const ioArtifacts = validArtifacts.filter((a) => {
    const lower = a.path.toLowerCase();
    return (
      lower.endsWith('.in') ||
      lower.endsWith('.out') ||
      lower.endsWith('.xml') ||
      a.role === 'input' ||
      a.role === 'log' ||
      a.role === 'evidence'
    );
  });

  // 4. QE Checkpoint State (*.tar.gz)
  const checkpointArtifact = validArtifacts.find(
    (a) => a.path.toLowerCase().endsWith('.tar.gz') || a.role === 'workspace',
  );

  // Helper to fetch files and build ZIP
  const downloadZipArchive = async (
    items: Array<{ name: string; url: string }>,
    zipFilename: string,
    actionKey: string,
  ) => {
    setActiveDownload(actionKey);
    setDownloadError(null);
    try {
      const entries: Record<string, Uint8Array> = Object.create(null);
      await Promise.all(
        items.map(async (item) => {
          const response = await fetch(item.url);
          if (!response.ok) throw new Error(`Failed to load ${item.name}`);
          const buffer = await response.arrayBuffer();
          entries[item.name] = new Uint8Array(buffer);
        }),
      );
      const zipped = zipSync(entries, { level: 6 });
      const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
      triggerDownloadBlob(blob, zipFilename);
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      console.error('Download packaging error:', err);
      setDownloadError(msg);
    } finally {
      setActiveDownload(null);
    }
  };

  // Actions
  const handleDownloadAll = () => {
    // Exclude workspace tar.gz from All Results zip
    const items = validArtifacts
      .filter((a) => !a.path.toLowerCase().endsWith('.tar.gz') && a.role !== 'workspace')
      .map((a) => ({
        name: a.path.replace(/^\/+/, ''),
        url: a.downloadUrl!,
      }));
    void downloadZipArchive(items, `${cleanStem}_all_results.zip`, 'all');
  };

  const handleDownloadCsv = () => {
    if (!csvArtifact?.downloadUrl) return;
    const filename = csvArtifact.path.split('/').pop() || `${cleanStem}_data.csv`;
    triggerDownloadUrl(csvArtifact.downloadUrl, filename);
    setOpen(false);
  };

  const handleDownloadFigures = () => {
    // Only PNG and PDF
    const items = figureArtifacts.map((a) => ({
      name: a.path.replace(/^\/+/, ''),
      url: a.downloadUrl!,
    }));
    void downloadZipArchive(items, `${cleanStem}_figures.zip`, 'figures');
  };

  const handleDownloadIo = () => {
    const items = ioArtifacts.map((a) => ({
      name: a.path.replace(/^\/+/, ''),
      url: a.downloadUrl!,
    }));
    void downloadZipArchive(items, `${cleanStem}_inputs_and_outputs.zip`, 'io');
  };

  const handleDownloadCheckpoint = () => {
    if (!checkpointArtifact?.downloadUrl) return;
    const filename = checkpointArtifact.path.split('/').pop() || 'workspace.tar.gz';
    triggerDownloadUrl(checkpointArtifact.downloadUrl, filename);
    setOpen(false);
  };

  return (
    <div ref={menuRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={Boolean(activeDownload)}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-[34px] items-center gap-1.5 rounded-[7px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[var(--panel-text)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--panel-hover)] disabled:opacity-50 cursor-pointer',
          open && 'bg-[var(--panel-selected)] border-[var(--line-strong)] text-[var(--panel-text)]',
        )}
        title={t('Download outputs', 'Unduh output kalkulasi')}
      >
        {activeDownload && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--panel-accent)]" />
        )}
        <span>{activeDownload ? t('Packaging…', 'Mengemas…') : t('Download', 'Unduh')}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-[var(--panel-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('Download outputs', 'Unduh output')}
          className="workspace-popover-motion absolute left-0 top-[40px] z-50 w-[240px] rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-[0_12px_36px_rgba(0,0,0,0.5)]"
        >
          {downloadError && (
            <div className="px-2.5 py-1 text-[10px] text-[var(--status-danger)]" role="alert">
              {downloadError}
            </div>
          )}

          {/* 1. All Results (.zip) */}
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(activeDownload)}
            onClick={handleDownloadAll}
            className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11px] text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate font-medium">All Results (.zip)</span>
            {activeDownload === 'all' && (
              <Loader2 className="h-3 w-3 animate-spin text-[var(--panel-accent)]" />
            )}
          </button>

          {/* 2. Band Data (CSV) */}
          {csvArtifact && (
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(activeDownload)}
              onClick={handleDownloadCsv}
              className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11px] text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{csvLabel}</span>
            </button>
          )}

          {/* 3. Figures (.zip) */}
          {figureArtifacts.length > 0 && (
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(activeDownload)}
              onClick={handleDownloadFigures}
              className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11px] text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate font-medium">Figures (.zip)</span>
              {activeDownload === 'figures' && (
                <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
              )}
            </button>
          )}

          {/* 4. Inputs & Outputs (.zip) */}
          {ioArtifacts.length > 0 && (
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(activeDownload)}
              onClick={handleDownloadIo}
              className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11px] text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate font-medium">Inputs & Outputs (.zip)</span>
              {activeDownload === 'io' && (
                <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
              )}
            </button>
          )}

          {/* 5. QE Checkpoint State (.tar.gz) */}
          {checkpointArtifact && (
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(activeDownload)}
              onClick={handleDownloadCheckpoint}
              className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11px] text-[var(--panel-text)] transition-colors hover:bg-[var(--panel-hover)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                QE Checkpoint State (.tar.gz)
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

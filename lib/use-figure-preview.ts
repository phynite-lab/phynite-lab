'use client';

import { useEffect, useRef, useState } from 'react';
import { figureIssues, renderFigure, type FigureDocument, type ResearchDataset } from './research-figures';

type Preview = { svg: string; error: string; issues: string[] };

export function useFigurePreview(figure: FigureDocument | null, datasets: ResearchDataset[]) {
  const [preview, setPreview] = useState<Preview>({ svg: '', error: '', issues: [] });
  const [completed, setCompleted] = useState<FigureDocument | null>(null);
  const [fallback, setFallback] = useState(false);
  const worker = useRef<Worker | null>(null);
  const sources = useRef<ResearchDataset[] | null>(null);
  const requestId = useRef(0);
  const currentFigure = useRef(figure);
  useEffect(() => {
    try {
      const instance = new Worker(new URL('./figure-preview.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<Preview & { id: number }>) => {
        if (event.data.id !== requestId.current) return;
        setPreview(event.data);
        setCompleted(currentFigure.current);
      };
      instance.onerror = () => { instance.terminate(); worker.current = null; setFallback(true); };
      return () => { instance.terminate(); worker.current = null; sources.current = null; };
    } catch { queueMicrotask(() => setFallback(true)); }
  }, []);
  useEffect(() => {
    const id = ++requestId.current;
    currentFigure.current = figure;
    // Coalesce typing; numerical data is transferred only when the library changes.
    const timer = window.setTimeout(() => {
      if (worker.current && !fallback) {
        worker.current.postMessage({ id, figure, ...(sources.current !== datasets ? { datasets } : {}) });
        sources.current = datasets;
      } else {
        try { setPreview({ svg: figure ? renderFigure(figure, datasets) : '', issues: figure ? figureIssues(figure, datasets) : [], error: '' }); }
        catch (error) { setPreview({ svg: '', issues: [], error: error instanceof Error ? error.message : 'Figure cannot be rendered.' }); }
        setCompleted(figure);
      }
    }, 90);
    return () => window.clearTimeout(timer);
  }, [figure, datasets, fallback]);
  return { ...preview, pending: completed !== figure };
}

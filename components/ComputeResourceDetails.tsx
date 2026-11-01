'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Cpu, MemoryStick } from 'lucide-react';
import { ComputeJobReceipt } from './ComputeJobReceipt';
import { phyniteCalculations } from '@/lib/phynite-api';
import { startBrowserPoll } from '@/lib/browser-poll';
import { computeBackendLabel, memoryLabel, readComputeResources, resourceSummary, type ComputeResources } from '@/lib/compute-resources';

export function ComputeResourceDetails({ calculationId, resources, running = false }: { calculationId?: string; resources?: ComputeResources; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; resources: ComputeResources }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const info = loaded && loaded.id === calculationId ? loaded.resources : resources;
  useEffect(() => {
    if (!open || !calculationId) return;
    let disposed = false;
    const refresh = async () => {
      setLoading(true);
      try {
        const result = await phyniteCalculations.get(calculationId);
        if (!disposed && result.calculation.id === calculationId) { setLoaded({ id: calculationId, resources: readComputeResources(result.calculation, result.result) }); setError(''); }
      } catch (error) { if (!disposed) setError('Could not refresh compute details.'); if (running) throw error; }
      finally { if (!disposed) setLoading(false); }
    };
    const stop = running ? startBrowserPoll(refresh, 20000) : undefined;
    if (!running) void refresh();
    return () => { disposed = true; stop?.(); };
  }, [calculationId, open, running]);
  return <details className="compute-resource-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><Cpu size={13} aria-hidden="true" /><span>{resourceSummary(info) || 'Compute resources'}</span><ChevronRight size={13} className="compute-resource-chevron" aria-hidden="true" /></summary>
    <div className="compute-resource-content">
      <p className="compute-resource-backend">{computeBackendLabel(info?.backend)}{loading && <span role="status">Updating...</span>}</p>
      <dl className="compute-resource-grid"><div><dt><Cpu size={12} />CPU allocation</dt><dd>{info?.vcpus ? `${info.vcpus} vCPU${info.vcpus === 1 ? '' : 's'}` : 'Not reported'}</dd></div><div><dt><MemoryStick size={12} />RAM limit</dt><dd>{memoryLabel(info?.memoryMiB)}</dd></div>{info?.elapsedSeconds !== undefined && <div><dt>Execution time</dt><dd>{info.elapsedSeconds < 60 ? `${Number(info.elapsedSeconds.toFixed(1))} s` : `${Number((info.elapsedSeconds / 60).toFixed(1))} min`}</dd></div>}</dl>
      {info && <ComputeJobReceipt job={{ ...info, computePhase: info.phase, status: info.status ?? (running ? 'RUNNING' : undefined) }} />}
      <p className="compute-resource-note">CPU and RAM show the job allocation. Individual steps can use fewer MPI processes.</p>
      {!!info?.steps?.length && <div className="compute-resource-steps"><h4>Execution steps</h4>{info.steps.map((step, index) => <div key={`${step.name}-${index}`}><span>{step.name}</span><small>{[step.mpiRanks ? `${step.mpiRanks} MPI` : '', step.memoryEstimateMiB ? `QE estimate ${memoryLabel(step.memoryEstimateMiB)}` : '', step.elapsedSeconds !== undefined ? `${Number(step.elapsedSeconds.toFixed(1))} s` : ''].filter(Boolean).join(' · ') || 'No resource measurements recorded'}</small></div>)}</div>}
      {error && <p className="compute-resource-note" role="status">{error}</p>}
    </div>
  </details>;
}

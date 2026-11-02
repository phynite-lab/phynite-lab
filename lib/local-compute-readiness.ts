import type { LocalWorkerCapability } from './phynite-api.ts';

export type LocalRuntimeState = {
  capabilities?: { solver?: string[] };
  runtime: {
    installed: Record<string, unknown>;
    availableComponents?: string[];
    downloadAvailable: boolean;
    error?: string;
    requirements?: Record<string, { compatible: boolean; reason?: string }>;
    progress?: { state?: string; component?: string; downloadedBytes?: number; totalBytes?: number; error?: string };
  };
};

/** Installed files alone are insufficient: the worker must validate the solver. */
export function localComputeReadiness(state: LocalRuntimeState, capability: LocalWorkerCapability) {
  const component = capability === 'qe' ? 'dft' : 'md';
  if (state.capabilities?.solver?.includes(capability)) return { status: 'ready' as const, component };
  const progress = state.runtime.progress;
  if (progress?.component === component && progress.state && !['idle', 'complete', 'failed'].includes(progress.state)) {
    const percent = progress.totalBytes && typeof progress.downloadedBytes === 'number'
      ? Math.min(100, Math.max(0, Math.floor(progress.downloadedBytes / progress.totalBytes * 100))) : undefined;
    return { status: 'installing' as const, component, phase: progress.state, percent };
  }
  if (progress?.component === component && progress.state === 'failed') {
    return { status: 'failed' as const, component, error: progress.error || 'Runtime installation failed.' };
  }
  if (state.runtime.installed[component] || (capability === 'md-analysis' && state.runtime.installed.analysis)) {
    return { status: 'starting' as const, component };
  }
  const requirement = state.runtime.requirements?.[component];
  if (requirement?.compatible === false || !state.runtime.availableComponents?.includes(component)) {
    return { status: 'unavailable' as const, component, error: requirement?.reason || state.runtime.error };
  }
  return { status: 'missing' as const, component };
}

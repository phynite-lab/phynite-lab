import type { LabAccount, ComputeWorkload } from './account-api.ts';
import { isHpcComputeSelection, type ComputeSelection } from './compute-selection.ts';
import type { WorkflowNode } from './project-workflow.ts';
import { workloadForNode } from './workspace-resource-metrics.ts';

export function workflowComputeSelection(node?: WorkflowNode): ComputeSelection {
  const configuration = node?.configuration ?? {};
  const execution = configuration.execution && typeof configuration.execution === 'object' ? configuration.execution : {};
  const c = { ...execution, ...configuration };
  return {
    ...(c.computeTarget === 'personal' || c.computeTarget === 'shared' || c.computeTarget === 'hpc' ? { computeTarget: c.computeTarget } : {}),
    ...(c.cloudMode === 'paid' || c.cloudMode === 'pilot' ? { cloudMode: c.cloudMode } : {}),
    ...(typeof c.computeProfileId === 'string' ? { computeProfileId: c.computeProfileId } : {}),
    ...(isHpcComputeSelection(c.hpc) ? { hpc: c.hpc } : {}),
    ...Object.fromEntries(['vcpus', 'memoryMiB', 'estimatedComputeSeconds'].filter(key => typeof c[key] === 'number').map(key => [key, c[key]])),
  };
}

/** Only runtime-supported fields enter the execution request; estimates stay in configuration. */
export function workflowExecutionCompute(selection: ComputeSelection): ComputeSelection {
  const execution = { ...selection };
  delete execution.estimatedComputeSeconds;
  delete execution.quoteId;
  return execution;
}

export function freezeWorkflowCompute(node: WorkflowNode, account: LabAccount, fallback: ComputeSelection = {}): WorkflowNode {
  const selection = resolvedWorkflowCompute(node, account, fallback);
  const configuration: WorkflowNode['configuration'] = { ...node.configuration, ...selection };
  if (node.kind === 'md' || node.kind === 'md-analysis' || node.kind === 'extract-frame') {
    const execution = configuration.execution && typeof configuration.execution === 'object' ? configuration.execution : {};
    configuration.execution = { ...workflowExecutionCompute({ ...execution, ...selection }), computeTarget: 'personal' };
  }
  return { ...node, configuration };
}
/** Freeze new-run choices without replacing a researcher's saved node override. */
export function resolvedWorkflowCompute(node: WorkflowNode, account: LabAccount, fallback: ComputeSelection = {}): ComputeSelection {
  const workload: ComputeWorkload = workloadForNode(node);
  const own = { ...(workload === 'qe' ? fallback : {}), ...workflowComputeSelection(node) };
  const computeTarget = workload === 'qe' ? own.computeTarget ?? account.computeTarget : 'personal';
  const allocation = account.personalDefaults?.[workload];
  return {
    computeTarget,
    ...(computeTarget === 'shared' ? { cloudMode: own.cloudMode ?? account.cloudMode, computeProfileId: own.computeProfileId ?? account.computeProfileId } : computeTarget === 'hpc' ? {
      ...(own.hpc ? { hpc: own.hpc } : {}),
    } : {
      ...(own.vcpus !== undefined || allocation?.vcpus !== undefined ? { vcpus: own.vcpus ?? allocation?.vcpus } : {}),
      ...(own.memoryMiB !== undefined || allocation?.memoryMiB !== undefined ? { memoryMiB: own.memoryMiB ?? allocation?.memoryMiB } : {}),
    }),
    estimatedComputeSeconds: own.estimatedComputeSeconds ?? account.estimatedComputeSeconds ?? 3600,
  };
}

import type { LabAccount, ComputeWorkload } from './account-api.ts';
import { isHpcComputeSelection, type ComputeSelection } from './compute-selection.ts';
import { stableWorkflowJson, type WorkflowNode } from './project-workflow.ts';
import { workloadForNode } from './workspace-resource-metrics.ts';

/** Changing destinations invalidates the old cluster allocation and frozen snapshot. */
export function changeWorkflowCompute(configuration: WorkflowNode['configuration'], selection: ComputeSelection): WorkflowNode['configuration'] {
  const next = { ...configuration };
  for (const key of ['computeTarget', 'cloudMode', 'computeProfileId', 'estimatedComputeSeconds', 'vcpus', 'memoryMiB', 'hpc', 'resolvedHpcCompute', 'quoteId', 'executionAffinity']) delete next[key];
  const compute = { ...selection };
  if (compute.computeTarget !== 'hpc') delete compute.hpc;
  if (next.execution && typeof next.execution === 'object') {
    const exec = { ...next.execution as Record<string, unknown> };
    for (const key of ['computeTarget', 'cloudMode', 'computeProfileId', 'estimatedComputeSeconds', 'vcpus', 'memoryMiB', 'hpc', 'resolvedHpcCompute', 'quoteId', 'executionAffinity']) delete exec[key];
    next.execution = { ...exec, ...workflowExecutionCompute(compute) };
  }
  return { ...next, ...compute };
}

/** Every allocation field must agree before a bulk editor can display one choice. */
export function commonWorkflowComputeSelection(nodes: WorkflowNode[]): ComputeSelection | undefined {
  if (!nodes.length) return undefined;
  const first = workflowComputeSelection(nodes[0]);
  return nodes.every(node => stableWorkflowJson(workflowComputeSelection(node)) === stableWorkflowJson(first)) ? first : undefined;
}

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
  } else if (configuration.execution && typeof configuration.execution === 'object') {
    const exec: Record<string, unknown> = { ...configuration.execution as Record<string, unknown>, computeTarget: selection.computeTarget };
    if (selection.hpc) exec.hpc = selection.hpc;
    else delete exec.hpc;
    configuration.execution = exec;
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

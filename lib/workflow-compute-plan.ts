import { buildComputePlan, type ComputePlan, type ComputePlanInput } from './compute-plan.ts';
import { isHpcComputeSelection } from './compute-selection.ts';
import type { ProjectWorkflow, WorkflowNode, WorkflowPlan } from './project-workflow.ts';
import { workflowComputeSelection } from './workflow-compute.ts';
import { workloadForNode } from './workspace-resource-metrics.ts';

export type WorkflowRuntimeState = {
  runtime?: { installed?: Record<string, unknown>; isolation?: { available?: boolean } };
  capabilities?: { solver?: string[] };
  resources?: ComputePlanInput['resources'];
};

/** Retained results, inputs and figure preparation do not start a scientific runtime. */
export function workflowComputeRequirements(graph: ProjectWorkflow, plan: WorkflowPlan) {
  const local: WorkflowNode[] = [], hpc: WorkflowNode[] = [], cloud: WorkflowNode[] = [];
  for (const item of plan.nodes) {
    if (item.action !== 'run') continue;
    const node = graph.nodes.find(node => node.id === item.nodeId);
    if (!node || !['scf', 'relax', 'bands', 'dos', 'phonon', 'btp2', 'md', 'md-analysis', 'extract-frame'].includes(node.kind)) continue;
    const target = workflowComputeSelection(node).computeTarget;
    // MD always needs personal compute, including an invalid imported remote choice.
    if (workloadForNode(node) !== 'qe' || target === 'personal' || !target) local.push(node);
    else if (target === 'hpc') hpc.push(node);
    else cloud.push(node);
  }
  return { local, hpc, cloud };
}

/** Review the server's frozen HPC receipt without treating local QE as a prerequisite. */
export function buildWorkflowComputePlan(graph: ProjectWorkflow, plan: WorkflowPlan, input: {
  runtime?: WorkflowRuntimeState;
  inputSaved: boolean;
  runtimeLabel?: string;
}): ComputePlan {
  const { local, hpc, cloud } = workflowComputeRequirements(graph, plan);
  const destinations = [local.length, hpc.length, cloud.length].filter(Boolean).length;
  const destination = destinations > 1 ? 'mixed' : hpc.length ? 'hpc' : cloud.length ? 'cloud' : 'local';
  const { runtime } = input;
  const installed = runtime?.runtime?.installed;
  const solverList = runtime?.capabilities?.solver ?? [];
  const workloads = local.map(workloadForNode);
  const runtimeInstalled = runtime === undefined ? undefined : workloads.every(workload => workload === 'qe' ? Boolean(installed?.dft) : workload === 'md-analysis' ? Boolean(installed?.md || installed?.analysis) : Boolean(installed?.md));
  const result = buildComputePlan({
    destination, inputSaved: input.inputSaved, runtimeRequired: local.length > 0 || cloud.length > 0,
    runtimeLabel: input.runtimeLabel,
    runtimeInstalled: !local.length && cloud.length ? true : runtimeInstalled,
    solverCapability: !local.length && cloud.length ? true : runtime === undefined ? undefined : workloads.every(workload => solverList.includes(workload)),
    isolationAvailable: !local.length && cloud.length ? true : runtime?.runtime?.isolation?.available,
    potentialsReady: plan.errors.length ? undefined : graph.nodes.filter(node => plan.order.includes(node.id)).every(node => !Array.isArray(node.configuration.missingInputs) || node.configuration.missingInputs.length === 0),
    ...(local.length ? { resources: runtime?.resources } : {}),
    cloudTransferReviewed: destination === 'cloud',
  });
  result.checks[0] = { ...result.checks[0], label: 'Saved workflow', detail: input.inputSaved ? 'The reviewed workflow revision is saved.' : 'Save the exact workflow before submitting.' };
  for (const check of result.checks) if (local.length && ['runtime', 'solver', 'isolation'].includes(check.id)) {
    check.detail += ` Required on Your computer for: ${local.map(node => node.name).join(', ')}.`;
  }
  for (const node of hpc) {
    const item = plan.nodes.find(item => item.nodeId === node.id)!;
    const selection = workflowComputeSelection(node).hpc;
    const receipt = item.compute;
    const affinity = receipt?.executionAffinity;
    const verified = !item.error && isHpcComputeSelection(selection) && receipt?.target === 'hpc' && receipt.clusterId === selection.clusterId
      && receipt.computeTarget === 'personal' && affinity && ['slurm', 'pbs'].includes(affinity.scheduler)
      && /^[a-f0-9]{64}$/.test(affinity.profileSha256) && (!selection.profileSha256 || selection.profileSha256 === affinity.profileSha256)
      && receipt.vcpus === selection.nodes * selection.ranksPerNode && Number.isSafeInteger(receipt.memoryMiB) && receipt.memoryMiB > 0
      && (selection.memoryMiBPerNode === undefined || receipt.memoryMiB === selection.nodes * selection.memoryMiBPerNode);
    result.checks.push({ id: `hpc:${node.id}`, label: `HPC submission · ${node.name}`, status: verified ? 'ready' : 'blocked',
      detail: verified ? `${affinity!.scheduler.toUpperCase()} · ${receipt!.vcpus} MPI ranks · ${receipt!.memoryMiB / 1024} GiB RAM. Profile ${affinity!.profileSha256.slice(0, 12)}. Submission prerequisites are verified; QE runs on the cluster.`
        : item.error || 'Resolve the module inputs and review a valid cluster profile and allocation before submitting.',
    });
  }
  if (plan.errors.length) result.checks.push({ id: 'modules', label: 'Module inputs', status: 'blocked', detail: 'Resolve the module errors below before starting a run.' });
  result.ready = result.checks.every(check => check.status === 'ready');
  return result;
}

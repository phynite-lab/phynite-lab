import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowComputePlan, workflowComputeRequirements } from '../lib/workflow-compute-plan.ts';
import { emptyProjectWorkflow, type WorkflowNode, type WorkflowPlan, type WorkflowHpcCompute } from '../lib/project-workflow.ts';
import { compileWorkflowDft } from '../lib/project-workflow-compiler.ts';
import { hpcProfileSelection } from '../lib/compute-selection.ts';
import type { HpcClusterProfile } from '../lib/hpc-profile.ts';

const hpc = { clusterId: 'test-cluster', profileSha256: 'a'.repeat(64), nodes: 1, ranksPerNode: 64, wallSeconds: 3600 };
const node = (id: string, kind: WorkflowNode['kind'], computeTarget = 'personal'): WorkflowNode => ({ id, kind, name: id, position: { x: 0, y: 0 }, configuration: { computeTarget, ...(computeTarget === 'hpc' ? { hpc } : {}) }, resources: [] });
const receipt: WorkflowHpcCompute = { target: 'hpc', clusterId: hpc.clusterId, computeTarget: 'personal', vcpus: 64, memoryMiB: 131072, executionAffinity: { scheduler: 'slurm', profileSha256: hpc.profileSha256 } };
function fixture(nodes = [node('scf', 'scf', 'hpc')]) {
  const graph = { ...emptyProjectWorkflow('test'), nodes };
  const plan: WorkflowPlan = { revision: 1, targets: [nodes.at(-1)!.id], order: nodes.map(node => node.id), errors: [], compute: { pricing: 'existing', md: 'personal', requiresConfirmation: true, estimatedQuanta: 0 }, nodes: nodes.map(node => ({ nodeId: node.id, fingerprint: 'f', action: 'run', ...(node.configuration.computeTarget === 'hpc' ? { compute: structuredClone(receipt) } : {}) })) };
  return { graph, plan };
}
const absentRuntime = { runtime: { installed: {}, isolation: { available: false } }, capabilities: { solver: [] }, resources: { vcpus: 2, memoryMiB: 4096 } };
test('HPC-only QE uses the frozen server receipt without local runtime, solver, isolation or CPU limits', () => {
  const { graph, plan } = fixture(), before = structuredClone({ graph, plan });
  for (const runtime of [undefined, absentRuntime]) {
    const review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime });
    assert.equal(review.destination, 'hpc'); assert.equal(review.ready, true);
    assert.ok(!review.checks.some(check => ['runtime', 'solver', 'isolation', 'resources'].includes(check.id)));
    assert.match(review.checks.find(check => check.id === 'hpc:scf')!.detail, /SLURM · 64 MPI ranks/);
    assert.ok(!review.checks.some(check => check.detail.includes('local machine')));
  }
  assert.deepEqual({ graph, plan }, before);
  plan.nodes[0].compute!.executionAffinity.scheduler = 'pbs';
  assert.match(buildWorkflowComputePlan(graph, plan, { inputSaved: true }).checks.find(check => check.id === 'hpc:scf')!.detail, /PBS/);
});
test('mixed HPC and personal MD still require the correct local runtime and isolation', () => {
  const { graph, plan } = fixture([node('scf', 'scf', 'hpc'), node('md', 'md')]);
  let review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: absentRuntime });
  assert.equal(review.destination, 'mixed'); assert.equal(review.ready, false);
  assert.equal(review.checks.find(check => check.id === 'hpc:scf')!.status, 'ready');
  assert.equal(review.checks.find(check => check.id === 'runtime')!.status, 'blocked');
  const mdRuntime = { runtime: { installed: { md: {} }, isolation: { available: true } }, capabilities: { solver: ['md-simulation'] } };
  review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: mdRuntime });
  assert.equal(review.ready, true);
  review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: { ...mdRuntime, capabilities: { solver: ['md-analysis'] } } });
  assert.equal(review.checks.find(check => check.id === 'solver')!.status, 'blocked');
  graph.nodes[1].configuration.computeTarget = 'hpc';
  assert.equal(workflowComputeRequirements(graph, plan).local[0].kind, 'md');
});
test('unresolved, changed and malformed HPC receipts remain blocked', () => {
  for (const change of [
    (plan: WorkflowPlan) => { delete plan.nodes[0].compute; },
    (plan: WorkflowPlan) => { plan.nodes[0].compute!.executionAffinity.profileSha256 = 'b'.repeat(64); },
    (plan: WorkflowPlan) => { plan.nodes[0].compute!.clusterId = 'another-cluster'; },
    (plan: WorkflowPlan) => { plan.nodes[0].compute!.vcpus = 2; },
    (plan: WorkflowPlan) => { plan.nodes[0].error = 'The local HPC dispatcher is unavailable.'; },
  ]) {
    const { graph, plan } = fixture(); change(plan);
    const review = buildWorkflowComputePlan(graph, plan, { inputSaved: true });
    assert.equal(review.ready, false); assert.equal(review.checks.find(check => check.id === 'hpc:scf')!.status, 'blocked');
  }
});
test('a personal QE branch is identified explicitly when its SCF uses HPC', () => {
  const { graph, plan } = fixture([node('scf', 'scf', 'hpc'), node('bands', 'bands')]);
  const review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: absentRuntime });
  assert.equal(review.ready, false);
  assert.equal(review.destination, 'mixed');
  assert.match(review.checks.find(check => check.id === 'runtime')!.detail, /Your computer for: bands/);
  assert.ok(!review.checks.find(check => check.id === 'runtime')!.detail.includes('scf'));
});
test('missing structure input stays blocked and its compiler error is preserved for HPC', () => {
  const { graph, plan } = fixture([node('structure', 'structure'), node('scf', 'scf', 'hpc')]);
  graph.edges = [{ id: 'edge', source: 'structure', target: 'scf', port: 'structure' }];
  plan.nodes[0].action = 'input';
  assert.throws(() => compileWorkflowDft(graph, graph.nodes[1], 'test'), /Save a crystal structure/);
  plan.errors = [{ nodeId: 'structure', message: 'Create or import a saved input first.' }];
  plan.nodes[0].error = plan.errors[0].message;
  const review = buildWorkflowComputePlan(graph, plan, { inputSaved: true });
  assert.equal(review.ready, false); assert.equal(review.checks.find(check => check.id === 'modules')!.status, 'blocked');
});
test('retained results do not require local or remote runtimes; new personal execution still does', () => {
  const { graph, plan } = fixture();
  plan.nodes[0].action = 'reuse';
  assert.equal(buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: absentRuntime }).ready, true);
  graph.nodes[0].configuration.computeTarget = 'personal'; plan.nodes[0].action = 'run';
  const review = buildWorkflowComputePlan(graph, plan, { inputSaved: true, runtime: absentRuntime });
  assert.equal(review.ready, false); assert.equal(review.checks.find(check => check.id === 'runtime')!.status, 'blocked');
  assert.equal(buildWorkflowComputePlan(graph, plan, { inputSaved: true }).ready, false);
});
test('choosing a profile carries checksum, memory, queue, account and walltime defaults', () => {
  const selected = hpcProfileSelection({ id: 'test-cluster', profileSha256: hpc.profileSha256, defaults: { nodes: 2, ranksPerNode: 32, wallSeconds: 7200, memoryMiBPerNode: 65536, queue: 'cpu', account: 'project' } } as HpcClusterProfile);
  assert.deepEqual(selected, { clusterId: 'test-cluster', profileSha256: hpc.profileSha256, nodes: 2, ranksPerNode: 32, wallSeconds: 7200, memoryMiBPerNode: 65536, partition: 'cpu', account: 'project' });
});

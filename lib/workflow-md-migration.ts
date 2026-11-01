import type { MdTrajectoryRecord } from './md-types.ts';
import type { ProjectWorkflow, WorkflowNode } from './project-workflow.ts';
/** Match canonical identities only. Equal project names never merge device data. */
export function workflowDeviceTrajectories(graph: ProjectWorkflow, owner: string, records: MdTrajectoryRecord[], seen: ReadonlySet<string>): WorkflowNode[] {
  return records.filter(record => record.owner === owner && (record.cloud?.projectId ?? record.projectId) === graph.projectId && !seen.has(record.id) && !graph.nodes.some(node => node.resources.some(ref => ref.id === record.id || ref.id === record.cloud?.trajectoryId))).map((record, index) => ({
    id: `device_${record.id}`.slice(0, 96), kind: 'trajectory', name: record.name,
    position: { x: 60, y: (graph.nodes.length + index) * 150 + 60 },
    configuration: { filename: record.sourceFilename ?? record.name, preservedSettings: record.settings, preservedSimulationWorkflow: record.simulationWorkflow },
    resources: [{ kind: 'trajectory', id: record.id, deviceOnly: true }],
  }));
}

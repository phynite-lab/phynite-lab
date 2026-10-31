import type { TrajectorySummary } from '@/components/md-prototype/types/trajectory';
import type { MdCloudTrajectory } from '@/lib/md-cloud-api';
import type { MdTrajectoryRecord } from '@/lib/md-types';
import type { PhyniteProject } from '@/lib/phynite-api';

const recordFormat = (record: MdTrajectoryRecord) => (
  (record.sourceFilename ?? record.name).split('.').at(-1)?.toUpperCase()
);
const recordProjectName = (record: MdTrajectoryRecord) => record.projectName ?? record.projectId;

export const MD_SIMULATION_INELIGIBLE_REASON = 'Open a structure or trajectory first.';

export function mdSimulationEligibility(input: {
  hasActiveProject: boolean;
  frameCount: number;
  hasSourceFile: boolean;
}): { eligible: boolean; reason: string } {
  const eligible = input.hasActiveProject && input.frameCount > 0 && input.hasSourceFile;
  return { eligible, reason: eligible ? '' : MD_SIMULATION_INELIGIBLE_REASON };
}

export async function resolveMdProjectTrajectoryCounts(
  projects: ReadonlyArray<Pick<PhyniteProject, 'id' | 'mdTrajectoryCount'>>,
  listTrajectories: (projectId: string) => Promise<ReadonlyArray<unknown>>,
): Promise<Record<string, number>> {
  const entries = await Promise.all(projects.map(async (project) => {
    if (typeof project.mdTrajectoryCount === 'number' && Number.isFinite(project.mdTrajectoryCount)) {
      return [project.id, Math.max(0, Math.trunc(project.mdTrajectoryCount))] as const;
    }
    try {
      const trajectories = await listTrajectories(project.id);
      return [project.id, trajectories.length] as const;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry !== null));
}

export function resolveMdRouteTrajectory(
  projectId: string,
  trajectoryId: string,
  trajectories: ReadonlyArray<MdCloudTrajectory>,
): MdCloudTrajectory | null {
  if (!projectId || !trajectoryId) return null;
  return trajectories.find((trajectory) => trajectory.id === trajectoryId && trajectory.projectId === projectId) ?? null;
}

export function mdRecordMatchesCloudSource(record: MdTrajectoryRecord, trajectory: MdCloudTrajectory): boolean {
  return (record.sourceFilename ?? record.name) === trajectory.filename
    && record.file.size === trajectory.sizeBytes;
}

export function buildMdSidebarTrajectories(
  records: MdTrajectoryRecord[],
  cloudTrajectories: MdCloudTrajectory[],
  projectName: string,
  cloudProjectId: string,
): TrajectorySummary[] {
  const deviceRecords = records.filter((record) => (
    recordProjectName(record) === projectName
    || Boolean(cloudProjectId && (
      record.projectId === cloudProjectId
      || record.cloud?.projectId === cloudProjectId
    ))
  ));
  const latestLinkedRecords = new Map<string, MdTrajectoryRecord>();
  deviceRecords.forEach((record) => {
    if (!record.cloud) return;
    const key = `${record.cloud.projectId}\0${record.cloud.trajectoryId}`;
    const current = latestLinkedRecords.get(key);
    if (!current
      || record.createdAt.localeCompare(current.createdAt) > 0
      || (record.createdAt === current.createdAt && record.id.localeCompare(current.id) > 0)) {
      latestLinkedRecords.set(key, record);
    }
  });
  const uniqueDeviceRecords = deviceRecords.filter((record) => {
    if (!record.cloud) return true;
    return latestLinkedRecords.get(`${record.cloud.projectId}\0${record.cloud.trajectoryId}`)?.id === record.id;
  });
  if (!cloudProjectId) {
    return uniqueDeviceRecords.map((record) => ({
      id: record.id,
      filename: record.name,
      sizeBytes: record.file.size,
      format: recordFormat(record),
      projectId: record.cloud?.projectId ?? record.projectId,
      storage: record.cloud ? 'cloud' : 'device',
    }));
  }

  const remoteIds = new Set(cloudTrajectories.map((trajectory) => trajectory.id));
  const remoteRows: TrajectorySummary[] = cloudTrajectories.map((trajectory) => ({
    id: `remote:${trajectory.id}`,
    filename: trajectory.name || trajectory.filename,
    sizeBytes: trajectory.sizeBytes,
    format: trajectory.format.toUpperCase(),
    projectId: cloudProjectId,
    storage: 'cloud',
  }));
  const deviceOnlyRows: TrajectorySummary[] = uniqueDeviceRecords
    .filter((record) => record.cloud?.projectId !== cloudProjectId || !remoteIds.has(record.cloud.trajectoryId))
    .map((record) => ({
      id: record.id,
      filename: record.name,
      sizeBytes: record.file.size,
      format: recordFormat(record),
      projectId: cloudProjectId,
      storage: 'device',
    }));

  return [...remoteRows, ...deviceOnlyRows];
}

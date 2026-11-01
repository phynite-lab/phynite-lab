import type { ScientificPlotSettings } from "@/lib/result-plot";

export const CALCULATION_WORKSPACE_STORAGE_KEY =
  "phynite:calculation-workspace:v1";
export const CALCULATION_WORKSPACE_EVENT = "phynite:calculation-workspace-change";
export const PROJECT_TRASH_RETENTION_DAYS = 15;
const PROJECT_TRASH_RETENTION_MS = PROJECT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

type StoredProject = {
  id: string;
  databaseId?: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  remoteId?: string;
};

type StoredMaterial = {
  id: string;
  projectId: string;
  name: string;
  formula: string;
  atoms?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  remoteId?: string;
};

type StoredJob = {
  id: string;
  componentId?: string;
  materialId: string;
  name: string;
  status: string;
  progress?: number;
  updated?: string;
  plotSettings?: ScientificPlotSettings;
};

type StoredCalculation = {
  id: string;
  materialId: string;
  name: string;
  calculation?: string;
};

type StoredCalculationConfiguration = {
  id?: string;
  materialId?: string;
  name?: string;
  [key: string]: unknown;
};

export type StoredProjectTrashEntry = {
  project: StoredProject;
  materials: StoredMaterial[];
  jobs: StoredJob[];
  calculationConfigurations: StoredCalculationConfiguration[];
  calculationComponents: StoredCalculation[];
  deletedAt: string;
  expiresAt: string;
};

export type StoredWorkspaceSnapshot = {
  [key: string]: unknown;
  version: 1;
  activeDatabaseId?: string;
  activeProjectId?: string;
  activeMaterialId?: string;
  projects?: StoredProject[];
  materials?: StoredMaterial[];
  jobs?: StoredJob[];
  calculationConfigurations?: StoredCalculationConfiguration[];
  calculationComponents?: StoredCalculation[];
  projectTrash?: StoredProjectTrashEntry[];
  savedAt?: string;
};

export function appendWorkspaceProject(snapshot: StoredWorkspaceSnapshot | null, name: string, description: string, id: string, timestamp: string): StoredWorkspaceSnapshot {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100 || description.trim().length > 500) throw new Error('Invalid project details');
  if (snapshot?.projects !== undefined && (!Array.isArray(snapshot.projects) || snapshot.projects.some(project => project.id === id))) throw new Error('Invalid workspace or duplicate project identity');
  return {
    ...(snapshot ?? { version: 1, materials: [], jobs: [], calculationComponents: [] }),
    projects: [...(snapshot?.projects ?? []), { id, databaseId: 'db-workspace', name: trimmed, description: description.trim(), createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp }],
    activeDatabaseId: 'db-workspace', activeProjectId: id, activeMaterialId: '', savedAt: timestamp,
  };
}

export function createWorkspaceProject(ownerId: string, name: string, description: string) {
  if (window.localStorage.getItem('phynite:calculation-workspace-owner:v1') !== ownerId) throw new Error('Wait for your account workspace to load before creating a project.');
  const raw = getCalculationWorkspaceSnapshot();
  const snapshot = parseCalculationWorkspaceSnapshot(raw);
  if (raw && !snapshot) throw new Error('The saved workspace could not be read. Reload before creating a project.');
  const id = `project-${crypto.randomUUID()}`;
  replaceCalculationWorkspaceSnapshot(appendWorkspaceProject(snapshot, name, description, id, new Date().toISOString()));
  return id;
}

function editableWorkspace(ownerId: string) {
  if (window.localStorage.getItem('phynite:calculation-workspace-owner:v1') !== ownerId) throw new Error('Wait for your account workspace to load before changing a project.');
  const raw = getCalculationWorkspaceSnapshot();
  const snapshot = parseCalculationWorkspaceSnapshot(raw);
  if (!snapshot || !Array.isArray(snapshot.projects)) throw new Error('The saved workspace could not be read. Reload before changing a project.');
  return snapshot;
}

function storedTrash(snapshot: StoredWorkspaceSnapshot) {
  return Array.isArray(snapshot.projectTrash)
    ? snapshot.projectTrash.filter((entry): entry is StoredProjectTrashEntry => Boolean(
        entry
        && typeof entry.project?.id === 'string'
        && Array.isArray(entry.materials)
        && Array.isArray(entry.jobs)
        && Array.isArray(entry.calculationConfigurations)
        && Array.isArray(entry.calculationComponents)
        && typeof entry.deletedAt === 'string'
        && typeof entry.expiresAt === 'string',
      ))
    : [];
}

export function updateWorkspaceProject(ownerId: string, projectId: string, values: { name: string; description: string }) {
  const name = values.name.trim();
  const description = values.description.trim();
  if (!name || name.length > 100 || description.length > 500) throw new Error('Invalid project details');
  const snapshot = editableWorkspace(ownerId);
  if (!snapshot.projects!.some((project) => project.id === projectId)) throw new Error('Project was not found.');
  const timestamp = new Date().toISOString();
  replaceCalculationWorkspaceSnapshot({
    ...snapshot,
    projects: snapshot.projects!.map((project) => project.id === projectId ? { ...project, name, description, updatedAt: timestamp } : project),
    savedAt: timestamp,
  });
}

export function duplicateWorkspaceProject(ownerId: string, projectId: string) {
  const snapshot = editableWorkspace(ownerId);
  const source = snapshot.projects!.find((project) => project.id === projectId);
  if (!source) throw new Error('Project was not found.');
  const timestamp = new Date().toISOString();
  const id = `project-${crypto.randomUUID()}`;
  const sourceMaterials = (snapshot.materials ?? []).filter((material) => material.projectId === projectId);
  const materialIds = new Map(sourceMaterials.map((material) => [material.id, `mat-${crypto.randomUUID()}`]));
  const materials = sourceMaterials.map((material) => ({
    ...material,
    id: materialIds.get(material.id)!,
    projectId: id,
    remoteId: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  }));
  const calculationConfigurations = (snapshot.calculationConfigurations ?? [])
    .filter((configuration) => typeof configuration.materialId === 'string' && materialIds.has(configuration.materialId))
    .map((configuration) => ({
      ...configuration,
      id: `config-${crypto.randomUUID()}`,
      materialId: materialIds.get(configuration.materialId!)!,
    }));
  const calculationComponents = (snapshot.calculationComponents ?? [])
    .filter((component) => materialIds.has(component.materialId))
    .map((component) => ({
      ...component,
      id: `calc-${crypto.randomUUID()}`,
      materialId: materialIds.get(component.materialId)!,
    }));
  const copy: StoredProject = {
    ...source,
    id,
    name: `${source.name} copy`.slice(0, 100),
    remoteId: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
  replaceCalculationWorkspaceSnapshot({
    ...snapshot,
    projects: [...snapshot.projects!, copy],
    materials: [...(snapshot.materials ?? []), ...materials],
    calculationConfigurations: [...(snapshot.calculationConfigurations ?? []), ...calculationConfigurations],
    calculationComponents: [...(snapshot.calculationComponents ?? []), ...calculationComponents],
    activeDatabaseId: copy.databaseId ?? 'db-workspace',
    activeProjectId: id,
    activeMaterialId: materials[0]?.id ?? '',
    savedAt: timestamp,
  });
  return id;
}

export function deleteWorkspaceProject(ownerId: string, projectId: string, now = new Date()) {
  const snapshot = editableWorkspace(ownerId);
  const project = snapshot.projects!.find((item) => item.id === projectId);
  if (!project) throw new Error('Project was not found.');
  const materials = (snapshot.materials ?? []).filter((material) => material.projectId === projectId);
  const materialIds = new Set(materials.map((material) => material.id));
  const jobs = (snapshot.jobs ?? []).filter((job) => materialIds.has(job.materialId));
  if (jobs.some((job) => job.status === 'Running' || job.status === 'Queued')) throw new Error('Finish or cancel active calculations before moving this project to Trash.');
  const calculationConfigurations = (snapshot.calculationConfigurations ?? []).filter((configuration) => typeof configuration.materialId === 'string' && materialIds.has(configuration.materialId));
  const calculationComponents = (snapshot.calculationComponents ?? []).filter((calculation) => materialIds.has(calculation.materialId));
  const remainingProjects = snapshot.projects!.filter((item) => item.id !== projectId);
  const remainingMaterials = (snapshot.materials ?? []).filter((material) => !materialIds.has(material.id));
  const fallbackProject = remainingProjects[0];
  const fallbackMaterial = remainingMaterials.find((material) => material.projectId === fallbackProject?.id);
  const timestamp = now.toISOString();
  const trashEntry: StoredProjectTrashEntry = {
    project,
    materials,
    jobs,
    calculationConfigurations,
    calculationComponents,
    deletedAt: timestamp,
    expiresAt: new Date(now.getTime() + PROJECT_TRASH_RETENTION_MS).toISOString(),
  };
  replaceCalculationWorkspaceSnapshot({
    ...snapshot,
    projects: remainingProjects,
    materials: remainingMaterials,
    jobs: (snapshot.jobs ?? []).filter((job) => !materialIds.has(job.materialId)),
    calculationConfigurations: (snapshot.calculationConfigurations ?? []).filter((configuration) => typeof configuration.materialId !== 'string' || !materialIds.has(configuration.materialId)),
    calculationComponents: (snapshot.calculationComponents ?? []).filter((calculation) => !materialIds.has(calculation.materialId)),
    projectTrash: [...storedTrash(snapshot).filter((entry) => entry.project.id !== projectId), trashEntry],
    activeDatabaseId: fallbackProject?.databaseId ?? 'db-workspace',
    activeProjectId: fallbackProject?.id ?? '',
    activeMaterialId: fallbackMaterial?.id ?? '',
    savedAt: timestamp,
  });
}

export function restoreWorkspaceProject(ownerId: string, projectId: string, now = new Date()) {
  const snapshot = editableWorkspace(ownerId);
  const entry = storedTrash(snapshot).find((item) => item.project.id === projectId);
  if (!entry) throw new Error('Trashed project was not found.');
  if (Date.parse(entry.expiresAt) <= now.getTime()) {
    forceDeleteWorkspaceProject(ownerId, projectId, now);
    throw new Error('This project has passed its 15-day recovery period.');
  }
  if (snapshot.projects!.some((project) => project.id === projectId)) throw new Error('A project with this identity already exists.');
  const timestamp = now.toISOString();
  replaceCalculationWorkspaceSnapshot({
    ...snapshot,
    projects: [...snapshot.projects!, { ...entry.project, updatedAt: timestamp, lastOpenedAt: timestamp }],
    materials: [...(snapshot.materials ?? []), ...entry.materials],
    jobs: [...(snapshot.jobs ?? []), ...entry.jobs],
    calculationConfigurations: [...(snapshot.calculationConfigurations ?? []), ...entry.calculationConfigurations],
    calculationComponents: [...(snapshot.calculationComponents ?? []), ...entry.calculationComponents],
    projectTrash: storedTrash(snapshot).filter((item) => item.project.id !== projectId),
    activeDatabaseId: entry.project.databaseId ?? 'db-workspace',
    activeProjectId: projectId,
    activeMaterialId: entry.materials[0]?.id ?? '',
    savedAt: timestamp,
  });
}

export function forceDeleteWorkspaceProject(ownerId: string, projectId: string, now = new Date()) {
  const snapshot = editableWorkspace(ownerId);
  if (!storedTrash(snapshot).some((entry) => entry.project.id === projectId)) throw new Error('Trashed project was not found.');
  replaceCalculationWorkspaceSnapshot({
    ...snapshot,
    projectTrash: storedTrash(snapshot).filter((entry) => entry.project.id !== projectId),
    savedAt: now.toISOString(),
  });
}

/** Remove redundant legacy device records only after the canonical deletion succeeds. */
export function removeDeletedCloudProject(ownerId: string, remoteId: string, legacyIds: string[] = []) {
  const snapshot = editableWorkspace(ownerId);
  const matches = (project: StoredProject) => project.remoteId === remoteId || project.id === remoteId || legacyIds.includes(project.id);
  const projects = snapshot.projects!.filter(project => !matches(project));
  const removedIds = new Set(snapshot.projects!.filter(matches).map(project => project.id));
  const materials = (snapshot.materials ?? []).filter(material => !removedIds.has(material.projectId));
  const removedMaterials = new Set((snapshot.materials ?? []).filter(material => removedIds.has(material.projectId)).map(material => material.id));
  const trash = storedTrash(snapshot).filter(entry => !matches(entry.project));
  if (!removedIds.size && trash.length === storedTrash(snapshot).length) return;
  const activeRemoved = removedIds.has(snapshot.activeProjectId ?? '');
  replaceCalculationWorkspaceSnapshot({
    ...snapshot, projects, materials,
    jobs: (snapshot.jobs ?? []).filter(job => !removedMaterials.has(job.materialId)),
    calculationComponents: (snapshot.calculationComponents ?? []).filter(component => !removedMaterials.has(component.materialId)),
    calculationConfigurations: (snapshot.calculationConfigurations ?? []).filter(configuration => !removedMaterials.has(configuration.materialId ?? '')),
    projectTrash: trash,
    ...(activeRemoved ? { activeProjectId: projects[0]?.id ?? '', activeMaterialId: materials.find(material => material.projectId === projects[0]?.id)?.id ?? '' } : {}),
    savedAt: new Date().toISOString(),
  });
}

export function purgeExpiredWorkspaceProjects(ownerId: string, now = new Date()) {
  const snapshot = editableWorkspace(ownerId);
  const trash = storedTrash(snapshot);
  const retained = trash.filter((entry) => Date.parse(entry.expiresAt) > now.getTime());
  if (retained.length === trash.length) return 0;
  replaceCalculationWorkspaceSnapshot({ ...snapshot, projectTrash: retained, savedAt: now.toISOString() });
  return trash.length - retained.length;
}

export type CalculationProjectSummary = {
  id: string;
  name: string;
  description: string;
  remoteId?: string;
  isActive: boolean;
  primaryStructure: (StoredMaterial & { atomCount: number }) | null;
  structures: CalculationStructureSummary[];
  structureCount: number;
  calculationCount: number;
  runCount: number;
  runningCount: number;
  completedCount: number;
  activityState: "idle" | "running" | "completed" | "error";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type CalculationStructureSummary = {
  id: string;
  projectId: string;
  name: string;
  formula: string;
  atomCount: number;
  updatedAt: string;
  lastOpenedAt: string;
};

export type CalculationTrashProjectSummary = {
  id: string;
  remoteId?: string;
  name: string;
  description: string;
  structureCount: number;
  runCount: number;
  deletedAt: string;
  expiresAt: string;
  daysRemaining: number;
};

export type CalculationWorkspaceSummary = {
  activeProject: StoredProject | null;
  activeStructure: (StoredMaterial & { atomCount: number }) | null;
  projects: CalculationProjectSummary[];
  trashProjects: CalculationTrashProjectSummary[];
  trashCount: number;
  projectCount: number;
  structureCount: number;
  activeProjectStructureCount: number;
  calculationCount: number;
  runCount: number;
  runningCount: number;
  completedCount: number;
};

export const emptyCalculationWorkspaceSummary: CalculationWorkspaceSummary = {
  activeProject: null,
  activeStructure: null,
  projects: [],
  trashProjects: [],
  trashCount: 0,
  projectCount: 0,
  structureCount: 0,
  activeProjectStructureCount: 0,
  calculationCount: 0,
  runCount: 0,
  runningCount: 0,
  completedCount: 0,
};

export function getCalculationWorkspaceSnapshot() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(CALCULATION_WORKSPACE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getServerCalculationWorkspaceSnapshot() {
  return "";
}

export function subscribeToCalculationWorkspace(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CALCULATION_WORKSPACE_STORAGE_KEY) listener();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CALCULATION_WORKSPACE_EVENT, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CALCULATION_WORKSPACE_EVENT, listener);
  };
}

export function notifyCalculationWorkspaceChange() {
  window.dispatchEvent(new Event(CALCULATION_WORKSPACE_EVENT));
}

export function replaceCalculationWorkspaceSnapshot(snapshot: StoredWorkspaceSnapshot) {
  if (typeof window === "undefined" || snapshot.version !== 1) return;
  window.localStorage.setItem(
    CALCULATION_WORKSPACE_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
  notifyCalculationWorkspaceChange();
}

export function parseCalculationWorkspaceSnapshot(rawSnapshot: string) {
  if (!rawSnapshot) return null;
  try {
    const snapshot = JSON.parse(rawSnapshot) as StoredWorkspaceSnapshot;
    return snapshot.version === 1 ? snapshot : null;
  } catch {
    return null;
  }
}

export function ensureCalculationWorkspaceMetadata() {
  if (typeof window === "undefined") return;

  try {
    const stored = window.localStorage.getItem(CALCULATION_WORKSPACE_STORAGE_KEY);
    if (!stored) return;

    const snapshot = JSON.parse(stored) as StoredWorkspaceSnapshot;
    if (snapshot.version !== 1) return;

    const fallbackTimestamp = snapshot.savedAt ?? new Date().toISOString();
    let changed = !snapshot.savedAt;
    const projects = (snapshot.projects ?? []).map((project) => {
      if (project.createdAt && project.updatedAt && project.lastOpenedAt) {
        return project;
      }
      changed = true;
      const createdAt = project.createdAt ?? fallbackTimestamp;
      const updatedAt = project.updatedAt ?? createdAt;
      return {
        ...project,
        createdAt,
        updatedAt,
        lastOpenedAt: project.lastOpenedAt ?? updatedAt,
      };
    });
    const materials = (snapshot.materials ?? []).map((material) => {
      if (material.createdAt && material.updatedAt && material.lastOpenedAt) {
        return material;
      }
      changed = true;
      const createdAt = material.createdAt ?? fallbackTimestamp;
      const updatedAt = material.updatedAt ?? createdAt;
      return {
        ...material,
        createdAt,
        updatedAt,
        lastOpenedAt: material.lastOpenedAt ?? updatedAt,
      };
    });

    if (!changed) return;
    window.localStorage.setItem(
      CALCULATION_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        ...snapshot,
        projects,
        materials,
        savedAt: snapshot.savedAt ?? fallbackTimestamp,
      }),
    );
    notifyCalculationWorkspaceChange();
  } catch {
    // Legacy or unavailable device storage should not block the workspace.
  }
}

function latestTimestamp(values: Array<string | undefined>) {
  return values.reduce<string>((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    const nextTime = Date.parse(value);
    const latestTime = Date.parse(latest);
    if (Number.isNaN(nextTime)) return latest;
    if (Number.isNaN(latestTime)) return value;
    return nextTime > latestTime ? value : latest;
  }, "");
}

export function summarizeCalculationWorkspace(
  rawSnapshot: string,
  now = new Date(),
): CalculationWorkspaceSummary {
  if (!rawSnapshot) return emptyCalculationWorkspaceSummary;

  try {
    const snapshot = JSON.parse(rawSnapshot) as StoredWorkspaceSnapshot;
    if (snapshot.version !== 1) return emptyCalculationWorkspaceSummary;

    const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const materials = Array.isArray(snapshot.materials) ? snapshot.materials : [];
    const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
    const calculations = Array.isArray(snapshot.calculationComponents)
      ? snapshot.calculationComponents
      : [];
    const trashProjects = storedTrash(snapshot)
      .filter((entry) => Date.parse(entry.expiresAt) > now.getTime())
      .map((entry): CalculationTrashProjectSummary => ({
        id: entry.project.id,
        remoteId: entry.project.remoteId,
        name: entry.project.name,
        description: entry.project.description?.trim() ?? "",
        structureCount: entry.materials.length,
        runCount: entry.jobs.length,
        deletedAt: entry.deletedAt,
        expiresAt: entry.expiresAt,
        daysRemaining: Math.max(1, Math.ceil((Date.parse(entry.expiresAt) - now.getTime()) / (24 * 60 * 60 * 1000))),
      }))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    const activeProject =
      projects.find((project) => project.id === snapshot.activeProjectId) ?? null;
    const activeStructureRecord =
      materials.find((material) => material.id === snapshot.activeMaterialId) ?? null;
    const activeStructure = activeStructureRecord
      ? {
          ...activeStructureRecord,
          atomCount: Array.isArray(activeStructureRecord.atoms)
            ? activeStructureRecord.atoms.length
            : 0,
        }
      : null;
    const projectSummaries = projects.map((project): CalculationProjectSummary => {
      const projectMaterials = materials.filter(
        (material) => material.projectId === project.id,
      );
      const projectMaterialIds = new Set(
        projectMaterials.map((material) => material.id),
      );
      const projectCalculations = calculations.filter((calculation) =>
        projectMaterialIds.has(calculation.materialId),
      );
      const projectJobs = jobs.filter((job) =>
        projectMaterialIds.has(job.materialId),
      );
      const latestCalculationJobs = projectCalculations.map((calculation) =>
        projectJobs.find((job) => job.componentId === calculation.id),
      );
      const runningCount = latestCalculationJobs.filter(
        (job) => job?.status === "Running" || job?.status === "Queued",
      ).length;
      const completedCount = latestCalculationJobs.filter(
        (job) => job?.status === "Completed",
      ).length;
      const activityState = runningCount
        ? "running"
        : latestCalculationJobs.some((job) => job?.status === "Failed")
          ? "error"
        : projectCalculations.length > 0 && completedCount === projectCalculations.length
          ? "completed"
          : "idle";
      const preferredStructure =
        projectMaterials.find(
          (material) => material.id === snapshot.activeMaterialId,
        ) ?? projectMaterials[0] ?? null;
      const structureSummaries = projectMaterials.map((material): CalculationStructureSummary => ({
        id: material.id,
        projectId: material.projectId,
        name: material.name,
        formula: material.formula,
        atomCount: Array.isArray(material.atoms) ? material.atoms.length : 0,
        updatedAt: material.updatedAt ?? material.createdAt ?? "",
        lastOpenedAt: material.lastOpenedAt ?? material.updatedAt ?? material.createdAt ?? "",
      })).sort((left, right) => (
        right.lastOpenedAt.localeCompare(left.lastOpenedAt)
        || right.updatedAt.localeCompare(left.updatedAt)
        || left.name.localeCompare(right.name)
      ));
      const updatedAt = latestTimestamp([
        project.updatedAt,
        ...projectMaterials.map((material) => material.updatedAt),
      ]);
      const lastOpenedAt = latestTimestamp([
        project.lastOpenedAt,
        ...projectMaterials.map((material) => material.lastOpenedAt),
      ]);

      return {
        id: project.id,
        name: project.name,
        description: project.description?.trim() ?? "",
        remoteId: project.remoteId,
        isActive: project.id === snapshot.activeProjectId,
        primaryStructure: preferredStructure
          ? {
              ...preferredStructure,
              atomCount: Array.isArray(preferredStructure.atoms)
                ? preferredStructure.atoms.length
                : 0,
            }
          : null,
        structures: structureSummaries,
        structureCount: projectMaterials.length,
        calculationCount: projectCalculations.length,
        runCount: projectJobs.length,
        runningCount,
        completedCount,
        activityState,
        createdAt: project.createdAt ?? "",
        updatedAt: updatedAt || project.createdAt || "",
        lastOpenedAt: lastOpenedAt || updatedAt || project.createdAt || "",
      };
    });

    return {
      activeProject,
      activeStructure,
      projects: projectSummaries,
      trashProjects,
      trashCount: trashProjects.length,
      projectCount: projects.length,
      structureCount: materials.length,
      activeProjectStructureCount: activeProject
        ? materials.filter((material) => material.projectId === activeProject.id).length
        : 0,
      calculationCount: calculations.length,
      runCount: jobs.length,
      runningCount: jobs.filter((job) => job.status === "Running" || job.status === "Queued").length,
      completedCount: jobs.filter((job) => job.status === "Completed").length,
    };
  } catch {
    return emptyCalculationWorkspaceSummary;
  }
}

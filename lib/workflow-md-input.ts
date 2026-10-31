import { createMdCloudStorageClient, createSameOriginMdCloudTransport, mdCloudSha256, mdCloudSaveKey } from './md-cloud-api';
import { createCIF, type ParsedStructure } from './structure-parsers';
export async function saveWorkflowTrajectory(projectId: string, file: File) {
  const api = createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() });
  const sha256 = await mdCloudSha256(file);
  const result = await api.createTrajectory(projectId, { name: file.name, filename: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size, sha256, idempotencyKey: await mdCloudSaveKey(projectId, sha256, file.name, 'workflow') });
  if (result.upload) { await api.uploadTrajectory(result.upload, file); return (await api.completeTrajectory(result.trajectory.id, { sizeBytes: file.size, sha256 })).trajectory; }
  return result.trajectory;
}
export function workflowStructureFile(structure: ParsedStructure, nodeId: string): File {
  return new File([createCIF(structure.name, structure.atoms, structure.lattice)], `${nodeId}.cif`, { type: 'chemical/x-cif' });
}

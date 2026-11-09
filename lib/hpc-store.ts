/**
 * HPC profiles are persisted by backend/local_api in the SQLite records table.
 * This compatibility module deliberately has no filesystem or process-memory
 * fallback and should not be imported by hosted routes.
 */
import { HpcProfileError } from './hpc-profile.ts';

function localOnly(): never {
  throw new HpcProfileError('HPC profiles are available only through the local control plane.');
}

export async function listHpcClusters(ownerId: string): Promise<never> { void ownerId; return localOnly(); }
export async function getHpcCluster(ownerId: string, id: string): Promise<never> { void ownerId; void id; return localOnly(); }
export async function saveHpcCluster(raw: unknown): Promise<never> { void raw; return localOnly(); }
export async function deleteHpcCluster(ownerId: string, id: string): Promise<never> { void ownerId; void id; return localOnly(); }
export async function setDefaultHpcCluster(ownerId: string, id: string): Promise<never> { void ownerId; void id; return localOnly(); }

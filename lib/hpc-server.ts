/** Hosted routes must never derive an owner from an unverified JWT payload. */
import { HpcProfileError } from './hpc-profile.ts';

export function getOwnerId(): never {
  throw new HpcProfileError('HPC profiles are available only through the authenticated local control plane.');
}

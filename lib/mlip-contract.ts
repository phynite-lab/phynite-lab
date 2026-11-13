/** MLIP output is approximate model evidence, distinct from DFT/Materials Project energies. */
export type MlipGeometry = { symbols: string[]; scaledPositions: number[][]; cellAngstrom: number[][]; periodic: boolean[] };
export type MlipProtocol = { mode: 'single_point' | 'relax_fixed_cell'; fmaxEvAngstrom: number; maxSteps: number; wallSeconds: number };
export type MlipResult = { schemaVersion: 1; model: { id: 'MACE-MP-0b3-medium'; sha256: string; version: '0.3.17'; device: 'cpu'; dtype: 'float64' }; requestSha256: string; protocolSha256: string; energyEv: number; energyPerAtomEv: number; forcesEvAngstrom: number[][]; finalGeometry: MlipGeometry; converged: boolean; steps: number; elapsedSeconds: number };

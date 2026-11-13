/** Qualitative QE workload hints; these are not hardware or runtime estimates. */
export type ComputeResourceAdvice = {
  recommendation: 'personal' | 'hpc';
  confidence: 'medium';
  title: { en: string; id: string };
  reason: { en: string; id: string };
  badge: { en: string; id: string };
  metrics: { atomCount: number; kPointProduct: number | null; complexity: 'light' | 'moderate' | 'heavy' };
};
export type ComputeAdvisorParams = {
  atomCount?: number;
  kPoints?: [number, number, number] | number[] | number;
  calculationType?: string;
  isHpcConfigured?: boolean;
};
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function getComputeResourceAdvice({ atomCount, kPoints, calculationType, isHpcConfigured = false }: ComputeAdvisorParams): ComputeResourceAdvice | null {
  if (!positiveInteger(atomCount)) return null;
  let kPointProduct: number | null = null;
  if (kPoints !== undefined) {
    const mesh = typeof kPoints === 'number' ? [kPoints, kPoints, kPoints] : kPoints;
    if (!Array.isArray(mesh) || mesh.length !== 3 || !mesh.every(positiveInteger)) return null;
    kPointProduct = mesh.reduce((a, b) => a * b, 1);
    if (!Number.isSafeInteger(kPointProduct)) return null;
  }
  const phonon = calculationType === 'Phonon dispersion';
  const heavy = atomCount > 10 || (kPointProduct !== null && kPointProduct > 512) || phonon;
  const complexity = heavy ? 'heavy' : kPointProduct === null ? 'moderate' : 'light';
  const recommendation = heavy && isHpcConfigured ? 'hpc' : 'personal';
  const qualification = {
    en: 'This is a workload heuristic. Cutoffs, band count, convergence, available RAM and queue conditions determine the actual cost; review the resource checks before running.',
    id: 'Ini perkiraan beban kerja. Cutoff, jumlah pita, konvergensi, RAM tersedia dan antrean menentukan biaya aktual; periksa validasi resource sebelum menjalankan.',
  };
  const reason = heavy ? {
    en: phonon ? 'Phonon dispersion can require many DFPT response calculations. Consider a compatible HPC allocation.' : `A ${atomCount}-atom structure or dense k-mesh can require substantial CPU time and memory. Consider HPC when available.`,
    id: phonon ? 'Dispersi fonon dapat memerlukan banyak kalkulasi respons DFPT. Pertimbangkan alokasi HPC yang kompatibel.' : `Struktur ${atomCount} atom atau k-mesh rapat dapat memerlukan CPU dan memori besar. Pertimbangkan HPC bila tersedia.`,
  } : {
    en: `A ${atomCount}-atom cell may be practical on Your computer when its runtime and memory checks pass.`,
    id: `Sel ${atomCount} atom mungkin cocok di Komputer Anda jika pemeriksaan runtime dan memori lolos.`,
  };
  return {
    recommendation, confidence: 'medium',
    badge: recommendation === 'hpc' ? { en: 'Consider HPC', id: 'Pertimbangkan HPC' } : heavy ? { en: 'Compute intensive', id: 'Komputasi intensif' } : { en: 'Consider local CPU', id: 'Pertimbangkan CPU lokal' },
    title: recommendation === 'hpc' ? { en: 'Compute advisor: consider HPC', id: 'Saran compute: pertimbangkan HPC' } : { en: 'Compute advisor: review local resources', id: 'Saran compute: periksa resource lokal' },
    reason: { en: `${reason.en} ${qualification.en}`, id: `${reason.id} ${qualification.id}` },
    metrics: { atomCount, kPointProduct, complexity },
  };
}

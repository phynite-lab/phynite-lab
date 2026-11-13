/**
 * Smart Resource Advisor: Scientific heuristic advisor for Local CPU vs HPC Cluster execution.
 * AGPL-3.0-only.
 */

export type ComputeResourceAdvice = {
  recommendation: 'personal' | 'hpc';
  confidence: 'high' | 'medium';
  title: { en: string; id: string };
  reason: { en: string; id: string };
  badge: { en: string; id: string };
  metrics: {
    atomCount: number;
    kPointProduct: number;
    complexity: 'light' | 'moderate' | 'heavy';
  };
};

export type ComputeAdvisorParams = {
  atomCount?: number;
  kPoints?: [number, number, number] | number[] | number;
  calculationType?: string;
  isHpcConfigured?: boolean;
};

export function getComputeResourceAdvice(params: ComputeAdvisorParams): ComputeResourceAdvice | null {
  const { atomCount, kPoints, calculationType, isHpcConfigured = false } = params;
  if (!atomCount || atomCount <= 0 || !Number.isFinite(atomCount)) {
    return null;
  }
  const normalizedAtomCount = Math.max(1, Math.round(atomCount));

  let kProduct = 64; // default 4x4x4 or 8x8x8
  if (Array.isArray(kPoints)) {
    const kx = Math.max(1, Math.round(Math.abs(Number(kPoints[0]) || 1)));
    const ky = Math.max(1, Math.round(Math.abs(Number(kPoints[1]) || 1)));
    const kz = Math.max(1, Math.round(Math.abs(Number(kPoints[2]) || 1)));
    kProduct = kx * ky * kz;
  } else if (typeof kPoints === 'number' && Number.isFinite(kPoints) && kPoints > 0) {
    const k = Math.max(1, Math.round(Math.abs(kPoints)));
    kProduct = k * k * k;
  }

  // Small unit cell: <= 10 atoms (e.g. primitive Si, GaAs, Graphene, FCC Cu)
  if (normalizedAtomCount <= 10 && kProduct <= 512 && calculationType !== 'Phonon dispersion') {
    return {
      recommendation: 'personal',
      confidence: 'high',
      badge: { en: 'Instant Local CPU', id: 'CPU Lokal Instan' },
      title: {
        en: 'Smart Advisor: Local CPU Recommended',
        id: 'Smart Advisor: Disarankan CPU Lokal',
      },
      reason: {
        en: `Small unit cell (${normalizedAtomCount} atoms). SCF converges in seconds on your CPU; submitting to HPC incurs queue overhead (minutes to hours) that dwarfs execution time.`,
        id: `Struktur kecil (${normalizedAtomCount} atom). SCF selesai dalam hitungan detik di CPU lokal; mengirim ke HPC menambah waktu tunggu antrean (menit hingga jam) yang jauh melebihi durasi komputasi.`,
      },
      metrics: {
        atomCount: normalizedAtomCount,
        kPointProduct: kProduct,
        complexity: 'light',
      },
    };
  }

  // Complex or heavy structure: > 10 atoms, dense k-points, or phonon dispersion
  if (normalizedAtomCount > 10 || kProduct > 512 || calculationType === 'Phonon dispersion') {
    const isPhonon = calculationType === 'Phonon dispersion';
    return {
      recommendation: isHpcConfigured ? 'hpc' : 'personal',
      confidence: 'high',
      badge: { en: isHpcConfigured ? 'HPC Cluster Recommended' : 'Compute Intensive', id: isHpcConfigured ? 'Disarankan HPC Cluster' : 'Komputasi Intensif' },
      title: {
        en: isHpcConfigured ? 'Smart Advisor: HPC Cluster Recommended' : 'Smart Advisor: High Workload Detected',
        id: isHpcConfigured ? 'Smart Advisor: Disarankan Cluster HPC' : 'Smart Advisor: Beban Kerja Tinggi Terdeteksi',
      },
      reason: {
        en: isPhonon
          ? `Phonon dispersion requires multiple DFPT linear response iterations. Parallel MPI execution on HPC prevents laptop CPU throttling and finishes significantly faster.`
          : `With ${normalizedAtomCount} atoms (scaling as O(N³)), parallel MPI execution across HPC nodes avoids overloading your laptop CPU/RAM and provides massive wall-clock speedup.`,
        id: isPhonon
          ? `Dispersi fonon memerlukan iterasi linear-response DFPT yang berat. Eksekusi paralel MPI di HPC mencegah laptop kepanasan/throttling dan selesai jauh lebih cepat.`
          : `Dengan ${normalizedAtomCount} atom (kompleksitas O(N³)), eksekusi paralel MPI di node HPC mencegah kehabisan RAM/CPU di laptop dan memberikan akselerasi signifikan.`,
      },
      metrics: {
        atomCount: normalizedAtomCount,
        kPointProduct: kProduct,
        complexity: 'heavy',
      },
    };
  }

  // Moderate workload
  return {
    recommendation: 'personal',
    confidence: 'medium',
    badge: { en: 'Balanced Workload', id: 'Beban Seimbang' },
    title: {
      en: 'Smart Advisor: Local or HPC Suitable',
      id: 'Smart Advisor: Cocok untuk Lokal atau HPC',
    },
    reason: {
      en: `Moderate workload (${normalizedAtomCount} atoms). Run locally for an immediate start without queue latency, or choose HPC for multi-node speedup.`,
      id: `Beban kerja moderat (${normalizedAtomCount} atom). Jalankan di lokal untuk mulai seketika tanpa antrean, atau pilih HPC untuk akselerasi multi-node.`,
    },
    metrics: {
      atomCount: normalizedAtomCount,
      kPointProduct: kProduct,
      complexity: 'moderate',
    },
  };
}

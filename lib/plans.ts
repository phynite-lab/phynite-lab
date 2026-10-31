import type { PlanId } from './account-api';
import type { Locale } from './locale';

export const pricingPolicy = {
  creditName: 'Quanta', creditUsd: 1,
  checkedOn: '2026-10-13',
  computeRatesCheckedOn: '2026-09-07',
  minimumTopUpUsd: 0.5,
  quantaSaleIdr: 18_000,
  dokuVaFeeIdr: 4_000,
  freeStorageBytes: 10 * 1024 ** 3,
} as const;

export const storagePlans = [
  { name: 'Pocket', gib: 50, monthlyIdr: 27_000 },
  { name: 'Shelf', gib: 100, monthlyIdr: 55_000 },
  { name: 'Archive', gib: 250, monthlyIdr: 129_000 },
  { name: 'Library', gib: 500, monthlyIdr: 259_000 },
  { name: 'Research', gib: 1024, monthlyIdr: 519_000 },
] as const;


type PublicPlanId = Exclude<PlanId, 'personal'>;
type Plan = { id: PublicPlanId; name: string; category: string; price: string; note?: string; description: string; features: string[]; action: string; href: string };
export const plans: Plan[] = [
  { id: 'free', name: 'Free', category: 'Build & run locally', price: '$0', note: 'always free', description: 'Prepare structures, make figures, and run simulations on your computer.', features: ['DFT Lab, MD Lab and Figure Lab', 'DFT and MD runs on one connected computer per account', 'Private projects, structure tools and cloud sync', '10 GiB total cloud storage, templates and figure exports', 'No local activation or hourly compute fee', 'Email support: support@phynitelab.com'], action: 'Join waitlist', href: '/waitlist' },
  { id: 'research', name: 'Cloud', category: 'Pay as you go', price: 'Quanta / usage', note: 'selected CPU/RAM profile', description: 'Use cloud compute when your research needs more capacity.', features: ['Everything in Free', 'All DFT, Guided/manual MD and OVITO workflows', 'Solver/analysis time × AWS profile rate +10%', 'Parallel funded jobs according to capacity'], action: 'Join waitlist', href: '/waitlist' },
  { id: 'enterprise', name: 'Institution', category: 'Research groups', price: 'Custom', description: 'Plan capacity, storage, and support around your research group.', features: ['Compute and storage requirements review', 'Institutional onboarding consultation', 'Written scope and pricing before activation'], action: 'Talk to the team', href: '/contact?plan=institution' },
];

const indonesianPlans: Record<PublicPlanId, Omit<Plan, 'id' | 'name' | 'href'>> = {
  free: { category: 'Rancang & jalankan lokal', price: '$0', note: 'selalu gratis', description: 'Siapkan struktur, buat figur, dan jalankan simulasi pada komputer sendiri.', features: ['DFT Lab, MD Lab dan Figure Lab', 'Run DFT dan MD pada satu komputer terhubung per akun', 'Project pribadi, pengolahan struktur dan sinkronisasi cloud', 'Total storage cloud 10 GiB, template dan ekspor figur', 'Tanpa biaya aktivasi atau komputasi lokal per jam', 'Bantuan email: support@phynitelab.com'], action: 'Gabung waitlist' },
  research: { category: 'Bayar sesuai pemakaian', price: 'Quanta / pemakaian', note: 'profil CPU/RAM terpilih', description: 'Gunakan komputasi cloud saat riset membutuhkan kapasitas lebih.', features: ['Semua fitur Free', 'Seluruh workflow DFT, MD Guided/manual, dan OVITO', 'Waktu solver/analisis × tarif profil AWS +10%', 'Job dengan pendanaan paralel sesuai kapasitas'], action: 'Gabung waitlist' },
  enterprise: { category: 'Kelompok riset', price: 'Sesuai kebutuhan', description: 'Rencanakan komputasi, penyimpanan, dan dukungan untuk tim riset.', features: ['Tinjauan kebutuhan komputasi dan storage', 'Konsultasi onboarding institusi', 'Cakupan dan harga tertulis sebelum aktivasi'], action: 'Hubungi tim' },
};

export function localizedPlans(locale: Locale) {
  return plans.map(plan => locale === 'id' ? { ...plan, ...indonesianPlans[plan.id] } : plan);
}

export function publicPlanId(planId: PlanId | undefined): PublicPlanId | undefined {
  return planId === 'personal' ? 'free' : planId;
}

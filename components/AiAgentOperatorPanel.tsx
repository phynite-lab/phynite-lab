'use client';

import { useState } from 'react';
import { Clock3, FlaskConical, ShieldCheck } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { aiAgentFeatureEnabled, aiAgentPresets, aiCampaignSummary } from '@/lib/ai-agent-operator';

/** Research-facing entry point for bounded campaigns; technical contract fields stay server-side. */
export function AiAgentOperatorPanel({ disabled, onPreset }: { disabled?: boolean; onPreset: (prompt: string) => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [sparse, setSparse] = useState(true);
  if (!aiAgentFeatureEnabled('ai-agent-operator', { PHYNITE_AI_AGENT_OPERATOR: process.env.NEXT_PUBLIC_PHYNITE_AI_AGENT_OPERATOR })) return null;
  return <section className="ai-agent-operator" aria-label={t('Scientific AI operator', 'Operator AI ilmiah')}>
    <header><div><strong><FlaskConical size={15} />{t('Discovery and remote research', 'Discovery dan riset remote')}</strong><p>{t('Use a bounded campaign that can continue after you close the browser.', 'Gunakan kampanye terbatas yang dapat dilanjutkan setelah browser ditutup.')}</p></div><button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} disabled={disabled}>{open ? t('Hide', 'Tutup') : t('Open presets', 'Buka preset')}</button></header>
    {open && <div className="ai-agent-operator-body"><div className="ai-agent-presets">{aiAgentPresets.map(preset => <button type="button" key={preset.id} disabled={disabled} onClick={() => onPreset(`Gunakan preset ${preset.label}. ${preset.description} ${sparse ? 'Unduh hanya data esensial dan grafik.' : 'Simpan evidence lengkap sesuai batas kampanye.'}`)}><span><ShieldCheck size={14} />{preset.label}</span><small>{preset.description}</small>{preset.id === 'overnight-discovery' && <em>{aiCampaignSummary({ maxCandidates: 5, totalNodeHours: 6, clusterLabel: 'kluster yang diizinkan' })}</em>}</button>)}</div><label className="ai-agent-sparse"><input type="checkbox" checked={sparse} onChange={event => setSparse(event.target.checked)} />{t('Unduh hanya data esensial & grafik (hemat kuota dan ruang disk)', 'Unduh hanya data esensial & grafik (hemat kuota dan ruang disk)')}</label><div className="ai-agent-clock"><Clock3 size={14} />{t('Queue wait and computation time are tracked separately.', 'Waktu antrean dan waktu komputasi dipantau terpisah.')}</div></div>}
  </section>;
}

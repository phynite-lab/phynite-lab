'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, ShieldCheck, X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { aiAgentFeatureEnabled, aiAgentPresets } from '@/lib/ai-agent-operator';
import { useAiOverlayPosition } from './use-ai-overlay';

type Props = { disabled?: boolean; open: boolean; portalOwner: string; onOpenChange: (open: boolean) => void; onPreset: (prompt: string) => void };

/** One controlled composer overlay; selecting a preset only fills a planning draft. */
export function AiAgentOperatorPanel({ disabled, open, portalOwner, onOpenChange, onPreset }: Props) {
  const { t } = useLocale();
  const anchor = useRef<HTMLButtonElement>(null), id = useId();
  if (!aiAgentFeatureEnabled('ai-agent-operator', { PHYNITE_AI_AGENT_OPERATOR: process.env.NEXT_PUBLIC_PHYNITE_AI_AGENT_OPERATOR })) return null;
  const close = (restoreFocus = true) => { onOpenChange(false); if (restoreFocus) anchor.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={anchor} type="button" className="ai-attach-button ai-discovery-trigger" aria-label={t('Discovery presets', 'Preset Discovery')} title={t('Prepare a Discovery campaign plan', 'Siapkan rencana kampanye Discovery')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => onOpenChange(!open)}><FlaskConical size={18} /></button>
    {open && <DiscoveryOverlay id={id} anchorRef={anchor} portalOwner={portalOwner} onClose={close}>
      <AiDiscoverySettings disabled={disabled} onPreset={prompt => { onOpenChange(false); onPreset(prompt); }} />
    </DiscoveryOverlay>}
  </>;
}

export function AiDiscoverySettings({ disabled, onPreset }: { disabled?: boolean; onPreset: (prompt: string) => void }) {
  const { t } = useLocale();
  const [sparse, setSparse] = useState(true);
  if (!aiAgentFeatureEnabled('ai-agent-operator', { PHYNITE_AI_AGENT_OPERATOR: process.env.NEXT_PUBLIC_PHYNITE_AI_AGENT_OPERATOR })) return null;
  return <details className="ai-discovery-settings"><summary><FlaskConical size={16} />{t('Discovery presets', 'Preset Discovery')}</summary>
      <p>{t('Prepare a bounded campaign plan. Review the draft before sending; choosing a preset does not submit calculations.', 'Siapkan rencana kampanye terbatas. Tinjau draf sebelum mengirim; memilih preset tidak menjalankan kalkulasi.')}</p>
      <div className="ai-agent-presets">{aiAgentPresets.map(preset => <button type="button" key={preset.id} disabled={disabled} onClick={() => {
        onPreset(t(`Prepare a campaign plan using ${preset.label}. ${preset.descriptionEn} ${sparse ? 'Retain only essential evidence and plots.' : 'Retain full evidence within the campaign budget.'} Do not submit calculations.`, `Siapkan rencana kampanye dengan preset ${preset.label}. ${preset.description} ${sparse ? 'Simpan hanya evidence esensial dan grafik.' : 'Simpan evidence lengkap sesuai batas kampanye.'} Jangan jalankan kalkulasi.`));
      }}><span><ShieldCheck size={15} aria-hidden="true" />{preset.label}</span><small>{t(preset.descriptionEn, preset.description)}</small></button>)}</div>
      <label className="ai-agent-sparse"><input type="checkbox" checked={sparse} onChange={event => setSparse(event.target.checked)} />{t('Retain only essential evidence and plots to save bandwidth and disk space', 'Simpan hanya evidence esensial dan grafik untuk menghemat kuota dan ruang disk')}</label>
      <p>{t('Persistent campaigns require a qualified local supervisor. Keep the conversation open while working with the current chat agent.', 'Kampanye persisten memerlukan supervisor lokal yang terkualifikasi. Biarkan percakapan terbuka saat bekerja dengan agen chat saat ini.')}</p>
  </details>;
}

function DiscoveryOverlay({ id, anchorRef, portalOwner, onClose, children }: { id: string; anchorRef: RefObject<HTMLButtonElement | null>; portalOwner: string; onClose: (restoreFocus?: boolean) => void; children: ReactNode }) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const placement = useAiOverlayPosition({ anchorRef, rootRef: root, keepComposerVisible: true });
  useEffect(() => { if (placement.style.visibility === 'visible') root.current?.querySelector<HTMLButtonElement>('.ai-agent-presets button')?.focus({ preventScroll: true }); }, [placement.style.visibility]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) {
        // Let another focusable control receive the pointer's focus normally.
        onClose(!(event.target instanceof Element && event.target.closest('button,input,textarea,select,a,[tabindex]')));
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [anchorRef, onClose]);
  return createPortal(<div id={id} ref={root} className="ai-agent-operator ai-overlay" data-ui-owner={portalOwner} data-sheet={placement.sheet} style={placement.style} role="dialog" aria-label={t('Discovery presets', 'Preset Discovery')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !anchorRef.current?.contains(event.relatedTarget)) onClose(false); }}>
    <header><strong><FlaskConical size={16} aria-hidden="true" />{t('Discovery campaign plan', 'Rencana kampanye Discovery')}</strong><button type="button" onClick={() => onClose()} aria-label={t('Close Discovery presets', 'Tutup preset Discovery')}><X size={17} /></button></header>
    <div className="ai-agent-operator-body" data-ai-overlay-scroll>{children}</div>
  </div>, document.body);
}

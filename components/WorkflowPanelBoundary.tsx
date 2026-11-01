'use client';
import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
function Recovery({ label, retry, onCanvas }: { label: string; retry: () => void; onCanvas: () => void }) {
  const { t } = useLocale();
  return <div className="workflow-panel-recovery" role="alert"><strong>{t('This tab could not open', 'Tab ini belum dapat dibuka')}</strong><p>{label}</p><p>{t('Your project and other tabs are still available. Retry this view, or return to Canvas to continue.', 'Project dan tab lain tetap tersedia. Coba buka lagi, atau kembali ke Kanvas untuk melanjutkan.')}</p><div><button onClick={retry}><RefreshCw size={14} />{t('Retry tab', 'Coba lagi')}</button><button onClick={onCanvas}>{t('Open Canvas', 'Buka Kanvas')}</button><button onClick={() => window.location.reload()}>{t('Reload project', 'Muat ulang project')}</button></div></div>;
}
/** A malformed view or a stale browser chunk must not take down the project shell. */
export class WorkflowPanelBoundary extends Component<{ children: ReactNode; label: string; onCanvas: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Recovery label={this.props.label} onCanvas={this.props.onCanvas} retry={() => this.setState({ failed: false })} /> : this.props.children; }
}

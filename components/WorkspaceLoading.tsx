/** Shared feedback is styled by the root layout, including before route CSS loads. */
export function WorkspaceLoading({ label, layout = 'panel', className = '' }: {
  label: string; layout?: 'page' | 'panel' | 'list' | 'inline'; className?: string;
}) {
  const Element = layout === 'page' ? 'main' : layout === 'inline' ? 'span' : 'div';
  return <Element className={`workspace-feedback workspace-feedback--${layout} ${className}`} role="status" aria-live="polite" aria-label={label} aria-busy="true">
    <span className="workspace-feedback-label"><span className="workspace-feedback-spinner" aria-hidden="true" /><span>{label}</span></span>
    {layout === 'list' && <div className="workspace-feedback-rows" aria-hidden="true">{[0, 1, 2].map(index => <div key={index}><i /><span /><span /></div>)}</div>}
  </Element>;
}

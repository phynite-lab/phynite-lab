import type { ReactNode } from 'react';

/** Shared chapter anatomy for workspace pages, settings and the AI welcome. */
export function WorkspacePageHeading({ title, description, eyebrow, actions, className = '' }: {
  title: string; description?: string; eyebrow?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <header className={`workspace-page-heading ${className}`}>
    <div className="workspace-page-heading-copy">
      {eyebrow && <p className="workspace-page-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="workspace-page-description">{description}</p>}
    </div>
    {actions && <div className="workspace-page-heading-actions">{actions}</div>}
  </header>;
}

import type { SVGProps } from 'react';

export type AiProviderLogoId = 'codex' | 'antigravity';

type LogoProps = SVGProps<SVGSVGElement> & { provider: AiProviderLogoId };

/**
 * Small, inline provider marks keep the settings surface usable offline. The
 * marks are intentionally rendered as SVG instead of loaded from a remote
 * image so a local installation never needs a network request just to paint
 * its provider list.
 */
export function AiProviderLogo({ provider, ...props }: LogoProps) {
  if (provider === 'codex') {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2.75c1.25 0 2.28.46 3.08 1.38l1.07 1.23 1.62-.18c1.23-.14 2.28.24 3.16 1.12.88.88 1.26 1.93 1.12 3.16l-.18 1.62 1.23 1.07c.92.8 1.38 1.83 1.38 3.08s-.46 2.28-1.38 3.08l-1.23 1.07.18 1.62c.14 1.23-.24 2.28-1.12 3.16-.88.88-1.93 1.26-3.16 1.12l-1.62-.18-1.07 1.23C14.28 22.54 13.25 23 12 23s-2.28-.46-3.08-1.38l-1.07-1.23-1.62.18c-1.23.14-2.28-.24-3.16-1.12-.88-.88-1.26-1.93-1.12-3.16l.18-1.62-1.23-1.07C0 12.8-.46 11.77-.46 10.52s.46-2.28 1.38-3.08l1.23-1.07-.18-1.62c-.14-1.23.24-2.28 1.12-3.16.88-.88 1.93-1.26 3.16-1.12l1.62.18 1.07-1.23C9.72 3.21 10.75 2.75 12 2.75Z" transform="scale(.82) translate(2.6 2.6)" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M8.25 12.15 10.9 14.8l5.15-5.6" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <path d="M12 2.5 14.55 8l5.95.7-4.36 4.08 1.14 5.85L12 15.72l-5.28 2.91 1.14-5.85L3.5 8.7l5.95-.7L12 2.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    <path d="M12 9.1v5.8M9.1 11.35l5.8 3.35M14.9 11.35l-5.8 3.35" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
  </svg>;
}

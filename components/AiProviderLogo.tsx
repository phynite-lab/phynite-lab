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
      <defs><linearGradient id="codex-mark" x1="3" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse"><stop stopColor="#2f80ed" /><stop offset=".5" stopColor="#32c7a5" /><stop offset="1" stopColor="#ff9f43" /></linearGradient></defs>
      <path d="M4.1 18.75c2.65-.1 4.22-1.42 5.07-3.17l2.1-4.33c.92-1.9 2.12-3.05 4.2-3.19 1.93-.13 3.32.75 4.42 2.1" stroke="url(#codex-mark)" strokeWidth="2.85" strokeLinecap="round" />
      <path d="M4.1 18.75c2.84.17 5.18-1.4 6.3-3.7l1.58-3.24c.72-1.47 1.75-2.42 3.2-2.55" stroke="url(#codex-mark)" strokeWidth="1.1" strokeLinecap="round" opacity=".4" />
      <path d="M19.9 18.75c-2.65-.1-4.22-1.42-5.07-3.17l-1.18-2.42" stroke="url(#codex-mark)" strokeWidth="2.85" strokeLinecap="round" />
    </svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <defs><linearGradient id="antigravity-mark" x1="4" y1="4" x2="20" y2="21" gradientUnits="userSpaceOnUse"><stop stopColor="#a997ff" /><stop offset="1" stopColor="#4169f5" /></linearGradient></defs>
    <path d="M6.4 17.65a5.3 5.3 0 0 1 .91-9.78 5.85 5.85 0 0 1 9.98 1.6 4.7 4.7 0 0 1 .82 8.18" fill="url(#antigravity-mark)" opacity=".9" />
    <path d="m9.1 11.2 2.18 2.23-2.18 2.22M13.2 15.65h2.7" stroke="white" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

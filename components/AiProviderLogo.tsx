import type { ImgHTMLAttributes } from 'react';

export type AiProviderLogoId = 'codex' | 'antigravity';

type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { provider: AiProviderLogoId };

/** Offline provider artwork shipped with the local application. */
export function AiProviderLogo({ provider, ...props }: LogoProps) {
  return <img src={`/brand/ai/${provider}.png`} alt="" aria-hidden="true" decoding="async" draggable={false} {...props} />;
}

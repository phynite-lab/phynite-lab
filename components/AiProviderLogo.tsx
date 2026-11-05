import type { ImgHTMLAttributes } from 'react';
import { Bot } from 'lucide-react';

export type AiProviderLogoId = 'codex' | 'antigravity' | 'claude';

type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { provider: AiProviderLogoId };

/** Offline provider artwork shipped with the local application. */
export function AiProviderLogo({ provider, ...props }: LogoProps) {
  // No Claude brand artwork is bundled. A neutral glyph is used until an official mark is added at /brand/ai/claude.png.
  if (provider === 'claude') return <Bot width={props.width} height={props.height} className={props.className} aria-hidden="true" />;
  return <img src={`/brand/ai/${provider}.png`} alt="" aria-hidden="true" decoding="async" draggable={false} {...props} />;
}

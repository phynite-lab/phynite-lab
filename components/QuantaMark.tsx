import { QUANTA_COIN_COLORS as colors, quantaMarkGeometry, type QuantaMarkVariant } from '@/lib/quanta-mark';

type Props = {
  variant?: QuantaMarkVariant;
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name. Omit for decorative use next to a visible label. */
  title?: string;
};

const DEFAULT_SIZE: Record<QuantaMarkVariant, number> = { mark: 20, mini: 14, tile: 56 };

/** Transparent blue coin with a size-adjusted border. */
export function QuantaMark({ variant = 'mark', size, className, title }: Props) {
  const geometry = quantaMarkGeometry(variant);
  const diameter = size ?? DEFAULT_SIZE[variant];
  const outlineWidth = Math.max(1.5, Math.min(4, diameter / 10));
  const coinColor = `var(--quanta-blue, ${colors.symbol})`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={geometry.viewBox}
      width={diameter}
      height={diameter}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <circle cx="32" cy="32" r={geometry.radius} fill="none" stroke={coinColor} strokeWidth={outlineWidth} vectorEffect="non-scaling-stroke" />
      <path fill={coinColor} d={geometry.symbol} />
    </svg>
  );
}

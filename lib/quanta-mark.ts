/** Shared vector geometry and palette for the Quanta compute-credit coin. */
export type QuantaMarkVariant = 'mark' | 'mini' | 'tile';

export const QUANTA_COIN_COLORS = {
  symbol: '#214FB5',
  symbolDark: '#7DA2FF',
} as const;

// Opposite winding opens the counter; the clockwise tail joins the bowl.
const QUANTA_Q = 'M32 18a14 14 0 1 1 0 28a14 14 0 0 1 0-28Z'
  + 'M32 24a8 8 0 1 0 0 16a8 8 0 0 0 0-16Z'
  + 'M34 31L48 45L44 49L30 35Z';

// A wider bowl and tail keep the counter open and the Q distinct at 14 px.
const QUANTA_Q_MINI = 'M32 17a15 15 0 1 1 0 30a15 15 0 0 1 0-30Z'
  + 'M32 24.5a7.5 7.5 0 1 0 0 15a7.5 7.5 0 0 0 0-15Z'
  + 'M34.5 30.5L49 45L44 50L29.5 35.5Z';

export function quantaMarkGeometry(variant: QuantaMarkVariant) {
  return {
    width: 64,
    height: 64,
    viewBox: '0 0 64 64',
    radius: 28,
    symbol: variant === 'mini' ? QUANTA_Q_MINI : QUANTA_Q,
  };
}

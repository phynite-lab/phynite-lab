type Rgb = [number, number, number];
type ColorStop = readonly [number, Rgb];

const hex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), 16) / 255,
  Number.parseInt(value.slice(3, 5), 16) / 255,
  Number.parseInt(value.slice(5, 7), 16) / 255,
];

/**
 * Compact reference stops for the palettes exposed by MD Lab. The renderer
 * and legend both consume this table so the scale shown to the user is the
 * scale applied to particles.
 */
const palettes: Record<string, readonly ColorStop[]> = {
  viridis: [
    [0, hex('#440154')],
    [.25, hex('#3b528b')],
    [.5, hex('#21918c')],
    [.75, hex('#5ec962')],
    [1, hex('#fde725')],
  ],
  turbo: [
    [0, hex('#30123b')],
    [1 / 6, hex('#4686fb')],
    [2 / 6, hex('#1ae4b6')],
    [3 / 6, hex('#a2fc3c')],
    [4 / 6, hex('#fbb82d')],
    [5 / 6, hex('#e43d09')],
    [1, hex('#7a0403')],
  ],
  coolwarm: [
    [0, hex('#3b4cc0')],
    [.25, hex('#8cb2e9')],
    [.5, hex('#e2e2e2')],
    [.75, hex('#f49a7b')],
    [1, hex('#b40426')],
  ],
  jet: [
    [0, hex('#000080')],
    [.125, hex('#0000ff')],
    [.375, hex('#00ffff')],
    [.625, hex('#ffff00')],
    [.875, hex('#ff0000')],
    [1, hex('#800000')],
  ],
};

function paletteFor(cmap: string) {
  return palettes[(cmap || 'viridis').toLowerCase()] ?? palettes.viridis;
}

export function sampleColormap(t: number, cmap: string = 'viridis'): Rgb {
  const norm = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const stops = paletteFor(cmap);
  const upperIndex = stops.findIndex(([position]) => position >= norm);
  if (upperIndex <= 0) return [...stops[0][1]];
  const [startPosition, start] = stops[upperIndex - 1];
  const [endPosition, end] = stops[upperIndex];
  const amount = (norm - startPosition) / Math.max(Number.EPSILON, endPosition - startPosition);
  return start.map((channel, index) => channel + (end[index] - channel) * amount) as Rgb;
}

const cssColor = (color: Rgb) => '#' + color
  .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0'))
  .join('');

export function colormapGradient(cmap: string = 'viridis') {
  return `linear-gradient(to right, ${paletteFor(cmap)
    .map(([position, color]) => `${cssColor(color)} ${Math.round(position * 10000) / 100}%`)
    .join(', ')})`;
}

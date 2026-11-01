export type ScientificPlotKind = 'band' | 'dos' | 'phonon' | 'thermoelectric' | 'generic';

export type ScientificPlotPoint = [number, number];

export type ScientificPlotSeries = {
  id: string;
  label: string;
  points: ScientificPlotPoint[];
  weights?: number[];
  weightScale?: 'absolute';
  projections?: Record<string, number[]>;
  legendGroup?: string;
};

export type ScientificPlotQuantity = {
  id: string;
  label: string;
  yLabel: string;
  series: ScientificPlotSeries[];
};

export type ScientificPlotData = {
  kind: ScientificPlotKind;
  energyReference?: 'fermi' | 'unknown';
  title: string;
  xLabel: string;
  xTicks?: Array<{ value: number; label: string }>;
  quantities: ScientificPlotQuantity[];
};

export type ScientificPlotExport = {
  id: string;
  label: string;
  filenameStem: string;
  svg: string;
  width: number;
  height: number;
};

export type PlotPalette = 'graphite' | 'viridis' | 'cobalt' | 'warm' | 'colorblind' | 'mono';
export type PlotTheme = 'paper' | 'warm-paper' | 'dark' | 'transparent';
export type PlotFont = 'sans' | 'serif' | 'mono';
export type PlotAxisScale = 'linear' | 'log';
export type PlotTickFormat = 'auto' | 'fixed' | 'scientific';
export type PlotLegendPosition = 'top' | 'right' | 'inside-ne' | 'inside-nw';
export type PlotLineStyle = 'solid' | 'dash' | 'dot' | 'dashdot';
export type PlotMarker = 'none' | 'circle' | 'square' | 'diamond';

export type ScientificPlotSeriesStyle = {
  visible: boolean;
  label: string;
  color: string | null;
  lineWidth: number | null;
  lineStyle: PlotLineStyle;
  marker: PlotMarker;
  markerSize: number;
};

export type ScientificPlotSettings = {
  layout: 'single' | 'band-dos';
  pairedJobId: string | null;
  combinedEnergyMin: number | null;
  combinedEnergyMax: number | null;
  combinedDosMin: number | null;
  combinedDosMax: number | null;
  combinedDosWidthPercent: number;
  title: string;
  xLabel: string;
  yLabel: string;
  quantityId: string;
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  xScale: PlotAxisScale;
  yScale: PlotAxisScale;
  xTickCount: number;
  yTickCount: number;
  tickFormat: PlotTickFormat;
  tickDecimals: number;
  width: number;
  height: number;
  exportScale: number;
  lineWidth: number;
  palette: PlotPalette;
  theme: PlotTheme;
  fontFamily: PlotFont;
  titleFontSize: number;
  labelFontSize: number;
  tickFontSize: number;
  subtitle: string;
  showGrid: boolean;
  showMinorGrid: boolean;
  showLegend: boolean;
  legendPosition: PlotLegendPosition;
  showFrame: boolean;
  showXZero: boolean;
  showYZero: boolean;
  xReference: number | null;
  yReference: number | null;
  referenceLabel: string;
  seriesStyles: Record<string, ScientificPlotSeriesStyle>;
};

const PALETTES: Record<PlotPalette, string[]> = {
  graphite: ['#252a35', '#6c7480', '#a2a8b0', '#454c57', '#c3c7cc'],
  viridis: ['#46327e', '#21918c', '#a0da39', '#365c8d', '#fde725'],
  cobalt: ['#174ea6', '#4d90fe', '#88b8ff', '#23395d', '#7b96bd'],
  warm: ['#8c2d04', '#d94801', '#f16913', '#7f3b08', '#fdae6b'],
  colorblind: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9', '#000000'],
  mono: ['#17191d', '#4a4f57', '#737a84', '#a0a6ae', '#c7cbd0'],
};

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.length > 1 || row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.length > 1 || row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function humanizeHeader(header: string) {
  return header
    .replace(/_relative_to_(fermi|plot_reference)/g, '')
    .replace(/_ev$/g, ' (eV)')
    .replace(/_k$/g, ' (K)')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function numericTable(source: string) {
  const rows = parseCsvRows(source);
  if (rows.length < 2 || rows[0].length < 2) throw new Error('The result CSV has no plottable columns');
  const headers = rows[0];
  const values = rows.slice(1)
    .map((row) => headers.map((_, index) => row[index]?.trim() ? Number(row[index].replace(/[dD]([+-]?\d+)$/, 'e$1')) : Number.NaN));
  if (!values.some((row) => row.some(Number.isFinite))) throw new Error('The result CSV contains no numeric rows');
  return { headers, values };
}

function columnSeries(
  headers: string[],
  rows: number[][],
  xIndex: number,
  yIndices: number[],
  transform?: (value: number, header: string) => number,
) {
  return yIndices.map((columnIndex) => ({
    id: headers[columnIndex],
    label: humanizeHeader(headers[columnIndex]),
    points: rows
      .map((row): ScientificPlotPoint => [row[xIndex], transform ? transform(row[columnIndex], headers[columnIndex]) : row[columnIndex]]),
  })).filter((series) => series.points.some(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function interpolate(points: ScientificPlotPoint[], x: number) {
  if (points.length < 2 || x < points[0][0] || x > points[points.length - 1][0]) return Number.NaN;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle][0] <= x) low = middle;
    else high = middle;
  }
  const [x0, y0] = points[low];
  const [x1, y1] = points[high];
  if (x1 === x0) return (y0 + y1) / 2;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

function zeroCrossings(points: ScientificPlotPoint[]) {
  const crossings: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    if (y0 === 0) crossings.push(x0);
    else if ((y0 < 0) !== (y1 < 0) && y1 !== y0) crossings.push(x0 - y0 * (x1 - x0) / (y1 - y0));
  }
  if (points.at(-1)?.[1] === 0) crossings.push(points.at(-1)![0]);
  return crossings;
}

function thermoelectricPlotReference(headers: string[], values: number[][], temperatureIndex: number) {
  const rawXIndex = headers.indexOf('chemical_potential_ev_relative_to_fermi');
  const rawSeebeckIndex = headers.indexOf('seebeck_uv_per_k');
  const storedXIndex = headers.indexOf('chemical_potential_ev_relative_to_plot_reference');
  const storedSeebeckIndex = headers.indexOf('seebeck_uv_per_k_relative_to_plot_reference');
  if (storedXIndex >= 0 && storedSeebeckIndex >= 0) {
    const storedX = values.map((row) => row[storedXIndex]).filter(Number.isFinite);
    if (storedX.length) {
      const storedMin = storedX.reduce((bound, value) => Math.min(bound, value), Infinity);
      const storedMax = storedX.reduce((bound, value) => Math.max(bound, value), -Infinity);
      const shorterSide = Math.min(Math.abs(storedMin), Math.abs(storedMax));
      const longerSide = Math.max(Math.abs(storedMin), Math.abs(storedMax));
      const centeredDomain = storedMin < 0
        && storedMax > 0
        && shorterSide > 0
        && longerSide / shorterSide <= 1.25;
      if (centeredDomain) {
        return {
          xIndex: storedXIndex,
          seebeckIndex: storedSeebeckIndex,
          xReference: 0,
          seebeckReference: 0,
        };
      }
    }
  }
  if (rawXIndex < 0 || rawSeebeckIndex < 0) {
    return {
      xIndex: storedXIndex >= 0 ? storedXIndex : 0,
      seebeckIndex: storedSeebeckIndex,
      xReference: 0,
      seebeckReference: 0,
    };
  }

  const temperatures = [...new Set(values.map((row) => row[temperatureIndex]).filter(Number.isFinite))];
  const series = temperatures.map((temperature) => values
    .filter((row) => row[temperatureIndex] === temperature && Number.isFinite(row[rawXIndex]) && Number.isFinite(row[rawSeebeckIndex]))
    .map((row): ScientificPlotPoint => [row[rawXIndex], row[rawSeebeckIndex]])
    .sort((left, right) => left[0] - right[0]))
    .filter((points) => points.length >= 2);
  if (series.length < 2) {
    return { xIndex: rawXIndex, seebeckIndex: rawSeebeckIndex, xReference: 0, seebeckReference: 0 };
  }

  const crossings = series.flatMap((points) => {
    const candidates = zeroCrossings(points);
    return candidates.length ? [candidates.reduce((closest, value) => Math.abs(value) < Math.abs(closest) ? value : closest)] : [];
  });
  const overlapMin = Math.max(...series.map((points) => points[0][0]));
  const overlapMax = Math.min(...series.map((points) => points[points.length - 1][0]));
  if (!(overlapMax > overlapMin)) {
    return { xIndex: rawXIndex, seebeckIndex: rawSeebeckIndex, xReference: 0, seebeckReference: 0 };
  }

  const center = crossings.length ? median(crossings) : 0;
  const crossingSpan = crossings.length > 1 ? Math.max(...crossings) - Math.min(...crossings) : 0;
  const halfWidth = Math.max(0.05, crossingSpan * 0.75);
  const focusMin = crossings.length ? Math.max(overlapMin, center - halfWidth) : overlapMin;
  const focusMax = crossings.length ? Math.min(overlapMax, center + halfWidth) : overlapMax;
  const gridMin = focusMax > focusMin ? focusMin : overlapMin;
  const gridMax = focusMax > focusMin ? focusMax : overlapMax;
  let xReference = center;
  let referenceValues = series.map((points) => interpolate(points, center)).filter(Number.isFinite);
  let bestSpread = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= 2048; index += 1) {
    const x = gridMin + (gridMax - gridMin) * index / 2048;
    const interpolated = series.map((points) => interpolate(points, x)).filter(Number.isFinite);
    if (interpolated.length !== series.length) continue;
    const spread = Math.max(...interpolated) - Math.min(...interpolated);
    if (spread < bestSpread - 1e-9 || (Math.abs(spread - bestSpread) <= 1e-9 && Math.abs(x - center) < Math.abs(xReference - center))) {
      bestSpread = spread;
      xReference = x;
      referenceValues = interpolated;
    }
  }
  return {
    xIndex: rawXIndex,
    seebeckIndex: rawSeebeckIndex,
    xReference,
    seebeckReference: referenceValues.length ? referenceValues.reduce((sum, value) => sum + value, 0) / referenceValues.length : 0,
  };
}

export function parseScientificPlotCsv(source: string, calculationType?: string): ScientificPlotData {
  const { headers, values } = numericTable(source);
  const normalizedType = calculationType?.toLowerCase() ?? '';
  const first = headers[0].toLowerCase();

  if (first === 'reaction_coordinate' && headers.includes('relative_energy_ev')) return { kind:'generic', title:'Minimum energy path', xLabel:'Normalized reaction coordinate', quantities:[{id:'neb-mep',label:'Minimum energy path',yLabel:'Energy relative to initial state (eV)',series:columnSeries(headers,values,0,[headers.indexOf('relative_energy_ev')])},{id:'neb-error',label:'Image convergence',yLabel:'Path error (eV/Å)',series:columnSeries(headers,values,0,[headers.indexOf('path_error_ev_per_a')])}] };
  if (normalizedType.includes('thermoelectric') || headers.includes('temperature_k')) {
    const temperatureIndex = headers.indexOf('temperature_k');
    if (temperatureIndex < 0) throw new Error('Thermoelectric CSV is missing temperature data');
    const reference = thermoelectricPlotReference(headers, values, temperatureIndex);
    const quantityDefinitions = [
      ['seebeck_uv_per_k_relative_to_plot_reference', 'Seebeck coefficient', 'Seebeck (μV/K)'],
      ['conductivity_s_per_m', 'Electrical conductivity', 'Conductivity (S/m)'],
      ['power_factor_mw_per_m_k2', 'Power factor', 'Power factor (mW m⁻¹ K⁻²)'],
      ['electronic_thermal_conductivity_w_per_m_k', 'Electronic thermal conductivity', 'κₑ (W m⁻¹ K⁻¹)'],
    ] as const;
    const temperatures = [...new Set(values.map((row) => row[temperatureIndex]).filter(Number.isFinite))].sort((a, b) => a - b);
    const quantities = quantityDefinitions.flatMap(([id, label, yLabel]) => {
      const useRecomputedSeebeck = id === 'seebeck_uv_per_k_relative_to_plot_reference' && reference.seebeckIndex >= 0;
      const yIndex = useRecomputedSeebeck ? reference.seebeckIndex : headers.indexOf(id);
      if (yIndex < 0) return [];
      return [{
        id,
        label,
        yLabel,
        series: temperatures.map((temperature) => ({
          id: `${id}-${temperature}`,
          label: `${temperature} K`,
          points: values
            .filter((row) => row[temperatureIndex] === temperature)
            .map((row): ScientificPlotPoint => [
              row[reference.xIndex] - reference.xReference,
              row[yIndex] - (useRecomputedSeebeck ? reference.seebeckReference : 0),
            ])
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
            .sort((left, right) => left[0] - right[0]),
        })),
      }];
    });
    if (!quantities.length) throw new Error('Thermoelectric CSV has no supported quantities');
    return {
      kind: 'thermoelectric',
      title: 'Thermoelectric properties',
      xLabel: 'Chemical potential μ − μ₀ (eV)',
      quantities,
    };
  }

  if (normalizedType.includes('band') || first === 'k_distance') {
    const fermiRelative = headers.slice(1).every((header) => /_ev_relative_to_fermi$/i.test(header));
    return {
      kind: 'band',
      energyReference: fermiRelative ? 'fermi' : 'unknown',
      title: 'Electronic band structure',
      xLabel: 'k-path coordinate',
      quantities: [{
        id: 'bands',
        label: 'Bands',
        yLabel: fermiRelative ? 'Energy E − Eᶠ (eV)' : 'Energy (reference unspecified)',
        series: columnSeries(headers, values, 0, headers.slice(1).map((_, index) => index + 1)),
      }],
    };
  }

  if (normalizedType.includes('phonon') || first === 'q_distance') {
    return {
      kind: 'phonon',
      title: 'Phonon dispersion',
      xLabel: 'q-path coordinate',
      quantities: [{
        id: 'phonons',
        label: 'Phonon modes',
        yLabel: 'Frequency (cm⁻¹)',
        series: columnSeries(headers, values, 0, headers.slice(1).map((_, index) => index + 1)),
      }],
    };
  }

  if (normalizedType.includes('density') || first.includes('energy_ev')) {
    const dosIndices = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header, index }) => index > 0 && header.includes('dos') && !header.includes('integrated'))
      .map(({ index }) => index);
    const spinIndices = dosIndices.filter((index) => headers[index].includes('dos_up') || headers[index].includes('dos_down'));
    const yIndices = spinIndices.length >= 2 ? spinIndices : dosIndices;
    const dosSeries = columnSeries(headers, values, 0, yIndices, (value, header) => header.includes('dos_down') ? -Math.abs(value) : value)
      .map((series) => ({
        ...series,
        label: series.id.includes('dos_up')
          ? 'Spin up'
          : series.id.includes('dos_down')
            ? 'Spin down'
            : 'Total DOS',
      }));
    return {
      kind: 'dos',
      energyReference: first === 'energy_ev_relative_to_fermi' ? 'fermi' : 'unknown',
      title: 'Density of States',
      xLabel: first === 'energy_ev_relative_to_fermi' ? 'Energy E − Eᶠ (eV)' : 'Energy (reference unspecified)',
      quantities: [{
        id: 'dos',
        label: 'Density of states',
        yLabel: 'DOS (states/eV)',
        series: dosSeries,
      }],
    };
  }

  return {
    kind: 'generic',
    title: calculationType || 'Calculation result',
    xLabel: humanizeHeader(headers[0]),
    quantities: [{
      id: 'result',
      label: 'Result',
      yLabel: humanizeHeader(headers[1]),
      series: columnSeries(headers, values, 0, headers.slice(1).map((_, index) => index + 1)),
    }],
  };
}

export function defaultScientificPlotSettings(data: ScientificPlotData): ScientificPlotSettings {
  const quantity = data.quantities[0];
  const seriesStyles = Object.fromEntries(data.quantities.flatMap((candidate) => candidate.series.map((series) => [series.id, {
    visible: true,
    label: series.label,
    color: null,
    lineWidth: null,
    lineStyle: 'solid' as const,
    marker: 'none' as const,
    markerSize: 4,
  }])));
  return {
    layout: 'single',
    pairedJobId: null,
    combinedEnergyMin: null,
    combinedEnergyMax: null,
    combinedDosMin: null,
    combinedDosMax: null,
    combinedDosWidthPercent: 28,
    title: data.title,
    xLabel: data.xLabel,
    yLabel: quantity.yLabel,
    quantityId: quantity.id,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    xScale: 'linear',
    yScale: 'linear',
    xTickCount: 6,
    yTickCount: 6,
    tickFormat: 'auto',
    tickDecimals: 2,
    width: 1200,
    height: 800,
    exportScale: 2,
    lineWidth: data.kind === 'band' || data.kind === 'phonon' ? 1.35 : 2.2,
    palette: data.kind === 'thermoelectric' ? 'colorblind' : 'graphite',
    theme: 'paper',
    fontFamily: 'sans',
    titleFontSize: 25,
    labelFontSize: 20,
    tickFontSize: 17,
    subtitle: '',
    showGrid: true,
    showMinorGrid: false,
    showLegend: data.kind === 'dos' || data.kind === 'thermoelectric',
    legendPosition: 'top',
    showFrame: true,
    showXZero: data.kind === 'thermoelectric',
    showYZero: data.kind === 'band' || data.kind === 'phonon' || data.kind === 'thermoelectric',
    xReference: data.kind === 'dos' ? 0 : null,
    yReference: null,
    referenceLabel: data.kind === 'dos' ? 'Fermi energy (Eᶠ = 0 eV)' : '',
    seriesStyles,
  };
}

export function mergeScientificPlotSettings(
  defaults: ScientificPlotSettings,
  saved: Partial<ScientificPlotSettings>,
): ScientificPlotSettings {
  const savedStyles = saved.seriesStyles ?? {};
  const seriesStyles = {
    ...savedStyles,
    ...Object.fromEntries(Object.entries(defaults.seriesStyles).map(([id, style]) => [
      id,
      { ...style, ...(savedStyles[id] ?? {}) },
    ])),
  };
  return { ...defaults, ...saved, seriesStyles };
}

export function plotSeriesColor(settings: ScientificPlotSettings, seriesIndex: number, customColor?: string | null) {
  return customColor || PALETTES[settings.palette][seriesIndex % PALETTES[settings.palette].length];
}

function finiteExtent(values: number[]): [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1];
  if (minimum === maximum) {
    const padding = Math.abs(minimum) > 0 ? Math.abs(minimum) * 0.1 : 1;
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function valuesForScale(values: number[], scale: PlotAxisScale) {
  return scale === 'log' ? values.filter((value) => value > 0) : values;
}

function resolveBounds(data: ScientificPlotData, settings: ScientificPlotSettings) {
  const quantity = data.quantities.find((candidate) => candidate.id === settings.quantityId) ?? data.quantities[0];
  const visibleSeries = quantity.series.filter((series) => settings.seriesStyles[series.id]?.visible !== false);
  if (!visibleSeries.length) throw new Error('At least one data series must remain visible');
  const points = visibleSeries.flatMap((series) => series.points);
  const xValues = valuesForScale(points.map(([x]) => x), settings.xScale);
  const yValues = valuesForScale(points.map(([, y]) => y), settings.yScale);
  if (!xValues.length || !yValues.length) throw new Error('Logarithmic axes require positive data values');
  let [xMin, xMax] = finiteExtent(xValues);
  let [yMin, yMax] = finiteExtent(yValues);
  if (
    settings.xScale === 'linear'
    && settings.xMin === null
    && settings.xMax === null
    && (data.kind === 'dos' || data.kind === 'thermoelectric')
  ) {
    const halfWidth = data.kind === 'thermoelectric' && xMin < 0 && xMax > 0
      ? Math.min(Math.abs(xMin), Math.abs(xMax))
      : Math.max(Math.abs(xMin), Math.abs(xMax));
    xMin = -halfWidth;
    xMax = halfWidth;
  }
  // The horizontal domain follows the sampled data exactly. Adding aesthetic
  // padding here creates visible gaps between the curve endpoints and frame,
  // which reads as a broken or truncated scientific trace.
  if (settings.yScale === 'log') {
    yMin /= 1.12;
    yMax *= 1.12;
  } else {
    const yPadding = (yMax - yMin) * 0.08;
    yMin -= yPadding;
    yMax += yPadding;
    if (data.kind === 'dos' && yMin >= -yPadding * 1.1) yMin = 0;
  }
  return {
    quantity,
    visibleSeries,
    xMin: settings.xMin ?? xMin,
    xMax: settings.xMax ?? xMax,
    yMin: settings.yMin ?? yMin,
    yMax: settings.yMax ?? yMax,
  };
}

function niceTicks(minimum: number, maximum: number, target = 6) {
  const span = Math.max(Number.EPSILON, maximum - minimum);
  const rawStep = span / target;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * power;
  const first = Math.ceil(minimum / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maximum + step * 1e-8 && ticks.length < 20; value += step) ticks.push(value);
  return ticks;
}

function logarithmicTicks(minimum: number, maximum: number) {
  const firstPower = Math.ceil(Math.log10(minimum));
  const lastPower = Math.floor(Math.log10(maximum));
  const ticks: number[] = [];
  for (let power = firstPower; power <= lastPower && ticks.length < 16; power += 1) ticks.push(10 ** power);
  if (!ticks.length) ticks.push(minimum, maximum);
  return ticks;
}

function axisTicks(minimum: number, maximum: number, target: number, scale: PlotAxisScale) {
  return scale === 'log' ? logarithmicTicks(minimum, maximum) : niceTicks(minimum, maximum, target);
}

function minorTicks(major: number[], minimum: number, maximum: number, scale: PlotAxisScale) {
  if (scale === 'log') {
    const ticks: number[] = [];
    const firstPower = Math.floor(Math.log10(minimum));
    const lastPower = Math.ceil(Math.log10(maximum));
    for (let power = firstPower; power <= lastPower && ticks.length < 80; power += 1) {
      for (let multiplier = 2; multiplier <= 9; multiplier += 1) {
        const value = multiplier * 10 ** power;
        if (value > minimum && value < maximum) ticks.push(value);
      }
    }
    return ticks;
  }
  return major.slice(0, -1).map((value, index) => (value + major[index + 1]) / 2);
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

export function kPointSymbol(label: string): string {
  return label.replace(/\\?\bgamma(?=$|[^a-z])/gi, '\u0393').replace(/\$([^$]+)\$/g, '$1');
}

function formatTick(value: number, format: PlotTickFormat, decimals: number) {
  if (format === 'scientific') return value.toExponential(Math.max(0, Math.min(6, decimals)));
  if (format === 'fixed') return value.toFixed(Math.max(0, Math.min(6, decimals)));
  const absolute = Math.abs(value);
  if ((absolute >= 10_000 || absolute > 0 && absolute < 0.001)) return value.toExponential(1);
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 1) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function sampledPoints(points: ScientificPlotPoint[], limit = 1800) {
  if (points.length <= limit) return points;
  const stride = Math.ceil(points.length / limit);
  return points.filter((_, index) => index % stride === 0 || index === points.length - 1);
}

type SinglePlotRenderOptions = {
  clipId?: string;
  centerTitle?: boolean;
  compact?: boolean;
  hideXLabel?: boolean;
  minimumWidth?: number;
  minimumHeight?: number;
  publication?: boolean;
  topMargin?: number;
  bottomMargin?: number;
  leftMargin?: number;
  rightMargin?: number;
};

function publicationTitleLines(settings: ScientificPlotSettings) {
  return settings.title.trim() ? wrappedFigureText(settings.title.trim(), settings.titleFontSize, Math.max(60, settings.width - settings.labelFontSize * 5.3)) : [];
}

function publicationTitleSpace(settings: ScientificPlotSettings) {
  const lines = publicationTitleLines(settings);
  return lines.length ? settings.titleFontSize * (2.3 + (lines.length - 1) * 1.2) : settings.tickFontSize;
}

export function scientificPanelHeader(data: ScientificPlotData, settings: ScientificPlotSettings): number {
  const { visibleSeries } = resolveBounds(data, settings);
  const entries = visibleSeries.filter((series, index) => !series.legendGroup || visibleSeries.findIndex((item) => item.legendGroup === series.legendGroup) === index);
  const font = settings.tickFontSize;
  const available = Math.max(60, settings.width - settings.labelFontSize * 5.3);
  const lines = entries.map((series) => wrappedFigureText(settings.seriesStyles[series.id]?.label || series.label, font, available - font * 3));
  return publicationTitleSpace(settings) + (settings.showLegend && entries.length > 1 ? lines.reduce((count, entry) => count + entry.length, 0) * font * 1.5 + font : 0);
}

export function renderScientificPlotPanelSvg(data: ScientificPlotData, settings: ScientificPlotSettings, margins: { top: number; bottom: number; left: number; right: number }): string {
  return renderSingleScientificPlotSvg(data, settings, { publication: true, topMargin: margins.top, bottomMargin: margins.bottom, leftMargin: margins.left, rightMargin: margins.right });
}

function renderSingleScientificPlotSvg(data: ScientificPlotData, settings: ScientificPlotSettings, options: SinglePlotRenderOptions = {}) {
  const width = Math.max(options.minimumWidth ?? 480, Math.min(6000, Math.round(settings.width)));
  const height = Math.max(options.minimumHeight ?? 360, Math.min(6000, Math.round(settings.height)));
  const { quantity, visibleSeries, xMin, xMax, yMin, yMax } = resolveBounds(data, settings);
  if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('Plot limits must have increasing minimum and maximum values');
  if ((settings.xScale === 'log' && xMin <= 0) || (settings.yScale === 'log' && yMin <= 0)) throw new Error('Logarithmic axis limits must be greater than zero');
  const referenceLegendVisible = data.kind === 'dos'
    && settings.xReference !== null
    && settings.xReference >= xMin
    && settings.xReference <= xMax
    && (settings.xScale !== 'log' || settings.xReference > 0)
    && settings.referenceLabel.trim().length > 0;
  const legendSeries = visibleSeries.filter((series, index) => !series.legendGroup || visibleSeries.findIndex((item) => item.legendGroup === series.legendGroup) === index);
  const legendVisible = settings.showLegend && (legendSeries.length > 1 || referenceLegendVisible);
  const legendEntryCount = legendSeries.length + (referenceLegendVisible ? 1 : 0);
  const legendColumns = Math.max(1, Math.floor((width - 160) / 180));
  const visibleLegendSeries = legendSeries.slice(0, Math.min(16, legendColumns * 3));
  const legendRows = Math.ceil(Math.min(legendEntryCount, legendColumns * 3) / legendColumns);
  const topLegendSpace = legendVisible && settings.legendPosition === 'top' ? Math.min(3, legendRows) * 25 + 10 : 0;
  const compact = options.compact === true;
  const margin = {
    left: options.leftMargin ?? (compact ? Math.max(70, settings.labelFontSize * 4.2) : Math.max(92, settings.labelFontSize * 4.8)),
    right: options.rightMargin ?? (legendVisible && settings.legendPosition === 'right' ? (compact ? 150 : 220) : (compact ? 26 : 42)),
    top: options.topMargin ?? ((compact ? 54 : 74) + (settings.subtitle.trim() ? 22 : 0) + topLegendSpace),
    bottom: options.bottomMargin ?? (options.hideXLabel ? 44 : compact ? Math.max(60, settings.labelFontSize * 3.8) : Math.max(78, settings.labelFontSize * 4.1)),
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  if (plotWidth < 25 || plotHeight < 25) throw new Error('Text and legend leave too little plotting space. Enlarge the panel, shorten labels, hide the legend or reduce font size.');
  const transform = (value: number, scale: PlotAxisScale) => scale === 'log' ? Math.log10(value) : value;
  const transformedXMin = transform(xMin, settings.xScale);
  const transformedXMax = transform(xMax, settings.xScale);
  const transformedYMin = transform(yMin, settings.yScale);
  const transformedYMax = transform(yMax, settings.yScale);
  const mapX = (value: number) => margin.left + (transform(value, settings.xScale) - transformedXMin) / (transformedXMax - transformedXMin) * plotWidth;
  const mapY = (value: number) => margin.top + (transformedYMax - transform(value, settings.yScale)) / (transformedYMax - transformedYMin) * plotHeight;
  const xTicks = data.xTicks ? data.xTicks.filter((tick) => tick.value >= xMin && tick.value <= xMax).map((tick) => tick.value) : axisTicks(xMin, xMax, Math.max(2, Math.min(12, settings.xTickCount)), settings.xScale);
  const yTicks = axisTicks(yMin, yMax, Math.max(2, Math.min(12, settings.yTickCount)), settings.yScale);
  const xMinorTicks = settings.showMinorGrid ? minorTicks(xTicks, xMin, xMax, settings.xScale) : [];
  const yMinorTicks = settings.showMinorGrid ? minorTicks(yTicks, yMin, yMax, settings.yScale) : [];
  const dark = settings.theme === 'dark';
  const background = dark ? '#111318' : settings.theme === 'warm-paper' ? '#fbfaf7' : '#ffffff';
  const transparent = settings.theme === 'transparent';
  const foreground = dark ? '#e8ebef' : '#252a35';
  const muted = dark ? '#9199a4' : '#697180';
  const grid = dark ? '#2a2e35' : '#dfe2e7';
  const minorGrid = dark ? '#20242a' : '#eef0f3';
  const palette = PALETTES[settings.palette];
  const monochromeDispersion = data.kind === 'band' || data.kind === 'phonon';
  const title = options.publication ? settings.title.trim() : settings.title.trim() || data.title;
  const xLabel = options.publication ? settings.xLabel.trim() : settings.xLabel.trim() || data.xLabel;
  const yLabel = options.publication ? settings.yLabel.trim() : settings.yLabel.trim() || quantity.yLabel;
  const font = options.publication ? ({ sans: 'DejaVu Sans', serif: 'DejaVu Serif', mono: 'DejaVu Sans Mono' }[settings.fontFamily]) : settings.fontFamily === 'serif'
    ? 'Georgia, Times New Roman, serif'
    : settings.fontFamily === 'mono'
      ? 'var(--font-code), SFMono-Regular, Consolas, Liberation Mono, monospace'
      : 'var(--font-ui), Arial, Helvetica, sans-serif';
  const dashPatterns: Record<PlotLineStyle, string | null> = { solid: null, dash: '10 6', dot: '2 5', dashdot: '10 5 2 5' };
  const lines = visibleSeries.map((series, index) => {
    const style = settings.seriesStyles[series.id];
    let segmentOpen = false;
    if (series.weights) {
      const maximum = series.weightScale === 'absolute' ? 1 : series.weights.reduce((maximum, weight) => Math.max(maximum, weight), 1e-12);
      const color = style?.color || palette[index % palette.length];
      let baseOpen = false;
      const basePath = series.weightScale === 'absolute' ? series.points.map(([x,y]) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || settings.xScale === 'log' && x <= 0 || settings.yScale === 'log' && y <= 0) { baseOpen = false; return ''; }
        const command = baseOpen ? 'L' : 'M'; baseOpen = true;
        return `${command}${mapX(x).toFixed(2)},${mapY(y).toFixed(2)}`;
      }).join(' ') : '';
      const baseLine = basePath ? `<path data-projected-band-outline="${escapeXml(series.id)}" d="${basePath}" fill="none" stroke="${color}" stroke-width="${style?.lineWidth ?? settings.lineWidth}" opacity="0.35"/>` : '';
      return `<g data-spectral-weight="${escapeXml(series.id)}"><title>Spectral weights; marker area normalized to maximum ${maximum}</title>${baseLine}${series.points.map(([x, y], pointIndex) => Number.isFinite(x) && Number.isFinite(y) && series.weights![pointIndex] > 0 ? `<circle cx="${mapX(x)}" cy="${mapY(y)}" r="${Math.sqrt(series.weights![pointIndex] / maximum) * 4}" fill="${color}"/>` : '').join('')}</g>`;
    }
    // This SVG is also the publication export: retain every point and gap.
    const path = series.points.map(([x, y]) => {
      const valid = Number.isFinite(x) && Number.isFinite(y) && (settings.xScale !== 'log' || x > 0) && (settings.yScale !== 'log' || y > 0);
      if (!valid) {
        segmentOpen = false;
        return '';
      }
      const command = segmentOpen ? 'L' : 'M';
      segmentOpen = true;
      return `${command}${mapX(x).toFixed(2)},${mapY(y).toFixed(2)}`;
    }).join(' ');
    const color = style?.color || palette[monochromeDispersion ? 0 : index % palette.length];
    const lineWidth = style?.lineWidth ?? settings.lineWidth;
    const dash = dashPatterns[style?.lineStyle ?? 'solid'];
    const pointSample = style?.marker && style.marker !== 'none'
      ? sampledPoints(series.points.filter(([x, y]) => x >= xMin && x <= xMax && y >= yMin && y <= yMax && (settings.xScale !== 'log' || x > 0) && (settings.yScale !== 'log' || y > 0)), 28)
      : [];
    const markers = pointSample.map(([x, y]) => {
      const markerSize = style?.markerSize ?? 4;
      const cx = mapX(x);
      const cy = mapY(y);
      const markerFill = transparent ? 'none' : background;
      if (style?.marker === 'square') return `<rect x="${cx - markerSize}" y="${cy - markerSize}" width="${markerSize * 2}" height="${markerSize * 2}" fill="${markerFill}" stroke="${color}" stroke-width="1.4"/>`;
      if (style?.marker === 'diamond') return `<path d="M${cx},${cy - markerSize * 1.25} L${cx + markerSize * 1.25},${cy} L${cx},${cy + markerSize * 1.25} L${cx - markerSize * 1.25},${cy} Z" fill="${markerFill}" stroke="${color}" stroke-width="1.4"/>`;
      return `<circle cx="${cx}" cy="${cy}" r="${markerSize}" fill="${markerFill}" stroke="${color}" stroke-width="1.4"/>`;
    }).join('');
    return `<g data-series="${escapeXml(series.id)}"><path d="${path}" fill="none" stroke="${color}" stroke-width="${lineWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${markers}</g>`;
  }).join('');
  const gridLines = settings.showGrid ? [
    ...xTicks.map((tick) => `<line x1="${mapX(tick)}" y1="${margin.top}" x2="${mapX(tick)}" y2="${margin.top + plotHeight}" stroke="${grid}" stroke-width="1"/>`),
    ...yTicks.map((tick) => `<line x1="${margin.left}" y1="${mapY(tick)}" x2="${margin.left + plotWidth}" y2="${mapY(tick)}" stroke="${grid}" stroke-width="1"/>`),
  ].join('') : '';
  const minorGridLines = settings.showMinorGrid ? [
    ...xMinorTicks.map((tick) => `<line x1="${mapX(tick)}" y1="${margin.top}" x2="${mapX(tick)}" y2="${margin.top + plotHeight}" stroke="${minorGrid}" stroke-width="0.8"/>`),
    ...yMinorTicks.map((tick) => `<line x1="${margin.left}" y1="${mapY(tick)}" x2="${margin.left + plotWidth}" y2="${mapY(tick)}" stroke="${minorGrid}" stroke-width="0.8"/>`),
  ].join('') : '';
  const zeroLines = `${settings.showXZero && settings.xScale === 'linear' && xMin < 0 && xMax > 0 ? `<line x1="${mapX(0)}" y1="${margin.top}" x2="${mapX(0)}" y2="${margin.top + plotHeight}" stroke="${muted}" stroke-width="1.2" stroke-dasharray="6 5"/>` : ''}${settings.showYZero && settings.yScale === 'linear' && yMin < 0 && yMax > 0 ? `<line x1="${margin.left}" y1="${mapY(0)}" x2="${margin.left + plotWidth}" y2="${mapY(0)}" stroke="${muted}" stroke-width="1.2" stroke-dasharray="6 5"/>` : ''}`;
  const xReferenceVisible = settings.xReference !== null
    && settings.xReference >= xMin
    && settings.xReference <= xMax
    && (settings.xScale !== 'log' || settings.xReference > 0);
  const xReferenceLine = xReferenceVisible ? `<g aria-label="${escapeXml(settings.referenceLabel || 'X reference')}">${data.kind === 'dos' ? `<line x1="${mapX(settings.xReference!)}" y1="${margin.top}" x2="${mapX(settings.xReference!)}" y2="${margin.top + plotHeight}" stroke="${background}" stroke-width="4.2" stroke-opacity="0.94"/>` : ''}<line x1="${mapX(settings.xReference!)}" y1="${margin.top}" x2="${mapX(settings.xReference!)}" y2="${margin.top + plotHeight}" stroke="#c04d44" stroke-width="1.5" stroke-dasharray="8 5"/>${settings.referenceLabel && !referenceLegendVisible ? `<text x="${mapX(settings.xReference!) + 7}" y="${margin.top + 18}" fill="#c04d44" font-size="${Math.max(11, settings.tickFontSize - 2)}">${escapeXml(settings.referenceLabel)}</text>` : ''}</g>` : '';
  const yReferenceLine = settings.yReference !== null && settings.yReference >= yMin && settings.yReference <= yMax && (settings.yScale !== 'log' || settings.yReference > 0) ? `<line x1="${margin.left}" y1="${mapY(settings.yReference)}" x2="${margin.left + plotWidth}" y2="${mapY(settings.yReference)}" stroke="#c04d44" stroke-width="1.4" stroke-dasharray="8 5"/>${settings.referenceLabel ? `<text x="${margin.left + 7}" y="${mapY(settings.yReference) - 7}" fill="#c04d44" font-size="${Math.max(11, settings.tickFontSize - 2)}">${escapeXml(settings.referenceLabel)}</text>` : ''}` : '';
  const referenceLines = `${xReferenceLine}${yReferenceLine}`;
  const tickLabels = [
    ...xTicks.map((tick) => `<text x="${mapX(tick)}" y="${margin.top + plotHeight + settings.tickFontSize + 12}" text-anchor="middle" fill="${muted}" font-size="${settings.tickFontSize}">${escapeXml(kPointSymbol(data.xTicks?.find((item) => item.value === tick)?.label ?? formatTick(tick, settings.tickFormat, settings.tickDecimals)))}</text>`),
    ...yTicks.map((tick) => `<text x="${margin.left - 18}" y="${mapY(tick) + settings.tickFontSize * 0.34}" text-anchor="end" fill="${muted}" font-size="${settings.tickFontSize}">${escapeXml(formatTick(tick, settings.tickFormat, settings.tickDecimals))}</text>`),
  ].join('');
  const legendItem = (series: ScientificPlotSeries, originalIndex: number, x: number, y: number) => {
    const style = settings.seriesStyles[series.id];
    const color = plotSeriesColor(settings, monochromeDispersion ? 0 : originalIndex, style?.color);
    const label = style?.label.trim() || series.label;
    return `<g transform="translate(${x},${y})"><line x1="0" y1="0" x2="28" y2="0" stroke="${color}" stroke-width="${Math.max(2, style?.lineWidth ?? settings.lineWidth)}"/><text x="38" y="5" fill="${foreground}" font-size="${Math.max(12, settings.tickFontSize - 2)}">${escapeXml(label)}</text></g>`;
  };
  const referenceLegendItem = (x: number, y: number) => `<g transform="translate(${x},${y})"><line x1="0" y1="0" x2="28" y2="0" stroke="${background}" stroke-width="4.2"/><line x1="0" y1="0" x2="28" y2="0" stroke="#c04d44" stroke-width="1.5" stroke-dasharray="8 5"/><text x="38" y="5" fill="${foreground}" font-size="${Math.max(12, settings.tickFontSize - 2)}">${escapeXml(settings.referenceLabel)}</text></g>`;
  const legendItems = [
    ...visibleLegendSeries.map((series) => ({ kind: 'series' as const, series })),
    ...(referenceLegendVisible ? [{ kind: 'reference' as const }] : []),
  ].slice(0, Math.min(16, legendColumns * 3));
  const renderLegendItem = (entry: typeof legendItems[number], index: number, x: number, y: number) => entry.kind === 'reference'
    ? referenceLegendItem(x, y)
    : legendItem(entry.series, quantity.series.indexOf(entry.series), x, y);
  let legend = '';
  if (legendVisible) {
    if (options.publication) {
      let y = publicationTitleSpace(settings);
      const fontSize = settings.tickFontSize;
      legend = `<g data-legend="outside">${legendSeries.map((series) => {
        const style = settings.seriesStyles[series.id];
        const label = style?.label || series.label;
        const rows = wrappedFigureText(label, fontSize, width - settings.labelFontSize * 5.3 - fontSize * 3);
        const top = y; y += rows.length * fontSize * 1.5;
        const dash = dashPatterns[style?.lineStyle ?? 'solid'];
        return `<g transform="translate(${margin.left},${top})"><line x1="0" y1="${-fontSize * .3}" x2="${fontSize * 2}" y2="${-fontSize * .3}" stroke="${escapeXml(style?.color || '#252a35')}" stroke-width="${style?.lineWidth ?? settings.lineWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${fontSize * 2.7}" fill="${foreground}" font-size="${fontSize}">${rows.map((row, index) => `<tspan x="${fontSize * 2.7}" dy="${index ? fontSize * 1.5 : 0}">${escapeXml(row)}</tspan>`).join('')}</text></g>`;
      }).join('')}</g>`;
    } else if (settings.legendPosition === 'top') {
      const legendY = (compact ? 51 : 68) + (settings.subtitle.trim() ? 22 : 0);
      legend = `<g>${legendItems.map((entry, index) => renderLegendItem(entry, index, margin.left + index % legendColumns * 180, legendY + Math.floor(index / legendColumns) * 25)).join('')}</g>`;
    } else if (settings.legendPosition === 'right') {
      legend = `<g>${legendItems.map((entry, index) => renderLegendItem(entry, index, width - (compact ? 140 : 190), margin.top + 14 + index * 25)).join('')}</g>`;
    } else {
      const insideWidth = 186;
      const insideHeight = legendItems.length * 25 + 18;
      const insideX = settings.legendPosition === 'inside-ne' ? margin.left + plotWidth - insideWidth - 14 : margin.left + 14;
      const insideY = margin.top + 14;
      legend = `<g><rect x="${insideX}" y="${insideY}" width="${insideWidth}" height="${insideHeight}" rx="3" fill="${background}" fill-opacity="0.9" stroke="${grid}"/>${legendItems.map((entry, index) => renderLegendItem(entry, index, insideX + 12, insideY + 20 + index * 25)).join('')}</g>`;
    }
  }
  const frame = settings.showFrame ? `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${foreground}" stroke-width="1.5"/>` : `<line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="${foreground}" stroke-width="1.5"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="${foreground}" stroke-width="1.5"/>`;
  const backgroundRect = transparent ? '' : `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`;
  const subtitle = settings.subtitle.trim() ? `<text x="${margin.left}" y="63" fill="${muted}" font-size="${Math.max(12, settings.tickFontSize - 2)}">${escapeXml(settings.subtitle.trim())}</text>` : '';
  const clipId = options.clipId || 'plot-area';
  const centerTitle = options.centerTitle || data.kind === 'dos';
  const titleX = centerTitle ? width / 2 : margin.left;
  const titleAnchor = centerTitle ? ' text-anchor="middle"' : '';
  const xAxisLabel = options.hideXLabel ? '' : `<text x="${margin.left + plotWidth / 2}" y="${options.publication ? height - settings.labelFontSize * .35 : height - 24}" text-anchor="middle" fill="${foreground}" font-size="${settings.labelFontSize}">${escapeXml(xLabel)}</text>`;
  const titleY = options.publication ? settings.titleFontSize * 1.2 : 39;
  const titleContent = options.publication ? publicationTitleLines(settings).map((line, index) => `<tspan x="${titleX}" dy="${index ? settings.titleFontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('') : escapeXml(title);
  const yTitleX = options.publication ? settings.labelFontSize : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><defs><clipPath id="${clipId}"><rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}"/></clipPath></defs>${backgroundRect}<g font-family="${font}"><text x="${titleX}" y="${titleY}"${titleAnchor} fill="${foreground}" font-size="${settings.titleFontSize}" font-weight="${options.publication ? 700 : 600}">${titleContent}</text>${subtitle}<g clip-path="url(#${clipId})">${minorGridLines}${gridLines}${zeroLines}</g>${frame}<g clip-path="url(#${clipId})">${lines}${referenceLines}</g>${tickLabels}${xAxisLabel}<text x="${yTitleX}" y="${margin.top + plotHeight / 2}" text-anchor="middle" fill="${foreground}" font-size="${settings.labelFontSize}" transform="rotate(-90 ${yTitleX} ${margin.top + plotHeight / 2})">${escapeXml(yLabel)}</text>${legend}</g></svg>`;
}

function settingsForQuantity(
  settings: ScientificPlotSettings,
  quantity: ScientificPlotQuantity,
  dimensions?: { width: number; height: number },
) : ScientificPlotSettings {
  const selected = settings.quantityId === quantity.id;
  return {
    ...settings,
    ...(dimensions ?? {}),
    title: quantity.label,
    subtitle: '',
    quantityId: quantity.id,
    yLabel: quantity.yLabel,
    yMin: selected ? settings.yMin : null,
    yMax: selected ? settings.yMax : null,
    yScale: selected ? settings.yScale : 'linear',
  };
}

function nestedSvg(svg: string, x: number, y: number, width: number, height: number) {
  return svg.replace(
    /^<svg[^>]*viewBox="([^"]+)"[^>]*>/,
    `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="$1" overflow="visible">`,
  );
}

function renderThermoelectricCompositeSvg(data: ScientificPlotData, settings: ScientificPlotSettings) {
  const width = Math.max(480, Math.min(6000, Math.round(settings.width)));
  const height = Math.max(360, Math.min(6000, Math.round(settings.height)));
  const dark = settings.theme === 'dark';
  const background = dark ? '#111318' : settings.theme === 'warm-paper' ? '#fbfaf7' : '#ffffff';
  const transparent = settings.theme === 'transparent';
  const foreground = dark ? '#e8ebef' : '#252a35';
  const muted = dark ? '#9199a4' : '#697180';
  const font = settings.fontFamily === 'serif'
    ? 'Georgia, Times New Roman, serif'
    : settings.fontFamily === 'mono'
      ? 'var(--font-code), SFMono-Regular, Consolas, Liberation Mono, monospace'
      : 'var(--font-ui), Arial, Helvetica, sans-serif';
  const title = settings.title.trim() || data.title;
  const subtitle = settings.subtitle.trim();
  const firstQuantity = data.quantities[0];
  const legendSeries = firstQuantity.series.filter((series) => settings.seriesStyles[series.id]?.visible !== false);
  const legendVisible = settings.showLegend && legendSeries.length > 0;
  const headerHeight = subtitle ? 112 : 94;
  const outerPadding = Math.max(6, Math.round(width * 0.008));
  const gap = Math.max(8, Math.round(width * 0.012));
  const panelWidth = (width - outerPadding * 2 - gap) / 2;
  const panelHeight = (height - headerHeight - outerPadding - gap) / 2;
  if (panelWidth < 250 || panelHeight < 170) throw new Error('Thermoelectric 2×2 layout needs a larger figure canvas');
  const fontScale = Math.max(0.56, Math.min(0.78, panelWidth / 780));
  const panelSvgs = data.quantities.slice(0, 4).map((quantity, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const panelSettings = settingsForQuantity(settings, quantity, { width: panelWidth, height: panelHeight });
    panelSettings.showLegend = false;
    panelSettings.titleFontSize = Math.max(13, settings.titleFontSize * fontScale);
    panelSettings.labelFontSize = Math.max(11, settings.labelFontSize * fontScale);
    panelSettings.tickFontSize = Math.max(9, settings.tickFontSize * fontScale);
    const panel = renderSingleScientificPlotSvg(data, panelSettings, {
      centerTitle: true,
      clipId: `plot-area-${index}`,
      compact: true,
      hideXLabel: row === 0,
      minimumWidth: 1,
      minimumHeight: 1,
    });
    return nestedSvg(
      panel,
      outerPadding + column * (panelWidth + gap),
      headerHeight + row * (panelHeight + gap),
      panelWidth,
      panelHeight,
    );
  }).join('');
  const legendItemWidth = Math.max(110, Math.min(180, width / Math.max(1, legendSeries.length + 1)));
  const legendWidth = legendSeries.length * legendItemWidth;
  const legendStart = Math.max(outerPadding, (width - legendWidth) / 2);
  const legendY = subtitle ? 88 : 68;
  const legend = legendVisible ? `<g>${legendSeries.map((series, index) => {
    const style = settings.seriesStyles[series.id];
    const color = plotSeriesColor(settings, index, style?.color);
    const label = style?.label.trim() || series.label;
    return `<g transform="translate(${legendStart + index * legendItemWidth},${legendY})"><line x1="0" y1="0" x2="28" y2="0" stroke="${color}" stroke-width="${Math.max(2, style?.lineWidth ?? settings.lineWidth)}"/><text x="38" y="5" fill="${foreground}" font-size="${Math.max(11, settings.tickFontSize - 2)}">${escapeXml(label)}</text></g>`;
  }).join('')}</g>` : '';
  const backgroundRect = transparent ? '' : `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`;
  const subtitleText = subtitle ? `<text x="${width / 2}" y="62" text-anchor="middle" fill="${muted}" font-size="${Math.max(12, settings.tickFontSize - 2)}">${escapeXml(subtitle)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">${backgroundRect}<g font-family="${font}"><text x="${width / 2}" y="36" text-anchor="middle" fill="${foreground}" font-size="${settings.titleFontSize}" font-weight="600">${escapeXml(title)}</text>${subtitleText}${legend}${panelSvgs}</g></svg>`;
}

export function bandDosEnergyBounds(primary: ScientificPlotData, companion: ScientificPlotData) {
  const band = [primary, companion].find((data) => data.kind === 'band');
  const dos = [primary, companion].find((data) => data.kind === 'dos');
  if (!band || !dos) throw new Error('Combined layout requires one Band structure result and one Density of states result');
  if (band.energyReference !== 'fermi' || dos.energyReference !== 'fermi') {
    throw new Error('Band + DOS requires CSV data explicitly referenced to each calculation’s Fermi energy');
  }
  const energies = (data: ScientificPlotData) => data.quantities[0].series.flatMap((series) => series.points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => data.kind === 'band' ? y : x));
  const bandEnergies = energies(band);
  const dosEnergies = energies(dos);
  if (!bandEnergies.length || !dosEnergies.length) throw new Error('Both panels need finite energy samples');
  const [bandMin, bandMax] = finiteExtent(bandEnergies);
  const [dosMin, dosMax] = finiteExtent(dosEnergies);
  const min = Math.max(bandMin, dosMin);
  const max = Math.min(bandMax, dosMax);
  if (!(max > min)) throw new Error('Band and DOS results do not share an energy range');
  return { min, max };
}

function wrappedFigureText(text: string, fontSize: number, availableWidth: number) {
  const maxCharacters = Math.max(10, Math.floor(availableWidth / (fontSize * 0.58)));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const parts = word.match(new RegExp(`.{1,${maxCharacters}}`, 'g')) ?? [];
    for (const part of parts) {
      if (line && line.length + part.length + 1 > maxCharacters) {
        lines.push(line);
        line = '';
      }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderBandDosCompositeSvg(primary: ScientificPlotData, companion: ScientificPlotData, settings: ScientificPlotSettings) {
  const commonBounds = bandDosEnergyBounds(primary, companion);
  const bandData = primary.kind === 'band' ? primary : companion.kind === 'band' ? companion : null;
  const dosData = primary.kind === 'dos' ? primary : companion.kind === 'dos' ? companion : null;
  if (!bandData || !dosData) throw new Error('Combined layout requires one Band structure result and one Density of states result');

  const bandQuantity = bandData.quantities[0];
  const dosQuantity = dosData.quantities[0];
  const bandSeries = bandQuantity.series.filter((series) => settings.seriesStyles[series.id]?.visible !== false);
  const dosSeries = dosQuantity.series.filter((series) => settings.seriesStyles[series.id]?.visible !== false);
  if (!bandSeries.length || !dosSeries.length) throw new Error('At least one Band and one DOS series must remain visible');

  const bandPoints = bandSeries.flatMap((series) => series.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const dosPoints = dosSeries.flatMap((series) => series.points).filter(([energy, density]) => Number.isFinite(energy) && Number.isFinite(density));
  if (!bandPoints.length || !dosPoints.length) throw new Error('Both visible panels need finite data samples');
  const [kMin, kMax] = finiteExtent(bandPoints.map(([k]) => k));
  const energyMin = settings.combinedEnergyMin ?? commonBounds.min;
  const energyMax = settings.combinedEnergyMax ?? commonBounds.max;
  if (!Number.isFinite(energyMin) || !Number.isFinite(energyMax) || !(energyMax > energyMin)) throw new Error('Combined energy limits must be finite and increasing');

  const visibleDosPoints = dosPoints.filter(([energy]) => energy >= energyMin && energy <= energyMax);
  // Include segment intersections at the viewport edges: a narrow zoom can
  // cross a valid curve even when it contains none of the original samples.
  for (const series of dosSeries) {
    for (let index = 1; index < series.points.length; index += 1) {
      const [e0, d0] = series.points[index - 1];
      const [e1, d1] = series.points[index];
      if (![e0, d0, e1, d1].every(Number.isFinite) || e0 === e1) continue;
      for (const edge of [energyMin, energyMax]) {
        if (edge >= Math.min(e0, e1) && edge <= Math.max(e0, e1)) visibleDosPoints.push([edge, d0 + (d1 - d0) * (edge - e0) / (e1 - e0)]);
      }
    }
  }
  if (!visibleDosPoints.length) throw new Error('The selected energy range contains no DOS samples');
  let [automaticDosMin, automaticDosMax] = finiteExtent(visibleDosPoints.map(([, density]) => density));
  if (automaticDosMin >= 0) automaticDosMin = 0;
  const dosPadding = Math.max(Number.EPSILON, automaticDosMax - automaticDosMin) * 0.06;
  if (automaticDosMin < 0) automaticDosMin -= dosPadding;
  automaticDosMax += dosPadding;
  const dosMin = settings.combinedDosMin ?? automaticDosMin;
  const dosMax = settings.combinedDosMax ?? automaticDosMax;
  if (!Number.isFinite(dosMin) || !Number.isFinite(dosMax) || !(dosMax > dosMin)) throw new Error('Combined DOS limits must be finite and increasing');

  const width = Math.max(480, Math.min(6000, Math.round(settings.width)));
  const height = Math.max(360, Math.min(6000, Math.round(settings.height)));
  const dark = settings.theme === 'dark';
  const background = dark ? '#111318' : settings.theme === 'warm-paper' ? '#fbfaf7' : '#ffffff';
  const transparent = settings.theme === 'transparent';
  const foreground = dark ? '#e8ebef' : '#252a35';
  const muted = dark ? '#9199a4' : '#697180';
  const grid = dark ? '#2a2e35' : '#dfe2e7';
  const palette = PALETTES[settings.palette];
  const font = settings.fontFamily === 'serif'
    ? 'Georgia, Times New Roman, serif'
    : settings.fontFamily === 'mono'
      ? 'var(--font-code), SFMono-Regular, Consolas, Liberation Mono, monospace'
      : 'var(--font-ui), Arial, Helvetica, sans-serif';
  const title = settings.title.trim() || 'Electronic band structure and density of states';
  const subtitle = settings.subtitle.trim();
  const titleLines = wrappedFigureText(title, settings.titleFontSize, width - 48);
  const subtitleFontSize = Math.max(12, settings.tickFontSize - 2);
  const subtitleLines = subtitle ? wrappedFigureText(subtitle, subtitleFontSize, width - 48) : [];
  const titleBaseline = 18 + settings.titleFontSize;
  const titleBottom = titleBaseline + (titleLines.length - 1) * settings.titleFontSize * 1.2;
  const subtitleBaseline = titleBottom + subtitleFontSize + 10;
  const textBottom = subtitleLines.length ? subtitleBaseline + (subtitleLines.length - 1) * subtitleFontSize * 1.3 : titleBottom;
  const fermiVisible = settings.showYZero && energyMin <= 0 && energyMax >= 0;
  const legendFontSize = Math.max(11, settings.tickFontSize - 3);
  const legendEntries = settings.showLegend ? [
    ...dosSeries.map((series, index) => ({
      label: settings.seriesStyles[series.id]?.label || series.label,
      color: settings.seriesStyles[series.id]?.color || palette[index % palette.length],
      dashed: settings.seriesStyles[series.id]?.lineStyle ?? 'solid',
    })),
    ...(fermiVisible ? [{ label: 'Eᶠ = 0 eV', color: '#c04d44', dashed: 'dash' as const }] : []),
  ] : [];
  const margin = {
    left: Math.max(88, settings.labelFontSize * 4.7),
    right: Math.max(34, settings.tickFontSize * 2.2),
    bottom: Math.max(76, settings.labelFontSize * 4),
  };
  const legendWidth = width - margin.left - margin.right;
  const legendPositions: { x: number; y: number; lines: string[] }[] = [];
  let legendX = 0;
  let legendY = textBottom + legendFontSize + 14;
  let legendRowHeight = 0;
  for (const entry of legendEntries) {
    const itemWidth = Math.min(legendWidth, 50 + entry.label.length * legendFontSize * 0.6);
    if (legendX > 0 && legendX + itemWidth > legendWidth) {
      legendX = 0;
      legendY += legendRowHeight + 10;
      legendRowHeight = 0;
    }
    const lines = wrappedFigureText(entry.label, legendFontSize, itemWidth - 36);
    legendPositions.push({ x: margin.left + legendX, y: legendY, lines });
    legendRowHeight = Math.max(legendRowHeight, lines.length * legendFontSize * 1.3);
    legendX += itemWidth;
  }
  const headerHeight = legendEntries.length ? legendY + legendRowHeight + 28 : textBottom + 42;
  const gap = Math.max(24, settings.tickFontSize * 2.4, Math.round(width * 0.012));
  const plotHeight = height - headerHeight - margin.bottom;
  const availableWidth = width - margin.left - margin.right - gap;
  const dosWidthPercent = Math.max(20, Math.min(45, settings.combinedDosWidthPercent));
  const dosWidth = availableWidth * dosWidthPercent / 100;
  const bandWidth = availableWidth - dosWidth;
  if (bandWidth < 160 || dosWidth < 80 || plotHeight < 120) throw new Error('Band + DOS needs a larger canvas or smaller text to fit the title, legend and panels');
  const bandLeft = margin.left;
  const dosLeft = bandLeft + bandWidth + gap;
  const plotTop = headerHeight;
  const mapEnergy = (energy: number) => plotTop + (energyMax - energy) / (energyMax - energyMin) * plotHeight;
  const mapK = (k: number) => bandLeft + (k - kMin) / (kMax - kMin) * bandWidth;
  const mapDos = (density: number) => dosLeft + (density - dosMin) / (dosMax - dosMin) * dosWidth;
  const energyTicks = axisTicks(energyMin, energyMax, Math.max(2, Math.min(12, settings.yTickCount)), 'linear');
  const labelTickWidth = settings.tickFontSize * (settings.tickFormat === 'scientific' ? 7 : Math.max(4, settings.tickDecimals + 3));
  const kTicks = bandData.xTicks ? bandData.xTicks.filter((tick) => tick.value >= kMin && tick.value <= kMax).map((tick) => tick.value) : axisTicks(kMin, kMax, Math.max(2, Math.min(12, settings.xTickCount, Math.floor(bandWidth / labelTickWidth))), 'linear');
  const dosTicks = axisTicks(dosMin, dosMax, Math.max(2, Math.min(8, settings.xTickCount, Math.floor(dosWidth / labelTickWidth))), 'linear');
  const dashPatterns: Record<PlotLineStyle, string | null> = { solid: null, dash: '10 6', dot: '2 5', dashdot: '10 5 2 5' };
  const pathFor = (points: ScientificPlotPoint[], xMap: (value: number) => number, yMap: (value: number) => number) => {
    let segmentOpen = false;
    return points.map(([x, y]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        segmentOpen = false;
        return '';
      }
      const command = segmentOpen ? 'L' : 'M';
      segmentOpen = true;
      return `${command}${xMap(x).toFixed(2)},${yMap(y).toFixed(2)}`;
    }).join(' ');
  };
  const markersFor = (series: ScientificPlotSeries, points: ScientificPlotPoint[], xMap: (value: number) => number, xMin: number, xMax: number, color: string) => {
    const style = settings.seriesStyles[series.id];
    if (!style?.marker || style.marker === 'none') return '';
    const size = style.markerSize ?? 4;
    const fill = transparent ? 'none' : background;
    return `<g data-markers="${escapeXml(series.id)}">${sampledPoints(points.filter(([x, energy]) => Number.isFinite(x) && Number.isFinite(energy) && x >= xMin && x <= xMax && energy >= energyMin && energy <= energyMax), 28).map(([x, energy]) => {
      const cx = xMap(x);
      const cy = mapEnergy(energy);
      const paint = `fill="${fill}" stroke="${color}" stroke-width="1.4"`;
      if (style.marker === 'square') return `<rect x="${cx - size}" y="${cy - size}" width="${size * 2}" height="${size * 2}" ${paint}/>`;
      if (style.marker === 'diamond') return `<path d="M${cx},${cy - size * 1.25} L${cx + size * 1.25},${cy} L${cx},${cy + size * 1.25} L${cx - size * 1.25},${cy} Z" ${paint}/>`;
      return `<circle cx="${cx}" cy="${cy}" r="${size}" ${paint}/>`;
    }).join('')}</g>`;
  };
  const bandLines = bandSeries.map((series) => {
    const style = settings.seriesStyles[series.id];
    const color = style?.color || palette[0];
    const dash = dashPatterns[style?.lineStyle ?? 'solid'];
    return `<path data-series="${escapeXml(series.id)}" d="${pathFor(series.points, mapK, mapEnergy)}" fill="none" stroke="${color}" stroke-width="${style?.lineWidth ?? settings.lineWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${markersFor(series, series.points, mapK, kMin, kMax, color)}`;
  }).join('');
  const dosLines = dosSeries.map((series, index) => {
    const style = settings.seriesStyles[series.id];
    const color = style?.color || palette[index % palette.length];
    const dash = dashPatterns[style?.lineStyle ?? 'solid'];
    const rotatedPoints = series.points.map(([energy, density]): ScientificPlotPoint => [density, energy]);
    return `<path data-series="${escapeXml(series.id)}" d="${pathFor(rotatedPoints, mapDos, mapEnergy)}" fill="none" stroke="${color}" stroke-width="${style?.lineWidth ?? settings.lineWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${markersFor(series, rotatedPoints, mapDos, dosMin, dosMax, color)}`;
  }).join('');
  const horizontalGrid = settings.showGrid ? energyTicks.map((tick) => `<path d="M${bandLeft},${mapEnergy(tick)} H${bandLeft + bandWidth} M${dosLeft},${mapEnergy(tick)} H${dosLeft + dosWidth}" fill="none" stroke="${grid}" stroke-width="1"/>`).join('') : '';
  const verticalGrid = settings.showGrid ? [
    ...kTicks.map((tick) => `<line x1="${mapK(tick)}" y1="${plotTop}" x2="${mapK(tick)}" y2="${plotTop + plotHeight}" stroke="${grid}" stroke-width="1"/>`),
    ...dosTicks.map((tick) => `<line x1="${mapDos(tick)}" y1="${plotTop}" x2="${mapDos(tick)}" y2="${plotTop + plotHeight}" stroke="${grid}" stroke-width="1"/>`),
  ].join('') : '';
  const minorGridLines = settings.showMinorGrid ? `<g data-grid="minor">${[
    ...minorTicks(energyTicks, energyMin, energyMax, 'linear').map((tick) => `<path d="M${bandLeft},${mapEnergy(tick)} H${bandLeft + bandWidth} M${dosLeft},${mapEnergy(tick)} H${dosLeft + dosWidth}"/>`),
    ...minorTicks(kTicks, kMin, kMax, 'linear').map((tick) => `<path d="M${mapK(tick)},${plotTop} V${plotTop + plotHeight}"/>`),
    ...minorTicks(dosTicks, dosMin, dosMax, 'linear').map((tick) => `<path d="M${mapDos(tick)},${plotTop} V${plotTop + plotHeight}"/>`),
  ].join('')}</g>` : '';
  const frames = settings.showFrame
    ? `<rect x="${bandLeft}" y="${plotTop}" width="${bandWidth}" height="${plotHeight}" fill="none" stroke="${foreground}" stroke-width="1.5"/><rect x="${dosLeft}" y="${plotTop}" width="${dosWidth}" height="${plotHeight}" fill="none" stroke="${foreground}" stroke-width="1.5"/>`
    : `<path d="M${bandLeft},${plotTop} V${plotTop + plotHeight} H${bandLeft + bandWidth} M${dosLeft},${plotTop + plotHeight} H${dosLeft + dosWidth}" fill="none" stroke="${foreground}" stroke-width="1.5"/>`;
  const fermiLine = fermiVisible ? `<g aria-label="Fermi energy at zero electron volts"><path d="M${bandLeft},${mapEnergy(0)} H${bandLeft + bandWidth} M${dosLeft},${mapEnergy(0)} H${dosLeft + dosWidth}" fill="none" stroke="#c04d44" stroke-width="1.5" stroke-dasharray="8 5"/></g>` : '';
  const tickMarks = `<g data-axis-ticks="shared" fill="none" stroke="${foreground}" stroke-width="1">${[
    ...energyTicks.map((tick) => `<path d="M${bandLeft},${mapEnergy(tick)} h6 M${dosLeft},${mapEnergy(tick)} h6"/>`),
    ...kTicks.map((tick) => `<path d="M${mapK(tick)},${plotTop + plotHeight} v-6"/>`),
    ...dosTicks.map((tick) => `<path d="M${mapDos(tick)},${plotTop + plotHeight} v-6"/>`),
  ].join('')}</g>`;
  const tickLabels = [
    ...energyTicks.map((tick) => `<text x="${bandLeft - 17}" y="${mapEnergy(tick) + settings.tickFontSize * 0.34}" text-anchor="end" fill="${muted}" font-size="${settings.tickFontSize}">${escapeXml(formatTick(tick, settings.tickFormat, settings.tickDecimals))}</text>`),
    ...kTicks.map((tick) => `<text x="${mapK(tick)}" y="${plotTop + plotHeight + settings.tickFontSize + 12}" text-anchor="middle" fill="${muted}" font-size="${settings.tickFontSize}">${escapeXml(kPointSymbol(bandData.xTicks?.find((item) => item.value === tick)?.label ?? formatTick(tick, settings.tickFormat, settings.tickDecimals)))}</text>`),
    ...dosTicks.map((tick) => `<text x="${mapDos(tick)}" y="${plotTop + plotHeight + settings.tickFontSize + 12}" text-anchor="middle" fill="${muted}" font-size="${settings.tickFontSize}">${escapeXml(formatTick(tick, settings.tickFormat, settings.tickDecimals))}</text>`),
  ].join('');
  const dosLegend = `<g data-legend="outside">${legendEntries.map((entry, index) => {
    const { x, y, lines } = legendPositions[index];
    const dash = dashPatterns[entry.dashed];
    return `<g transform="translate(${x},${y})"><line x1="0" y1="-4" x2="24" y2="-4" stroke="${entry.color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="32" fill="${foreground}" font-size="${legendFontSize}">${lines.map((line, lineIndex) => `<tspan x="32" dy="${lineIndex ? legendFontSize * 1.3 : 0}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
  }).join('')}</g>`;
  const backgroundRect = transparent ? '' : `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`;
  const titleText = `<text data-title="combined" x="${width / 2}" y="${titleBaseline}" text-anchor="middle" fill="${foreground}" font-size="${settings.titleFontSize}" font-weight="600">${titleLines.map((line, index) => `<tspan x="${width / 2}" dy="${index ? settings.titleFontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
  const subtitleText = subtitle ? `<text x="${width / 2}" y="${subtitleBaseline}" text-anchor="middle" fill="${muted}" font-size="${subtitleFontSize}">${subtitleLines.map((line, index) => `<tspan x="${width / 2}" dy="${index ? subtitleFontSize * 1.3 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>` : '';
  const panelTitleY = plotTop - 13;
  const dosLabelSize = Math.min(settings.labelFontSize, dosWidth / 8.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><desc>Band structure and Density of states. Each panel uses its own calculation Fermi energy as zero. The k-path axis follows CSV coordinates; symmetry labels are not inferred.</desc><defs><clipPath id="band-dos-band-panel"><rect x="${bandLeft}" y="${plotTop}" width="${bandWidth}" height="${plotHeight}"/></clipPath><clipPath id="band-dos-dos-panel"><rect x="${dosLeft}" y="${plotTop}" width="${dosWidth}" height="${plotHeight}"/></clipPath></defs>${backgroundRect}<g font-family="${font}">${titleText}${subtitleText}${dosLegend}<text x="${bandLeft}" y="${panelTitleY}" fill="${muted}" font-size="${Math.max(11, settings.tickFontSize - 2)}" font-weight="600">Band structure</text><text x="${dosLeft}" y="${panelTitleY}" fill="${muted}" font-size="${Math.max(11, settings.tickFontSize - 2)}" font-weight="600">DOS</text><g fill="none" stroke="${grid}" stroke-width="0.5">${minorGridLines}</g><g data-grid="major">${horizontalGrid}${verticalGrid}</g>${frames}<g data-panel="band" clip-path="url(#band-dos-band-panel)">${bandLines}</g><g data-panel="dos" clip-path="url(#band-dos-dos-panel)">${dosLines}</g>${fermiLine}${tickMarks}${tickLabels}<text x="${bandLeft + bandWidth / 2}" y="${height - 24}" text-anchor="middle" fill="${foreground}" font-size="${settings.labelFontSize}">${escapeXml(bandData.xLabel)}</text><text x="${dosLeft + dosWidth / 2}" y="${height - 24}" text-anchor="middle" fill="${foreground}" font-size="${dosLabelSize}">DOS (states/eV)</text><text x="28" y="${plotTop + plotHeight / 2}" text-anchor="middle" fill="${foreground}" font-size="${settings.labelFontSize}" transform="rotate(-90 28 ${plotTop + plotHeight / 2})">${escapeXml(bandQuantity.yLabel)}</text></g></svg>`;
}

export function renderScientificPlotSvg(data: ScientificPlotData, settings: ScientificPlotSettings, companionData?: ScientificPlotData | null) {
  if (settings.layout === 'band-dos') {
    if (!companionData) throw new Error('Matching Band/DOS data is unavailable');
    return renderBandDosCompositeSvg(data, companionData, settings);
  }
  if (data.kind === 'thermoelectric' && data.quantities.length > 1) {
    return renderThermoelectricCompositeSvg(data, settings);
  }
  return renderSingleScientificPlotSvg(data, settings);
}

export function renderScientificPlotExports(data: ScientificPlotData, settings: ScientificPlotSettings, companionData?: ScientificPlotData | null): ScientificPlotExport[] {
  if (settings.layout === 'band-dos') {
    if (!companionData) return [];
    return [{
      id: 'band-dos',
      label: settings.title.trim() || 'Electronic band structure and density of states',
      filenameStem: 'electronic-structure-band-dos',
      svg: renderBandDosCompositeSvg(data, companionData, settings),
      width: Math.max(480, Math.min(6000, Math.round(settings.width))),
      height: Math.max(360, Math.min(6000, Math.round(settings.height))),
    }];
  }
  if (data.kind !== 'thermoelectric' || data.quantities.length <= 1) {
    return [{
      id: settings.quantityId,
      label: settings.title.trim() || data.title,
      filenameStem: 'plot',
      svg: renderSingleScientificPlotSvg(data, settings),
      width: Math.max(480, Math.min(6000, Math.round(settings.width))),
      height: Math.max(360, Math.min(6000, Math.round(settings.height))),
    }];
  }
  return data.quantities.slice(0, 4).map((quantity, index) => {
    const panelSettings = settingsForQuantity(settings, quantity);
    return {
      id: quantity.id,
      label: quantity.label,
      filenameStem: quantity.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      svg: renderSingleScientificPlotSvg(data, panelSettings, { clipId: `plot-export-${index}`, centerTitle: true }),
      width: Math.max(480, Math.min(6000, Math.round(settings.width))),
      height: Math.max(360, Math.min(6000, Math.round(settings.height))),
    };
  });
}

export function plotDownloadFilename(calculationName: string, extension: 'svg' | 'png') {
  const base = calculationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calculation-plot';
  return `${base}-custom.${extension}`;
}

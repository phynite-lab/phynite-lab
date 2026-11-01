import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bandDosEnergyBounds,
  kPointSymbol,
  defaultScientificPlotSettings,
  mergeScientificPlotSettings,
  parseScientificPlotCsv,
  renderScientificPlotExports,
  renderScientificPlotSvg,
} from '../lib/result-plot.ts';
import { parseCalculationWorkspaceSnapshot } from '../lib/workspace-storage.ts';

test('band CSV becomes a multi-series paper plot', () => {
  const data = parseScientificPlotCsv([
    'k_distance,band_1_ev_relative_to_fermi,band_2_ev_relative_to_fermi',
    '0,-1,2',
    '0.5,-0.4,1.2',
    '1,-1.1,2.1',
  ].join('\n'), 'Band structure');
  assert.equal(data.kind, 'band');
  assert.equal(data.quantities[0].series.length, 2);
  const svg = renderScientificPlotSvg(data, defaultScientificPlotSettings(data));
  assert.match(svg, /Electronic band structure/);
  assert.match(svg, /<path/);
  assert.match(svg, /Energy E − Eᶠ \(eV\)/);
});

test('matching band and DOS data render as a shared-energy side-by-side figure', () => {
  const band = parseScientificPlotCsv([
    'k_distance,band_1_ev_relative_to_fermi,band_2_ev_relative_to_fermi',
    '0,-2,1',
    '0.5,-1,2',
    '1,-2,1',
  ].join('\n'), 'Band structure');
  const dos = parseScientificPlotCsv([
    'energy_ev_relative_to_fermi,dos_states_per_ev',
    '-3,0',
    '-1,4',
    '0,0.5',
    '1,3',
    '3,0',
  ].join('\n'), 'Density of states');
  const settings = {
    ...defaultScientificPlotSettings(band),
    layout: 'band-dos' as const,
    pairedJobId: 'dos-run',
    title: 'Electronic structure',
  };
  const svg = renderScientificPlotSvg(band, settings, dos);
  const exports = renderScientificPlotExports(band, settings, dos);
  assert.match(svg, /data-panel="band"/);
  assert.match(svg, /data-panel="dos"/);
  assert.match(svg, /Density of states/);
  assert.match(svg, /Fermi energy at zero electron volts/);
  assert.match(svg, /DOS \(states\/eV\)/);
  assert.equal(exports.length, 1);
  assert.equal(exports[0].filenameStem, 'electronic-structure-band-dos');
});

function combinedFixture() {
  const band = parseScientificPlotCsv('k_distance,band_1_ev_relative_to_fermi\n0,-2\n0.5,2\n1,-2', 'Band structure');
  const dos = parseScientificPlotCsv('energy_ev_relative_to_fermi,dos_states_per_ev\n-3,0\n-1,4\n1,2\n3,0', 'Density of states');
  const settings = {
    ...defaultScientificPlotSettings(band),
    layout: 'band-dos' as const,
    pairedJobId: 'dos-run',
    seriesStyles: { ...defaultScientificPlotSettings(band).seriesStyles, ...defaultScientificPlotSettings(dos).seriesStyles },
  };
  return { band, dos, settings };
}

test('combined figures require explicit Fermi-relative CSV conventions and report their shared coverage', () => {
  const { band, dos, settings } = combinedFixture();
  assert.deepEqual(bandDosEnergyBounds(band, dos), { min: -2, max: 2 });
  const unspecified = parseScientificPlotCsv('energy_ev,dos_states_per_ev\n-1,2\n1,4', 'Density of states');
  assert.equal(unspecified.energyReference, 'unknown');
  assert.throws(() => renderScientificPlotSvg(band, settings, unspecified), /explicitly referenced/);
  assert.match(renderScientificPlotSvg(band, settings, dos), /Each panel uses its own calculation Fermi energy as zero/);
});

test('combined render preserves missing-data breaks and every dense-path peak', () => {
  const { dos, settings } = combinedFixture();
  const band = parseScientificPlotCsv([
    'k_distance,band_1_ev_relative_to_fermi',
    ...Array.from({ length: 2001 }, (_, index) => `${index / 2000},${index === 999 ? '' : index === 501 ? '1.75' : '-1'}`),
  ].join('\n'), 'Band structure');
  assert.ok(Number.isNaN(band.quantities[0].series[0].points[999][1]));
  const svg = renderScientificPlotSvg(band, settings, dos);
  const path = svg.match(/data-series="band_1_ev_relative_to_fermi" d="([^"]+)"/)?.[1] ?? '';
  assert.equal((path.match(/M/g) ?? []).length, 2, 'A missing CSV value must start a new line segment');
  assert.equal((path.match(/[ML]/g) ?? []).length, 2000, 'Narrow peaks cannot be skipped by stride sampling');
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('combined figure honors markers, line styles, minor grid and Fermi visibility', () => {
  const { band, dos, settings } = combinedFixture();
  settings.seriesStyles.band_1_ev_relative_to_fermi.marker = 'circle';
  settings.seriesStyles.dos_states_per_ev.marker = 'diamond';
  settings.seriesStyles.dos_states_per_ev.lineStyle = 'dashdot';
  settings.showMinorGrid = true;
  settings.showYZero = false;
  const svg = renderScientificPlotSvg(band, settings, dos);
  assert.match(svg, /data-markers="band_1_ev_relative_to_fermi"/);
  assert.match(svg, /data-markers="dos_states_per_ev"/);
  assert.match(svg, /stroke-dasharray="10 5 2 5"/);
  assert.match(svg, /data-grid="minor"/);
  assert.doesNotMatch(svg, /aria-label="Fermi energy at zero/);
  settings.showYZero = true;
  assert.match(renderScientificPlotSvg(band, settings, dos), /aria-label="Fermi energy at zero/);
});

test('narrow decimal energy windows interpolate viewport edges without adding CSV samples', () => {
  const { band, dos, settings } = combinedFixture();
  settings.combinedEnergyMin = -0.125;
  settings.combinedEnergyMax = 0.375;
  const sampleCount = dos.quantities[0].series[0].points.length;
  assert.match(renderScientificPlotSvg(band, settings, dos), /data-panel="dos"/);
  assert.equal(dos.quantities[0].series[0].points.length, sampleCount);
  settings.combinedEnergyMax = Number.POSITIVE_INFINITY;
  assert.throws(() => renderScientificPlotSvg(band, settings, dos), /finite and increasing/);
});

test('compact combined canvases wrap long titles and reserve outside space for legend entries', () => {
  const { band, dos, settings } = combinedFixture();
  settings.width = 640;
  settings.height = 520;
  settings.showLegend = true;
  settings.title = 'Electronic structure of the selected relaxed crystal with a long publication title';
  settings.subtitle = 'Band and density data plotted with the corresponding calculation Fermi references';
  settings.seriesStyles.dos_states_per_ev.label = 'Density of states for the corresponding relaxed crystal';
  const svg = renderScientificPlotSvg(band, settings, dos);
  assert.match(svg, /width="640" height="520"/);
  const title = svg.match(/data-title="combined"[^>]*>(.*?)<\/text>/)?.[1] ?? '';
  assert.ok((title.match(/<tspan/g) ?? []).length >= 2);
  const plotTop = Number(svg.match(/id="band-dos-band-panel"><rect x="[^"]+" y="([^"]+)"/)?.[1]);
  const legend = svg.match(/data-legend="outside">(.*?)<\/g><text x=/)?.[1] ?? '';
  const legendBaselines = [...legend.matchAll(/translate\([^,]+,([^)]+)\)/g)].map((match) => Number(match[1]));
  assert.ok(legendBaselines.length >= 2);
  assert.ok(legendBaselines.every((baseline) => baseline < plotTop - 10));
});

test('saved companion curve styles survive reopening a combined Band and DOS figure', () => {
  const band = parseScientificPlotCsv([
    'k_distance,band_1_ev_relative_to_fermi',
    '0,-1',
    '1,1',
  ].join('\n'), 'Band structure');
  const defaults = defaultScientificPlotSettings(band);
  const merged = mergeScientificPlotSettings(defaults, {
    layout: 'band-dos',
    pairedJobId: 'dos-run',
    seriesStyles: {
      ...defaults.seriesStyles,
      dos_states_per_ev: { label: 'Custom DOS', visible: true, color: '#145da0', lineWidth: 2.5, lineStyle: 'dash', marker: 'none', markerSize: 4 },
    },
  });
  assert.equal(merged.seriesStyles.dos_states_per_ev.label, 'Custom DOS');
  assert.equal(merged.seriesStyles.dos_states_per_ev.color, '#145da0');
});

test('thermoelectric CSV exposes independently editable quantities and temperature series', () => {
  const data = parseScientificPlotCsv([
    'chemical_potential_ev_relative_to_fermi,chemical_potential_ev_relative_to_plot_reference,temperature_k,seebeck_uv_per_k,seebeck_uv_per_k_relative_to_plot_reference,conductivity_s_per_m,power_factor_mw_per_m_k2,electronic_thermal_conductivity_w_per_m_k',
    '-0.1,-0.1,300,200,190,12,0.3,0.02',
    '0.1,0.1,300,-180,-190,18,0.5,0.03',
    '-0.1,-0.1,600,120,110,20,0.6,0.04',
    '0.1,0.1,600,-100,-110,26,0.9,0.05',
  ].join('\n'), 'Thermoelectric properties');
  assert.equal(data.kind, 'thermoelectric');
  assert.equal(data.quantities.length, 4);
  assert.deepEqual(data.quantities[0].series.map((series) => series.label), ['300 K', '600 K']);
  const settings = defaultScientificPlotSettings(data);
  const svg = renderScientificPlotSvg(data, settings);
  assert.match(svg, /text-anchor="middle"[^>]*>Thermoelectric properties</);
  assert.equal((svg.match(/<svg x="/g) ?? []).length, 4);
  assert.match(svg, /Seebeck coefficient/);
  assert.match(svg, /Electrical conductivity/);
  assert.match(svg, /Power factor/);
  assert.match(svg, /Electronic thermal conductivity/);
  const exports = renderScientificPlotExports(data, settings);
  assert.deepEqual(exports.map((plot) => plot.filenameStem), [
    'seebeck-coefficient',
    'electrical-conductivity',
    'power-factor',
    'electronic-thermal-conductivity',
  ]);
});

test('legacy thermoelectric CSV is recentered on its Seebeck transition instead of a converged tail', () => {
  const header = 'chemical_potential_ev_relative_to_fermi,chemical_potential_ev_relative_to_plot_reference,temperature_k,seebeck_uv_per_k,seebeck_uv_per_k_relative_to_plot_reference,conductivity_s_per_m,power_factor_mw_per_m_k2,electronic_thermal_conductivity_w_per_m_k';
  const axis = [-0.5, -0.15, -0.1, 0, 0.45, 0.5];
  const curves = [
    [500, 100, 0, -100, -140, -150],
    [300, 80, -10, -200, -139, -150],
    [200, 60, -20, -150, -141, -150],
  ];
  const rows = curves.flatMap((curve, temperatureIndex) => axis.map((chemicalPotential, index) => [
    chemicalPotential,
    chemicalPotential - 0.5,
    (temperatureIndex + 1) * 300,
    curve[index],
    curve[index] + 150,
    1,
    1,
    1,
  ].join(',')));
  const data = parseScientificPlotCsv([header, ...rows].join('\n'), 'Thermoelectric properties');
  const seebeck = data.quantities[0];
  const transitionPoints = seebeck.series.map((series) => series.points.reduce((closest, point) => Math.abs(point[0]) < Math.abs(closest[0]) ? point : closest));
  assert.ok(transitionPoints.every(([x]) => Math.abs(x) < 0.06));
  const farTail = seebeck.series[0].points.at(-1);
  assert.ok(farTail && farTail[0] > 0.5);
});

test('current thermoelectric CSV keeps its validated centered reference without a blank half-domain', () => {
  const data = parseScientificPlotCsv([
    'chemical_potential_ev_relative_to_fermi,chemical_potential_ev_relative_to_plot_reference,temperature_k,seebeck_uv_per_k,seebeck_uv_per_k_relative_to_plot_reference,conductivity_s_per_m,power_factor_mw_per_m_k2,electronic_thermal_conductivity_w_per_m_k',
    '-0.4,-1,300,200,200,1,1,1',
    '0.6,0,300,0,0,2,2,2',
    '1.6,1,300,-200,-200,3,3,3',
    '-0.4,-1,600,100,100,1,1,1',
    '0.6,0,600,0,0,2,2,2',
    '1.6,1,600,-100,-100,3,3,3',
  ].join('\n'), 'Thermoelectric properties');
  assert.deepEqual(data.quantities[0].series[0].points.map(([x]) => x), [-1, 0, 1]);
  const svg = renderScientificPlotSvg(data, defaultScientificPlotSettings(data));
  const firstPanel = svg.match(/<svg x="[^"]+"[^>]*>[\s\S]*?<\/svg>/)?.[0];
  const firstPanelPath = firstPanel?.match(/<path d="([^"]+)" fill="none"/)?.[1];
  const firstPanelFrame = firstPanel?.match(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)" height="[^"]+" fill="none"/) ?? null;
  assert.ok(firstPanelPath);
  assert.ok(firstPanelFrame);
  const firstX = Number(firstPanelPath.match(/^M([\d.]+)/)?.[1]);
  const lastX = Number(firstPanelPath.match(/L([\d.]+),[\d.]+\s*$/)?.[1]);
  const frameLeft = Number(firstPanelFrame[1]);
  const frameRight = frameLeft + Number(firstPanelFrame[2]);
  assert.ok(Math.abs(firstX - frameLeft) < 0.01);
  assert.ok(Math.abs(lastX - frameRight) < 0.01);
});

test('manual viewport and dark canvas are reflected in exported SVG', () => {
  const data = parseScientificPlotCsv('energy_ev_relative_to_fermi,dos_states_per_ev\n-1,0\n0,2\n1,0', 'Density of states');
  const settings = {
    ...defaultScientificPlotSettings(data),
    xMin: -0.5,
    xMax: 0.5,
    yMin: 0,
    yMax: 3,
    theme: 'dark' as const,
  };
  const svg = renderScientificPlotSvg(data, settings);
  assert.match(svg, /fill="#111318"/);
  assert.match(svg, />-0\.4</);
  assert.match(svg, />3</);
});

test('legacy saved settings are migrated without losing new curve controls', () => {
  const data = parseScientificPlotCsv('energy_ev_relative_to_fermi,dos_up_states_per_ev,dos_down_states_per_ev\n-1,1,2\n1,3,4', 'Density of states');
  const defaults = defaultScientificPlotSettings(data);
  const merged = mergeScientificPlotSettings(defaults, {
    palette: 'warm',
    seriesStyles: {
      dos_up_states_per_ev: {
        ...defaults.seriesStyles.dos_up_states_per_ev,
        visible: false,
        color: '#ff0000',
      },
    },
  });
  assert.equal(merged.palette, 'warm');
  assert.equal(merged.seriesStyles.dos_up_states_per_ev.visible, false);
  assert.equal(merged.seriesStyles.dos_down_states_per_ev.visible, true);
  assert.equal(merged.seriesStyles.dos_down_states_per_ev.lineStyle, 'solid');
});

test('curve visibility, publication styling, and reference guides reach exported SVG', () => {
  const data = parseScientificPlotCsv('energy_ev_relative_to_fermi,dos_up_states_per_ev,dos_down_states_per_ev\n-1,1,2\n0,3,4\n1,2,1', 'Density of states');
  const defaults = defaultScientificPlotSettings(data);
  const settings = {
    ...defaults,
    legendPosition: 'right' as const,
    xReference: 0,
    referenceLabel: 'Fermi level',
    seriesStyles: {
      ...defaults.seriesStyles,
      dos_up_states_per_ev: {
        ...defaults.seriesStyles.dos_up_states_per_ev,
        label: 'Spin up',
        color: '#123456',
        lineStyle: 'dash' as const,
        marker: 'diamond' as const,
      },
      dos_down_states_per_ev: {
        ...defaults.seriesStyles.dos_down_states_per_ev,
        visible: false,
      },
    },
  };
  const svg = renderScientificPlotSvg(data, settings);
  assert.match(svg, /stroke="#123456"/);
  assert.match(svg, /stroke-dasharray="10 6"/);
  assert.match(svg, /Fermi level/);
  assert.doesNotMatch(svg, /Dos Down States Per Ev/);
});

test('logarithmic axes reject non-positive manual limits with an actionable error', () => {
  const data = parseScientificPlotCsv('x,y\n1,1\n10,100\n100,10000', 'Generic result');
  const settings = {
    ...defaultScientificPlotSettings(data),
    xScale: 'log' as const,
    xMin: 0,
  };
  assert.throws(() => renderScientificPlotSvg(data, settings), /greater than zero/);
});

test('automatic x range connects the first and last samples to the plot frame', () => {
  const data = parseScientificPlotCsv('x,y\n-1,2\n0,3\n1,1', 'Generic result');
  const svg = renderScientificPlotSvg(data, defaultScientificPlotSettings(data));
  const path = svg.match(/<path d="([^"]+)" fill="none"/)?.[1];
  const frame = svg.match(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)" height="[^"]+" fill="none" stroke=/);
  assert.ok(path);
  assert.ok(frame);
  const firstX = Number(path.match(/^M([\d.]+)/)?.[1]);
  const lastX = Number(path.match(/L([\d.]+),[\d.]+\s*$/)?.[1]);
  const frameLeft = Number(frame[1]);
  const frameRight = frameLeft + Number(frame[2]);
  assert.ok(Math.abs(firstX - frameLeft) < 0.01);
  assert.ok(Math.abs(lastX - frameRight) < 0.01);
  assert.ok(svg.indexOf(frame[0]) < svg.indexOf(`<path d="${path}"`), 'data curves should render above the frame so edge strokes are not visually cropped');
});

test('custom high-resolution canvas dimensions are preserved in preview and export', () => {
  const data = parseScientificPlotCsv('x,y\n-1,2\n0,3\n1,1', 'Generic result');
  const settings = { ...defaultScientificPlotSettings(data), width: 4096, height: 2160 };
  const svg = renderScientificPlotSvg(data, settings);
  const [exported] = renderScientificPlotExports(data, settings);
  assert.match(svg, /width="4096" height="2160" viewBox="0 0 4096 2160"/);
  assert.equal(exported.width, 4096);
  assert.equal(exported.height, 2160);
});

test('DOS auto range centers the Fermi reference at x = 0', () => {
  const data = parseScientificPlotCsv(
    'energy_ev_relative_to_fermi,dos_states_per_ev\n-2,0.5\n0,2\n1,0.25',
    'Density of states',
  );
  const settings = { ...defaultScientificPlotSettings(data), showGrid: false };
  const svg = renderScientificPlotSvg(data, settings);
  const zero = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="\1" y2="[\d.]+" stroke="#c04d44" stroke-width="1\.5" stroke-dasharray="8 5"\/>/);
  const frame = svg.match(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)" height="[^"]+" fill="none" stroke=/);
  assert.ok(zero);
  assert.ok(frame);
  const frameCenter = Number(frame[1]) + Number(frame[2]) / 2;
  assert.ok(Math.abs(Number(zero[1]) - frameCenter) < 0.01);
  assert.match(svg, /text-anchor="middle"[^>]*>Density of States</);
  assert.match(svg, /Fermi energy \(Eᶠ = 0 eV\)/);
  assert.match(svg, /stroke-width="4\.2" stroke-opacity="0\.94"/);
});

test('thermoelectric auto range centers its computed plot reference at x = 0', () => {
  const data = parseScientificPlotCsv([
    'chemical_potential_ev_relative_to_fermi,chemical_potential_ev_relative_to_plot_reference,temperature_k,seebeck_uv_per_k,seebeck_uv_per_k_relative_to_plot_reference,conductivity_s_per_m,power_factor_mw_per_m_k2,electronic_thermal_conductivity_w_per_m_k',
    '-0.5,-0.4,300,100,80,12,0.3,0.02',
    '0.6,0.7,300,-100,-120,18,0.5,0.03',
    '-0.5,-0.4,600,80,60,20,0.6,0.04',
    '0.6,0.7,600,-80,-100,26,0.9,0.05',
  ].join('\n'), 'Thermoelectric properties');
  const settings = { ...defaultScientificPlotSettings(data), showGrid: false };
  const svg = renderScientificPlotSvg(data, settings);
  const zero = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="\1" y2="[\d.]+" stroke="[^"]+" stroke-width="1\.2" stroke-dasharray="6 5"\/>/);
  const frame = svg.match(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)" height="[^"]+" fill="none" stroke=/);
  assert.ok(zero);
  assert.ok(frame);
  const frameCenter = Number(frame[1]) + Number(frame[2]) / 2;
  assert.ok(Math.abs(Number(zero[1]) - frameCenter) < 0.01);
});

test('figure settings survive cloud-workspace snapshot serialization', () => {
  const data = parseScientificPlotCsv('x,y\n0,1\n1,2', 'Generic result');
  const settings = defaultScientificPlotSettings(data);
  const snapshot = parseCalculationWorkspaceSnapshot(JSON.stringify({
    version: 1,
    jobs: [{
      id: 'job-plot',
      materialId: 'material-1',
      name: 'Generic result',
      status: 'Completed',
      plotSettings: settings,
    }],
  }));
  assert.deepEqual(snapshot?.jobs?.[0].plotSettings, settings);
});


test('Gamma labels use the Greek symbol without rewriting other source labels', () => {
  for (const label of ['Gamma', 'GAMMA', 'gamma', String.raw`\Gamma`, String.raw`$\Gamma$`]) assert.equal(kPointSymbol(label), '\u0393');
  assert.equal(kPointSymbol('G'), 'G');
  assert.equal(kPointSymbol('Gamma_1'), '\u0393_1');
  assert.equal(kPointSymbol('L|GAMMA'), 'L|\u0393');
});

test('explicit plot limits clip thick lines and markers to the exact frame', () => {
  const data = parseScientificPlotCsv('x,y\n-3,-7\n0,0\n3,7', 'Generic result');
  const settings = { ...defaultScientificPlotSettings(data), xMin: -1, xMax: 1, yMin: -2, yMax: 2, lineWidth: 6 };
  for (const style of Object.values(settings.seriesStyles)) { style.marker = 'circle'; style.markerSize = 12; }
  const svg = renderScientificPlotSvg(data, settings);
  const clip = svg.match(/<clipPath id="plot-area"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
  const frame = svg.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="none" stroke=/);
  assert.ok(clip); assert.ok(frame);
  assert.deepEqual(clip.slice(1, 5), frame.slice(1, 5));
  assert.match(svg, /<g clip-path="url\(#plot-area\)"><g data-series="[^"]+"><path/);
});

test('combined Band/DOS clips are exact and preserve symbolic k ticks', () => {
  const band = parseScientificPlotCsv('k_distance,band_1_ev_relative_to_fermi\n0,-2\n1,2', 'Band structure');
  band.xTicks = [{ value: 0, label: 'Gamma' }, { value: 1, label: 'M' }];
  const dos = parseScientificPlotCsv('energy_ev_relative_to_fermi,dos_states_per_ev\n-3,1\n0,2\n3,1', 'Density of states');
  const svg = renderScientificPlotSvg(band, { ...defaultScientificPlotSettings(band), layout: 'band-dos', yMin: -1, yMax: 1 }, dos);
  assert.match(svg, />\u0393<\/text>/);
  const clips = [...svg.matchAll(/<clipPath[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((match) => match.slice(1, 5));
  const frames = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="none" stroke=/g)].map((match) => match.slice(1, 5));
  assert.equal(clips.length, 2);
  assert.deepEqual(clips, frames);
});

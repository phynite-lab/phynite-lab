import { downloadBlob, renderPlotPngBlob } from './plot-download.ts';
import { renderFigure, type FigureDocument, type ResearchDataset } from './research-figures.ts';
import { embedPublicationFonts, publicationFonts } from './publication-fonts.ts';
import { buildSourcePackage } from './research-package.ts';

export async function exportFigure(figure: FigureDocument, datasets: ResearchDataset[], format: 'svg' | 'png' | 'pdf' | 'zip', dpi = 600, revision = 0): Promise<void> {
  const rendered = renderFigure(figure, datasets);
  const fonts = await publicationFonts(figure.fontFamily);
  const svg = embedPublicationFonts(rendered, fonts);
  const filename = figure.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'figure';
  if (format === 'svg') return downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
  if (format === 'png') {
    const width = Math.round(figure.widthMm / 25.4 * dpi), height = Math.round(figure.heightMm / 25.4 * dpi);
    if (width * height > 40_000_000) throw new Error('This raster exceeds 40 megapixels. Reduce DPI or export vector SVG/PDF.');
    return downloadBlob(await renderPlotPngBlob(svg, width, height, 1), `${filename}.png`);
  }
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    await import('svg2pdf.js');
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const pdf = new jsPDF({ orientation: figure.widthMm > figure.heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [figure.widthMm, figure.heightMm] });
    pdf.addFileToVFS('figure-regular.ttf', fonts.regular);
    pdf.addFileToVFS('figure-bold.ttf', fonts.bold);
    pdf.addFont('figure-regular.ttf', fonts.family, 'normal');
    pdf.addFont('figure-bold.ttf', fonts.family, 'bold');
    await pdf.svg(document, { x: 0, y: 0, width: figure.widthMm, height: figure.heightMm });
    pdf.setProperties({ title: figure.name, subject: `${figure.caption}\nEmbedded font license:\n${fonts.license}` });
    downloadBlob(pdf.output('blob'), `${filename}.pdf`);
    return;
  }
  const bytes = await buildSourcePackage(figure, datasets, svg, fonts.license, revision);
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), `${filename}-sources.zip`);
}

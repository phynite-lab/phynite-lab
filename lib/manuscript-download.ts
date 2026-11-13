import { buildManuscriptArchive, type ManuscriptSnapshot } from './manuscript.ts';
import { publicationFonts } from './publication-fonts.ts';
import { downloadBlob } from './plot-download.ts';

/** Trusted SVG renderer only. The application never compiles user TeX. */
export async function downloadManuscript(snapshot: ManuscriptSnapshot): Promise<void> {
  const { bytes } = await buildManuscriptArchive(snapshot, async (svg, figure) => {
    const { jsPDF } = await import('jspdf'); await import('svg2pdf.js');
    const fonts = await publicationFonts(figure.fontFamily), element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (element.localName !== 'svg' || element.querySelector('parsererror')) throw new Error('Saved vector figure could not be read.');
    const pdf = new jsPDF({ orientation: figure.widthMm > figure.heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [figure.widthMm, figure.heightMm] });
    pdf.addFileToVFS('manuscript-regular.ttf', fonts.regular); pdf.addFileToVFS('manuscript-bold.ttf', fonts.bold);
    pdf.addFont('manuscript-regular.ttf', fonts.family, 'normal'); pdf.addFont('manuscript-bold.ttf', fonts.family, 'bold');
    await pdf.svg(element, { x: 0, y: 0, width: figure.widthMm, height: figure.heightMm });
    pdf.setProperties({ title: figure.name, subject: `${figure.caption}\nFont license:\n${fonts.license}` });
    return { bytes: new Uint8Array(pdf.output('arraybuffer')), fontLicense: fonts.license };
  });
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), 'phynite-aps-prb-draft.zip');
}

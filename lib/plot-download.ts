export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function renderPlotPngBlob(svg: string, width: number, height: number, scale: number) {
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The browser could not rasterize this plot'));
      image.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function downloadRenderedPlotPng(svg: string, width: number, height: number, scale: number, filename: string) {
  downloadBlob(await renderPlotPngBlob(svg, width, height, scale), filename);
}

export async function downloadRenderedPlotArchive(
  plots: ScientificPlotExport[],
  format: 'png' | 'svg',
  scale: number,
  filename: string,
) {
  const entries: Record<string, Uint8Array> = {};
  for (const plot of plots) {
    if (format === 'svg') {
      entries[`${plot.filenameStem}.svg`] = strToU8(plot.svg);
    } else {
      const blob = await renderPlotPngBlob(plot.svg, plot.width, plot.height, scale);
      entries[`${plot.filenameStem}.png`] = new Uint8Array(await blob.arrayBuffer());
    }
  }
  const archive = zipSync(entries, { level: 6 });
  downloadBlob(new Blob([new Uint8Array(archive)], { type: 'application/zip' }), filename);
}
import { strToU8, zipSync } from 'fflate';
import type { ScientificPlotExport } from '@/lib/result-plot';

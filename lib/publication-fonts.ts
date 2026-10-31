const families = {
  sans: { family: 'DejaVu Sans', file: 'DejaVuSans' },
  serif: { family: 'DejaVu Serif', file: 'DejaVuSerif' },
  mono: { family: 'DejaVu Sans Mono', file: 'DejaVuSansMono' },
};
const cache = new Map<string, Promise<{ family: string; regular: string; bold: string; license: string }>>();

export function publicationFonts(kind: keyof typeof families) {
  if (!cache.has(kind)) cache.set(kind, (async () => {
    const { family, file } = families[kind];
    const read = async (name: string) => {
      const response = await fetch(`/fonts/publication/${name}`, { cache: 'force-cache', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Publication font could not be loaded. Retry after reconnecting.');
      return response;
    };
    const base64 = async (name: string) => {
      const bytes = new Uint8Array(await (await read(name)).arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return btoa(binary);
    };
    const [regular, bold, license] = await Promise.all([base64(`${file}.ttf`), base64(`${file}-Bold.ttf`), read('LICENSE.txt').then((response) => response.text())]);
    await Promise.all([document.fonts.load(`12px "${family}"`), document.fonts.load(`700 12px "${family}"`)]);
    return { family, regular, bold, license };
  })().catch((error) => { cache.delete(kind); throw error; }));
  return cache.get(kind)!;
}

export function embedPublicationFonts(svg: string, fonts: Awaited<ReturnType<typeof publicationFonts>>) {
  const license = fonts.license.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const faces = [[400, fonts.regular], [700, fonts.bold]].map(([weight, font]) => `@font-face{font-family:'${fonts.family}';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${font}) format('truetype')}`).join('');
  return svg.replace(/(<svg[^>]*>)/, `$1<metadata>${license}</metadata><defs><style>${faces}</style></defs>`);
}

import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getGuideSections } from '../lib/guide-library.ts';
import { materializeGuideSections } from '../lib/guide-release.ts';
import { getLocalReleaseMetadata } from '../lib/local-release-metadata.ts';
import { guidePath, guideRoute } from '../lib/guide-routing.ts';
import { publicSiteOrigin } from '../lib/site-metadata.ts';

export function markdownText(value) {
  return value.replaceAll('&', '&amp;').replace(/([\\`*_{}\[\]<>])/g, '\\$1').replace(/\r?\n/g, ' ');
}

export async function verifyVisualAsset(src, publicRoot = resolve('public')) {
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+\.(png|jpe?g|webp|gif|avif|svg)$/.test(src)) {
    throw new Error(`Guide images must use a committed public asset path: ${src}`);
  }
  const root = await realpath(publicRoot);
  const file = await realpath(resolve(root, `.${src}`));
  const withinRoot = relative(root, file);
  if (!withinRoot || withinRoot.startsWith(`..${sep}`) || withinRoot === '..' || !(await stat(file)).isFile()) {
    throw new Error(`Guide image is outside the public asset tree: ${src}`);
  }
}

export function visualMarkdown(visual, origin = publicSiteOrigin()) {
  const image = `![${markdownText(visual.alt)}](<${new URL(visual.src, origin).href}>)`;
  return `${image}\n\n${visual.caption ? `${markdownText(visual.caption)}\n\n` : ''}`;
}

export function guideMarkdownLink(href, origin = publicSiteOrigin()) {
  const url = new URL(href, origin);
  const route = url.origin === new URL(origin).origin ? guideRoute(url.pathname) : null;
  if (route?.topic && !url.search) return url.hash || `#${route.topic}`;
  return url.href;
}

async function buildGuides() {
  const release = await getLocalReleaseMetadata();
  console.log(`Documentation release metadata: ${release.packageName}@${release.version} (${release.versionSource})`);
  const verifiedAssets = new Set();
  await mkdir('docs', { recursive: true });
  await mkdir('public/downloads', { recursive: true });
  for (const locale of ['en', 'id']) {
    const guideSections = materializeGuideSections(getGuideSections(locale), release);
    let markdown = locale === 'id' ? '# Panduan Pengguna Phynite Lab\n\n' : '# Phynite Lab User Guide\n\n';
    markdown += locale === 'id'
      ? 'Panduan ini menjelaskan antarmuka yang diimplementasikan. Gunakan bersama dokumentasi solver dan uji konvergensi. Gambar disajikan dari aset dokumentasi publik; koneksi internet diperlukan untuk memuat gambar pada file Markdown.\n\n'
      : 'This guide describes the implemented interface. Use it alongside solver documentation and convergence studies. Images use public documentation assets; an internet connection is needed to load them in this Markdown file.\n\n';
    markdown += guideSections.map(section => `- [${markdownText(section.title)}](#${section.id})`).join('\n') + '\n\n';
    for (const section of guideSections) {
      const sectionStart = markdown.length;
      markdown += `<a id="${section.id}"></a>\n\n## ${section.title}\n\n${section.intro}\n\n`;
      for (const [index, block] of section.blocks.entries()) {
        markdown += `<a id="docs-${section.id}-${index + 1}"></a>\n\n### ${block.title}\n\n`;
        for (const visual of block.visuals ?? []) {
          for (const source of [visual.src, visual.lightSrc, visual.darkSrc, visual.mobileSrc].filter(Boolean)) {
            if (!verifiedAssets.has(source)) { await verifyVisualAsset(source); verifiedAssets.add(source); }
          }
          markdown += visualMarkdown(visual);
        }
        if (block.paragraphs) markdown += block.paragraphs.join('\n\n') + '\n\n';
        if (block.steps) markdown += block.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') + '\n\n';
        if (block.bullets) markdown += block.bullets.map(item => `- ${item}`).join('\n') + '\n\n';
        if (block.table) {
          const row = cells => '| ' + cells.map(cell => cell.replaceAll('|', '\\|')).join(' | ') + ' |\n';
          markdown += row(block.table.headings) + row(block.table.headings.map(() => '---')) + block.table.rows.map(row).join('') + '\n';
        }
        if (block.code) {
          const fence = '`'.repeat(Math.max(3, ...[...block.code.matchAll(/`+/g)].map(match => match[0].length + 1)));
          markdown += `${fence}text\n${block.code}\n${fence}\n\n`;
        }
        if (block.note) markdown += '> ' + block.note.replaceAll('\n', '\n> ') + '\n\n';
        if (block.links) markdown += block.links.map(link => `- [${markdownText(link.label)}](<${guideMarkdownLink(link.href)}>)`).join('\n') + '\n\n';
      }
      if (section.id === 'local-compute' && locale === 'en') {
        // This chapter ships alone in the worker bundle; cross-chapter links need the website.
        const standalone = markdown.slice(sectionStart).replace(/\]\(<#([a-z0-9-]+)>\)/g, (_match, anchor) => {
          const target = guideSections.find(candidate => candidate.id === anchor || anchor.startsWith(`docs-${candidate.id}-`));
          return `](<${new URL(guidePath(locale, target?.id ?? anchor), publicSiteOrigin()).href}${anchor.startsWith('docs-') ? `#${anchor}` : ''}>)`;
        });
        await writeFile('docs/personal-compute.md', standalone);
      }
    }
    markdown += (locale === 'id' ? '## Referensi ilmiah\n\n' : '## Scientific references\n\n') + '- https://www.quantum-espresso.org/documentation/\n- https://docs.materialsproject.org/\n- https://seekpath.readthedocs.io/\n- https://www.boltztrap.org/\n- https://docs.lammps.org/\n- https://www.ovito.org/docs/\n- https://wannier.org/documentation/\n';
    await writeFile(`public/downloads/phynite-user-guide${locale === 'id' ? '-id' : ''}.md`, markdown);
    await writeFile(`docs/user-guide${locale === 'id' ? '-id' : ''}.md`, markdown);
    console.log(`User guide (${locale}): ${guideSections.length} chapters, ${markdown.split(/\s+/).length} words.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildGuides();

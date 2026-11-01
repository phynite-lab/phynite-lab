import { mkdir, writeFile } from 'node:fs/promises';
import { getGuideSections } from '../lib/guide-library.ts';
import { guidePath, guideRoute } from '../lib/guide-routing.ts';
import { publicSiteOrigin } from '../lib/site-metadata.ts';

for (const locale of ['en', 'id']) {
const guideSections = getGuideSections(locale);

let markdown = locale === 'id' ? '# Panduan Pengguna Phynite Lab\n\n' : '# Phynite Lab User Guide\n\n';
markdown += locale === 'id' ? 'Panduan ini menjelaskan antarmuka yang diimplementasikan. Gunakan bersama dokumentasi solver dan uji konvergensi.\n\n' : 'This guide describes the implemented interface. Use it alongside solver documentation and convergence studies.\n\n';
markdown += guideSections.map(section => `- [${section.title}](#${section.id})`).join('\n') + '\n\n';
for (const section of guideSections) {
  const sectionStart = markdown.length;
  markdown += `<a id="${section.id}"></a>\n\n## ${section.title}\n\n${section.intro}\n\n`;
  for (const block of section.blocks) {
    markdown += `### ${block.title}\n\n`;
    if (block.paragraphs) markdown += block.paragraphs.join('\n\n') + '\n\n';
    if (block.steps) markdown += block.steps.map((step, i) => `${i + 1}. ${step}`).join('\n') + '\n\n';
    if (block.bullets) markdown += block.bullets.map(item => `- ${item}`).join('\n') + '\n\n';
    if (block.table) {
      const row = cells => '| ' + cells.map(cell => cell.replaceAll('|', '\\|')).join(' | ') + ' |\n';
      markdown += row(block.table.headings) + row(block.table.headings.map(() => '---')) + block.table.rows.map(row).join('') + '\n';
    }
    if (block.code) markdown += '```text\n' + block.code + '\n```\n\n';
    if (block.note) markdown += '> ' + block.note + '\n\n';
    if (block.links) markdown += block.links.map(link => {
      const topic = guideRoute(link.href)?.topic;
      return `- [${link.label}](${topic ? `#${topic}` : link.href})`;
    }).join('\n') + '\n\n';
  }
  if (section.id === 'local-compute' && locale === 'en') {
    // This chapter ships alone in the worker bundle, without the other chapters.
    const standalone = markdown.slice(sectionStart).replace(/\]\(#([a-z0-9-]+)\)/g,
      (_match, topic) => `](${new URL(guidePath(locale, topic), publicSiteOrigin()).href})`);
    await writeFile('docs/personal-compute.md', standalone);
  }
}
markdown += (locale === 'id' ? '## Referensi ilmiah\n\n' : '## Scientific references\n\n') + '- https://www.quantum-espresso.org/documentation/\n- https://docs.materialsproject.org/\n- https://seekpath.readthedocs.io/\n- https://www.boltztrap.org/\n';
await mkdir('public/downloads', { recursive: true });
await writeFile(`public/downloads/phynite-user-guide${locale === 'id' ? '-id' : ''}.md`, markdown);
await writeFile(`docs/user-guide${locale === 'id' ? '-id' : ''}.md`, markdown);
console.log(`User guide (${locale}): ${guideSections.length} chapters, ${markdown.split(/\s+/).length} words.`);

}

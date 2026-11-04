import { guideSections, type GuideSection } from './guide-content.ts';
import { guideSectionsId } from './guide-content-id.ts';
import { guideAdditions } from './guide-additions.ts';
import { guideAdditionsId } from './guide-additions-id.ts';
import { productGuideSections } from './guide-product.ts';
import { productGuideSectionsId } from './guide-product-id.ts';
import { handbookGuideSections } from './guide-handbook.ts';
import { withGuideVisuals } from './guide-visuals.ts';
import type { Locale } from './locale.ts';
import { GUIDE_TOPIC_IDS, guidePath } from './guide-routing.ts';

const topicOrder: readonly string[] = GUIDE_TOPIC_IDS;
const sortTopics = (sections: GuideSection[]) => [...sections].sort((a, b) => topicOrder.indexOf(a.id) - topicOrder.indexOf(b.id));
const groupLabels: Record<string, [string, string]> = {
  workflow: ['Start here', 'Mulai di sini'], 'getting-started': ['Start here', 'Mulai di sini'], 'quickstart-silicon': ['QE & DFT', 'QE & DFT'], project: ['Projects & structures', 'Project & struktur'],
  'npm-local-app': ['Install & update', 'Instal & perbarui'],
  structure: ['Projects & structures', 'Project & struktur'], edit: ['Projects & structures', 'Project & struktur'], periodicity: ['Projects & structures', 'Project & struktur'], 'slab-workflow': ['Projects & structures', 'Project & struktur'],
  calculation: ['QE & DFT', 'QE & DFT'], configure: ['QE & DFT', 'QE & DFT'], convergence: ['QE & DFT', 'QE & DFT'], execution: ['QE & DFT', 'QE & DFT'],
  'quickstart-md': ['MD & analysis', 'MD & analisis'], 'md-workflows': ['MD & analysis', 'MD & analisis'],
  'local-compute': ['Install & update', 'Instal & perbarui'],
  'ai-providers': ['AI providers', 'Provider AI'], 'cloud-sync': ['Phynite Cloud', 'Phynite Cloud'], saving: ['Phynite Cloud', 'Phynite Cloud'], billing: ['Phynite Cloud', 'Phynite Cloud'],
  'storage-backup': ['Storage & backups', 'Storage & backup'], 'settings-reference': ['Settings & preferences', 'Pengaturan & preferensi'], language: ['Settings & preferences', 'Pengaturan & preferensi'], account: ['Phynite Cloud', 'Phynite Cloud'],
  results: ['Results & figures', 'Hasil & figur'], figures: ['Results & figures', 'Hasil & figur'], alignment: ['Results & figures', 'Hasil & figur'], studies: ['Results & figures', 'Hasil & figur'], reuse: ['Results & figures', 'Hasil & figur'], advanced: ['Results & figures', 'Hasil & figur'], export: ['Results & figures', 'Hasil & figur'], publication: ['Results & figures', 'Hasil & figur'], 'research-history': ['Results & figures', 'Hasil & figur'],
  troubleshooting: ['Troubleshooting & recovery', 'Pemecahan masalah & pemulihan'], 'local-troubleshooting': ['Troubleshooting & recovery', 'Pemecahan masalah & pemulihan'], diagnostics: ['Troubleshooting & recovery', 'Pemecahan masalah & pemulihan'],
  'tools-reference': ['Reference', 'Referensi'], shortcuts: ['Reference', 'Referensi'], 'field-reference': ['Reference', 'Referensi'], roadmap: ['Reference', 'Referensi'], reference: ['Reference', 'Referensi'],
};
const normalizeGroup = (section: GuideSection, locale: Locale): GuideSection => {
  const label = groupLabels[section.id];
  return label ? { ...section, group: locale === 'id' ? label[1] : label[0] } : section;
};
function relatedTopics(sections: GuideSection[], locale: Locale): GuideSection[] {
  const relatedGroup = new Set(['ai-providers', 'cloud-sync']);
  return sortTopics(sections).map(section => ({ ...section, blocks: [...section.blocks, {
    title: locale === 'id' ? 'Topik terkait' : 'Related topics',
    links: sections.filter(other => other.id !== section.id && (other.group === section.group || relatedGroup.has(section.id) && relatedGroup.has(other.id))).slice(0, 3).map(other => ({ label: other.title, href: guidePath(locale, other.id) })),
  }] }));
}
const normalizeGroups = (sections: GuideSection[], locale: Locale) => sections.map(section => withGuideVisuals(normalizeGroup(section, locale), locale));
const guides = {
  en: relatedTopics(normalizeGroups([...guideSections, ...guideAdditions, ...productGuideSections, ...handbookGuideSections('en')], 'en'), 'en'),
  id: relatedTopics(normalizeGroups([...guideSectionsId, ...guideAdditionsId, ...productGuideSectionsId, ...handbookGuideSections('id')], 'id'), 'id'),
};

export function getGuideSections(locale: Locale) { return guides[locale]; }

export function searchGuide(sections: GuideSection[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sections.map(section => {
    const title = section.title.toLocaleLowerCase();
    const body = JSON.stringify(section).toLocaleLowerCase();
    const matches = words.every(word => body.includes(word));
    return { section, score: matches ? words.reduce((score, word) => score + (title.includes(word) ? 10 : 1), 0) : 0 };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score).map(result => result.section);
}

export function guideTopicKind(id: string, locale: Locale) {
  if (id.startsWith('quickstart') || id === 'getting-started') return 'Tutorial';
  if (id === 'md-workflows') return locale === 'id' ? 'Workflow MD' : 'MD workflow';
  if (id === 'research-history') return locale === 'id' ? 'Bukti riset' : 'Research evidence';
  if (id === 'tools-reference') return locale === 'id' ? 'Referensi alat' : 'Tool reference';
  if (['shortcuts', 'field-reference', 'reference', 'roadmap'].includes(id)) return locale === 'id' ? 'Referensi' : 'Reference';
  if (['periodicity', 'alignment', 'saving'].includes(id)) return locale === 'id' ? 'Konsep' : 'Concept';
  if (['troubleshooting', 'local-troubleshooting', 'diagnostics'].includes(id)) return locale === 'id' ? 'Diagnosis' : 'Troubleshooting';
  return locale === 'id' ? 'Panduan tugas' : 'How-to';
}

import { guideSections, type GuideSection } from './guide-content.ts';
import { guideSectionsId } from './guide-content-id.ts';
import { guideAdditions } from './guide-additions.ts';
import { guideAdditionsId } from './guide-additions-id.ts';
import { productGuideSections } from './guide-product.ts';
import { productGuideSectionsId } from './guide-product-id.ts';
import type { Locale } from './locale.ts';
import { GUIDE_TOPIC_IDS, guidePath } from './guide-routing.ts';

const topicOrder: readonly string[] = GUIDE_TOPIC_IDS;
const sortTopics = (sections: GuideSection[]) => [...sections].sort((a, b) => topicOrder.indexOf(a.id) - topicOrder.indexOf(b.id));
function relatedTopics(sections: GuideSection[], locale: Locale): GuideSection[] {
  const relatedGroup = new Set(['ai-providers', 'cloud-sync']);
  return sortTopics(sections).map(section => ({ ...section, blocks: [...section.blocks, {
    title: locale === 'id' ? 'Topik terkait' : 'Related topics',
    links: sections.filter(other => other.id !== section.id && (other.group === section.group || relatedGroup.has(section.id) && relatedGroup.has(other.id))).slice(0, 3).map(other => ({ label: other.title, href: guidePath(locale, other.id) })),
  }] }));
}
const guides = { en: relatedTopics([...guideSections, ...guideAdditions, ...productGuideSections], 'en'), id: relatedTopics([...guideSectionsId, ...guideAdditionsId, ...productGuideSectionsId], 'id') };

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
  if (id.startsWith('quickstart')) return 'Tutorial';
  if (['shortcuts', 'field-reference', 'reference', 'roadmap'].includes(id)) return locale === 'id' ? 'Referensi' : 'Reference';
  if (['periodicity', 'alignment', 'saving'].includes(id)) return locale === 'id' ? 'Konsep' : 'Concept';
  if (['troubleshooting', 'diagnostics'].includes(id)) return locale === 'id' ? 'Diagnosis' : 'Troubleshooting';
  return locale === 'id' ? 'Panduan tugas' : 'How-to';
}

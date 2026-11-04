import type { GuideBlock, GuideSection } from './guide-content.ts';
import type { LocalReleaseMetadata } from './local-release-metadata.ts';

const versionToken = /\{\{LOCAL_NPM_VERSION\}\}/g;
const nodeToken = /\{\{NODE_REQUIREMENT\}\}/g;

function replaceText(value: string, release: LocalReleaseMetadata): string {
  return value.replace(versionToken, release.version).replace(nodeToken, release.nodeRequirement);
}

function materializeBlock(block: GuideBlock, release: LocalReleaseMetadata): GuideBlock {
  return {
    ...block,
    title: replaceText(block.title, release),
    paragraphs: block.paragraphs?.map(value => replaceText(value, release)),
    steps: block.steps?.map(value => replaceText(value, release)),
    bullets: block.bullets?.map(value => replaceText(value, release)),
    code: block.code ? replaceText(block.code, release) : undefined,
    note: block.note ? replaceText(block.note, release) : undefined,
    table: block.table ? {
      headings: block.table.headings.map(value => replaceText(value, release)),
      rows: block.table.rows.map(row => row.map(value => replaceText(value, release))),
    } : undefined,
    links: block.links?.map(link => ({ ...link, label: replaceText(link.label, release), href: replaceText(link.href, release) })),
    visuals: block.visuals?.map(visual => ({ ...visual,
      alt: replaceText(visual.alt, release),
      caption: visual.caption ? replaceText(visual.caption, release) : undefined,
    })),
  };
}

export function materializeGuideSections(sections: GuideSection[], release: LocalReleaseMetadata): GuideSection[] {
  return sections.map(section => ({
    ...section,
    title: replaceText(section.title, release),
    intro: replaceText(section.intro, release),
    blocks: section.blocks.map(block => materializeBlock(block, release)),
  }));
}

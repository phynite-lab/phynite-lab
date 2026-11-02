import { notFound } from 'next/navigation';
import { GuideExperience } from '@/app/guide/guide-experience';
import { getGuideSections } from './guide-library.ts';
import { guidePath, isGuideTopic } from './guide-routing.ts';
import type { Locale } from './locale.ts';
import { getLocalReleaseMetadata } from './local-release-metadata.ts';
import { publicPageMetadata } from './site-metadata.ts';

function guideTopic(locale: Locale, topic: string) {
  if (!isGuideTopic(topic)) notFound();
  const section = getGuideSections(locale).find(section => section.id === topic);
  if (!section) notFound();
  return section;
}

export function guideMetadata(locale: Locale, topic = '') {
  const section = topic ? guideTopic(locale, topic) : undefined;
  const title = section?.title ?? (locale === 'id' ? 'Dokumentasi Phynite Lab: DFT, MD, npm, Cloud & AI' : 'Phynite Lab Documentation: DFT, MD, npm, Cloud & AI');
  const description = section?.intro ?? (locale === 'id'
    ? 'Panduan Phynite Lab untuk aplikasi npm lokal, Quantum ESPRESSO DFT, simulasi LAMMPS, AI provider, Cloud Sync, storage, dan figur ilmiah.'
    : 'Phynite Lab guides for the npm local app, Quantum ESPRESSO DFT, LAMMPS simulations, AI providers, Cloud Sync, storage, and scientific figures.');
  return publicPageMetadata({
    path: guidePath(locale, topic), title: `${title} — Phynite Lab`, description, locale,
    languages: { en: guidePath('en', topic), id: guidePath('id', topic), 'x-default': guidePath('en', topic) },
  });
}

export async function GuideDocument({ locale, topic = '' }: { locale: Locale; topic?: string }) {
  if (topic) guideTopic(locale, topic);
  const release = await getLocalReleaseMetadata();
  return <GuideExperience topic={topic} release={release} />;
}

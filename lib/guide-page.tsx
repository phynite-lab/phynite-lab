import { notFound } from 'next/navigation';
import { GuideExperience } from '@/app/guide/guide-experience';
import { getGuideSections } from './guide-library.ts';
import { guidePath, isGuideTopic } from './guide-routing.ts';
import type { Locale } from './locale.ts';
import { publicPageMetadata } from './site-metadata.ts';

function guideTopic(locale: Locale, topic: string) {
  if (!isGuideTopic(topic)) notFound();
  const section = getGuideSections(locale).find(section => section.id === topic);
  if (!section) notFound();
  return section;
}

export function guideMetadata(locale: Locale, topic = '') {
  const section = topic ? guideTopic(locale, topic) : undefined;
  const title = section?.title ?? (locale === 'id' ? 'Dokumentasi DFT, MD & Figure Lab' : 'DFT, MD & Figure Lab Documentation');
  const description = section?.intro ?? (locale === 'id'
    ? 'Panduan Phynite Lab untuk Quantum ESPRESSO DFT, simulasi LAMMPS, figur ilmiah, dan pengaturan komputasi pribadi.'
    : 'Phynite Lab guides for Quantum ESPRESSO DFT, LAMMPS simulations, scientific figures, and personal compute setup.');
  return publicPageMetadata({
    path: guidePath(locale, topic), title: `${title} — Phynite Lab`, description, locale,
    languages: { en: guidePath('en', topic), id: guidePath('id', topic), 'x-default': guidePath('en', topic) },
  });
}

export function GuideDocument({ locale, topic = '' }: { locale: Locale; topic?: string }) {
  if (topic) guideTopic(locale, topic);
  return <GuideExperience topic={topic} />;
}

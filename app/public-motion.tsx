'use client';

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useLocale } from './locale-provider';
import { useMotionPreference } from './public-landing/ScrollMotion';
import { Reveal } from './public-landing/Reveal';

/** Content stays visible in server HTML, including when JavaScript is disabled. */
export function PublicReveal({ children, className, as }: { children: ReactNode; className?: string; as?: 'div' | 'header' | 'section' }) {
  return <Reveal className={className} as={as}>{children}</Reveal>;
}

export function PublicProductPreview({ className = '' }: { className?: string }) {
  const { t } = useLocale();
  const reduced = useMotionPreference();
  const target = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [48, -48]);
  return <figure ref={target} className={`public-product-preview ${className}`}>
    <motion.div className="public-product-motion" style={{ y: reduced ? 0 : y }}><div className="public-product-frame">
      {/* Existing product capture; never a fabricated calculation or scientific result. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hero-labs-poster-960.webp" srcSet="/hero-labs-poster-480.webp 480w, /hero-labs-poster-768.webp 768w, /hero-labs-poster-960.webp 960w, /hero-labs-poster.webp 1920w" sizes="(max-width: 760px) calc(100vw - 48px), 640px" width={1920} height={1080} loading="lazy" decoding="async" alt={t('Phynite materials research workspace — example view', 'Workspace riset material Phynite — contoh tampilan')} />
    </div>
    <figcaption>{t('Phynite workspace · Example view', 'Workspace Phynite · Contoh tampilan')}</figcaption></motion.div>
  </figure>;
}

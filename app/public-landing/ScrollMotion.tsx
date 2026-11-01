'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LazyMotion, domAnimation, m, useScroll, useSpring, useTransform } from 'framer-motion';

function subscribeMotionPreference(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function useMotionPreference() {
  return useSyncExternalStore(subscribeMotionPreference, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => true);
}

function useScrollProfile() {
  const [mounted, setMounted] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const reducedMotion = useMotionPreference();
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px) and (min-height: 650px)');
    const update = () => { setDesktop(query.matches); setMounted(true); };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const active = mounted && !reducedMotion;
  return { active, desktop };
}

export function Parallax({ children, className = '', hero = false, distance = 54 }: { children: ReactNode; className?: string; hero?: boolean; distance?: number }) {
  const target = useRef<HTMLDivElement>(null);
  const { active, desktop } = useScrollProfile();
  const { scrollYProgress } = useScroll({ target, offset: hero ? ['start start', 'end start'] : ['start end', 'end start'] });
  const progress = useSpring(scrollYProgress, { stiffness: 180, damping: 35, mass: 0.4 });
  const amount = desktop ? distance : Math.min(distance, 16);
  const y = useTransform(progress, [0, 1], hero ? [0, desktop ? 56 : 16] : [amount, -amount]);
  return <div ref={target} className={hero ? 'pl-hero-parallax-track' : 'pl-parallax-track'} data-parallax={active ? 'active' : 'static'}>
    <LazyMotion features={domAnimation}><m.div className={className} style={{ y: active ? y : 0 }} initial={false}>{children}</m.div></LazyMotion>
  </div>;
}

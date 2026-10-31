'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { LazyMotion, domAnimation, m, useAnimationControls, useInView } from 'framer-motion';

import { useMotionPreference } from './ScrollMotion';

export function Reveal({ children, className = '', delay = 0, as = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'header' | 'section' }) {
  const ref = useRef<HTMLElement>(null);
  const controls = useAnimationControls();
  const reducedMotion = useMotionPreference();
  const visible = useInView(ref, { once: true, amount: 0.12 });
  useEffect(() => {
    if (reducedMotion) { controls.stop(); controls.set({ opacity: 1, y: 0 }); return; }
    if (!visible) return;
    void controls.start({ opacity: [0.8, 1], y: [12, 0], transition: { duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] } });
  }, [controls, delay, reducedMotion, visible]);
  // Never hide the server-rendered content. Motion enhances an already readable page.
  const Element = as === 'header' ? m.header : as === 'section' ? m.section : m.div;
  return <LazyMotion features={domAnimation}><Element ref={(element: HTMLElement | null) => { ref.current = element; }} className={className} initial={false} animate={controls}>{children}</Element></LazyMotion>;
}

import type { SVGProps } from 'react';

/** A stepped, filled spark on a square grid, shared by every Phynite AI entry. */
export function PhyniteAiIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="M9 3h3v5h3v3h5v3h-5v3h-3v5H9v-5H6v-3H1v-3h5V8h3zM18 2h4v4h-4z" /></svg>;
}

export function CalculationIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M9 3h6M10 3v6l-6 10a1.3 1.3 0 0 0 1.1 2h13.8a1.3 1.3 0 0 0 1.1-2L14 9V3M7.6 15h8.8" /></svg>;
}

export function FiguresIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M4 3v17h17M7 15l4-5 4 3 5-7" /></svg>;
}

export function MdLabIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" {...props}><path d="M3 7c3-2 5 2 8 0s5 2 10 0M3 12c3-2 5 2 8 0s5 2 10 0M3 17c3-2 5 2 8 0s5 2 10 0" /></svg>;
}

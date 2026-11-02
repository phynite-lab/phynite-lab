import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { localAppMode } from '@/lib/local-runtime';
import '../private-ui.css';
import './billing.css';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function PrivateLayout({children}: {children: React.ReactNode}) { if (localAppMode()) redirect('https://phynitelab.com/billing'); return children; }

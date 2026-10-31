import type { Metadata } from 'next';
import '../private-ui.css';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function PrivateLayout({children}: {children: React.ReactNode}) {return children;}

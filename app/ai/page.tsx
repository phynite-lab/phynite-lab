import type { Metadata } from 'next';
import { ResearchAccessGate } from '../research-access-gate';
import { AiProjectRedirect } from '@/components/AiProjectRedirect';

export const metadata: Metadata = { title: 'Phynite AI — Co-researcher', robots: { index: false, follow: false } };
export default function AiPage() { return <ResearchAccessGate><AiProjectRedirect /></ResearchAccessGate>; }

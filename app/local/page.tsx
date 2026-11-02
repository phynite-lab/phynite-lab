import { notFound } from 'next/navigation';
import { localAppMode } from '@/lib/local-runtime';
import { ResearchAccessGate } from '../research-access-gate';
import { LegacyLocalSettings } from './legacy-settings';

export default function LocalPage() {
  if (!localAppMode()) notFound();
  return <ResearchAccessGate><LegacyLocalSettings /></ResearchAccessGate>;
}

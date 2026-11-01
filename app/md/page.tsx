import { LegacyProjectRoute } from '@/components/LegacyProjectRoute';
import type { Metadata } from 'next';
import { MdExperience } from './md-experience';
import { ResearchAccessGate } from '../research-access-gate';

export const metadata: Metadata = {
  title: 'MD Lab — Phynite',
  description: 'Inspect molecular dynamics trajectories, analyze structure, and prepare frames for DFT in Phynite.',
};

export default function MdPage() {
  return <ResearchAccessGate><LegacyProjectRoute kind="md"><MdExperience /></LegacyProjectRoute></ResearchAccessGate>;
}

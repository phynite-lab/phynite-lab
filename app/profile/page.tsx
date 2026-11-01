import type { Metadata } from 'next';
import '../private-ui.css';
import { ResearchAccessGate } from '../research-access-gate';
import { ProfileExperience } from './profile-experience';
export const metadata: Metadata = { title: 'Research Profile — Phynite', description: 'Your private research identity and recorded jobs.', robots: { index: false, follow: false } };
export default function ProfilePage() { return <ResearchAccessGate><ProfileExperience /></ResearchAccessGate>; }

import type { Metadata } from 'next';
import { InboxExperience } from './inbox-experience';
import { ResearchAccessGate } from '../research-access-gate';
import './inbox.css';

export const metadata: Metadata = {
  title: 'Inbox — Phynite',
  description: 'Read messages and announcements for your Phynite workspace.',
};

export default function InboxPage() {
  return <ResearchAccessGate><InboxExperience /></ResearchAccessGate>;
}

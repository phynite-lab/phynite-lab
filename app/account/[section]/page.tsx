import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { AccountExperience } from '../account-experience';
import type { AccountSection } from '../../account-navigation';
import { ResearchAccessGate } from '../../research-access-gate';
import { AccountLegacyRedirect } from '../legacy-redirect';

export default async function AccountSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'admin') redirect('/developer/overview');
  if (section === 'computer' || section === 'preferences') return <AccountLegacyRedirect section={section} />;
  if (!['compute', 'ai-providers', 'usage', 'storage', 'appearance', 'keyboard', 'notifications', 'account', 'privacy'].includes(section)) notFound();
  return <ResearchAccessGate><AccountExperience section={section as AccountSection} /></ResearchAccessGate>;
}

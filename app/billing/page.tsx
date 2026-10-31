import type { Metadata } from 'next';
import { BillingExperience } from './billing-experience';
import { ResearchAccessGate } from '../research-access-gate';

export const metadata: Metadata = { title: 'Billing & Usage — Phynite', description: 'Manage your Phynite plan and review storage and compute usage.' };
export default function BillingPage() { return <ResearchAccessGate><BillingExperience /></ResearchAccessGate>; }

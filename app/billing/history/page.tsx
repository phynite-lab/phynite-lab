import type { Metadata } from 'next';
import { PaymentHistoryExperience } from '../payment-experience';
import { ResearchAccessGate } from '../../research-access-gate';
export const metadata: Metadata = { title: 'Purchase History — Phynite Lab' };
export default function PaymentHistoryPage() { return <ResearchAccessGate><PaymentHistoryExperience /></ResearchAccessGate>; }

import type { Metadata } from 'next';
import { PaymentExperience } from '../../payment-experience';
import { ResearchAccessGate } from '../../../research-access-gate';
export const metadata: Metadata = { title: 'Order Details — Phynite Lab' };
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResearchAccessGate><PaymentExperience id={id} /></ResearchAccessGate>;
}

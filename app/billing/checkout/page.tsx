import type { Metadata } from 'next';
import { CheckoutExperience } from '../payment-experience';
import { ResearchAccessGate } from '../../research-access-gate';
export const metadata: Metadata = { title: 'Checkout — Phynite Lab' };
export default function CheckoutPage() { return <ResearchAccessGate><CheckoutExperience /></ResearchAccessGate>; }

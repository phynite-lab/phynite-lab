import '../public-page-styles.css';
import { GuideDocument, guideMetadata } from '@/lib/guide-page';

export const metadata = guideMetadata('en');

export default function GuidePage() { return <GuideDocument locale="en" />; }

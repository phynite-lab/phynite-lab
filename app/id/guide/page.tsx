import '../../public-page-styles.css';
import { GuideDocument, guideMetadata } from '@/lib/guide-page';

export const metadata = guideMetadata('id');
export default function IndonesianGuidePage() { return <GuideDocument locale="id" />; }

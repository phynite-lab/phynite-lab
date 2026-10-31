import '../../../public-page-styles.css';
import { GuideDocument, guideMetadata } from '@/lib/guide-page';

type Props = { params: Promise<{ topic: string }> };
export async function generateMetadata({ params }: Props) { return guideMetadata('id', (await params).topic); }
export default async function IndonesianGuideTopicPage({ params }: Props) { return <GuideDocument locale="id" topic={(await params).topic} />; }

import '../../public-page-styles.css';
import { GuideDocument, guideMetadata } from '@/lib/guide-page';

type Props = { params: Promise<{ topic: string }> };
export async function generateMetadata({ params }: Props) { return guideMetadata('en', (await params).topic); }
export default async function GuideTopicPage({ params }: Props) { return <GuideDocument locale="en" topic={(await params).topic} />; }

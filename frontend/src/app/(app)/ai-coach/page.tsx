import type { Metadata } from 'next';
import { AiCoachView } from '@/features/ai-coach/ai-coach-view';

export const metadata: Metadata = { title: 'AI Time Coach' };

export default function AiCoachPage() {
  return <AiCoachView />;
}

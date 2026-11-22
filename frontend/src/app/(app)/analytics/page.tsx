import type { Metadata } from 'next';
import { AnalyticsView } from '@/features/analytics/analytics-view';

export const metadata: Metadata = { title: 'Productivity analytics' };

export default function AnalyticsPage() {
  return <AnalyticsView />;
}

import type { Metadata } from 'next';
import { TimeTrackingView } from '@/features/time-tracking/time-tracking-view';

export const metadata: Metadata = { title: 'Time tracking' };

export default function TimeTrackingPage() {
  return <TimeTrackingView />;
}

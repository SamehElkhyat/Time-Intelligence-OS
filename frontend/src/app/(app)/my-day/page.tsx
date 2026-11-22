import type { Metadata } from 'next';
import { MyDayView } from '@/features/my-day/my-day-view';

export const metadata: Metadata = { title: 'My day' };

export default function MyDayPage() {
  return <MyDayView />;
}

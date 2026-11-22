import type { Metadata } from 'next';
import { ProfileView } from '@/features/settings/settings-views';

export const metadata: Metadata = { title: 'Profile' };

export default function ProfilePage() {
  return <ProfileView />;
}

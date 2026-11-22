import type { Metadata } from 'next';
import { PreferencesView } from '@/features/settings/settings-views';

export const metadata: Metadata = { title: 'Preferences' };

export default function PreferencesPage() {
  return <PreferencesView />;
}

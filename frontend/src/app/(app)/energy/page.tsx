import type { Metadata } from 'next';
import { EnergyView } from '@/features/energy/energy-view';

export const metadata: Metadata = { title: 'Energy' };

export default function EnergyPage() {
  return <EnergyView />;
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TimeFlow — Time Intelligence', template: '%s · TimeFlow' },
  description: 'Understand how you spend your time, find real availability and decide what to do next.',
};

export const viewport: Viewport = { themeColor: '#090c09', colorScheme: 'dark', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

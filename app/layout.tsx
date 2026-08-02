import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { InactivityTimeoutProvider } from '@/components/providers/InactivityTimeoutConfig';
import { env } from '@/lib/env';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Property NI Multi-Tenant Portal',
  description: 'Multi-tenant property management portal for Northern Ireland',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <InactivityTimeoutProvider timeoutMins={env.INACTIVITY_TIMEOUT_MINS}>
          <Providers>{children}</Providers>
        </InactivityTimeoutProvider>
      </body>
    </html>
  );
}

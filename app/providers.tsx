'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';

export function Providers({ children }: { children: React.ReactNode }) {
  // Inactivity timeout runs unconditionally — signOutUser() is a safe no-op if no session exists.
  useInactivityTimeout();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // With SSR, we usually want to set some default staleTime above 0 to avoid refetching immediately on the client
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <>
      <Toaster position="top-right" richColors />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </>
  );
}

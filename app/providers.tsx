'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';
import { registerQueryClient } from '@/lib/query-client';

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

  // Expose the client to non-React modules (auth-client) so sign-in/out can
  // invalidate per-user cache — see lib/query-client.ts.
  useEffect(() => registerQueryClient(queryClient), [queryClient]);

  return (
    <>
      <Toaster position="top-right" richColors />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </>
  );
}

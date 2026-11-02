'use client';

import { createContext, useContext, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* ------------------------------------------------------------------ */
/*  Demo Mode Context                                                  */
/* ------------------------------------------------------------------ */

interface DemoModeContextValue {
  isDemoMode: boolean;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  isDemoMode: process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
});

export function useDemoMode(): DemoModeContextValue {
  return useContext(DemoModeContext);
}

/* ------------------------------------------------------------------ */
/*  Query Client                                                       */
/* ------------------------------------------------------------------ */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server — always create a new client
    return makeQueryClient();
  }
  // Browser — reuse across renders
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

/* ------------------------------------------------------------------ */
/*  Providers                                                          */
/* ------------------------------------------------------------------ */

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  // Fixed at build time and identical on server and client (no hydration mismatch). It must match
  // getApiClient(), which picks the mock or real client from the same variable.
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const demoValue = useMemo<DemoModeContextValue>(() => ({ isDemoMode }), [isDemoMode]);

  return (
    <QueryClientProvider client={queryClient}>
      <DemoModeContext.Provider value={demoValue}>
        {children}
      </DemoModeContext.Provider>
    </QueryClientProvider>
  );
}

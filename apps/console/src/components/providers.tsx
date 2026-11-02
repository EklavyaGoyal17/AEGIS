'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* ------------------------------------------------------------------ */
/*  Demo Mode Context                                                  */
/* ------------------------------------------------------------------ */

interface DemoModeContextValue {
  isDemoMode: boolean;
  setDemoMode: (v: boolean) => void;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  isDemoMode: true,
  setDemoMode: () => {},
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

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
    }
    return true;
  });

  const setDemoMode = useCallback((v: boolean) => {
    setIsDemoMode(v);
  }, []);

  const demoValue = useMemo<DemoModeContextValue>(
    () => ({ isDemoMode, setDemoMode }),
    [isDemoMode, setDemoMode],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DemoModeContext.Provider value={demoValue}>
        {children}
      </DemoModeContext.Provider>
    </QueryClientProvider>
  );
}

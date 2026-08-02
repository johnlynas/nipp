'use client';

import { createContext, useContext } from 'react';

interface InactivityTimeoutContextValue {
  timeoutMins: number;
}

const InactivityTimeoutContext = createContext<InactivityTimeoutContextValue>({
  timeoutMins: 15,
});

export function InactivityTimeoutProvider({
  children,
  timeoutMins,
}: {
  children: React.ReactNode;
  timeoutMins: number;
}) {
  return (
    <InactivityTimeoutContext.Provider value={{ timeoutMins }}>
      {children}
    </InactivityTimeoutContext.Provider>
  );
}

export function useInactivityTimeoutConfig(): InactivityTimeoutContextValue {
  return useContext(InactivityTimeoutContext);
}

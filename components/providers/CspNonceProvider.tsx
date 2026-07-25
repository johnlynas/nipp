'use client';

import { createContext, useContext, ReactNode } from 'react';

/**
 * CSP Nonce Context Provider
 * 
 * Provides the Content-Security-Policy nonce to child components.
 * The nonce is set by middleware in the x-csp-nonce header and consumed here.
 * 
 * Usage:
 *   <CspNonceProvider>
 *     <YourComponent />
 *   </CspNonceProvider>
 * 
 * In components:
 *   const nonce = useCspNonce();
 *   <style nonce={nonce}>...</style>
 */

const CspNonceContext = createContext<string>('');

export function CspNonceProvider({ children }: { children: ReactNode }) {
  // Get nonce from cookie or header (set by middleware)
  const getNonce = (): string => {
    if (typeof window === 'undefined') return '';
    
    // Try to get from cookie first
    const match = document.cookie.match(/x-csp-nonce=([^;]+)/);
    if (match) return match[1];
    
    // Fallback: try to get from a meta tag or generate empty nonce
    return '';
  };

  const nonce = getNonce();

  return (
    <CspNonceContext.Provider value={nonce}>
      {children}
    </CspNonceContext.Provider>
  );
}

export function useCspNonce(): string {
  return useContext(CspNonceContext);
}

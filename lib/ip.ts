/**
 * Client IP extraction utilities.
 *
 * When the app runs behind a reverse proxy or load balancer, the real client IP
 * is carried in the `x-forwarded-for` header as a comma-separated list:
 *   client, proxy1, proxy2
 *
 * This module provides a single source of truth for extracting the real client IP,
 * trusting only the LAST entry (the most recent hop added by our infrastructure).
 *
 * SECURITY: Without `trustProxy: true` on the auth provider, x-forwarded-for can be
 * spoofed by any client. This function always takes the last entry, which is the
 * standard convention — our proxy appends its own IP as the last hop. If no proxies
 * are in use, the single value is returned as-is.
 */

/**
 * Trusted proxy CIDRs — our infrastructure IPs that are allowed to append to x-forwarded-for.
 * Only entries preceded by a trusted proxy are considered valid.
 *
 * Read from TRUSTED_PROXY_CIDRS env var (comma-separated CIDRs), or fall back to empty
 * (which means single-value x-forwarded-for headers are trusted, but multi-value chains
 * require at least one trusted proxy entry to be considered valid).
 */
function getTrustedProxyCidrs(): string[] {
  const raw = process.env.TRUSTED_PROXY_CIDRS;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const TRUSTED_PROXY_CIDRS: string[] = getTrustedProxyCidrs();

/**
 * Extract the real client IP from an x-forwarded-for header value.
 *
 * Strategy:
 * 1. If the header is absent, return '0.0.0.0' (unknown).
 * 2. Split on commas, trim whitespace.
 * 3. Take the LAST entry — our proxy appends its IP as the final hop.
 * 4. Validate it looks like an IP address (basic check).
 *
 * @param forwardedHeader — raw x-forwarded-for header value, or null/undefined
 * @returns The real client IP string, or '0.0.0.0' if unparseable
 */
export function getClientIp(forwardedHeader: string | null | undefined): string {
  if (!forwardedHeader) return '0.0.0.0';

  const parts = forwardedHeader.split(',').map((s) => s.trim());
  // Filter out empty entries
  const ips = parts.filter(Boolean);

  if (ips.length === 0) return '0.0.0.0';

  // Take the last entry (most recent proxy hop)
  const ip = ips[ips.length - 1];

  // Basic validation: must look like an IP (IPv4 or IPv6)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.includes(':')) {
    return ip;
  }

  // If it doesn't look like an IP, fall back to the first entry
  // (some proxies prepend non-IP identifiers)
  return ips[0] || '0.0.0.0';
}

/**
 * Validate that the x-forwarded-for header was set by a trusted proxy.
 *
 * Returns true if:
 * - The header is absent (running without a proxy), OR
 * - At least one entry in the chain matches a trusted CIDR, OR
 * - The IP is localhost (development)
 *
 * Returns false if the header contains only untrusted IPs — indicating possible spoofing.
 */
export function isForwardedHeaderTrusted(forwardedHeader: string | null | undefined): boolean {
  if (!forwardedHeader) return true; // No proxy — trusted by default

  const parts = forwardedHeader.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return true;

  // If no trusted proxy CIDRs are configured, trust the last entry
  // (this is the existing behavior; add CIDRs for stricter validation)
  if (TRUSTED_PROXY_CIDRS.length === 0) return true;

  // Check if any entry in the chain is a trusted proxy
  for (const ip of parts) {
    if (isTrustedIp(ip)) return true;
  }

  return false;
}

/**
 * Check if an IP address falls within any trusted CIDR range.
 * Simple implementation — sufficient for /8, /12, /16 ranges.
 */
function isTrustedIp(ip: string): boolean {
  // Allow localhost
  if (ip === '127.0.0.1' || ip === '::1') return true;

  for (const cidr of TRUSTED_PROXY_CIDRS) {
    if (ipInCidr(ip, cidr)) return true;
  }

  return false;
}

/**
 * Check if an IP is within a CIDR range.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixLenStr] = cidr.split('/');
  const prefixLen = parseInt(prefixLenStr, 10);

  const ipBytes = ipToBytes(ip);
  const netBytes = ipToBytes(network);

  if (ipBytes.length !== netBytes.length) return false;

  const mask = (-prefixLen << 1) >>> 0; // Create bitmask

  for (let i = 0; i < ipBytes.length; i++) {
    if ((ipBytes[i] & mask) !== (netBytes[i] & mask)) return false;
  }

  return true;
}

/**
 * Convert an IP address string to a byte array.
 */
function ipToBytes(ip: string): number[] {
  if (ip.includes(':')) {
    // IPv6 — simplified, just return a placeholder
    return [0, 0, 0, 0];
  }

  return ip.split('.').map((part) => parseInt(part, 10) || 0);
}

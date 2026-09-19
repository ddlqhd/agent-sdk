import * as dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import type { DnsLookupFn } from '../environment.js';

function isBlockedAddress(addr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (addr.kind() === 'ipv4') {
    return addr.range() !== 'unicast';
  }
  const v6 = addr as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) {
    const v4 = v6.toIPv4Address();
    return v4.range() !== 'unicast';
  }
  return v6.range() !== 'unicast';
}

export function isDangerousIp(ip: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) {
      return true;
    }
    const addr = ipaddr.parse(ip);
    return isBlockedAddress(addr);
  } catch {
    return true;
  }
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === 'metadata') {
    return true;
  }
  if (h.endsWith('.localhost')) {
    return true;
  }
  if (h === 'metadata.google.internal') {
    return true;
  }
  if (h.endsWith('.internal')) {
    return true;
  }
  if (h.endsWith('.local')) {
    return true;
  }
  return false;
}

export function assertHttpUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are allowed, got: ${url.protocol}`);
  }
}

export async function assertResolvableHostSafe(
  hostname: string,
  lookup: DnsLookupFn = dns.promises.lookup as DnsLookupFn
): Promise<void> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  if (!results.length) {
    throw new Error('DNS lookup returned no addresses');
  }
  for (const { address } of results) {
    if (isDangerousIp(address)) {
      throw new Error(`Refused to connect: address "${address}" is not a public endpoint`);
    }
  }
}

export async function assertUrlSafeForFetch(
  url: URL,
  lookup: DnsLookupFn = dns.promises.lookup as DnsLookupFn
): Promise<void> {
  assertHttpUrl(url);
  const host = url.hostname;
  if (!host) {
    throw new Error('URL has no hostname');
  }
  if (isBlockedHostname(host)) {
    throw new Error(`Refused to connect: hostname "${host}" is blocked`);
  }
  if (ipaddr.isValid(host)) {
    if (isDangerousIp(host)) {
      throw new Error(`Refused to connect: address "${host}" is not a public endpoint`);
    }
    return;
  }
  await assertResolvableHostSafe(host, lookup);
}

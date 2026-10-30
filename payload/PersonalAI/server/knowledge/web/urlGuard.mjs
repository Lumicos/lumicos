import net from 'node:net';

function blockedIpv4(ip) {
  const parts = ip.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

export function assertSafeWebUrl(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('unsafe URL.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0') throw new TypeError('Local web URL is blocked.');
  const family = net.isIP(host);
  if (family === 4 && blockedIpv4(host)) throw new TypeError('Private IPv4 address is blocked.');
  if (family === 6 && (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))) throw new TypeError('Private IPv6 address is blocked.');
  return url;
}

export function validateRedirectChain(urls, { maxRedirects = 5 } = {}) {
  if (!Array.isArray(urls) || !urls.length || urls.length > maxRedirects + 1) throw new RangeError('Unsafe redirect chain length.');
  return urls.map((url) => assertSafeWebUrl(url).href);
}

export function validateResolvedAddresses(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) throw new TypeError('DNS resolution returned no addresses.');
  for (const entry of addresses) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    if (!address || net.isIP(address) === 0) throw new TypeError('DNS resolution returned an invalid address.');
    assertSafeWebUrl(`http://${net.isIP(address) === 6 ? `[${address}]` : address}/`);
  }
  return true;
}


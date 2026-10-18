/** Public hosting is explicit. Forwarded request headers never select a trusted origin. */
export function publicOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('APP_PUBLIC_ORIGIN must be one HTTPS origin');
  return url.origin;
}

export function trustedRequestOrigin(protocol: string, host: string, configured?: string): string {
  const external = publicOrigin(configured);
  if (external) {
    if (host.toLowerCase() !== new URL(external).host) throw new Error('Unexpected public host');
    return external;
  }
  const url = new URL(`${protocol}//${host}`);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Not a local origin');
  return url.origin;
}

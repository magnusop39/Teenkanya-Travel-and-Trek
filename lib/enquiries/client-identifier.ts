import { isIP } from 'node:net'

export function getTrustedClientIdentifier(headers: Headers) {
  // Vercel supplies x-real-ip as the client IP. Do not trust a forwarding chain as a fallback.
  const clientIp = headers.get('x-real-ip')?.trim()
  return clientIp && isIP(clientIp) !== 0 ? clientIp : null
}

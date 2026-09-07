/**
 * Unique id generation that works everywhere the app runs.
 *
 * `crypto.randomUUID` only exists in secure contexts (HTTPS / localhost), so a
 * phone visiting a dev server over LAN HTTP doesn't have it. Fall back to
 * building an RFC 4122 v4 UUID from `crypto.getRandomValues`, and only as a
 * last resort (no crypto at all) from `Math.random`.
 */

function bytesToUuid(bytes: Uint8Array): string {
  // Set the version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex: string[] = []
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

/** UUID v4 string; prefers native randomUUID, degrades gracefully without it. */
export function generateId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return bytesToUuid(bytes)
}

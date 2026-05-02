// Bookworm requires modern browser APIs to deliver its local-first guarantees:
// OPFS to store original files, IndexedDB for the structured library,
// WebCrypto to encrypt the saved API key, and a Service Worker for offline.
// We refuse silently degraded behavior — if a capability is missing we surface
// it honestly through the unsupported-browser screen.

export type Capability = 'opfs' | 'indexedDB' | 'webCrypto' | 'serviceWorker';

export type CapabilityCheck =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported'; readonly missing: readonly Capability[] };

export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  opfs: 'Origin Private File System (storing your books)',
  indexedDB: 'IndexedDB (your library catalog)',
  webCrypto: 'Web Crypto (encrypting your API key)',
  serviceWorker: 'Service Worker (offline reading)',
};

export function checkCapabilities(): CapabilityCheck {
  const missing: Capability[] = [];

  const hasOpfs =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function';
  if (!hasOpfs) missing.push('opfs');

  const hasIndexedDb = typeof indexedDB !== 'undefined';
  if (!hasIndexedDb) missing.push('indexedDB');

  const hasWebCrypto =
    typeof crypto !== 'undefined' &&
    'subtle' in crypto &&
    typeof crypto.subtle.encrypt === 'function';
  if (!hasWebCrypto) missing.push('webCrypto');

  const hasServiceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!hasServiceWorker) missing.push('serviceWorker');

  return missing.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', missing };
}

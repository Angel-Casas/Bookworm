import type { ApiKeyBlob } from '@/storage';

const SALT_BYTES = 16;
const IV_BYTES = 12;
export const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const KEY_BITS = 256;

async function deriveKey(
  passphrase: string,
  salt: BufferSource,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    [usage],
  );
}

export async function encryptKey(apiKey: string, passphrase: string): Promise<ApiKeyBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(apiKey),
  );
  return {
    salt: salt.buffer,
    iv: iv.buffer,
    ciphertext,
    iterations: PBKDF2_ITERATIONS,
  };
}

// Decrypts the blob using the passphrase. AES-GCM authentication failure
// (wrong passphrase or corrupted ciphertext) surfaces as a thrown DOMException.
export async function decryptKey(blob: ApiKeyBlob, passphrase: string): Promise<string> {
  const aesKey = await deriveKey(passphrase, blob.salt, blob.iterations, 'decrypt');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.iv },
    aesKey,
    blob.ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

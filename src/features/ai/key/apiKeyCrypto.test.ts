import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, PBKDF2_ITERATIONS } from './apiKeyCrypto';

describe('apiKeyCrypto', () => {
  it('encryptKey produces a non-trivial blob with correct iterations', async () => {
    const blob = await encryptKey('sk-secret-key', 'my-passphrase');
    expect(blob.iterations).toBe(PBKDF2_ITERATIONS);
    expect(blob.salt.byteLength).toBeGreaterThanOrEqual(16);
    expect(blob.iv.byteLength).toBe(12);
    expect(blob.ciphertext.byteLength).toBeGreaterThan(0);
  });

  it('encryptKey then decryptKey round-trips the original key', async () => {
    const original = 'sk-test-' + Math.random().toString(36).slice(2);
    const blob = await encryptKey(original, 'pp-1');
    const decrypted = await decryptKey(blob, 'pp-1');
    expect(decrypted).toBe(original);
  });

  it('decryptKey with wrong passphrase throws', async () => {
    const blob = await encryptKey('sk-test', 'right');
    await expect(decryptKey(blob, 'wrong')).rejects.toThrow();
  });

  it('decryptKey with corrupted ciphertext throws', async () => {
    const blob = await encryptKey('sk-test', 'pp');
    const ct = new Uint8Array(blob.ciphertext);
    ct[0] = ct[0] ^ 0xff;
    const corrupted = { ...blob, ciphertext: ct.buffer };
    await expect(decryptKey(corrupted, 'pp')).rejects.toThrow();
  });

  it('salt and IV are different on each encryption (no nonce reuse)', async () => {
    const blob1 = await encryptKey('sk-x', 'pp');
    const blob2 = await encryptKey('sk-x', 'pp');
    expect(new Uint8Array(blob1.salt)).not.toEqual(new Uint8Array(blob2.salt));
    expect(new Uint8Array(blob1.iv)).not.toEqual(new Uint8Array(blob2.iv));
    expect(new Uint8Array(blob1.ciphertext)).not.toEqual(new Uint8Array(blob2.ciphertext));
  });

  it('decrypts a blob encrypted with non-default iterations (forward-compat)', async () => {
    const passphrase = 'pp';
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      enc.encode('legacy-key'),
    );
    const blob = { salt: salt.buffer, iv: iv.buffer, ciphertext, iterations: 1000 };
    const decrypted = await decryptKey(blob, passphrase);
    expect(decrypted).toBe('legacy-key');
  });
});

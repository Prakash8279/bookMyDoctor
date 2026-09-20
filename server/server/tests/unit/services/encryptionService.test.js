/**
 * Unit tests for services/encryptionService.js — the AES-256-GCM field-level encryption used
 * for doctor bank/payout details (risky-item #3, docs/risky-fixes-plan-2026-09-20.md).
 *
 * config/env is left real (BANK_DETAILS_ENCRYPTION_KEY is seeded by tests/setupEnv.js with a
 * throwaway 32-byte hex key) so these tests exercise the real Node `crypto` calls, not a mock.
 */
const encryptionService = require('../../../src/services/encryptionService');
const env = require('../../../src/config/env');

describe('encryptionService.encrypt / decrypt — round trip', () => {
  test('a plaintext string round-trips exactly through encrypt then decrypt', () => {
    const encrypted = encryptionService.encrypt('123456789012');
    expect(encryptionService.decrypt(encrypted)).toBe('123456789012');
  });

  test('encrypted output is in the enc:v1: format and is not the plaintext', () => {
    const encrypted = encryptionService.encrypt('Asha Rao');
    expect(encrypted).not.toBe('Asha Rao');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encryptionService.isEncrypted(encrypted)).toBe(true);
  });

  test('encrypting the same plaintext twice produces different ciphertext (random IV per call)', () => {
    const first = encryptionService.encrypt('HDFC0001234');
    const second = encryptionService.encrypt('HDFC0001234');
    expect(first).not.toBe(second);
    expect(encryptionService.decrypt(first)).toBe('HDFC0001234');
    expect(encryptionService.decrypt(second)).toBe('HDFC0001234');
  });

  test('null and undefined pass through both encrypt and decrypt unchanged', () => {
    expect(encryptionService.encrypt(null)).toBeNull();
    expect(encryptionService.encrypt(undefined)).toBeUndefined();
    expect(encryptionService.decrypt(null)).toBeNull();
    expect(encryptionService.decrypt(undefined)).toBeUndefined();
  });

  test('encrypting an already-encrypted value is a no-op (never double-encrypts)', () => {
    const once = encryptionService.encrypt('asha@okhdfcbank');
    const twice = encryptionService.encrypt(once);
    expect(twice).toBe(once);
    expect(encryptionService.decrypt(twice)).toBe('asha@okhdfcbank');
  });
});

describe('encryptionService.decrypt — legacy plaintext passthrough', () => {
  test('a value without the enc:v1: prefix is treated as pre-migration plaintext and returned as-is', () => {
    expect(encryptionService.decrypt('HDFC Bank')).toBe('HDFC Bank');
    expect(encryptionService.isEncrypted('HDFC Bank')).toBe(false);
  });
});

describe('encryptionService — tamper detection', () => {
  test('a corrupted ciphertext fails to decrypt instead of silently returning garbled data', () => {
    const encrypted = encryptionService.encrypt('123456789012');
    // Flip one bit in the middle of the decoded (iv || authTag || ciphertext) buffer, then
    // re-encode to base64 — flipping raw bytes this way (rather than a base64 CHARACTER, which
    // can land on trailing '=' padding that Node's decoder ignores, leaving the decoded bytes
    // unchanged) reliably corrupts either the ciphertext or the GCM auth tag either of which
    // must make decrypt() reject the value instead of returning garbled/wrong plaintext.
    const payload = Buffer.from(encrypted.slice('enc:v1:'.length), 'base64');
    payload[Math.floor(payload.length / 2)] ^= 0xff;
    const tampered = 'enc:v1:' + payload.toString('base64');
    expect(() => encryptionService.decrypt(tampered)).toThrow();
  });
});

describe('encryptionService — key configuration', () => {
  const originalKey = env.bankDetailsEncryptionKey;
  afterEach(() => {
    env.bankDetailsEncryptionKey = originalKey;
  });

  test('encrypt() throws EncryptionNotConfiguredError when no key is set', () => {
    env.bankDetailsEncryptionKey = '';
    expect(() => encryptionService.encrypt('123456789012')).toThrow(encryptionService.EncryptionNotConfiguredError);
  });

  test('decrypt() throws EncryptionNotConfiguredError only when it actually needs the key (an encrypted value with no key set)', () => {
    const encrypted = encryptionService.encrypt('123456789012'); // key is present here
    env.bankDetailsEncryptionKey = '';
    expect(() => encryptionService.decrypt(encrypted)).toThrow(encryptionService.EncryptionNotConfiguredError);
    // But a not-yet-migrated plaintext row must still read fine with no key configured at all.
    expect(encryptionService.decrypt('plain legacy value')).toBe('plain legacy value');
  });

  test('a key of the wrong length is rejected with a clear error', () => {
    env.bankDetailsEncryptionKey = 'too-short';
    expect(() => encryptionService.encrypt('x')).toThrow(/64-character hex string/);
  });
});

describe('encryptionService.BANK_DETAIL_FIELDS', () => {
  test('covers all 5 doctor_profiles bank/payout columns (not just the 3 originally named)', () => {
    expect(encryptionService.BANK_DETAIL_FIELDS.sort()).toEqual(
      ['bankAccountHolderName', 'bankAccountNumber', 'bankIfscCode', 'bankName', 'bankUpiId'].sort()
    );
  });
});

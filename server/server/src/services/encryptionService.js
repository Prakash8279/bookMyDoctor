/**
 * Field-level AES-256-GCM encryption for at-rest storage of a doctor's bank/payout details.
 *
 * SECURITY FIX (risky-item #3 from docs/risky-fixes-plan-2026-09-20.md — "doctor bank details
 * are stored as plain-text columns in doctor_profiles; anyone with DB/backup access reads them
 * straight off"). This service is the ONLY place that ever calls Node's `crypto` for this
 * purpose — every read/write path for these fields goes through `encrypt()`/`decrypt()` here
 * (see doctors.service.js#shapeDoctor and me.service.js#updateMe/#buildProfile) instead of each
 * call site rolling its own crypto.
 *
 * BANK_DETAIL_FIELDS covers all 5 columns actually on DoctorProfile (prisma/schema.prisma) —
 * bankAccountHolderName, bankAccountNumber, bankIfscCode, bankName, bankUpiId. The original
 * security audit and the first draft of the risky-fixes plan named only the first 3; bankName
 * and bankUpiId were found to be equally plaintext-sensitive payout fields while wiring this in,
 * so all 5 are encrypted for consistency — flagged here so it's visible in one place, not buried
 * in a diff.
 *
 * Format on disk: `enc:v1:<base64(iv || authTag || ciphertext)>`.
 *   - A versioned, explicitly-tagged prefix (not bare base64) so a future algorithm/format change
 *     (`enc:v2:...`) can be introduced without ambiguity about which rows are which.
 *   - `decrypt()` treats any string WITHOUT the `enc:v1:` prefix as legacy plaintext and returns
 *     it unchanged, rather than throwing. This is deliberate, not a leniency bug: it's what lets
 *     existing plaintext rows keep reading correctly right up until the one-time migration script
 *     (scripts/encryptExistingBankDetails.js) re-saves them encrypted — the app never needs a
 *     flag-day cutover, and a doctor's bank details are never bounced/hidden just because the
 *     migration hasn't run yet on this row.
 *   - A 12-byte (96-bit) random IV per encryption call, as NIST SP 800-38D recommends for GCM —
 *     never reused, so two calls encrypting the identical plaintext produce different ciphertext.
 *   - The 16-byte GCM auth tag is stored alongside the ciphertext (not discarded), so any
 *     tampering with the stored value is detected as a decryption failure rather than silently
 *     producing garbled plaintext.
 *
 * Key handling: BANK_DETAILS_ENCRYPTION_KEY (config/env.js#bankDetailsEncryptionKey) is a
 * 64-character hex string (32 raw bytes) the OPERATOR generates themselves, e.g.:
 *   openssl rand -hex 32
 * This service never generates, logs, or persists that key — see .env.example's comment on this
 * var and the standing project rule that secrets are always the user's own to create and enter.
 */
const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;
const PREFIX = 'enc:v1:';

// All doctor_profiles columns this service is responsible for. Exported so
// scripts/encryptExistingBankDetails.js and any future caller iterate the same list instead of
// re-typing it — a 6th field added later only needs to be added here.
const BANK_DETAIL_FIELDS = [
  'bankAccountHolderName',
  'bankAccountNumber',
  'bankIfscCode',
  'bankName',
  'bankUpiId',
];

class EncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      'BANK_DETAILS_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -hex 32` ' +
        'and set it in your real .env — see .env.example for details.'
    );
    this.name = 'EncryptionNotConfiguredError';
  }
}

function getKey() {
  const hex = env.bankDetailsEncryptionKey;
  if (!hex) {
    throw new EncryptionNotConfiguredError();
  }
  let key;
  try {
    key = Buffer.from(hex, 'hex');
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `BANK_DETAILS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) — got ${key.length} bytes. ` +
        'Generate one with `openssl rand -hex 32`.'
    );
  }
  return key;
}

/** True for a value already in this service's `enc:v1:` on-disk format. */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypts a single plaintext field value for storage. `null`/`undefined` pass through
 * unchanged (a doctor clearing a field stays a clean SQL NULL, never "encrypted emptiness").
 * Throws EncryptionNotConfiguredError if BANK_DETAILS_ENCRYPTION_KEY isn't set — callers should
 * check that case explicitly beforehand to surface a clean 503 instead of a bare 500 (see
 * me.service.js#updateMe).
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted — never double-encrypt

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypts a stored field value back to plaintext. `null`/`undefined` pass through unchanged.
 * A value NOT in `enc:v1:` format is assumed to be legacy plaintext (pre-migration row) and is
 * returned as-is — see the header comment above for why this is intentional.
 */
function decrypt(stored) {
  if (stored === null || stored === undefined) return stored;
  if (!isEncrypted(stored)) return stored;

  const key = getKey();
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = {
  BANK_DETAIL_FIELDS,
  EncryptionNotConfiguredError,
  isEncrypted,
  encrypt,
  decrypt,
};

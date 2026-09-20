#!/usr/bin/env node
/**
 * ONE-TIME, idempotent live-data migration for risky-item #3
 * (docs/risky-fixes-plan-2026-09-20.md — "doctor bank details are stored plaintext in
 * doctor_profiles").
 *
 * WHAT THIS DOES: reads every doctor_profiles row that has at least one of the 5 bank/payout
 * fields (bankAccountHolderName, bankAccountNumber, bankIfscCode, bankName, bankUpiId) set, and
 * re-saves any of those fields that are still plain text as `enc:v1:...` ciphertext (see
 * src/services/encryptionService.js for the AES-256-GCM format). A field already in that format
 * is left untouched — running this script twice (or a hundred times) is always safe.
 *
 * WHO RUNS THIS: YOU, the operator, against your real database. This is a plain Node script
 * (not a Prisma migration .sql file) because it needs application-level encryption logic, not
 * just schema DDL — but it is still exactly the kind of "touches real production data" operation
 * that must run under your own control, with your own eyes on the output, not from an AI
 * assistant's sandbox (which in any case has no network route to your real Postgres).
 *
 * HOW TO RUN:
 *   1. Make sure BANK_DETAILS_ENCRYPTION_KEY is set in your real server/server/.env (generate it
 *      yourself first — `openssl rand -hex 32` — if you haven't already; see .env.example).
 *   2. Take a database backup/snapshot first. This script only ever UPDATEs 5 named columns on
 *      doctor_profiles (never deletes rows, never touches any other table), but "back up before
 *      any live-data script" is a good habit regardless of how narrow the script is.
 *   3. Dry run first to see exactly what it would change, with zero writes:
 *        node scripts/encryptExistingBankDetails.js --dry-run
 *   4. Then run for real:
 *        node scripts/encryptExistingBankDetails.js
 *   5. Re-running it afterwards (accidentally or to confirm) is safe and a no-op — every row it
 *      finds will already be fully encrypted, so it reports 0 rows changed.
 */
const encryptionService = require('../src/services/encryptionService');
const { BANK_DETAIL_FIELDS } = encryptionService;

const BATCH_SIZE = 200;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.BANK_DETAILS_ENCRYPTION_KEY) {
    console.error(
      '[encryptExistingBankDetails] BANK_DETAILS_ENCRYPTION_KEY is not set in your environment.\n' +
        'Set it in server/server/.env first (generate one yourself with `openssl rand -hex 32`),\n' +
        'then re-run this script. Refusing to continue — there is nothing safe to do without a key.'
    );
    process.exitCode = 1;
    return;
  }

  // Required only now, after the key-presence check above, so the "key missing" message prints
  // even if this script is somehow run without DATABASE_URL configured either — a clearer first
  // error to fix than a raw Prisma connection failure.
  const prisma = require('../src/config/db');

  console.log(`[encryptExistingBankDetails] Starting${DRY_RUN ? ' (DRY RUN — no writes will happen)' : ''}...`);

  let cursor;
  let scanned = 0;
  let candidates = 0; // rows with at least one bank field set (plaintext or already-encrypted)
  let updated = 0; // rows where at least one field actually needed encrypting
  let fieldsEncrypted = 0; // total individual field values encrypted, across all rows

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await prisma.doctorProfile.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {}),
      orderBy: { userId: 'asc' },
      select: {
        userId: true,
        bankAccountHolderName: true,
        bankAccountNumber: true,
        bankIfscCode: true,
        bankName: true,
        bankUpiId: true,
      },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      scanned += 1;
      const hasAnyBankValue = BANK_DETAIL_FIELDS.some((field) => row[field] !== null && row[field] !== undefined);
      if (!hasAnyBankValue) continue;
      candidates += 1;

      const updates = {};
      for (const field of BANK_DETAIL_FIELDS) {
        const value = row[field];
        if (value !== null && value !== undefined && !encryptionService.isEncrypted(value)) {
          updates[field] = encryptionService.encrypt(value);
        }
      }

      const fieldsToUpdate = Object.keys(updates);
      if (fieldsToUpdate.length === 0) continue; // already fully encrypted — nothing to do

      updated += 1;
      fieldsEncrypted += fieldsToUpdate.length;
      console.log(
        `[encryptExistingBankDetails] doctor userId=${row.userId}: encrypting ${fieldsToUpdate.join(', ')}` +
          (DRY_RUN ? ' (dry run — not written)' : '')
      );

      if (!DRY_RUN) {
        // eslint-disable-next-line no-await-in-loop
        await prisma.doctorProfile.update({ where: { userId: row.userId }, data: updates });
      }
    }

    cursor = batch[batch.length - 1].userId;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log(
    `[encryptExistingBankDetails] Done. Scanned ${scanned} doctor profile(s), ${candidates} had bank details, ` +
      `${updated} row(s) updated (${fieldsEncrypted} field value(s) encrypted)` +
      `${DRY_RUN ? ' — DRY RUN, nothing was actually written. Re-run without --dry-run to apply.' : '.'}`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[encryptExistingBankDetails] Failed:', err);
  try {
    await require('../src/config/db').$disconnect();
  } catch {
    /* already disconnected or never connected — ignore */
  }
  process.exitCode = 1;
});

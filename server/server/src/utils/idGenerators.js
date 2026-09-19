/**
 * Server-side generators for human-facing sequential ids (payment receipt numbers, booking ids)
 * that must be unique and monotonic — backed by a Postgres SEQUENCE, never Math.random()/array-index
 * like the current frontend does. Responsibility: one place that talks to the DB sequence.
 */
const prisma = require('../config/db');

/**
 * Draws the next value from the `payment_receipt_seq` Postgres sequence (created in
 * prisma/manual_sql/001_constraints_and_triggers.sql) and formats it as CDR-00000001.
 * Every call returns a distinct, monotonically increasing number — safe under concurrency
 * because Postgres sequences are atomic, no application-level locking needed.
 * @returns {Promise<string>}
 */
async function nextReceiptNumber() {
  const rows = await prisma.$queryRaw`SELECT nextval('payment_receipt_seq') AS value`;
  const value = rows[0].value; // BigInt from node-postgres
  return `CDR-${value.toString().padStart(8, '0')}`;
}

module.exports = { nextReceiptNumber };

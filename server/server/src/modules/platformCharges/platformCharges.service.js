/**
 * Business logic for the platformCharges module.
 * Responsibility: all Prisma calls, ownership/role shaping, and business-rule validation for the
 * platform_charges singleton row live here. Controllers call these functions; these functions
 * never touch req/res directly.
 */
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { ADMIN_ROLES } = require('../../utils/roles');

/**
 * FLAGGED DESIGN DECISION (see phase plan): commissionPercent is masked out of the GET response
 * for every non-admin role, even though the brief's "masked per role" language was written with
 * payments/appointments responses primarily in mind, not this config-preview endpoint. Rule 8
 * names `commission` explicitly as a field that must never reach doctor/receptionist, and
 * commissionPercent is the platform's internal margin baked into every consultation fee — a
 * patient, doctor, or receptionist has no legitimate need to see it, whereas the other four
 * fields here are exactly the inputs a booking price-preview screen needs. Documented here per
 * the same convention as the receptionist_profiles.clinicId gap note in schema.prisma.
 * @param {object} row - raw platform_charges row.
 * @param {string} role
 */
function shapeCharges(row, role) {
  const base = {
    patientConvenienceFee: row.patientConvenienceFee,
    emergencyFee: row.emergencyFee,
    gstPercent: row.gstPercent,
    applyConvenienceFee: row.applyConvenienceFee,
    applyEmergencyFee: row.applyEmergencyFee,
  };
  if (ADMIN_ROLES.includes(role)) {
    return { ...base, commissionPercent: row.commissionPercent };
  }
  return base;
}

/**
 * @param {string} role
 */
async function getPlatformCharges(role) {
  const row = await prisma.platformCharges.findUnique({ where: { id: 1 } });
  if (!row) {
    // Shouldn't happen once manual_sql/001 has been run (it seeds id=1) — a 500, not a 404,
    // since this is a platform misconfiguration, not a missing resource a client could ever
    // legitimately request by id.
    throw new ApiError(500, 'PLATFORM_CHARGES_NOT_CONFIGURED', 'Platform charges are not configured.');
  }
  return shapeCharges(row, role);
}

/**
 * Full-replace upsert of the singleton platform_charges row. ALWAYS targets id:1 — never a bare
 * `create` — so a second row can never appear (task requirement, matching the CHECK(id=1)
 * constraint in manual_sql/001 as a backstop, not a substitute for this).
 * @param {object} body - already shape-validated by platformCharges.validation.js#updateCharges.
 * @param {{id:string, role:string}} actor
 */
async function updatePlatformCharges(body, actor) {
  const data = {
    commissionPercent: new Prisma.Decimal(body.commissionPercent),
    patientConvenienceFee: new Prisma.Decimal(body.patientConvenienceFee),
    emergencyFee: new Prisma.Decimal(body.emergencyFee),
    gstPercent: new Prisma.Decimal(body.gstPercent),
    applyConvenienceFee: body.applyConvenienceFee === true,
    applyEmergencyFee: body.applyEmergencyFee === true,
  };

  const row = await prisma.platformCharges.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'platformCharges.update',
    targetEntityType: 'platformCharges',
    targetEntityId: '1',
    description: 'Updated platform charges configuration',
  });

  // commissionPercent (and the fee fields) are baked into every cached listPayments page's
  // commission/clinicPayout figures — every scope's cache (patient/doctor/receptionist/admin)
  // depends on this singleton row, so bust the whole cache:payments:list:* namespace rather
  // than a single scope, matching the broad-wildcard convention used elsewhere in this codebase
  // for a write that affects every cached list page (e.g. doctors.service.js's
  // invalidateDoctorCaches, contact.service.js's cache:contact:list:*).
  await cacheService.invalidate('cache:payments:list:*');
  // FIX (cache-invalidation audit): appointments.service.js#listAppointments also bakes
  // commission/clinicPayout (via shapeFees, computed from this same singleton row) into its own
  // cached admin/superadmin list pages — missing this left a changed commission rate showing
  // stale commission/clinicPayout figures on the admin appointments list for up to its own TTL
  // after a rate change, even though the payments list above was correctly busted.
  await cacheService.invalidate('cache:appointments:list:admin:*');

  // Caller is already admin-only (enforced by authorize('admin','superadmin') at the route
  // layer) — return the full unmasked row, no shaping needed.
  return row;
}

module.exports = { getPlatformCharges, updatePlatformCharges };

/**
 * Shared formula for the patient-facing "pay the minimum now, rest at the clinic" booking option
 * (BUG FIX — superadmin request, Hinglish: "minimum me platform charge + joo minimum fee doctor
 * decide kiya hai ushka percentage jo admin decide kiya hai").
 *
 * Previously the "Minimum booking amount" shown to the patient — and the amount actually charged
 * via Razorpay for that option — was just the doctor's raw `minBookingAdvanceAmount`, with ZERO
 * platform cut baked in. If a patient chose to pay only the minimum, the platform collected
 * nothing at all on that transaction, unlike the "pay full amount" option (whose totalAmount
 * already bakes in convenience/emergency fee + GST on top of the consultation fee).
 *
 * Fixed formula:
 *   minBookingAmount = platformCharge + (doctor's minBookingAdvanceAmount x admin's commissionPercent / 100)
 * where platformCharge = totalAmount - consultationFee (this booking's convenience fee +
 * emergency fee + GST, whichever applied — the same figure the admin dashboard now calls
 * "platform commission" per the consultation-fee-ownership change made earlier this session; see
 * appointments.service.js#shapeFees / payments.service.js#shapePaymentFees).
 *
 * commissionPercent itself must NEVER reach a patient/doctor/receptionist response (rule 8) — only
 * this already-computed rupee total may. Both the read path (what the patient is SHOWN, in
 * appointments.service.js#shapeFees) and the charge path (what the patient is actually CHARGED,
 * in razorpay.service.js#createOrder) must call this exact same function so the two can never
 * drift apart again — that mismatch was the root of this bug.
 *
 * All amounts are plain rupee numbers (not Prisma.Decimal) — callers pass `Number(...)` of their
 * Decimal fields; this returns a plain number rounded to 2 decimals, or null when there is nothing
 * to compute (no doctor minimum configured, or platform charges not configured yet).
 *
 * @param {{totalAmount: number, consultationFee: number, minBookingAdvanceAmount: number|null, commissionPercent: number|null}} input
 * @returns {number|null}
 */
function computeMinBookingAmount({ totalAmount, consultationFee, minBookingAdvanceAmount, commissionPercent }) {
  if (minBookingAdvanceAmount == null || Number(minBookingAdvanceAmount) <= 0) return null;
  if (commissionPercent == null) return null;

  const platformCharge = Number(totalAmount) - Number(consultationFee);
  let amount = platformCharge + (Number(minBookingAdvanceAmount) * Number(commissionPercent)) / 100;
  amount = Math.round(amount * 100) / 100;

  // Safety clamps: never below 0, never above the booking's own full total (a very high doctor
  // minimum + commissionPercent could otherwise overshoot totalAmount).
  const cap = Math.round(Number(totalAmount) * 100) / 100;
  if (amount > cap) amount = cap;
  if (amount < 0) amount = 0;
  return amount;
}

module.exports = { computeMinBookingAmount };

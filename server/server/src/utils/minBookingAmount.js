/**
 * Shared formula for the patient-facing "pay the minimum now, rest at the clinic" booking option
 * (BUG FIX — superadmin request).
 *
 * Previously the "Minimum booking amount" shown to the patient — and the amount actually charged
 * via Razorpay for that option — was just the doctor's raw `minBookingAdvanceAmount`, with ZERO
 * platform cut baked in. If a patient chose to pay only the minimum, the platform collected
 * nothing at all on that transaction, unlike the "pay full amount" option (whose totalAmount
 * already bakes in convenience/emergency fee + GST on top of the consultation fee).
 *
 * The superadmin spelled out the exact formula with a worked example (Hinglish): "platform charge
 * 25 hai and percentage 3 hai, doctor fee 400 hai to koi patient full payment karta hai to
 * 400+25+3%=437.75 [400+25, then +3% of that 425 subtotal]. koi minimum charge pay karta hai tab
 * 100 charge doctor rakha hai to 100+25+100 ka 3%=128" — i.e. the minimum-booking breakdown
 * mirrors the full-payment breakdown exactly, just with the doctor's minBookingAdvanceAmount
 * standing in for the full consultationFee:
 *
 *   minBookingAmount = minBookingAdvanceAmount
 *                     + platformCharge (this booking's convenienceFee + emergencyFee — the same
 *                       flat amount the full payment charged; mutually exclusive, one is always 0)
 *                     + GST on the minimum fee ALONE (not on the platform charge — deliberately
 *                       asymmetric with the full-payment GST base, which is charged on
 *                       consultationFee + platformCharge together; see the worked example above,
 *                       where 3% is taken of the bare 100, not of 100+25).
 *
 * The GST rate itself is never stored as a bare percent on the appointment row (only the rupee
 * gstAmount is) — nor is it safe to just re-fetch the live Platform Charges config, since rates
 * can change after a booking was made. Instead the rate actually charged on THIS booking is
 * derived from its own stored fields: gstAmount / (consultationFee + platformCharge). This also
 * makes GST naturally 0 for a walk-in booking (source != 'online' never charges GST, so
 * gstAmount is already 0 on the row) without any extra branching here.
 *
 * Both the read path (what the patient is SHOWN, in appointments.service.js#shapeFees) and the
 * charge path (what the patient is actually CHARGED, in razorpay.service.js#createOrder) must
 * call this exact same function so the two can never drift apart again — that mismatch was the
 * root of the original bug.
 *
 * All amounts are plain rupee numbers (not Prisma.Decimal) — callers pass `Number(...)` of their
 * Decimal fields; this returns a plain number rounded to 2 decimals, or null when there is
 * nothing to compute (the doctor hasn't configured a minimum).
 *
 * @param {{consultationFee: number, convenienceFee: number, emergencyFee: number, gstAmount: number, minBookingAdvanceAmount: number|null}} input
 * @returns {number|null}
 */
function computeMinBookingAmount({ consultationFee, convenienceFee, emergencyFee, gstAmount, minBookingAdvanceAmount }) {
  if (minBookingAdvanceAmount == null || Number(minBookingAdvanceAmount) <= 0) return null;

  const minAdvance = Number(minBookingAdvanceAmount);
  const platformCharge = Number(convenienceFee || 0) + Number(emergencyFee || 0);
  const subtotal = Number(consultationFee) + platformCharge;
  // Implied GST rate actually charged on this booking (0 when there's no subtotal to divide by,
  // or when this was never a GST-charged booking to begin with — same result either way).
  const gstRate = subtotal > 0 ? Number(gstAmount || 0) / subtotal : 0;

  let amount = minAdvance + platformCharge + minAdvance * gstRate;
  amount = Math.round(amount * 100) / 100;

  // Safety clamp: never below 0 (defensive only — every input here is itself non-negative).
  if (amount < 0) amount = 0;
  return amount;
}

/**
 * The counterpart to computeMinBookingAmount above: what's left to collect AT THE CLINIC once the
 * minimum has been paid online (BUG FIX — superadmin request: "309 kyu bach raha hai 300 bachna
 * chahiye" — the UI was showing totalAmount - minBookingAmount as the clinic-collected remainder,
 * which double-subtracts the platform charge and GST that were already fully settled online).
 *
 * The clinic only ever collects the doctor's own outstanding consultation-fee share — never any
 * further platform charge or GST on top:
 *
 *   minBookingRemainder = consultationFee - minBookingAdvanceAmount
 *
 * Worked example: consultationFee 400, minBookingAdvanceAmount 100 -> remainder 300 (not
 * totalAmount(437.75) - minBookingAmount(128) = 309.75). This is intentionally NOT a shortfall:
 * the platform's convenience/emergency charge is paid in full online regardless of which option
 * the patient picks, and GST only ever applies to whatever portion of the consultation fee was
 * actually processed through the online gateway (the ₹100 minimum here, never the clinic-collected
 * cash/card/UPI remainder) — so nothing is left uncollected once this remainder is paid; the
 * booking settles at ₹128 + ₹300 = ₹428 total, deliberately less than the ₹437.75 "pay in full
 * online" total, because less of the consultation fee went through the gateway.
 *
 * Once this remainder is paid, the appointment is fully settled — see
 * payments.service.js#createPaymentForAppointment, which marks it 'paid' unconditionally on this
 * path rather than re-comparing against totalAmount.
 *
 * @param {{consultationFee: number, minBookingAdvanceAmount: number|null}} input
 * @returns {number|null} null when the doctor never configured a minimum (nothing to reconcile).
 */
function computeMinBookingRemainder({ consultationFee, minBookingAdvanceAmount }) {
  if (minBookingAdvanceAmount == null || Number(minBookingAdvanceAmount) <= 0) return null;

  let remainder = Number(consultationFee) - Number(minBookingAdvanceAmount);
  remainder = Math.round(remainder * 100) / 100;
  if (remainder < 0) remainder = 0;
  return remainder;
}

module.exports = { computeMinBookingAmount, computeMinBookingRemainder };

// Shared display-formatting helpers.
// Extracted from independent copies in PatientPages.jsx, FeaturePages.jsx,
// PortalSectionPages.jsx (all three module-level, byte-identical `formatDate`), a fourth,
// slightly different inline `formatDate` in AdminPages.jsx (lacked the invalid-date fallback),
// AdminPages.jsx/PlatformCharges.jsx (`money`/`formatMoney`, byte-identical), and
// AdminPages.jsx/StaffPages.jsx (`shortId`, identical apart from the display prefix) —
// found during the duplication audit (2026-09-05).

/**
 * Formats a date value as "DD Mon YYYY" (en-IN), or an em dash for a falsy/invalid value.
 * @param {string|number|Date|null|undefined} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Formats a number as an Indian-locale rupee amount, e.g. "₹1,234.5".
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatMoney(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/**
 * Same number formatting as formatMoney, but with an ASCII "Rs." prefix instead of the "₹"
 * glyph. Used only when the text is going somewhere that can't guarantee a Unicode-capable font
 * — currently just the from-scratch PDF receipts in lib/pdf.js, which draw text with the PDF
 * standard Helvetica font (WinAnsiEncoding: no Rupee sign glyph) rather than an embedded Unicode
 * font, so a literal "₹" there would render as a missing-glyph box instead of the amount.
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatMoneyPlain(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/**
 * Shortens an id (optionally `prefix_uuid`-shaped) to a display-friendly `<prefix><last 4 chars>`
 * string, e.g. shortId('appt_9f8e7d6c5b4a') -> '#5b4a'. One fixed format across the whole app
 * (AdminPages previously used a 'DC-' prefix here — dropped so every table shows the same '#xxxx'
 * shape, per user request "id aur chota kro ekk formar me kro").
 * @param {string|number|null|undefined} id
 * @param {string} [prefix] - defaults to '#'
 * @returns {string}
 */
export function shortId(id, prefix = '#') {
  const raw = String(id || '')
  const tail = raw.includes('_') ? raw.split('_').pop() : raw
  return `${prefix}${tail.slice(-4)}`
}

/**
 * Formats a 0-based row position as a running display number: sequenceId(0) -> 'DC01',
 * sequenceId(1) -> 'DC02', sequenceId(24) -> 'DC25'. Used for the leading "ID" column shown to
 * patients/doctors/admins in a table — a simple DC01, DC02, DC03… sequence per user request
 * ("dc01 se start keo dc02..... esh formate me kro") — NOT the database id, so it is only for
 * on-screen row numbering, never for a downloadable filename or a receipt/booking reference that
 * must stay tied to one specific record (those keep using shortId()).
 * @param {number} index - 0-based position in the currently displayed list
 * @param {string} [prefix] - defaults to 'DC'
 * @returns {string}
 */
export function sequenceId(index, prefix = 'DC') {
  const n = Number(index) + 1
  return `${prefix}${String(n).padStart(2, '0')}`
}

/**
 * Formats a real, server-stored sequential number (User.patientNumber / DoctorProfile.doctorNumber
 * / Clinic.clinicNumber — assigned once at registration/creation, see prisma/migrations/
 * 20260919130000_add_patient_doctor_clinic_numbers) as a stable display id: stableId(1, 'DCP') ->
 * 'DCP1', stableId(23, 'DCD') -> 'DCD23'. Unlike sequenceId() above, this number is NOT derived
 * from a row's position in whatever filtered/sorted/paginated list happens to be on screen right
 * now — it's the actual stored identity of that one patient/doctor/clinic, so it stays the same
 * everywhere that record's data appears, regardless of search/sort/pagination (per user request:
 * "ek patient ko dcp1 mil hya to ushka data jaha v ja raha hai waha same id jaye").
 *
 * A legacy row created before this column existed and somehow not yet backfilled by the migration
 * shows the fallback below instead of a blank/NaN cell — this should be rare in practice (the
 * migration backfills every existing row), but a formatter must never crash a table render over
 * one bad value.
 * @param {number|string|null|undefined} number - the stored patientNumber/doctorNumber/clinicNumber
 * @param {string} prefix - 'DCP' | 'DCD' | 'DCC' (no default: callers must be explicit about which)
 * @returns {string}
 */
export function stableId(number, prefix) {
  if (number === null || number === undefined || number === '') return `${prefix}—`
  const n = Number(number)
  return Number.isFinite(n) ? `${prefix}${n}` : `${prefix}—`
}

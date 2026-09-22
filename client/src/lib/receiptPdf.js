// Proper PDF receipt/slip generation, used by every "view/download slip" / "view/download
// receipt" button across the app (previously each one wrote a plain .txt file via a Blob — see
// the git history of PatientPages.jsx's old `downloadSlip`/`download` functions — missing a lot
// of the data a real clinic receipt needs: clinic address, doctor specialization, a proper fee
// breakdown, an issue timestamp, etc.). Built on the from-scratch PDF writer in lib/pdf.js (no
// external library — see that file's header comment for why).
//
// Split into pure "build*Sections" data functions (easy to unit-test without touching the PDF
// writer at all) and thin "build*PdfBlob" functions that render the doc and hand back a Blob +
// suggested filename — never trigger a download themselves.
//
// VIEW-THEN-DOWNLOAD (request: "booking slip ke jagah view ka option do view open hone ke bad
// download ka option ho", then "baki jagah v same kar do jaha slip download ho raha hai" — apply
// the same thing everywhere a slip/receipt PDF is produced): every one of these used to trigger an
// immediate save via lib/pdf.js's `downloadBlob`. They now only build the Blob; every call site
// opens it in the shared PdfPreviewModal (components/PdfPreviewModal.jsx, via the
// hooks/usePdfPreview.js hook) and offers the actual save-to-disk action from inside that preview.
//
// BRANDING (logo + color theme, per request "pdf me logo add karo header me mera colorthem v add
// kar do"): every receipt/slip header now carries the app's own brand mark (see lib/brandLogo.js —
// the same icon used for the browser favicon, rasterized to a raw image the PDF can embed) next to
// the title, and the brand color (theme.js's `primary`, #ad5d3b) tints the title, the header rule,
// each section heading, and the totals box — instead of plain black/gray throughout.
import { createPdfDoc, hexToRgb01 } from './pdf'
import { formatDate, formatMoneyPlain, shortId } from './format'
import { loadBrandLogoRgb } from './brandLogo'
import { theme } from './theme'
import { isOnlineBookingPayment } from './paymentVisibility'

// COMPLETENESS ADD (request: "online booking ke time pe kitna payment hua hai and second clinic pe
// aake cash ya online ye v to confirm hona chahiye", then "... pdf mr v ye aana chahiye") — the
// same "paid online at booking" / "collected at the clinic" confirmation shown on the
// receptionist/doctor, patient, and admin Payments tables (components/PaymentSourceBadge.jsx) is
// spelled out here as plain text next to the Mode row, since a PDF has no badge to render.
function paymentSourceLabel(item) {
  if (!item.mode) return undefined
  return isOnlineBookingPayment(item) ? 'Paid online at booking' : 'Collected at clinic'
}

const BRAND = hexToRgb01(theme.primary) // #ad5d3b
const BRAND_TINT = hexToRgb01('#f5e9e3') // theme's primaryLight — the totals-box background

function issuedNowLines() {
  const now = new Date()
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return `${formatDate(now)}, ${time}`
}

/**
 * Lays out a receipt-shaped document (a branded title/logo header, a subtitle, a meta block,
 * labeled sections, an optional highlighted totals box, and a footer) and returns the PDF doc —
 * callers decide the filename and trigger the download. Paginates automatically if content
 * overflows one page. Async only because the header logo is loaded (and rasterized) lazily — see
 * lib/brandLogo.js; if that fails or isn't available (e.g. no 2D canvas), the header still renders
 * correctly, just without the logo image.
 * @param {{title: string, subtitle?: string, meta?: string[], sections: {heading: string, rows: [string, string][]}[], totalRows?: [string, string, boolean?][], footer?: string[]}} spec
 */
export async function renderReceiptDocument({ title, subtitle, meta = [], sections = [], totalRows = [], footer = [] }) {
  const doc = createPdfDoc()
  const marginX = 40
  const rightX = doc.pageWidth - marginX
  const pageBottom = doc.pageHeight - 50
  let y = 50

  function ensureSpace(next) {
    if (y + next > pageBottom) {
      doc.addPage()
      y = 50
    }
  }

  const logo = await loadBrandLogoRgb().catch(() => null)
  const logoSize = 30
  if (logo) doc.image(marginX, y - 22, logoSize, logoSize, logo)
  const titleX = logo ? marginX + logoSize + 10 : marginX
  doc.text(titleX, y, title, { size: 20, bold: true, color: BRAND })
  y += 22
  if (subtitle) {
    doc.text(marginX, y, subtitle, { size: 11, bold: true })
    y += 16
  }
  doc.line(marginX, y, rightX, y, { color: BRAND, width: 1.25 })
  y += 18

  meta.forEach((line) => {
    doc.text(marginX, y, line, { size: 9 })
    y += 13
  })
  y += 8

  sections.forEach((section) => {
    ensureSpace(24)
    doc.text(marginX, y, section.heading, { size: 12, bold: true, color: BRAND })
    y += 16
    section.rows.forEach(([label, value]) => {
      ensureSpace(16)
      doc.text(marginX + 4, y, `${label}:`, { size: 10 })
      doc.text(marginX + 160, y, value === null || value === undefined || value === '' ? '-' : String(value), { size: 10 })
      y += 15
    })
    y += 8
    doc.line(marginX, y, rightX, y, { gray: 0.85 })
    y += 10
  })

  if (totalRows.length) {
    const boxHeight = totalRows.length * 17 + 12
    ensureSpace(boxHeight + 10)
    doc.rect(marginX, y, rightX - marginX, boxHeight, { fill: true, fillColor: BRAND_TINT, strokeColor: BRAND })
    let ty = y + 18
    totalRows.forEach(([label, value, emphasize]) => {
      doc.text(marginX + 12, ty, label, { size: emphasize ? 12 : 10, bold: !!emphasize, color: emphasize ? BRAND : undefined })
      doc.text(rightX - 160, ty, String(value), { size: emphasize ? 12 : 10, bold: !!emphasize, color: emphasize ? BRAND : undefined })
      ty += 17
    })
    y += boxHeight + 16
  }

  if (footer.length) {
    ensureSpace(footer.length * 11 + 14)
    doc.line(marginX, y, rightX, y, { gray: 0.85 })
    y += 14
    footer.forEach((line) => {
      doc.text(marginX, y, line, { size: 8 })
      y += 11
    })
  }

  return doc
}

/**
 * Booking slip — patient's own appointment, before/around visit time. `appointment` is a shaped
 * Appointment as returned by GET /appointments (doctor.specialization, clinic.address/phone
 * included since the appointments.service.js#APPOINTMENT_INCLUDE fix that added them for exactly
 * this purpose).
 */
export function buildBookingSlipSections({ appointment, fee, paid, due, patientName }) {
  return {
    title: 'BookMyDoctors',
    subtitle: 'Booking Slip',
    meta: [`Booking ID: ${shortId(appointment.id)}`, `Issued: ${issuedNowLines()}`],
    sections: [
      { heading: 'Patient', rows: [['Name', patientName]] },
      {
        heading: 'Doctor',
        rows: [
          ['Name', appointment.doctor?.name],
          ['Specialization', appointment.doctor?.specialization?.name],
        ],
      },
      {
        heading: 'Clinic',
        rows: [
          ['Name', appointment.clinic?.name],
          ['Address', appointment.clinic?.address],
          ['Phone', appointment.clinic?.phone],
        ],
      },
      {
        heading: 'Appointment',
        rows: [
          // BOOKING-ID VISIBILITY FIX (user request: "bookinh id ko slip pe dikhai") — the
          // booking id was already in the `meta` line above (small caption text next to "Issued:
          // ..."), but as its own row here it reads as an actual appointment detail, matching
          // how "Token number" is shown, and it's what a patient would look for if the clinic
          // asks "aapki booking id kya hai" at the counter. Same shortId(appointment.id) format
          // used everywhere else in the app (e.g. PatientPages.jsx's Payments table).
          ['Booking ID', shortId(appointment.id)],
          ['Date', formatDate(appointment.appointmentDate)],
          ['Time', appointment.appointmentTime],
          ['Token number', appointment.tokenNumber != null ? `#${appointment.tokenNumber}` : 'Not yet assigned'],
          ['Status', appointment.status],
        ],
      },
    ],
    // LABEL FIX (multi-agent payment audit): `fee` here is the appointment's full totalAmount
    // (consultation + platform charge + emergency fee + GST — see PatientPages.jsx's `records`
    // map, which is this function's only caller), not just the doctor's consultation fee. It used
    // to be printed under the label "Consultation fee", silently folding the platform charge and
    // GST into a figure this official-looking, printable document explicitly named as the
    // consultation fee alone — which could mislead a patient or cause a dispute at the clinic
    // counter. Unlike buildPatientReceiptSections below (a payment RECEIPT, which does itemize
    // consultationFee/convenienceFee/emergencyFee/gstAmount separately), this booking SLIP only
    // ever received the single merged total, so the correct minimal fix is to label it for what it
    // actually is.
    // ONE-FEE-COLUMN FIX ("slip v sahi kro eshi taarat" — same fix as the "My appointments"
    // table's single, payment-path-aware Fee column, after the brief two-row "Total amount (full
    // online payment)" / "Total amount (minimum booking path)" split read as confusing here too):
    // `fee` is now whatever PatientPages.jsx's `records` map's `displayFee` resolves to — the
    // minimum-booking-path total while the booking is 'partial' (minimum paid online, rest due at
    // the clinic), otherwise the full online-payment total — so Paid + Due always reconciles
    // against this single "Total amount" row without needing a second one.
    totalRows: [
      ['Total amount', formatMoneyPlain(fee)],
      ['Paid', formatMoneyPlain(paid)],
      ['Due', formatMoneyPlain(due), true],
    ],
    footer: ['This is a computer-generated booking slip from BookMyDoctors.', 'Please carry a valid photo ID to your appointment.'],
  }
}

/**
 * Renders the booking slip PDF and returns the Blob + suggested filename — used by the "View
 * slip" flow (PatientPages.jsx's PatientAppointments, via hooks/usePdfPreview.js), which shows
 * this in an in-page preview and lets the browser's object URL double as the download link's href.
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function buildBookingSlipPdfBlob({ appointment, fee, paid, due, patientName }) {
  const doc = await renderReceiptDocument(buildBookingSlipSections({ appointment, fee, paid, due, patientName }))
  return { blob: doc.toBlob(), filename: `booking-slip-${shortId(appointment.id)}.pdf` }
}

/**
 * Payment receipt — a PATIENT's own view of a payment. Patients see the full fee breakdown
 * (consultationFee/convenienceFee/emergencyFee/gstAmount/amount) — payments.service.js's
 * shapePaymentFees gives a patient their own full breakdown (never commission/clinicPayout,
 * those are platform-internal), unlike the staff-masked view below.
 * @param {object} item - a row from the patient Payments page: the shaped Payment plus
 *   patientName/doctorName/clinicName convenience fields already computed there, and the
 *   cross-referenced `appointment` (for date/time/token/specialization/clinic address).
 */
export function buildPatientReceiptSections(item) {
  const fees = item.fees || {}
  const appointment = item.appointment
  const paidAmount = Number(fees.amount ?? item.amount) || 0
  const consultationFeeFull = Number(fees.consultationFee) || 0
  const convenienceFeeFull = Number(fees.convenienceFee) || 0
  const emergencyFeeFull = Number(fees.emergencyFee) || 0
  const gstAmountFull = Number(fees.gstAmount) || 0
  const impliedTotal = consultationFeeFull + convenienceFeeFull + emergencyFeeFull + gstAmountFull
  const closeTo = (a, b) => Math.abs(a - b) < 0.01

  // EXACT-BREAKDOWN FIX (user request: "...doctor jo minimum le set kiya hai utna do and jo
  // platform charge hai ushko v sahi do transaction charge v sahi do"): payments.service.js
  // copies the appointment's FULL fee breakdown (consultationFee/convenienceFee/emergencyFee/
  // gstAmount) verbatim onto every Payment row for that appointment — including the doctor's
  // minimum-booking-amount advance paid online, and a second row for the remaining balance
  // collected later at the clinic — only `fees.amount` differs between rows (each one's own
  // actual charge). The previous fix scaled every line by this row's share of the appointment
  // total (amount / impliedTotal), which "balanced" to the right total but printed a fictional
  // FRACTIONAL platform charge/GST for the minimum-advance row (and a fictional platform
  // charge/GST on the clinic's remainder row, which never actually collects either — the
  // platform charge/GST are settled in full by the online minimum payment; see
  // utils/minBookingAmount.js's worked example). When the cross-referenced appointment carries
  // its own minBookingAmount/minBookingRemainder/consultationFee (patient branch of
  // appointments.service.js#shapeFees) and this row's amount matches one of the three real
  // payment shapes, compute the EXACT figures that business rule defines instead of an
  // approximation. Falls back to the old ratio-based scaling for a full payment (ratio is
  // exactly 1 there, so unchanged) or any older/unrecognized row shape this can't identify.
  const apptFees = appointment?.fees
  const minBookingAmount = apptFees?.minBookingAmount != null ? Number(apptFees.minBookingAmount) : null
  const minBookingRemainder = apptFees?.minBookingRemainder != null ? Number(apptFees.minBookingRemainder) : null
  const apptConsultationFee = apptFees?.consultationFee != null ? Number(apptFees.consultationFee) : null

  let totalRows
  if (minBookingAmount != null && closeTo(paidAmount, minBookingAmount)) {
    // The doctor's own minimum booking amount, paid online at booking time. Consultation
    // portion is the doctor's configured minimum advance itself (consultationFee -
    // minBookingRemainder — see utils/minBookingAmount.js#computeMinBookingRemainder), the
    // platform charge is collected IN FULL (never prorated) either way, and the transaction
    // charge (GST) is whatever's left of this exact amount — guaranteed to foot to the total.
    const platformCharge = convenienceFeeFull + emergencyFeeFull
    const minAdvance = apptConsultationFee != null && minBookingRemainder != null
      ? apptConsultationFee - minBookingRemainder
      : Math.max(0, paidAmount - platformCharge)
    const transactionCharge = Math.max(0, paidAmount - minAdvance - platformCharge)
    totalRows = [['Consultation fee (minimum booking amount)', formatMoneyPlain(minAdvance)]]
    if (platformCharge > 0) totalRows.push(['Platform charge', formatMoneyPlain(platformCharge)])
    if (transactionCharge > 0) totalRows.push(['Transaction charge', formatMoneyPlain(transactionCharge)])
    totalRows.push(['Amount paid', formatMoneyPlain(paidAmount), true])
  } else if (minBookingRemainder != null && closeTo(paidAmount, minBookingRemainder)) {
    // The remaining consultation fee, collected later at the clinic. The platform charge and
    // GST were already collected in full by the online minimum-booking payment above, so
    // nothing further is owed (or shown) for either of those on this row.
    totalRows = [
      ['Consultation fee (remaining balance)', formatMoneyPlain(paidAmount)],
      ['Amount paid', formatMoneyPlain(paidAmount), true],
    ]
  } else {
    // Full payment (ratio is exactly 1, so unchanged), or an older/unrecognized row shape this
    // can't match to one of the two exact cases above — same ratio-based scaling as before.
    const shareRatio = impliedTotal > 0 ? paidAmount / impliedTotal : 1
    const scaled = (value) => value * shareRatio
    totalRows = [['Consultation fee', formatMoneyPlain(scaled(consultationFeeFull))]]
    if (convenienceFeeFull > 0) totalRows.push(['Platform charge', formatMoneyPlain(scaled(convenienceFeeFull))])
    if (emergencyFeeFull > 0) totalRows.push(['Emergency fee', formatMoneyPlain(scaled(emergencyFeeFull))])
    if (gstAmountFull > 0) totalRows.push(['Transaction charge', formatMoneyPlain(scaled(gstAmountFull))])
    totalRows.push(['Amount paid', formatMoneyPlain(paidAmount), true])
  }

  const paymentRows = [
    ['Payment date', formatDate(item.createdAt)],
    ['Mode', item.mode],
    ['Payment source', paymentSourceLabel(item)],
    ['UTR / Transaction ref', item.transactionId || item.transactionRef],
  ]
  if (item.payerUpiId) paymentRows.push(['UPI ID', item.payerUpiId])
  paymentRows.push(['Status', item.status])

  return {
    title: 'BookMyDoctors',
    subtitle: 'Payment Receipt',
    meta: [`Receipt No: ${item.receiptNumber || shortId(item.id)}`, `Issued: ${issuedNowLines()}`],
    sections: [
      { heading: 'Patient', rows: [['Name', item.patientName]] },
      {
        heading: 'Doctor',
        rows: [
          ['Name', item.doctorName],
          ['Specialization', appointment?.doctor?.specialization?.name],
        ],
      },
      {
        heading: 'Clinic',
        // item.clinic (the payment's own clinic, PAYMENT_SELECT) carries address/phone directly —
        // prefer it, falling back to the cross-referenced appointment's clinic for older data
        // shapes that only ever had appointment.clinic.
        rows: [
          ['Name', item.clinicName],
          ['Address', item.clinic?.address || appointment?.clinic?.address],
          ['Phone', item.clinic?.phone || appointment?.clinic?.phone],
        ],
      },
      {
        heading: 'Appointment',
        rows: [
          ['Date', appointment ? formatDate(appointment.appointmentDate) : undefined],
          ['Time', appointment?.appointmentTime],
          ['Token number', appointment?.tokenNumber != null ? `#${appointment.tokenNumber}` : undefined],
        ],
      },
      { heading: 'Payment', rows: paymentRows },
    ],
    totalRows,
    footer: ['This is a computer-generated receipt from BookMyDoctors.'],
  }
}

/**
 * Renders the patient's payment receipt PDF and returns the Blob + suggested filename — used by
 * the "View receipt" flow (PatientPages.jsx's Payments, via hooks/usePdfPreview.js).
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function buildPatientReceiptPdfBlob(item) {
  const doc = await renderReceiptDocument(buildPatientReceiptSections(item))
  return { blob: doc.toBlob(), filename: `receipt-${item.receiptNumber || shortId(item.id)}.pdf` }
}

/**
 * Payment receipt — a DOCTOR/RECEPTIONIST'S view of a payment they collected/witnessed. Per
 * "mandatory rule 8" (appointments.service.js#shapeFees / payments.service.js#shapePaymentFees),
 * staff roles only ever receive `fees.consultationFee` on the API response — every other money
 * field is omitted entirely, not just hidden client-side — so this receipt deliberately shows
 * ONLY the consultation fee as the collected amount, never a fee breakdown the API never sent.
 * @param {object} item - a row from the receptionist/doctor Payments page (StaffPages.jsx's
 *   `clinicPayments`): the shaped (staff-masked) Payment plus `clinicAmount`, and (when available)
 *   the cross-referenced `appointment` for date/time/token/doctor-specialization.
 */
export function buildStaffReceiptSections(item) {
  const appointment = item.appointment
  return {
    title: 'BookMyDoctors',
    subtitle: 'Clinic Payment Receipt',
    meta: [`Receipt No: ${item.receiptNumber || shortId(item.id)}`, `Issued: ${issuedNowLines()}`],
    sections: [
      { heading: 'Patient', rows: [['Name', item.patient?.name]] },
      {
        heading: 'Doctor',
        rows: [
          ['Name', item.doctor?.name],
          ['Specialization', appointment?.doctor?.specialization?.name],
        ],
      },
      {
        heading: 'Clinic',
        // item.clinic (the payment's own clinic, PAYMENT_SELECT) carries address/phone directly —
        // prefer it, falling back to the cross-referenced appointment's clinic.
        rows: [
          ['Name', item.clinic?.name],
          ['Address', item.clinic?.address || appointment?.clinic?.address],
          ['Phone', item.clinic?.phone || appointment?.clinic?.phone],
        ],
      },
      {
        heading: 'Appointment',
        rows: [
          ['Date', appointment ? formatDate(appointment.appointmentDate) : undefined],
          ['Time', appointment?.appointmentTime],
          ['Token number', appointment?.tokenNumber != null ? `#${appointment.tokenNumber}` : undefined],
        ],
      },
      {
        heading: 'Payment',
        rows: [
          ['Payment date', formatDate(item.createdAt)],
          ['Mode', item.mode],
          ['Payment source', paymentSourceLabel(item)],
          ['UTR / Transaction ref', item.transactionRef],
          ...(item.payerUpiId ? [['UPI ID', item.payerUpiId]] : []),
          ['Status', item.status],
        ],
      },
    ],
    totalRows: [['Consultation fee collected', formatMoneyPlain(item.fees?.consultationFee ?? item.clinicAmount), true]],
    footer: [
      'This is a computer-generated receipt from BookMyDoctors.',
      'Amount shown is the consultation fee only, per this platform’s clinic-staff fee-visibility policy.',
    ],
  }
}

/**
 * Renders the staff (doctor/receptionist) payment receipt PDF and returns the Blob + suggested
 * filename — used by the "View receipt" flow (StaffPages.jsx's CashPayment, via
 * hooks/usePdfPreview.js).
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function buildStaffReceiptPdfBlob(item) {
  const doc = await renderReceiptDocument(buildStaffReceiptSections(item))
  return { blob: doc.toBlob(), filename: `receipt-${item.receiptNumber || shortId(item.id)}.pdf` }
}

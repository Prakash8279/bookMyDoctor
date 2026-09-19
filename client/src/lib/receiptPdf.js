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
    title: 'BookMyDoctor24',
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
    totalRows: [
      ['Total amount', formatMoneyPlain(fee)],
      ['Paid', formatMoneyPlain(paid)],
      ['Due', formatMoneyPlain(due), true],
    ],
    footer: ['This is a computer-generated booking slip from BookMyDoctor24.', 'Please carry a valid photo ID to your appointment.'],
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
  // SPLIT-PAYMENT BREAKDOWN FIX (multi-agent payment audit): payments.service.js copies the
  // appointment's FULL fee breakdown (consultationFee/convenienceFee/emergencyFee/gstAmount)
  // verbatim onto every Payment row for that appointment, including a second row created when a
  // 'partial' online advance's remaining balance is later collected at the clinic — only
  // `fees.amount` differs between the two rows (each one's own actual charge). Printing the full,
  // unscaled breakdown above a bold "Amount paid" that's only this row's partial charge made the
  // itemized lines not add up to the paid figure on the same receipt, with no indication the
  // breakdown was the appointment's total rather than this transaction's share. Scale each line to
  // this row's share of the appointment total (same ratio approach payments.service.js's
  // shapePaymentFees already uses for admin commission) — for the normal, un-split, full-payment
  // case `fees.amount` already equals the total, so the ratio is exactly 1 and every line is
  // unchanged.
  const paidAmount = Number(fees.amount ?? item.amount) || 0
  const impliedTotal =
    (Number(fees.consultationFee) || 0) +
    (Number(fees.convenienceFee) || 0) +
    (Number(fees.emergencyFee) || 0) +
    (Number(fees.gstAmount) || 0)
  const shareRatio = impliedTotal > 0 ? paidAmount / impliedTotal : 1
  const scaled = (value) => (Number(value) || 0) * shareRatio
  const totalRows = [['Consultation fee', formatMoneyPlain(scaled(fees.consultationFee))]]
  if (Number(fees.convenienceFee) > 0) totalRows.push(['Platform charge', formatMoneyPlain(scaled(fees.convenienceFee))])
  if (Number(fees.emergencyFee) > 0) totalRows.push(['Emergency fee', formatMoneyPlain(scaled(fees.emergencyFee))])
  if (Number(fees.gstAmount) > 0) totalRows.push(['Transaction charge', formatMoneyPlain(scaled(fees.gstAmount))])
  totalRows.push(['Amount paid', formatMoneyPlain(paidAmount), true])

  const paymentRows = [
    ['Payment date', formatDate(item.createdAt)],
    ['Mode', item.mode],
    ['Payment source', paymentSourceLabel(item)],
    ['UTR / Transaction ref', item.transactionId || item.transactionRef],
  ]
  if (item.payerUpiId) paymentRows.push(['UPI ID', item.payerUpiId])
  paymentRows.push(['Status', item.status])

  return {
    title: 'BookMyDoctor24',
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
    footer: ['This is a computer-generated receipt from BookMyDoctor24.'],
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
    title: 'BookMyDoctor24',
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
      'This is a computer-generated receipt from BookMyDoctor24.',
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

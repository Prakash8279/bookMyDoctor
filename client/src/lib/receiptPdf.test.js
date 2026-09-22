import { describe, expect, it } from 'vitest'
import {
  buildBookingSlipPdfBlob,
  buildBookingSlipSections,
  buildPatientReceiptPdfBlob,
  buildPatientReceiptSections,
  buildStaffReceiptPdfBlob,
  buildStaffReceiptSections,
  renderReceiptDocument,
} from './receiptPdf'
import { theme } from './theme'
import { hexToRgb01 } from './pdf'

function bytesToLatin1String(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

// Pure data-shape tests only — no PDF bytes involved, same spirit as pdf.test.js/format.test.js.
// The goal here is to lock in the two things that matter most for a receipt: (1) every field a
// real clinic receipt needs is actually present when the data is available, and (2) the
// "mandatory rule 8" fee-masking boundary between the patient view and the staff view is
// respected by the PDF content itself, not just by the API response.

function findSection(doc, heading) {
  return doc.sections.find((s) => s.heading === heading)
}

function findRow(section, label) {
  const row = section?.rows.find(([l]) => l === label)
  return row ? row[1] : undefined
}

describe('buildBookingSlipSections', () => {
  const appointment = {
    id: 'appt_9f8e7d6c5b4a',
    doctor: { name: 'Dr. Asha Rao', specialization: { name: 'Cardiology' } },
    clinic: { name: 'Sunrise Clinic', address: '12 MG Road, Pune', phone: '020-1234567' },
    appointmentDate: '2026-09-25',
    appointmentTime: '10:30 AM',
    tokenNumber: 7,
    status: 'confirmed',
  }

  it('includes patient, doctor, clinic and appointment details', () => {
    const doc = buildBookingSlipSections({ appointment, fee: 500, paid: 200, due: 300, patientName: 'Rahul Verma' })

    expect(doc.title).toBe('BookMyDoctors')
    expect(doc.subtitle).toBe('Booking Slip')
    expect(doc.meta.join(' ')).toContain('Booking ID: #5b4a')

    expect(findRow(findSection(doc, 'Patient'), 'Name')).toBe('Rahul Verma')
    expect(findRow(findSection(doc, 'Doctor'), 'Name')).toBe('Dr. Asha Rao')
    expect(findRow(findSection(doc, 'Doctor'), 'Specialization')).toBe('Cardiology')
    expect(findRow(findSection(doc, 'Clinic'), 'Name')).toBe('Sunrise Clinic')
    expect(findRow(findSection(doc, 'Clinic'), 'Address')).toBe('12 MG Road, Pune')
    expect(findRow(findSection(doc, 'Clinic'), 'Phone')).toBe('020-1234567')
    expect(findRow(findSection(doc, 'Appointment'), 'Time')).toBe('10:30 AM')
    expect(findRow(findSection(doc, 'Appointment'), 'Token number')).toBe('#7')
    expect(findRow(findSection(doc, 'Appointment'), 'Status')).toBe('confirmed')
  })

  // BOOKING-ID VISIBILITY FIX (user request: "bookinh id ko slip pe dikhai") — the booking id
  // was already in the `meta` caption line (asserted above), but as its own row in the
  // "Appointment" section it reads as an actual booking detail, matching "Token number".
  it('shows the booking id as its own row in the Appointment section, matching the meta line', () => {
    const doc = buildBookingSlipSections({ appointment, fee: 500, paid: 200, due: 300, patientName: 'Rahul Verma' })
    expect(findRow(findSection(doc, 'Appointment'), 'Booking ID')).toBe('#5b4a')
  })

  it('shows "Not yet assigned" when no token has been given yet', () => {
    const doc = buildBookingSlipSections({
      appointment: { ...appointment, tokenNumber: null },
      fee: 500,
      paid: 0,
      due: 500,
      patientName: 'Rahul Verma',
    })
    expect(findRow(findSection(doc, 'Appointment'), 'Token number')).toBe('Not yet assigned')
  })

  it('shows the fee/paid/due totals with the ASCII-safe money format', () => {
    const doc = buildBookingSlipSections({ appointment, fee: 500, paid: 200, due: 300, patientName: 'Rahul Verma' })
    // LABEL FIX (multi-agent payment audit): `fee` is the appointment's full totalAmount
    // (consultation + platform charge + emergency fee + GST), not just the consultation fee — see
    // the fix comment in buildBookingSlipSections — so this row is labeled "Total amount".
    expect(doc.totalRows).toEqual([
      ['Total amount', 'Rs. 500'],
      ['Paid', 'Rs. 200'],
      ['Due', 'Rs. 300', true],
    ])
  })

  // ONE-FEE-COLUMN FIX (user request, in two rounds: "slip me v sahi kro" — briefly added a
  // second "Total amount (minimum booking path)" row — then "slip v sahi kro eshi taarat",
  // matching the "My appointments" table's collapse back to one payment-path-aware Fee column):
  // buildBookingSlipSections takes a single `fee` again. It's up to the caller
  // (PatientPages.jsx's `records` map — see its `displayFee`) to resolve that to the
  // minimum-booking-path total for a 'partial' booking, or the full online-payment total
  // otherwise, so this "Total amount" row always reconciles with Paid + Due on its own.
  it('prints whatever fee the caller passes as "Total amount" — e.g. the minimum-booking-path total for a partial booking', () => {
    const doc = buildBookingSlipSections({ appointment, fee: 428, paid: 128, due: 300, patientName: 'Rahul Verma' })
    expect(doc.totalRows).toEqual([
      ['Total amount', 'Rs. 428'],
      ['Paid', 'Rs. 128'],
      ['Due', 'Rs. 300', true],
    ])
  })
})

describe('buildPatientReceiptSections', () => {
  const baseItem = {
    id: 'pay_1122334455',
    receiptNumber: 'RCPT-0042',
    patientName: 'Rahul Verma',
    doctorName: 'Dr. Asha Rao',
    clinicName: 'Sunrise Clinic',
    createdAt: '2026-09-18',
    mode: 'upi',
    transactionId: 'UTR123456',
    payerUpiId: 'rahul@okhdfcbank',
    status: 'paid',
    amount: 590,
    fees: { consultationFee: 500, convenienceFee: 20, emergencyFee: 0, gstAmount: 70, amount: 590 },
    appointment: {
      doctor: { specialization: { name: 'Cardiology' } },
      clinic: { address: '12 MG Road, Pune', phone: '020-1234567' },
      appointmentDate: '2026-09-25',
      appointmentTime: '10:30 AM',
      tokenNumber: 7,
    },
  }

  it('shows the full fee breakdown a patient is entitled to see', () => {
    const doc = buildPatientReceiptSections(baseItem)
    expect(doc.totalRows).toEqual([
      ['Consultation fee', 'Rs. 500'],
      ['Platform charge', 'Rs. 20'],
      ['Transaction charge', 'Rs. 70'],
      ['Amount paid', 'Rs. 590', true],
    ])
  })

  it('omits a fee-breakdown row when its amount is zero or absent', () => {
    const doc = buildPatientReceiptSections(baseItem)
    const labels = doc.totalRows.map(([label]) => label)
    expect(labels).not.toContain('Emergency fee')
  })

  it('includes emergency fee when it is greater than zero', () => {
    const doc = buildPatientReceiptSections({
      ...baseItem,
      fees: { ...baseItem.fees, emergencyFee: 150, amount: 740 },
    })
    const labels = doc.totalRows.map(([label]) => label)
    expect(labels).toContain('Emergency fee')
  })

  // SPLIT-PAYMENT BREAKDOWN FIX regression test (multi-agent payment audit): payments.service.js
  // copies the appointment's FULL fee breakdown verbatim onto every Payment row for that
  // appointment, including a second row for the clinic-collected remainder of a 'partial' online
  // advance — only `fees.amount` differs between the two rows. Previously this printed the full,
  // unscaled breakdown above a bold "Amount paid" that was only this row's own partial charge, so
  // the itemized lines didn't add up to the paid figure. Each line is now scaled to this row's
  // share (amount / impliedTotal) of the appointment total.
  it('scales the fee breakdown to this row\'s share of the appointment total for a split (partial) payment', () => {
    // Appointment total: consultation 500 + platform charge 20 + GST 70 = 590. This row only
    // collected the doctor's 200 minimum advance (a fraction, ratio 200/590).
    const doc = buildPatientReceiptSections({
      ...baseItem,
      fees: { consultationFee: 500, convenienceFee: 20, emergencyFee: 0, gstAmount: 70, amount: 200 },
    })
    expect(doc.totalRows).toEqual([
      ['Consultation fee', 'Rs. 169.49'],
      ['Platform charge', 'Rs. 6.78'],
      ['Transaction charge', 'Rs. 23.73'],
      ['Amount paid', 'Rs. 200', true],
    ])
  })

  // EXACT-BREAKDOWN FIX (user request: "...doctor jo minimum le set kiya hai utna do and jo
  // platform charge hai ushko v sahi do transaction charge v sahi do") — worked example from
  // utils/minBookingAmount.js: consultationFee 400, doctor's minimum booking advance 100,
  // platform (convenience) charge 25, GST rate 3% -> totalAmount 437.75, minBookingAmount 128,
  // minBookingRemainder 300. The online advance payment row's `amount` (128) matches the
  // appointment's minBookingAmount, so the receipt must show the doctor's REAL minimum (100).
  it('shows the exact minimum-booking-amount breakdown (not a fractional scale) for the online advance payment', () => {
    const doc = buildPatientReceiptSections({
      ...baseItem,
      appointment: {
        ...baseItem.appointment,
        fees: { consultationFee: 400, totalAmount: 437.75, minBookingAmount: 128, minBookingRemainder: 300 },
      },
      fees: { consultationFee: 400, convenienceFee: 25, emergencyFee: 0, gstAmount: 12.75, amount: 128 },
    })
    expect(doc.totalRows).toEqual([
      ['Consultation fee (minimum booking amount)', 'Rs. 100'],
      ['Platform charge', 'Rs. 25'],
      ['Transaction charge', 'Rs. 3'],
      ['Amount paid', 'Rs. 128', true],
    ])
  })

  it('shows only the remaining consultation fee — no fictional platform charge/GST — for the clinic-collected remainder payment', () => {
    const doc = buildPatientReceiptSections({
      ...baseItem,
      appointment: {
        ...baseItem.appointment,
        fees: { consultationFee: 400, totalAmount: 437.75, minBookingAmount: 128, minBookingRemainder: 300 },
      },
      fees: { consultationFee: 400, convenienceFee: 25, emergencyFee: 0, gstAmount: 12.75, amount: 300 },
    })
    expect(doc.totalRows).toEqual([
      ['Consultation fee (remaining balance)', 'Rs. 300'],
      ['Amount paid', 'Rs. 300', true],
    ])
  })

  it('includes clinic address/phone and doctor specialization from the cross-referenced appointment', () => {
    const doc = buildPatientReceiptSections(baseItem)
    expect(findRow(findSection(doc, 'Doctor'), 'Specialization')).toBe('Cardiology')
    expect(findRow(findSection(doc, 'Clinic'), 'Address')).toBe('12 MG Road, Pune')
    expect(findRow(findSection(doc, 'Clinic'), 'Phone')).toBe('020-1234567')
    expect(findRow(findSection(doc, 'Appointment'), 'Token number')).toBe('#7')
  })

  it('includes the payment mode, UTR and UPI ID', () => {
    const doc = buildPatientReceiptSections(baseItem)
    const paymentRows = findSection(doc, 'Payment')
    expect(findRow(paymentRows, 'Mode')).toBe('upi')
    expect(findRow(paymentRows, 'UTR / Transaction ref')).toBe('UTR123456')
    expect(findRow(paymentRows, 'UPI ID')).toBe('rahul@okhdfcbank')
  })

  it('omits the UPI ID row when there is none (e.g. a cash payment)', () => {
    const doc = buildPatientReceiptSections({ ...baseItem, payerUpiId: null, mode: 'cash' })
    const paymentRows = findSection(doc, 'Payment')
    expect(paymentRows.rows.some(([label]) => label === 'UPI ID')).toBe(false)
  })

  // COMPLETENESS ADD (request: "online booking ke time pe kitna payment hua hai and second clinic
  // pe aake cash ya online ye v to confirm hona chahiye", then "... pdf mr v ye aana chahiye") —
  // the receipt now spells out whether this was the patient's own Razorpay prepayment at booking
  // time or a payment collected in person at the clinic.
  it('says "Collected at clinic" for an in-person UPI/cash payment, and "Paid online at booking" for the patient\'s own Razorpay payment', () => {
    const clinicDoc = buildPatientReceiptSections(baseItem) // upi, transactionId (not a Razorpay ref)
    expect(findRow(findSection(clinicDoc, 'Payment'), 'Payment source')).toBe('Collected at clinic')

    const bookingDoc = buildPatientReceiptSections({ ...baseItem, mode: 'online', transactionRef: 'pay_xyz789' })
    expect(findRow(findSection(bookingDoc, 'Payment'), 'Payment source')).toBe('Paid online at booking')
  })

  it('still renders when there is no cross-referenced appointment', () => {
    const doc = buildPatientReceiptSections({ ...baseItem, appointment: undefined })
    expect(() => doc).not.toThrow()
    expect(findRow(findSection(doc, 'Appointment'), 'Date')).toBeUndefined()
  })
})

describe('buildStaffReceiptSections', () => {
  // Per "mandatory rule 8", the API never sends a doctor/receptionist anything beyond
  // consultationFee — convenienceFee/emergencyFee/gstAmount/amount/commission/clinicPayout are
  // omitted from the response entirely. This receipt must reflect that: it should show ONLY the
  // consultation fee collected, and never fabricate or leak a full breakdown.
  const staffItem = {
    id: 'pay_998877',
    receiptNumber: 'RCPT-0099',
    patient: { name: 'Rahul Verma' },
    doctor: { name: 'Dr. Asha Rao' },
    clinic: { name: 'Sunrise Clinic' },
    createdAt: '2026-09-18',
    mode: 'cash',
    transactionRef: null,
    payerUpiId: null,
    status: 'paid',
    clinicAmount: 500,
    fees: { consultationFee: 500 },
    appointment: {
      clinic: { address: '12 MG Road, Pune', phone: '020-1234567' },
    },
  }

  it('shows only the consultation fee as the collected total, never a fee breakdown', () => {
    const doc = buildStaffReceiptSections(staffItem)
    expect(doc.totalRows).toEqual([['Consultation fee collected', 'Rs. 500', true]])
  })

  it('never includes convenience/emergency/GST rows even if present on the object', () => {
    const doc = buildStaffReceiptSections({
      ...staffItem,
      fees: { consultationFee: 500, convenienceFee: 20, emergencyFee: 100, gstAmount: 70, amount: 690 },
    })
    const labels = doc.totalRows.map(([label]) => label)
    expect(labels).toEqual(['Consultation fee collected'])
  })

  it('falls back to clinicAmount when fees.consultationFee is unavailable', () => {
    const doc = buildStaffReceiptSections({ ...staffItem, fees: undefined })
    expect(doc.totalRows).toEqual([['Consultation fee collected', 'Rs. 500', true]])
  })

  it('includes clinic address/phone from the cross-referenced appointment', () => {
    const doc = buildStaffReceiptSections(staffItem)
    expect(findRow(findSection(doc, 'Clinic'), 'Address')).toBe('12 MG Road, Pune')
    expect(findRow(findSection(doc, 'Clinic'), 'Phone')).toBe('020-1234567')
  })

  // COMPLETENESS ADD (request: "online booking ke time pe kitna payment hua hai and second clinic
  // pe aake cash ya online ye v to confirm hona chahiye", then "... pdf mr v ye aana chahiye") —
  // same "Collected at clinic" / "Paid online at booking" line as the patient receipt above.
  it('says "Collected at clinic" for the receptionist-recorded cash payment, and "Paid online at booking" for a Razorpay one', () => {
    const clinicDoc = buildStaffReceiptSections(staffItem) // cash
    expect(findRow(findSection(clinicDoc, 'Payment'), 'Payment source')).toBe('Collected at clinic')

    const bookingDoc = buildStaffReceiptSections({ ...staffItem, mode: 'online', transactionRef: 'pay_xyz789' })
    expect(findRow(findSection(bookingDoc, 'Payment'), 'Payment source')).toBe('Paid online at booking')
  })

  it('includes the UTR when present and omits the UPI ID row when there is none', () => {
    const doc = buildStaffReceiptSections({ ...staffItem, mode: 'upi', transactionRef: 'UTR999' })
    const paymentRows = findSection(doc, 'Payment')
    expect(findRow(paymentRows, 'UTR / Transaction ref')).toBe('UTR999')
    expect(paymentRows.rows.some(([label]) => label === 'UPI ID')).toBe(false)
  })

  it('includes the UPI ID row when present', () => {
    const doc = buildStaffReceiptSections({ ...staffItem, payerUpiId: 'rahul@okhdfcbank' })
    const paymentRows = findSection(doc, 'Payment')
    expect(findRow(paymentRows, 'UPI ID')).toBe('rahul@okhdfcbank')
  })
})

// Branding: "pdf me logo add karo header me mera colorthem v add kar do" — the header logo image
// and the app's brand color, not just the receipt content shape tested above.
describe('renderReceiptDocument branding', () => {
  const minimalSpec = { title: 'BookMyDoctors', subtitle: 'Test Receipt', sections: [{ heading: 'Patient', rows: [['Name', 'Rahul Verma']] }], totalRows: [['Total', 'Rs. 500', true]] }

  it('produces a well-formed PDF even when the logo cannot be rasterized (this test env has no 2D canvas)', async () => {
    const doc = await renderReceiptDocument(minimalSpec)
    const pdf = bytesToLatin1String(doc.toBytes())
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf).not.toContain('/Subtype /Image') // no canvas here -> no logo embedded, and that's fine
  })

  it('draws the title in the brand color', async () => {
    const doc = await renderReceiptDocument(minimalSpec)
    const pdf = bytesToLatin1String(doc.toBytes())
    const [r, g, b] = hexToRgb01(theme.primary)
    expect(pdf).toContain(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
    expect(pdf).toContain('(BookMyDoctors) Tj')
  })

  it('draws the header rule and section headings in the brand color', async () => {
    const doc = await renderReceiptDocument(minimalSpec)
    const pdf = bytesToLatin1String(doc.toBytes())
    const [r, g, b] = hexToRgb01(theme.primary)
    expect(pdf).toContain(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`) // header rule (stroke)
    expect(pdf).toContain('(Patient) Tj') // the section heading itself
  })

  it('tints the totals box with the brand-light background and brand-colored border', async () => {
    const doc = await renderReceiptDocument(minimalSpec)
    const pdf = bytesToLatin1String(doc.toBytes())
    const [r, g, b] = hexToRgb01('#f5e9e3')
    expect(pdf).toContain(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
  })

  it('still produces a valid PDF end-to-end from a real booking slip spec', async () => {
    const appointment = {
      id: 'appt_1',
      doctor: { name: 'Dr. Asha Rao', specialization: { name: 'Cardiology' } },
      clinic: { name: 'Sunrise Clinic', address: '12 MG Road, Pune', phone: '020-1234567' },
      appointmentDate: '2026-09-25',
      appointmentTime: '10:30 AM',
      tokenNumber: 7,
      status: 'confirmed',
    }
    const doc = await renderReceiptDocument(buildBookingSlipSections({ appointment, fee: 500, paid: 200, due: 300, patientName: 'Rahul Verma' }))
    const pdf = bytesToLatin1String(doc.toBytes())
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(doc.toBlob().type).toBe('application/pdf')
  })
})

// "View slip" flow (request: "booking slip ke jagah view ka option do view open hone ke bad
// download ka option ho") — this returns the Blob instead of triggering a download itself, so
// PatientPages.jsx can preview it in-page first and offer the actual save as a separate action
// from inside that preview.
describe('buildBookingSlipPdfBlob', () => {
  const appointment = { id: 'appt_9f8e7d6c5b4a', doctor: { name: 'Dr. Asha Rao' }, clinic: { name: 'Sunrise Clinic' }, appointmentDate: '2026-09-25', appointmentTime: '10:30 AM', tokenNumber: 7, status: 'confirmed' }

  it('returns a PDF Blob and a booking-slip filename derived from the appointment id, without downloading anything itself', async () => {
    const { blob, filename } = await buildBookingSlipPdfBlob({ appointment, fee: 500, paid: 200, due: 300, patientName: 'Rahul Verma' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(0)
    expect(filename).toBe('booking-slip-#5b4a.pdf')
  })
})

// Same "view first, download from inside the preview" flow, applied to every other slip/receipt
// PDF in the app (request: "baki jagah v same kar do jaha slip download ho raha hai").
describe('buildPatientReceiptPdfBlob', () => {
  it('returns a PDF Blob and a receipt filename derived from the receipt number, without downloading anything itself', async () => {
    const item = { id: 'pay_1122334455', receiptNumber: 'RCPT-0042', patientName: 'Rahul Verma', doctorName: 'Dr. Asha Rao', clinicName: 'Sunrise Clinic', createdAt: '2026-09-18', mode: 'upi', status: 'paid', amount: 500, fees: { consultationFee: 500, amount: 500 } }
    const { blob, filename } = await buildPatientReceiptPdfBlob(item)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(0)
    expect(filename).toBe('receipt-RCPT-0042.pdf')
  })

  it('falls back to a shortId-based filename when there is no receipt number', async () => {
    const item = { id: 'pay_1122334455', patientName: 'Rahul Verma', doctorName: 'Dr. Asha Rao', clinicName: 'Sunrise Clinic', createdAt: '2026-09-18', mode: 'upi', status: 'paid', amount: 500, fees: { consultationFee: 500, amount: 500 } }
    const { filename } = await buildPatientReceiptPdfBlob(item)
    expect(filename).toBe('receipt-#4455.pdf')
  })
})

describe('buildStaffReceiptPdfBlob', () => {
  it('returns a PDF Blob and a receipt filename derived from the receipt number, without downloading anything itself', async () => {
    const item = { id: 'pay_998877', receiptNumber: 'RCPT-0099', patient: { name: 'Rahul Verma' }, doctor: { name: 'Dr. Asha Rao' }, clinic: { name: 'Sunrise Clinic' }, createdAt: '2026-09-18', mode: 'cash', status: 'paid', fees: { consultationFee: 500 } }
    const { blob, filename } = await buildStaffReceiptPdfBlob(item)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(0)
    expect(filename).toBe('receipt-RCPT-0099.pdf')
  })
})

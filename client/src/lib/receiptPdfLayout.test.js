import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBookingSlipSections, buildPatientReceiptSections, buildStaffReceiptSections, renderReceiptDocument, wrapReceiptText } from './receiptPdf'

describe('receipt completeness and PDF wrapping', () => {
  const appointment = {
    id: 'appointment-full-reference-20261021-12345678', patient: { name: 'Account owner', phone: '9000000000' },
    familyMember: { name: 'Anita Sharma', relation: 'Mother' },
    doctor: { name: 'Dr. Priya Sharma', doctorNumber: 1, specialization: { name: 'General Physician' } },
    clinic: { name: 'BookADoctors Demo Clinic', address: 'First floor, opposite Central Hospital, Main Road, Andheri West, Mumbai, Maharashtra 400053', phone: '022-12345678' },
    appointmentDate: '2026-10-21', appointmentTime: '10:05', isEstimatedTime: true,
    estimatedVisitAt: '2026-10-21T04:35:00.000Z', tokenNumber: 1, status: 'confirmed', paymentStatus: 'partial',
    reason: 'Follow-up consultation. Please bring previous prescriptions and test results.',
  }
  const options = { appointment, fee: 528, paid: 228, due: 300, patientNumber: 2,
    payment: { status: 'paid', mode: 'online', transactionRef: 'pay_1234567890123456789012345678901234567890' } }

  it('prints the actual family member, full reference, approximate visit time and payment details', () => {
    const document = buildBookingSlipSections(options)
    const rows = document.sections.flatMap((section) => section.rows)
    expect(rows).toContainEqual(['Name', 'Anita Sharma'])
    expect(rows).toContainEqual(['Booked by', 'Account owner'])
    expect(rows).toContainEqual(['Full booking reference', appointment.id])
    expect(rows).toContainEqual(['Time', 'Approx. 10:05'])
    expect(rows).toContainEqual(['Payment status', 'partial'])
    expect(rows).toContainEqual(['Transaction reference', options.payment.transactionRef])
    expect(rows).toContainEqual(['Visit notes', appointment.reason])
  })

  it('wraps multiline text and unbroken IDs without truncation', () => {
    const reference = 'W'.repeat(180)
    const lines = wrapReceiptText(reference, 300, 10)
    expect(lines.every((line) => line.length <= 30)).toBe(true)
    expect(lines.join('')).toBe(reference)
    expect(wrapReceiptText('first\nsecond', 300)).toEqual(['first', 'second'])
  })

  it('paginates exceptionally long notes without losing the final content', async () => {
    const document = buildBookingSlipSections({ ...options, appointment: { ...appointment, reason: `${'Long visit notes requiring wrapping. '.repeat(130)}END OF NOTES` } })
    const doc = await renderReceiptDocument(document)
    const text = Array.from(doc.toBytes(), (byte) => String.fromCharCode(byte)).join('')
    expect(text).toContain('continued')
    const visibleText = [...text.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => match[1]).join(' ')
    expect(visibleText).toContain('END OF NOTES')
    expect(text).toContain('Please carry a valid photo ID')
    if (process.env.PDF_QA_DIR) {
      mkdirSync(process.env.PDF_QA_DIR, { recursive: true })
      writeFileSync(join(process.env.PDF_QA_DIR, 'long-booking-slip.pdf'), doc.toBytes())
      const regular = await renderReceiptDocument(buildBookingSlipSections(options))
      writeFileSync(join(process.env.PDF_QA_DIR, 'booking-slip.pdf'), regular.toBytes())
      const payment = {
        id: 'payment-reference', receiptNumber: 'CDR-00000001', createdAt: '2026-10-21T05:00:00.000Z',
        patient: { ...appointment.patient, patientNumber: 2 }, doctor: appointment.doctor, clinic: appointment.clinic,
        patientName: 'Account owner', doctorName: appointment.doctor.name, clinicName: appointment.clinic.name,
        mode: 'online', transactionRef: 'pay_12345678901234567890', status: 'paid', amount: 528,
        fees: { consultationFee: 500, convenienceFee: 25, gstAmount: 3, amount: 528 }, appointment,
      }
      for (const [name, spec] of [['patient-receipt', buildPatientReceiptSections(payment)], ['clinic-receipt', buildStaffReceiptSections(payment)]]) {
        writeFileSync(join(process.env.PDF_QA_DIR, `${name}.pdf`), (await renderReceiptDocument(spec)).toBytes())
      }
    }
  })
})

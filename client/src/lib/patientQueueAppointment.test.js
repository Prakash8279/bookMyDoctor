import { describe, expect, it } from 'vitest'
import { nextPatientAppointment, todaysQueueAppointment } from './patientQueueAppointment'

const today = '2026-10-24'

describe('patient queue appointment selection', () => {
  it('does not use a past booking as today\'s live queue', () => {
    const past = { id: 'past', appointmentDate: '2026-10-23', status: 'upcoming', tokenNumber: 1 }
    expect(todaysQueueAppointment([past], today)).toBeNull()
    expect(nextPatientAppointment([past], today)).toBeNull()
  })

  it('prefers a fully paid booking when multiple visits share today', () => {
    const partial = { id: 'partial', appointmentDate: today, status: 'upcoming', appointmentTime: '10:00', clinicPaymentComplete: false }
    const paid = { id: 'paid', appointmentDate: today, status: 'upcoming', appointmentTime: '11:00', clinicPaymentComplete: true }
    expect(todaysQueueAppointment([partial, paid], today)?.id).toBe('paid')
  })

  it('finds the nearest future visit regardless of API list order', () => {
    const later = { id: 'later', appointmentDate: '2026-10-30', status: 'upcoming' }
    const sooner = { id: 'sooner', appointmentDate: '2026-10-26', status: 'confirmed' }
    expect(nextPatientAppointment([later, sooner], today)?.id).toBe('sooner')
  })
})

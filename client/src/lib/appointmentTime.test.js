import { describe, expect, it } from 'vitest'
import { appointmentTimeLabel, bookingCreatedAtLabel } from './appointmentTime'

describe('booking creation timestamp', () => {
  it('shows the original creation instant in India time, independently of visit time', () => {
    expect(bookingCreatedAtLabel({ createdAt: '2026-10-21T20:40:05Z', appointmentDate: '2026-10-25', appointmentTime: '10:00' })).toBe('22/10/2026 02:10:05 IST')
    expect(bookingCreatedAtLabel({ createdAt: '2026-10-22T02:10:05+05:30' })).toBe('22/10/2026 02:10:05 IST')
  })
  it('does not invent a timestamp for missing, invalid or date-only legacy records', () => {
    for (const createdAt of [null, undefined, '', 'invalid', '2026-10-21']) {
      expect(bookingCreatedAtLabel({ createdAt })).toBe('Not recorded')
    }
  })
})

describe('approximate call time', () => {
  it('keeps legacy exact appointments unchanged', () => {
    expect(appointmentTimeLabel({ appointmentTime: '10:00' })).toBe('10:00')
  })
  it('marks same-day estimates', () => {
    expect(appointmentTimeLabel({ isEstimatedTime: true, appointmentDate: '2026-10-22',
      estimatedVisitAt: '2026-10-22T04:35:00Z' })).toBe('Approx. 10:05')
  })
  it('shows the real date if the estimated call crosses midnight', () => {
    expect(appointmentTimeLabel({ isEstimatedTime: true, appointmentDate: '2026-10-22',
      estimatedVisitAt: '2026-10-22T18:35:00Z' })).toBe('Approx. 2026-10-23 00:05')
  })
})

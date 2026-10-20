import { describe, expect, it } from 'vitest'
import { appointmentTimeLabel } from './appointmentTime'

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

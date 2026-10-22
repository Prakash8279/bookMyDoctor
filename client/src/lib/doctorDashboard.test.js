import { describe, expect, it } from 'vitest'
import { doctorDashboardToday } from './doctorDashboard'

describe('doctor dashboard today-only records', () => {
  it('does not count historical, future or undated rows as today', () => {
    const summary = doctorDashboardToday({
      appointments: [
        { id: 'old-cancelled', appointmentDate: '2026-10-19', status: 'cancelled' },
        { id: 'old', appointmentDate: '2026-10-21', status: 'confirmed' },
        { id: 'future', appointmentDate: '2026-10-23', status: 'confirmed' },
        { id: 'missing-date', status: 'upcoming' },
      ],
      payments: [{ createdAt: '2026-10-21T04:30:00Z', status: 'paid', fees: { consultationFee: 1501 } }],
      queueTokens: [{ queueDate: '2026-10-21', status: 'waiting' }, { status: 'waiting' }],
    }, '2026-10-22')
    expect(summary).toEqual({ bookings: 0, completed: 0, waiting: 0, revenue: 0, recentRecords: [] })
  })

  it('uses visit date for bookings and includes completed visits, not unpaid/cancelled holds', () => {
    const summary = doctorDashboardToday({
      appointments: [
        { id: 'confirmed', appointmentDate: '2026-10-22', status: 'confirmed', createdAt: '2026-10-20T04:30:00Z' },
        { id: 'completed', appointmentDate: '2026-10-22', status: 'completed' },
        { id: 'hold', appointmentDate: '2026-10-22', status: 'pending_payment' },
        { id: 'cancelled', appointmentDate: '2026-10-22', status: 'cancelled' },
        { id: 'advance', appointmentDate: '2026-10-23', status: 'confirmed', createdAt: '2026-10-22T04:30:00Z' },
      ],
      queueTokens: [{ queueDate: '2026-10-22', status: 'waiting' }, { queueDate: '2026-10-22', status: 'completed' }],
    }, '2026-10-22')
    expect(summary.bookings).toBe(2)
    expect(summary.completed).toBe(1)
    expect(summary.waiting).toBe(1)
    expect(summary.recentRecords).toHaveLength(4)
    expect(summary.recentRecords.some((row) => row.id === 'advance')).toBe(false)
  })

  it('uses IST midnight boundaries and only successful payment collections for revenue', () => {
    const summary = doctorDashboardToday({
      payments: [
        { createdAt: '2026-10-21T18:29:59Z', status: 'paid', fees: { consultationFee: 1000 } },
        { createdAt: '2026-10-21T18:30:00Z', status: 'paid', fees: { consultationFee: 500 } },
        { createdAt: '2026-10-22T18:29:59Z', status: 'paid', fees: { consultationFee: 300 } },
        { createdAt: '2026-10-22T18:30:00Z', status: 'paid', fees: { consultationFee: 1000 } },
        ...['pending', 'refunded', 'failed'].map((status) => ({ createdAt: '2026-10-22T04:30:00Z', status, fees: { consultationFee: 1000 } })),
        { createdAt: '2026-10-22T04:30:00Z', status: 'paid', fees: { consultationFee: 'bad' } },
      ],
    }, '2026-10-22')
    expect(summary.revenue).toBe(800)
  })

  it('shows the six latest creation records from today without mutating source arrays', () => {
    const appointments = Array.from({ length: 9 }, (_, index) => ({
      id: String(index), status: 'confirmed', appointmentDate: '2026-10-22', createdAt: `2026-10-22T04:${String(index).padStart(2, '0')}:00Z`,
    }))
    const snapshot = [...appointments]
    expect(doctorDashboardToday({ appointments }, '2026-10-22').recentRecords.map((row) => row.id)).toEqual(['8', '7', '6', '5', '4', '3'])
    expect(appointments).toEqual(snapshot)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { doctorAppointmentsCsv, fetchDoctorAppointmentsForRange, indiaTodayDate } from './doctorAppointmentsExport'

describe('doctor appointment export', () => {
  it('uses the India calendar date for Today', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-18T20:00:00Z'))
      expect(indiaTodayDate()).toBe('2026-10-19')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fetches every page for the selected range', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `a${index}` }))
    const second = [{ id: 'a100' }]
    const api = { get: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) }
    const result = await fetchDoctorAppointmentsForRange(api, '2026-10-19', '2026-10-21')
    expect(result).toHaveLength(101)
    expect(api.get).toHaveBeenNthCalledWith(1, '/appointments', { params: { dateFrom: '2026-10-19', dateTo: '2026-10-21', page: 1, pageSize: 100 } })
    expect(api.get).toHaveBeenNthCalledWith(2, '/appointments', { params: { dateFrom: '2026-10-19', dateTo: '2026-10-21', page: 2, pageSize: 100 } })
  })

  it('exports full booking data safely for spreadsheets', () => {
    const csv = doctorAppointmentsCsv([{
      id: 'booking-1', tokenNumber: 4, appointmentDate: '2026-10-19', appointmentTime: '10:00',
      doctor: { doctorNumber: 'DCD1', name: 'Dr. Asha' },
      patient: { patientNumber: 'DCP2', name: 'Kiran', phone: '9000000001' },
      clinic: { name: 'Main Clinic' }, status: 'confirmed', paymentStatus: 'paid',
      fees: { consultationFee: 500, due: 0 }, reason: '=HYPERLINK("bad")',
    }])
    expect(csv).toContain('"booking-1"')
    expect(csv).toContain('"DCP2"')
    expect(csv).toContain('"500.00"')
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
  })
})

import { describe, expect, it } from 'vitest'
import { clinicDistanceKm, clinicDirectionsUrl, nearestDoctorClinic } from './clinicLocation'

describe('clinic location', () => {
  it('sorts only clinics with verified coordinates by real distance', () => {
    const origin = { latitude: 19.1197, longitude: 72.8464 }
    const near = { id: 'near', latitude: 19.12, longitude: 72.846 }
    const far = { id: 'far', latitude: 19.2, longitude: 72.9 }
    expect(nearestDoctorClinic({ clinics: [far, near] }, origin).clinic.id).toBe('near')
    expect(clinicDistanceKm(origin, near)).toBeLessThan(clinicDistanceKm(origin, far))
    expect(clinicDistanceKm(origin, { name: 'No pin' })).toBeNull()
  })

  it('opens Google Maps directions with a pin or the clinic address', () => {
    expect(clinicDirectionsUrl({ name: 'Care Clinic', latitude: 19.12, longitude: 72.85 })).toContain('destination=19.12%2C72.85')
    expect(decodeURIComponent(clinicDirectionsUrl({ name: 'Care Clinic', city: 'Mumbai' }, 'Andheri West'))).toContain('destination=Care Clinic, Andheri West, Mumbai, India')
  })
})

const radians = (degrees) => degrees * Math.PI / 180

export function clinicCoordinates(clinic) {
  if (clinic?.latitude == null || clinic?.longitude == null) return null
  const latitude = Number(clinic.latitude)
  const longitude = Number(clinic.longitude)
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null
}

export function clinicDistanceKm(origin, clinic) {
  const destination = clinicCoordinates(clinic)
  if (!origin || !destination) return null
  const deltaLat = radians(destination.latitude - origin.latitude)
  const deltaLng = radians(destination.longitude - origin.longitude)
  const arc = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(deltaLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(arc))
}

export function nearestDoctorClinic(doctor, origin) {
  return (doctor.clinics || [])
    .map((clinic) => ({ clinic, distanceKm: clinicDistanceKm(origin, clinic) }))
    .filter((item) => item.distanceKm != null)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] || null
}

export function clinicDirectionsUrl(clinic, address) {
  if (!clinic) return null
  const coordinates = clinicCoordinates(clinic)
  const destination = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : [clinic.name, address || clinic.address, clinic.area?.name || clinic.area, clinic.city?.name || clinic.city, 'India'].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

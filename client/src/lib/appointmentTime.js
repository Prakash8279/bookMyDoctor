// Booking creation is an instant, not the scheduled visit date or PDF generation time.
// Do not invent a time for legacy date-only or missing values.
export function bookingCreatedAtLabel(appointment) {
  const value = appointment?.createdAt
  if (!value || (typeof value === 'string' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) return 'Not recorded'
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return 'Not recorded'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')} IST`
}

// Keep the actual estimated date visible when a doctor's quota extends past midnight.
export function appointmentTimeLabel(appointment) {
  if (!appointment?.isEstimatedTime) return appointment?.appointmentTime || '—'
  const instant = appointment.estimatedVisitAt && new Date(appointment.estimatedVisitAt)
  if (instant && !Number.isNaN(instant.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant)
    const part = (type) => parts.find((item) => item.type === type)?.value
    const date = `${part('year')}-${part('month')}-${part('day')}`
    return `Approx. ${date !== appointment.appointmentDate?.slice(0, 10) ? `${date} ` : ''}${part('hour')}:${part('minute')}`
  }
  return `Approx. ${appointment.appointmentTime || '—'}`
}

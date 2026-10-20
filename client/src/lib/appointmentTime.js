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

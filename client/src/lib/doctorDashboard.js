import { indiaRecordDate } from './adminRecords'

// A doctor's daily workload is based on the visit date; collections are based on
// the payment's own creation instant. Never substitute one date for the other.
export function doctorDashboardToday(data, today) {
  const appointments = (data.appointments || []).filter((item) => indiaRecordDate(item.appointmentDate) === today)
  const bookings = appointments.filter((item) => ['upcoming', 'confirmed', 'completed', 'no_show'].includes(item.status)).length
  const completed = appointments.filter((item) => item.status === 'completed').length
  const waiting = (data.queueTokens || []).filter((item) => item.queueDate === today && item.status === 'waiting').length
  const revenue = (data.payments || []).reduce((sum, item) => {
    if (item.status !== 'paid' || indiaRecordDate(item.createdAt) !== today) return sum
    const amount = Number(item.fees?.consultationFee ?? 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
  const recentRecords = [...appointments].sort((left, right) => {
    const timestamp = (item) => {
      const created = Date.parse(item.createdAt)
      return Number.isNaN(created) ? Date.parse(`${today}T${item.appointmentTime || '00:00'}:00+05:30`) || 0 : created
    }
    return timestamp(right) - timestamp(left) || String(right.id || '').localeCompare(String(left.id || ''))
  }).slice(0, 6)
  return { bookings, completed, waiting, revenue, recentRecords }
}

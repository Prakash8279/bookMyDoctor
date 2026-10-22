import { appointmentTimeLabel, bookingCreatedAtLabel } from './appointmentTime'
import { buildCsv } from './csv'

export function indiaTodayDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

// Spreadsheet apps can evaluate cells starting with these characters as formulas.
const spreadsheetSafe = (value) => {
  const text = String(value ?? '')
  return /^[\p{Cc}\s]*[=+\-@]/u.test(text) ? `'${text}` : text
}

const money = (value) => value == null ? '' : Number(value).toFixed(2)

export function doctorAppointmentsCsv(appointments) {
  const headers = ['Booking ID', 'Booked on (IST)', 'Token', 'Date', 'Time', 'Doctor ID', 'Doctor', 'Patient ID', 'Patient', 'Phone', 'Clinic', 'Status', 'Payment status', 'Payment method', 'Consultation fee (INR)', 'Due (INR)', 'Notes']
  const rows = appointments.map((item) => [
    item.id, bookingCreatedAtLabel(item), item.tokenNumber, item.appointmentDate, appointmentTimeLabel(item),
    item.doctor?.doctorNumber, item.doctor?.name,
    item.patient?.patientNumber, item.familyMember?.name || item.patient?.name,
    item.patient?.phone, item.clinic?.name, item.status, item.paymentStatus,
    item.paymentMethod, money(item.fees?.consultationFee), money(item.fees?.due), item.reason,
  ].map(spreadsheetSafe))
  // UTF-8 BOM helps Excel display names and other non-ASCII characters correctly.
  return `\uFEFF${buildCsv(headers, rows)}`
}

export async function fetchDoctorAppointmentsForRange(apiClient, dateFrom, dateTo) {
  const appointments = []
  for (let page = 1; ; page += 1) {
    const rows = await apiClient.get('/appointments', { params: { dateFrom, dateTo, page, pageSize: 100 } })
    if (!Array.isArray(rows)) throw new Error('Could not read appointment export data.')
    appointments.push(...rows)
    if (rows.length < 100 || (rows.__pagination && page >= rows.__pagination.totalPages)) break
  }
  return appointments
}

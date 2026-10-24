import { indiaTodayDate } from './doctorAppointmentsExport'
import { clinicPaymentComplete } from './clinicPaymentGate'

const bookable = (item) => ['upcoming', 'confirmed'].includes(item.status)

export function todaysQueueAppointment(appointments, today = indiaTodayDate()) {
  return (appointments || [])
    .filter((item) => bookable(item) && item.appointmentDate === today)
    .sort((a, b) => Number(clinicPaymentComplete(b)) - Number(clinicPaymentComplete(a)) ||
      Number(Boolean(b.checkedInAt)) - Number(Boolean(a.checkedInAt)) ||
      String(a.appointmentTime || '').localeCompare(String(b.appointmentTime || '')))[0] || null
}

export function nextPatientAppointment(appointments, today = indiaTodayDate()) {
  return (appointments || [])
    .filter((item) => bookable(item) && item.appointmentDate >= today)
    .sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate) ||
      String(a.appointmentTime || '').localeCompare(String(b.appointmentTime || '')))[0] || null
}

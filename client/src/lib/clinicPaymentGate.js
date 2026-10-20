export function clinicPaymentComplete(item) {
  if (typeof item.clinicPaymentComplete === 'boolean') return item.clinicPaymentComplete
  if (item.paymentStatus === 'refunded') return false
  if (item.paymentStatus === 'paid') return true
  // `due` is role-masked and supplied by the API, unlike private platform totals.
  return item.fees?.due != null && Number(item.fees.due) <= 0
}

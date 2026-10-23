// A booking advance secures a reservation, not permission to start consultation.
// Free appointments need no artificial zero-value payment receipt.
function isClinicPaymentComplete(appointment) {
  return !!appointment && appointment.paymentStatus !== 'refunded' &&
    (appointment.paymentStatus === 'paid' ||
      (appointment.totalAmount != null && Number(appointment.totalAmount) <= 0));
}

function clinicPaymentWhere() {
  return { paymentStatus: { not: 'refunded' }, OR: [{ paymentStatus: 'paid' }, { totalAmount: { lte: 0 } }] };
}

module.exports = { isClinicPaymentComplete, clinicPaymentWhere };

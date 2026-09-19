export const doctorCharge = (payment = {}, appointment = {}) => Number(payment.consultationFee ?? payment.doctorFee ?? appointment.consultationFee ?? appointment.doctorFee ?? appointment.fee ?? payment.amount ?? 0)

export const visiblePaymentAmount = (payment = {}, appointment = {}, role = 'admin') => ['doctor', 'receptionist'].includes(role) ? doctorCharge(payment, appointment) : Number(payment.amount || payment.totalAmount || 0)

// Was this payment made by the PATIENT online at booking time (Razorpay's "Pay now" flow right
// after booking), as opposed to collected in person at the clinic (by a receptionist/admin,
// recorded via the Payments/CashPayment form — cash, or a UPI/card/online payment taken at the
// counter)? Request: "online booking ke time pe kitna payment hua hai and second clinic pe aake
// cash ya online ye v to confirm hona chahiye" — the receptionist's Payments page previously
// lumped both together under one "Online" bucket (any non-cash `mode`), so there was no way to
// tell "patient already paid before arriving" apart from "collected just now at the counter".
//
// The Payment table itself has no explicit source/channel column (that would need a backend
// schema change + a manual SQL migration the user would have to run — see razorpay.service.js's
// verifyAndRecordPayment). What IS reliable with today's data: verifyAndRecordPayment always
// calls createPaymentForAppointment with mode:'online' and transactionRef set to the exact
// Razorpay payment id, and Razorpay payment ids always start with "pay_" (see
// razorpay.service.test.js's fixtures, e.g. 'pay_xyz789'). A receptionist recording a payment by
// hand can also pick "Online" as the method, but types a bank/UPI reference into that same field
// — never something shaped like a Razorpay id — so this prefix reliably separates the two without
// touching the database.
export const isOnlineBookingPayment = (payment = {}) =>
  String(payment.mode || '').toLowerCase() === 'online' && /^pay_/i.test(String(payment.transactionRef || ''))

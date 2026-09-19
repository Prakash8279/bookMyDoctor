import { Badge } from './Badge'
import { isOnlineBookingPayment } from '../lib/paymentVisibility'

// Small confirmation tag shown next to a payment's mode: was this paid by the patient online at
// booking time (Razorpay, before ever reaching the clinic), or collected in person at the clinic
// (cash, or an online/UPI/card payment taken at the counter)? Request: "eshme ye show hona chahiye
// ki online booking ke time pe kitna payment hua hai and second clinic pe aake cash ya online ye v
// to confirm hona chahiye", then "eshme v add kro ye sab ye sab patient setion me v add kro pdf mr
// v ye aana chahiye admin section me v" — shared by the receptionist/doctor Payments table
// (StaffPages.jsx's CashPayment), the patient's own Payments table (PatientPages.jsx), and the
// admin Revenue report's payments table (AdminPages.jsx's RevenueReports); lib/receiptPdf.js
// writes the same "at booking" / "at clinic" wording as plain text in the PDF itself.
export function PaymentSourceBadge({ payment }) {
  if (!payment?.mode) return null
  return isOnlineBookingPayment(payment)
    ? <Badge tone="teal">At booking</Badge>
    : <Badge tone="neutral">At clinic</Badge>
}

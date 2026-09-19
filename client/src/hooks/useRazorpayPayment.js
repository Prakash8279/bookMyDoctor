import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { loadRazorpayScript } from '../lib/loadRazorpayScript'

// PENDING-PAYMENT RESUME FIX (multi-agent senior-dev payment audit, "payment sahi nahi hua hai"):
// before this hook existed, the ONLY place in the app that could ever pay for a `pending_payment`
// appointment was the Booking component's one-shot "Payment required to confirm" screen, gated by
// component-local useState set right after a fresh booking. A patient who left that screen before
// finishing payment — refreshed the page, clicked "My appointments" to double check the booking
// went through, backgrounded the tab during a UPI app-switch, a tab crash — had NO way back to a
// Pay button anywhere in the app: the appointment just sat as `pending_payment` forever, with no
// resume and no cancel option. This hook extracts the create-order -> open-checkout -> verify-
// signature flow (previously only inlined in Booking) so PatientAppointments/BookingHistory can
// also offer "Resume payment" on any `pending_payment` row it renders, independent of whether the
// patient is still on the post-booking screen.
//
// It also carries the RESUME/RECONCILE fix: the Razorpay `handler` callback only ever fires after
// Razorpay has already captured the payment, so a failure in the subsequent verify call (timeout,
// dropped connection, a transient error after the backend's own transaction actually committed)
// does not mean the money wasn't taken — re-check the appointment's real status before reporting a
// failure, so a lost response doesn't wrongly tell the patient to pay again.
export function useRazorpayPayment() {
  const createRazorpayOrder = useAppStore((state) => state.createRazorpayOrder)
  const verifyRazorpayPayment = useAppStore((state) => state.verifyRazorpayPayment)
  const getAppointment = useAppStore((state) => state.getAppointment)
  const [payingId, setPayingId] = useState(null) // the appointment id currently mid-flow, or null
  const [paymentError, setPaymentError] = useState('')

  /**
   * @param {object} appointment - needs .id and, for the Checkout description, .doctor?.name
   * @param {'full'|'minimum'} paymentOption
   * @param {{name?:string, email?:string, phone?:string}} [currentUser]
   * @param {(appointment: object) => void} [onUpdated] - called with the freshly re-fetched
   *   appointment once payment is confirmed (or reconciled as already-paid)
   */
  const payNow = async (appointment, paymentOption, { currentUser = {}, onUpdated } = {}) => {
    setPaymentError('')
    setPayingId(appointment.id)
    try {
      await loadRazorpayScript().catch(() => {
        throw new Error('Payment gateway failed to load. Check your internet connection and try again.')
      })
      const order = await createRazorpayOrder(appointment.id, paymentOption)
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'BookMyDoctor24',
        description: `Consultation with ${appointment.doctor?.name || 'doctor'}${paymentOption === 'minimum' ? ' · Booking amount' : ''}`,
        prefill: { name: currentUser.name || '', email: currentUser.email || '', contact: currentUser.phone || '' },
        theme: { color: '#ad5d3b' },
        modal: { ondismiss: () => setPayingId(null) },
        handler: async (response) => {
          try {
            const { appointment: updated } = await verifyRazorpayPayment({
              appointmentId: appointment.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            onUpdated && onUpdated(updated)
          } catch (verifyError) {
            try {
              const fresh = await getAppointment(appointment.id)
              if (fresh && fresh.status !== 'pending_payment') {
                onUpdated && onUpdated(fresh)
                return
              }
            } catch {
              /* couldn't even re-check — fall through to showing the original error below */
            }
            setPaymentError(verifyError.message)
          } finally {
            setPayingId(null)
          }
        },
      })
      checkout.on('payment.failed', (failure) => {
        setPaymentError(failure?.error?.description || 'Payment failed. Please try again.')
        setPayingId(null)
      })
      checkout.open()
    } catch (orderError) {
      setPaymentError(orderError.message)
      setPayingId(null)
    }
  }

  return { payNow, payingId, paymentError, setPaymentError }
}

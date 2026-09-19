import { describe, expect, it } from 'vitest'
import { doctorCharge, isOnlineBookingPayment, visiblePaymentAmount } from './paymentVisibility'

describe('doctorCharge', () => {
  it('prefers payment.consultationFee first', () => {
    expect(
      doctorCharge(
        { consultationFee: 500, doctorFee: 400, amount: 100 },
        { consultationFee: 300, doctorFee: 200, fee: 100 }
      )
    ).toBe(500)
  })

  it('falls back through the chain to appointment.fee', () => {
    expect(doctorCharge({}, { fee: 250 })).toBe(250)
  })

  it('falls back to payment.amount when nothing else is set', () => {
    expect(doctorCharge({ amount: 700 }, {})).toBe(700)
  })

  it('defaults to 0 when everything is missing', () => {
    expect(doctorCharge()).toBe(0)
    expect(doctorCharge({}, {})).toBe(0)
  })
})

describe('visiblePaymentAmount', () => {
  it('shows the doctor charge for a doctor role', () => {
    expect(visiblePaymentAmount({ amount: 1000, consultationFee: 400 }, {}, 'doctor')).toBe(400)
  })

  it('shows the doctor charge for a receptionist role', () => {
    expect(visiblePaymentAmount({ amount: 1000, doctorFee: 350 }, {}, 'receptionist')).toBe(350)
  })

  it('shows the full payment amount for an admin role', () => {
    expect(visiblePaymentAmount({ amount: 1000, consultationFee: 400 }, {}, 'admin')).toBe(1000)
  })

  it('defaults to the admin (full amount) view when no role is given', () => {
    expect(visiblePaymentAmount({ totalAmount: 900 }, {})).toBe(900)
  })

  it('defaults amount-related fields to 0 when missing', () => {
    expect(visiblePaymentAmount({}, {}, 'admin')).toBe(0)
    expect(visiblePaymentAmount({}, {}, 'doctor')).toBe(0)
  })
})

describe('isOnlineBookingPayment', () => {
  it('is true for a Razorpay-verified payment (mode online, transactionRef is a Razorpay payment id)', () => {
    expect(isOnlineBookingPayment({ mode: 'online', transactionRef: 'pay_xyz789' })).toBe(true)
  })

  it('is case-insensitive on both the mode and the "pay_" prefix', () => {
    expect(isOnlineBookingPayment({ mode: 'Online', transactionRef: 'PAY_Xyz789' })).toBe(true)
  })

  it('is false for a receptionist-recorded online/UPI/card payment (a bank reference, not a Razorpay payment id)', () => {
    expect(isOnlineBookingPayment({ mode: 'online', transactionRef: 'UTR998877' })).toBe(false)
    expect(isOnlineBookingPayment({ mode: 'upi', transactionRef: 'pay_xyz789' })).toBe(false) // wrong mode
  })

  it('is false for cash, and for a payment with no transaction reference at all', () => {
    expect(isOnlineBookingPayment({ mode: 'cash', transactionRef: 'pay_xyz789' })).toBe(false)
    expect(isOnlineBookingPayment({ mode: 'online' })).toBe(false)
    expect(isOnlineBookingPayment({})).toBe(false)
  })
})

import { expect, it } from 'vitest'
import { clinicPaymentComplete } from './clinicPaymentGate'
it('requires full payment, honors the server gate and allows free visits', () => {
  expect(clinicPaymentComplete({paymentStatus:'partial',fees:{due:400}})).toBe(false)
  expect(clinicPaymentComplete({paymentStatus:'pending'})).toBe(false)
  expect(clinicPaymentComplete({paymentStatus:'refunded',fees:{due:0}})).toBe(false)
  expect(clinicPaymentComplete({paymentStatus:'paid'})).toBe(true)
  expect(clinicPaymentComplete({clinicPaymentComplete:true,paymentStatus:'pending',fees:{due:0}})).toBe(true)
  expect(clinicPaymentComplete({clinicPaymentComplete:false,fees:{due:0}})).toBe(false)
})

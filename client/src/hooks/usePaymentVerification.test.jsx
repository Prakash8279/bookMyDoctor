import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isConfirmedPayment, usePaymentVerification } from './usePaymentVerification'

const mocks = vi.hoisted(() => ({ verifyRazorpayPayment: vi.fn(), getAppointment: vi.fn() }))
vi.mock('../store/useAppStore', () => ({ useAppStore: (select) => select(mocks) }))
const paid = { id: 'a1', status: 'upcoming', paymentStatus: 'paid', tokenNumber: 1 }
const payload = { appointmentId: 'a1', razorpayPaymentId: 'pay_x' }
describe('payment confirmation waiting room', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.getAppointment.mockResolvedValue({ status: 'pending_payment', paymentStatus: 'pending', tokenNumber: null })
    mocks.verifyRazorpayPayment.mockRejectedValue(new Error('PAYMENT_PROCESSING'))
  })
  afterEach(() => vi.useRealTimers())

  it('shows waiting immediately, then resolves a captured payment without waiting a minute', async () => {
    let resolve
    mocks.verifyRazorpayPayment.mockImplementation(() => new Promise((done) => { resolve = done }))
    const confirmed = vi.fn()
    const { result } = renderHook(usePaymentVerification)
    let request
    act(() => { request = result.current.start(payload, confirmed) })
    expect(result.current.verification).toEqual({ phase: 'verifying', secondsLeft: 60 })
    await act(async () => { resolve({ appointment: paid }); await request })
    expect(confirmed).toHaveBeenCalledWith(paid)
    expect(result.current.verification).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    expect(confirmed).toHaveBeenCalledOnce()
  })

  it('automatically detects a webhook confirmation while initial verification is still slow', async () => {
    mocks.verifyRazorpayPayment.mockImplementation(() => new Promise(() => {}))
    const confirmed = vi.fn()
    const { result } = renderHook(usePaymentVerification)
    act(() => { result.current.start(payload, confirmed) })
    mocks.getAppointment.mockResolvedValue(paid)
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(confirmed).toHaveBeenCalledWith(paid)
    expect(result.current.verification).toBeNull()
  })

  it('retries authorized/processing verification but never grants a token for unpaid bookings', async () => {
    const confirmed = vi.fn()
    const { result } = renderHook(usePaymentVerification)
    await act(async () => result.current.start(payload, confirmed))
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(mocks.verifyRazorpayPayment).toHaveBeenCalledTimes(2)
    expect(confirmed).not.toHaveBeenCalled()
    expect(result.current.verification.secondsLeft).toBe(54)
    mocks.verifyRazorpayPayment.mockResolvedValue({ appointment: { ...paid, paymentStatus: 'partial' } })
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(confirmed).toHaveBeenCalledOnce()
  })

  it('shows an honest pending state at sixty seconds, with safe idempotent status retry', async () => {
    const confirmed = vi.fn()
    const { result } = renderHook(usePaymentVerification)
    await act(async () => result.current.start(payload, confirmed))
    await act(async () => vi.advanceTimersByTimeAsync(60000))
    expect(result.current.verification).toEqual({ phase: 'pending', secondsLeft: 0 })
    expect(confirmed).not.toHaveBeenCalled()
    mocks.verifyRazorpayPayment.mockResolvedValue({ appointment: paid })
    await act(async () => result.current.retry())
    expect(mocks.verifyRazorpayPayment).toHaveBeenLastCalledWith(payload)
    expect(confirmed).toHaveBeenCalledWith(paid)
  })

  it('never confirms cancelled/refunded bookings and ignores late replies after unmount', async () => {
    mocks.getAppointment.mockResolvedValue({ ...paid, status: 'cancelled', paymentStatus: 'refunded' })
    const confirmed = vi.fn()
    const { result, unmount } = renderHook(usePaymentVerification)
    await act(async () => result.current.start(payload, confirmed))
    expect(result.current.verification.phase).toBe('cancelled')
    expect(confirmed).not.toHaveBeenCalled()
    unmount()
    expect(isConfirmedPayment({ ...paid, paymentStatus: 'pending' })).toBe(false)
    expect(isConfirmedPayment({ ...paid, tokenNumber: null })).toBe(false)
  })

  it('ignores a late successful verification response after leaving the page', async () => {
    let finish
    mocks.verifyRazorpayPayment.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const confirmed = vi.fn()
    const { result, unmount } = renderHook(usePaymentVerification)
    let request
    act(() => { request = result.current.start(payload, confirmed) })
    unmount()
    await act(async () => { finish({ appointment: paid }); await request })
    expect(confirmed).not.toHaveBeenCalled()
  })
})

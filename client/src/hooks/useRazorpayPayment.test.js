import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRazorpayPayment } from './useRazorpayPayment'

const mocks = vi.hoisted(() => ({
  createRazorpayOrder: vi.fn(),
  verifyRazorpayPayment: vi.fn(),
  getAppointment: vi.fn(),
  loadRazorpayScript: vi.fn(),
}))
vi.mock('../store/useAppStore', () => ({ useAppStore: (select) => select(mocks) }))
vi.mock('../lib/loadRazorpayScript', () => ({ loadRazorpayScript: mocks.loadRazorpayScript }))

describe('payment checkout reservation deadline', () => {
  let options
  let close
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T14:00:00Z'))
    vi.clearAllMocks()
    mocks.loadRazorpayScript.mockResolvedValue(undefined)
    mocks.createRazorpayOrder.mockResolvedValue({
      keyId: 'rzp_test_example', amount: 200, currency: 'INR', orderId: 'order_example',
      holdExpiresAt: '2026-10-19T14:01:30Z',
    })
    close = vi.fn()
    window.Razorpay = vi.fn(function (checkoutOptions) {
      options = checkoutOptions
      return { open: vi.fn(), close, on: vi.fn() }
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete window.Razorpay
  })

  it('limits checkout to the server reservation and closes it when that reservation expires', async () => {
    const { result, unmount } = renderHook(() => useRazorpayPayment())
    await act(async () => { await result.current.payNow({ id: 'appt-1' }, 'platform_only') })
    expect(options.timeout).toBe(90)
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(close).toHaveBeenCalledOnce()
    expect(result.current.payingId).toBeNull()
    expect(result.current.paymentError).toMatch(/window expired/)
    expect(mocks.verifyRazorpayPayment).not.toHaveBeenCalled()
    unmount()
  })

  it('does not open a checkout whose reservation expired while creating its order', async () => {
    mocks.createRazorpayOrder.mockResolvedValue({ holdExpiresAt: '2026-10-19T13:59:59Z' })
    const { result, unmount } = renderHook(() => useRazorpayPayment())
    await act(async () => { await result.current.payNow({ id: 'appt-1' }, 'full') })
    expect(window.Razorpay).not.toHaveBeenCalled()
    expect(result.current.paymentError).toMatch(/window expired/)
    unmount()
  })

  it('closes an unpaid checkout on navigation and clears its expiry timer', async () => {
    const { result, unmount } = renderHook(() => useRazorpayPayment())
    await act(async () => { await result.current.payNow({ id: 'appt-1' }, 'full') })
    unmount()
    expect(close).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not open an orphan checkout if the page is left while its order is loading', async () => {
    let finishOrder
    mocks.createRazorpayOrder.mockImplementation(() => new Promise((resolve) => { finishOrder = resolve }))
    const { result, unmount } = renderHook(() => useRazorpayPayment())
    let pending
    await act(async () => { pending = result.current.payNow({ id: 'appt-1' }, 'full') })
    unmount()
    await act(async () => {
      finishOrder({ holdExpiresAt: '2026-10-19T14:01:30Z' })
      await pending
    })
    expect(window.Razorpay).not.toHaveBeenCalled()
  })
})

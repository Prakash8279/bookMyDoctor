import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The loader keeps an in-flight/loaded promise in module-level state, so each test gets a fresh
// module instance (vi.resetModules + dynamic import) to avoid one test's script tag or mocked
// window.Razorpay leaking into the next.
const clearInjectedScripts = () => {
  document.querySelectorAll('script[src*="razorpay"]').forEach((node) => node.remove())
}

describe('loadRazorpayScript', () => {
  beforeEach(() => {
    vi.resetModules()
    delete window.Razorpay
    clearInjectedScripts()
  })

  afterEach(() => {
    delete window.Razorpay
    clearInjectedScripts()
  })

  it('resolves immediately without touching the DOM when window.Razorpay is already set', async () => {
    window.Razorpay = function FakeRazorpay() {}
    const { loadRazorpayScript } = await import('./loadRazorpayScript')

    const result = await loadRazorpayScript()

    expect(result).toBe(window.Razorpay)
    expect(document.querySelectorAll('script[src*="razorpay"]').length).toBe(0)
  })

  it('injects exactly one script tag even when called twice concurrently, and both callers resolve', async () => {
    const { loadRazorpayScript } = await import('./loadRazorpayScript')

    const first = loadRazorpayScript()
    const second = loadRazorpayScript()
    expect(document.querySelectorAll('script[src*="razorpay"]').length).toBe(1)

    // Simulate the real CDN script finishing and defining window.Razorpay as a side effect,
    // then firing its load event.
    window.Razorpay = function FakeRazorpay() {}
    document.querySelector('script[src*="razorpay"]').onload()

    await expect(first).resolves.toBe(window.Razorpay)
    await expect(second).resolves.toBe(window.Razorpay)
  })

  it('rejects on a load failure and lets a later call retry instead of staying stuck', async () => {
    const { loadRazorpayScript } = await import('./loadRazorpayScript')

    const attempt = loadRazorpayScript()
    document.querySelector('script[src*="razorpay"]').onerror()
    await expect(attempt).rejects.toThrow('Failed to load the Razorpay payment script.')

    clearInjectedScripts()
    const retry = loadRazorpayScript()
    expect(document.querySelectorAll('script[src*="razorpay"]').length).toBe(1)
    window.Razorpay = function FakeRazorpay() {}
    document.querySelector('script[src*="razorpay"]').onload()

    await expect(retry).resolves.toBe(window.Razorpay)
  })
})

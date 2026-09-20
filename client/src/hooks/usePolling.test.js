import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePolling } from './usePolling'

// Simulates the browser Page Visibility API in jsdom, which has no real notion of tab
// backgrounding — `document.hidden` is a read-only getter, so it must be redefined per test
// (restored in afterEach) rather than assigned directly.
function setDocumentHidden(hidden) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setDocumentHidden(false)
  })

  it('calls loadFn immediately on mount, then again every intervalMs', () => {
    const loadFn = vi.fn()
    renderHook(() => usePolling(loadFn, { intervalMs: 1000 }))

    expect(loadFn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(loadFn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1000)
    expect(loadFn).toHaveBeenCalledTimes(3)
  })

  it('defaults to a 15s interval when none is given, matching every existing call site', () => {
    const loadFn = vi.fn()
    renderHook(() => usePolling(loadFn))

    expect(loadFn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(14999)
    expect(loadFn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(loadFn).toHaveBeenCalledTimes(2)
  })

  it('never calls loadFn at all when enabled is false', () => {
    const loadFn = vi.fn()
    renderHook(() => usePolling(loadFn, { intervalMs: 1000, enabled: false }))

    vi.advanceTimersByTime(5000)
    expect(loadFn).not.toHaveBeenCalled()
  })

  // LOAD-REVIEW FIX core behavior — the whole point of consolidating into this hook.
  it('skips the scheduled poll while the tab is hidden, instead of firing it anyway', () => {
    const loadFn = vi.fn()
    renderHook(() => usePolling(loadFn, { intervalMs: 1000 }))
    expect(loadFn).toHaveBeenCalledTimes(1)

    setDocumentHidden(true)
    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(1000)
    expect(loadFn).toHaveBeenCalledTimes(1) // both scheduled ticks skipped while hidden
  })

  it('polls immediately when the tab becomes visible again, instead of waiting for the next tick', () => {
    const loadFn = vi.fn()
    setDocumentHidden(true)
    renderHook(() => usePolling(loadFn, { intervalMs: 1000 }))
    // The leading call still fires on mount regardless of visibility (matches every existing call
    // site's own unconditional `load()` before the old setInterval was even registered).
    expect(loadFn).toHaveBeenCalledTimes(1)

    setDocumentHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(loadFn).toHaveBeenCalledTimes(2)
  })

  it('stops polling entirely after unmount (interval cleared, listener removed)', () => {
    const loadFn = vi.fn()
    const { unmount } = renderHook(() => usePolling(loadFn, { intervalMs: 1000 }))
    expect(loadFn).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(5000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(loadFn).toHaveBeenCalledTimes(1)
  })

  it('always calls the LATEST loadFn closure without restarting the interval when it changes identity', () => {
    let value = 'first'
    const calls = []
    const { rerender } = renderHook(({ v }) => usePolling(() => calls.push(v), { intervalMs: 1000 }), {
      initialProps: { v: value },
    })
    expect(calls).toEqual(['first'])

    value = 'second'
    rerender({ v: value })
    // Merely passing a new closure must not itself trigger an extra call or reset the timer.
    expect(calls).toEqual(['first'])

    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['first', 'second'])
  })
})

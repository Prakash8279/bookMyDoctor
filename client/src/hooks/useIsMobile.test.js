import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useIsMobile } from './useIsMobile'

// Builds a fake MediaQueryList honoring the SAME (max-width: 767px) query the hook itself uses,
// with a `change()` helper the test calls to simulate the viewport crossing the breakpoint —
// mirroring how a real browser fires the 'change' event on resize.
function installMatchMedia(initiallyMobile) {
  let matches = initiallyMobile
  let listener = null
  const mql = {
    get matches() { return matches },
    media: '(max-width: 767px)',
    addEventListener: (event, cb) => { if (event === 'change') listener = cb },
    removeEventListener: (event, cb) => { if (event === 'change' && listener === cb) listener = null },
  }
  window.matchMedia = vi.fn().mockReturnValue(mql)
  return {
    change(nextMatches) {
      matches = nextMatches
      listener?.()
    },
  }
}

describe('useIsMobile', () => {
  afterEach(() => {
    delete window.matchMedia
  })

  // The behavior this whole feature depends on: jsdom (this project's test environment) has NO
  // window.matchMedia at all — confirmed directly, it's `undefined`, not a stub that always
  // returns false. Every existing test in the app renders through this exact "no matchMedia"
  // path, so it must resolve to desktop (isMobile === false), never throw.
  it('resolves to false (desktop) when window.matchMedia does not exist, matching this project\'s jsdom test environment', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('resolves to true when the (max-width: 767px) query already matches on mount', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('resolves to false when the query does not match on mount', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates live when the viewport crosses the breakpoint (a "change" event fires)', () => {
    const mq = installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => { mq.change(true) })
    expect(result.current).toBe(true)

    act(() => { mq.change(false) })
    expect(result.current).toBe(false)
  })

  it('unsubscribes its change listener on unmount', () => {
    const mq = installMatchMedia(false)
    const { unmount } = renderHook(() => useIsMobile())
    unmount()
    // No listener left to call — this would throw if removeEventListener wasn't wired correctly
    // and some stale internal state tried to update after unmount.
    expect(() => mq.change(true)).not.toThrow()
  })
})

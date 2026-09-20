import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useListLoad, resetAllListLoadCachesForTests } from './useListLoad'

describe('useListLoad', () => {
  afterEach(() => {
    resetAllListLoadCachesForTests()
  })

  it('fetches on mount and reports loading:false once it resolves', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useListLoad('key-1', fetchFn))

    expect(result.current.loading).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('')
  })

  it('surfaces the error message and clears loading when the fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useListLoad('key-err', fetchFn))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
  })

  // The core LOAD-REVIEW FIX behavior: a remount within the TTL window must not refetch.
  it('skips the fetch on a second mount with the same cacheKey within the TTL window', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const first = renderHook(() => useListLoad('key-2', fetchFn, { ttlMs: 30000 }))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(fetchFn).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(() => useListLoad('key-2', fetchFn, { ttlMs: 30000 }))
    // Fresh within the TTL — no second network call, and it never even shows a loading state.
    expect(second.result.current.loading).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refetches on a second mount once the TTL has expired', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const first = renderHook(() => useListLoad('key-3', fetchFn, { ttlMs: 10 }))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    first.unmount()

    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = renderHook(() => useListLoad('key-3', fetchFn, { ttlMs: 10 }))
    expect(second.result.current.loading).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a different cacheKey is never gated by another key\'s freshness', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const first = renderHook(() => useListLoad('key-4a', fetchFn, { ttlMs: 30000 }))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    const second = renderHook(() => useListLoad('key-4b', fetchFn, { ttlMs: 30000 }))
    expect(second.result.current.loading).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  // refresh() is the "↻ Refresh" button's handler — it must always hit the network, TTL or not.
  it('refresh() always bypasses the cache, even immediately after a fresh fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useListLoad('key-5', fetchFn, { ttlMs: 30000 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await result.current.refresh()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('refresh() forwards its arguments through to fetchFn (e.g. a search filter)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useListLoad('key-6', fetchFn))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.refresh({ search: 'asha' })
    expect(fetchFn).toHaveBeenLastCalledWith({ search: 'asha' })
  })
})

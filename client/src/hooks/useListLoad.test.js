import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, renderHook, waitFor } from '@testing-library/react'
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

  // REGRESSION TEST for the "admin app me clinic doctor patient show nahi ho raha hai" bug:
  // ManageDoctors/ManageClinics/ManagePatients (AdminPages.jsx, cacheKeys 'admin:doctors'/
  // 'admin:clinics'/'admin:patients') all got stuck showing the loading skeleton and a
  // permanently-disabled "Refreshing…" button, even though the data had actually already
  // arrived in the store. Root cause: React 18 StrictMode (main.jsx wraps <App/> in it) mounts
  // every component twice in dev — mount, run the []-effect's cleanup as if unmounting, mount
  // again — specifically to catch bugs where a ref set on "unmount" never gets reset.
  // cancelledRef.current got set true by that phantom cleanup, and nothing reset it afterwards,
  // so by the time the genuinely-mounted second run()'s fetch resolved, its .finally() found
  // cancelledRef.current already true and silently skipped setLoading(false) forever.
  //
  // A same-tick-resolved mock (mockResolvedValue) doesn't reproduce this: its .then() callback
  // fires as a microtask that can interleave with StrictMode's synchronous double-invoke and
  // populate the TTL cache before the second effect run, so the second run short-circuits via
  // isFresh() before ever reaching the buggy cancelledRef path — masking the bug entirely. A
  // real network call never resolves that fast, so this uses a setTimeout-delayed fetch (like
  // usePolling.js's real-timer tests) to force the same ordering a real browser hits.
  it('clears loading after a StrictMode phantom mount/unmount/remount cycle, with a realistically-delayed fetch', async () => {
    resetAllListLoadCachesForTests()
    const fetchFn = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 20)))
    let latest = null
    function Probe() {
      const state = useListLoad('strict-key', fetchFn)
      latest = state
      return null
    }

    render(React.createElement(React.StrictMode, null, React.createElement(Probe)))

    await waitFor(() => expect(latest.loading).toBe(false), { timeout: 2000 })
    expect(latest.error).toBe('')
  })
})

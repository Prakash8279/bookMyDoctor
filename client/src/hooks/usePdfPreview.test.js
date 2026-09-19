import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePdfPreview } from './usePdfPreview'

function makePdfBlob() {
  return new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' })
}

describe('usePdfPreview', () => {
  let createObjectURLSpy
  let revokeObjectURLSpy
  let urlCounter

  beforeEach(() => {
    urlCounter = 0
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${++urlCounter}`)
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
  })

  it('starts with no preview and not loading', () => {
    const { result } = renderHook(() => usePdfPreview())
    expect(result.current.preview).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('open() builds the PDF, turns it into an object URL, and exposes it as the preview', async () => {
    const build = vi.fn().mockResolvedValue({ blob: makePdfBlob(), filename: 'booking-slip-#abcd.pdf' })
    const { result } = renderHook(() => usePdfPreview())

    await act(async () => {
      await result.current.open(build)
    })

    expect(build).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(result.current.preview).toEqual({ url: 'blob:mock-1', filename: 'booking-slip-#abcd.pdf' })
    expect(result.current.loading).toBe(false)
  })

  it('sets loading true while the build is in flight, then false once it resolves', async () => {
    let resolveBuild
    const build = vi.fn(() => new Promise((resolve) => { resolveBuild = resolve }))
    const { result } = renderHook(() => usePdfPreview())

    let openPromise
    act(() => {
      openPromise = result.current.open(build)
    })
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveBuild({ blob: makePdfBlob(), filename: 'receipt-1.pdf' })
      await openPromise
    })
    expect(result.current.loading).toBe(false)
  })

  it('close() revokes the object URL and clears the preview', async () => {
    const build = vi.fn().mockResolvedValue({ blob: makePdfBlob(), filename: 'receipt-1.pdf' })
    const { result } = renderHook(() => usePdfPreview())

    await act(async () => {
      await result.current.open(build)
    })
    act(() => {
      result.current.close()
    })

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-1')
    expect(result.current.preview).toBeNull()
  })

  it('opening a second PDF revokes the first preview\'s URL before replacing it — no leaked object URLs from repeated clicks', async () => {
    const { result } = renderHook(() => usePdfPreview())

    await act(async () => {
      await result.current.open(vi.fn().mockResolvedValue({ blob: makePdfBlob(), filename: 'first.pdf' }))
    })
    await act(async () => {
      await result.current.open(vi.fn().mockResolvedValue({ blob: makePdfBlob(), filename: 'second.pdf' }))
    })

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-1')
    expect(result.current.preview).toEqual({ url: 'blob:mock-2', filename: 'second.pdf' })
  })

  it('leaves the preview closed (and stops loading) when the build rejects, rather than opening a broken preview', async () => {
    const build = vi.fn().mockRejectedValue(new Error('logo rasterization failed'))
    const { result } = renderHook(() => usePdfPreview())

    await act(async () => {
      await result.current.open(build)
    })

    expect(result.current.preview).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(createObjectURLSpy).not.toHaveBeenCalled()
  })
})

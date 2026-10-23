import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePdfPreview } from './usePdfPreview'

afterEach(() => vi.restoreAllMocks())
const pdf = () => ({ blob: new Blob(['%PDF-test'], { type: 'application/pdf' }), filename: 'booking.pdf', document: { title: 'BookADoctors' } })

describe('usePdfPreview', () => {
  it('keeps the same PDF URL for viewing and downloading and releases it on close', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:slip')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { result } = renderHook(usePdfPreview)
    await act(async () => result.current.open(async () => pdf()))
    expect(result.current.preview).toMatchObject({ url: 'blob:slip', filename: 'booking.pdf', document: { title: 'BookADoctors' } })
    act(() => result.current.close())
    expect(result.current.preview).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:slip')
  })

  it('shows a retryable error instead of silently doing nothing', async () => {
    const { result } = renderHook(usePdfPreview)
    await act(async () => result.current.open(async () => { throw new Error('Failed') }))
    expect(result.current.error).toMatch(/Please try again/)
    expect(result.current.loading).toBe(false)
    expect(result.current.preview).toBeNull()
    await act(async () => result.current.open(async () => pdf()))
    expect(result.current.error).toBe('')
    expect(result.current.preview).not.toBeNull()
  })

  it('does not reopen a closed preview after delayed generation completes', async () => {
    let finish
    const { result } = renderHook(usePdfPreview)
    act(() => { result.current.open(() => new Promise((resolve) => { finish = resolve })) })
    act(() => result.current.close())
    await act(async () => finish(pdf()))
    expect(result.current.preview).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('does not create a URL after unmount and releases an existing preview on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { result, unmount } = renderHook(usePdfPreview)
    await act(async () => result.current.open(async () => pdf()))
    const url = result.current.preview.url
    unmount()
    expect(revoke).toHaveBeenCalledWith(url)
    const second = renderHook(usePdfPreview)
    let finish
    const create = vi.spyOn(URL, 'createObjectURL')
    act(() => { second.result.current.open(() => new Promise((resolve) => { finish = resolve })) })
    second.unmount()
    await act(async () => finish(pdf()))
    await waitFor(() => expect(create).not.toHaveBeenCalled())
  })
})

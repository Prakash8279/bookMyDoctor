import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDeleteWithConfirm } from './useDeleteWithConfirm'

describe('useDeleteWithConfirm', () => {
  let confirmSpy

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm')
  })

  afterEach(() => {
    confirmSpy.mockRestore()
  })

  it('starts with nothing mid-delete', () => {
    const { result } = renderHook(() =>
      useDeleteWithConfirm({ deleteFn: vi.fn(), confirmMessage: () => 'Sure?', setError: vi.fn() })
    )
    expect(result.current.deletingId).toBeNull()
  })

  it('does nothing when the user cancels the confirm dialog', async () => {
    confirmSpy.mockReturnValue(false)
    const deleteFn = vi.fn()
    const setError = vi.fn()
    const { result } = renderHook(() =>
      useDeleteWithConfirm({ deleteFn, confirmMessage: (item) => `Delete ${item.name}?`, setError })
    )

    await act(async () => {
      await result.current.remove({ id: '1', name: 'Rex' })
    })

    expect(confirmSpy).toHaveBeenCalledWith('Delete Rex?')
    expect(deleteFn).not.toHaveBeenCalled()
    expect(setError).not.toHaveBeenCalled()
    expect(result.current.deletingId).toBeNull()
  })

  it('confirms, clears any prior error, sets a busy state, and calls deleteFn', async () => {
    confirmSpy.mockReturnValue(true)
    let resolveDelete
    const deleteFn = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve
        })
    )
    const setError = vi.fn()
    const { result } = renderHook(() => useDeleteWithConfirm({ deleteFn, confirmMessage: () => 'Sure?', setError }))

    let removePromise
    act(() => {
      removePromise = result.current.remove({ id: 'abc' })
    })

    // The busy state and error-clear happen synchronously, before deleteFn's promise settles.
    expect(result.current.deletingId).toBe('abc')
    expect(setError).toHaveBeenCalledWith('')
    expect(deleteFn).toHaveBeenCalledWith({ id: 'abc' })

    await act(async () => {
      resolveDelete()
      await removePromise
    })

    expect(result.current.deletingId).toBeNull()
  })

  it('surfaces the thrown error message and still clears the busy state', async () => {
    confirmSpy.mockReturnValue(true)
    const deleteFn = vi.fn().mockRejectedValue(new Error('Server exploded'))
    const setError = vi.fn()
    const { result } = renderHook(() => useDeleteWithConfirm({ deleteFn, confirmMessage: () => 'Sure?', setError }))

    await act(async () => {
      await result.current.remove({ id: 'x' })
    })

    expect(setError).toHaveBeenCalledWith('Server exploded')
    expect(result.current.deletingId).toBeNull()
  })

  it('falls back to the default error message when the thrown error has none', async () => {
    confirmSpy.mockReturnValue(true)
    const deleteFn = vi.fn().mockRejectedValue(new Error())
    const setError = vi.fn()
    const { result } = renderHook(() => useDeleteWithConfirm({ deleteFn, confirmMessage: () => 'Sure?', setError }))

    await act(async () => {
      await result.current.remove({ id: 'y' })
    })

    expect(setError).toHaveBeenCalledWith('Could not delete this item.')
  })

  it('uses a caller-supplied errorFallback message instead of the default', async () => {
    confirmSpy.mockReturnValue(true)
    const deleteFn = vi.fn().mockRejectedValue(new Error())
    const setError = vi.fn()
    const { result } = renderHook(() =>
      useDeleteWithConfirm({
        deleteFn,
        confirmMessage: () => 'Sure?',
        setError,
        errorFallback: 'Custom fallback message.',
      })
    )

    await act(async () => {
      await result.current.remove({ id: 'z' })
    })

    expect(setError).toHaveBeenCalledWith('Custom fallback message.')
  })

  it('builds the confirm message from the item passed to remove', async () => {
    confirmSpy.mockReturnValue(false)
    const confirmMessage = vi.fn((item) => `Remove ${item.name}?`)
    const { result } = renderHook(() =>
      useDeleteWithConfirm({ deleteFn: vi.fn(), confirmMessage, setError: vi.fn() })
    )

    await act(async () => {
      await result.current.remove({ id: '9', name: 'Downtown Clinic' })
    })

    expect(confirmMessage).toHaveBeenCalledWith({ id: '9', name: 'Downtown Clinic' })
    expect(confirmSpy).toHaveBeenCalledWith('Remove Downtown Clinic?')
  })
})

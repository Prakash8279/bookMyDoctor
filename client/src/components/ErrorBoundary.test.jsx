import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb() {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders a fallback UI instead of crashing when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Reloading usually fixes it/)).toBeInTheDocument()
    expect(screen.queryByText('All good')).not.toBeInTheDocument()
  })

  it('logs the caught error and component stack', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ErrorBoundary] Unhandled error in the component tree:',
      expect.any(Error),
      expect.any(String)
    )
  })

  it('reloads the page when the Reload button is clicked', () => {
    const originalLocation = window.location
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    })
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })
})

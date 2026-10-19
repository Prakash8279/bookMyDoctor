import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { PaymentConfirmation } from './PaymentConfirmation'

afterEach(() => vi.useRealTimers())

it('shows payment confirmation first and automatically opens the token after two seconds', async () => {
  vi.useFakeTimers()
  render(<MemoryRouter><PaymentConfirmation appointment={{ tokenNumber: 1, paymentStatus: 'partial', doctor: { name: 'Dr Test' }, appointmentDate: '2026-10-20' }} /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
  expect(screen.queryByText('Token #1')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(screen.getByRole('heading', { name: 'Your appointment token' })).toBeInTheDocument()
  expect(screen.getByText('Token #1')).toBeInTheDocument()
})

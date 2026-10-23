import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndiaDateRangeFilter } from './IndiaDateRangeFilter'

describe('IndiaDateRangeFilter', () => {
  it('provides Today, custom range and All dates controls', () => {
    const onChange = vi.fn()
    const { rerender } = render(<IndiaDateRangeFilter label="Payment" from="2026-10-22" to="2026-10-22" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Payment start date'), { target: { value: '2026-10-20' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-20', to: '2026-10-22' })

    fireEvent.click(screen.getByRole('button', { name: 'All dates' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '', to: '' })

    rerender(<IndiaDateRangeFilter label="Payment" from="2026-10-22" to="" onChange={onChange} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Select both From and To dates')
  })
})

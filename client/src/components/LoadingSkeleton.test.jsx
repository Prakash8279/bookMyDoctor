import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSkeleton } from './LoadingSkeleton'

describe('LoadingSkeleton', () => {
  it('renders 3 placeholder rows by default', () => {
    const { container } = render(<LoadingSkeleton />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('renders the requested number of rows', () => {
    const { container } = render(<LoadingSkeleton rows={5} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5)
  })

  it('renders no rows when rows is 0', () => {
    const { container } = render(<LoadingSkeleton rows={0} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
  })
})

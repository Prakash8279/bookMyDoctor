import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('renders label, value and the default icon', () => {
    render(<StatCard label="Appointments" value={42} />)
    expect(screen.getByText('Appointments')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('•')).toBeInTheDocument()
  })

  it('renders an optional detail line', () => {
    render(<StatCard label="Revenue" value="₹1,000" detail="+12% this week" />)
    expect(screen.getByText('+12% this week')).toBeInTheDocument()
  })

  it('omits the detail line when not provided', () => {
    render(<StatCard label="Revenue" value="₹1,000" />)
    expect(screen.queryByText('+12% this week')).not.toBeInTheDocument()
  })

  it('renders as a plain article when no `to` is given', () => {
    const { container } = render(<StatCard label="Patients" value={5} />)
    expect(container.querySelector('article')).toBeInTheDocument()
    expect(container.querySelector('a')).not.toBeInTheDocument()
  })

  it('renders as a router Link when `to` is given', () => {
    render(
      <MemoryRouter>
        <StatCard label="Patients" value={5} to="/admin/patients" />
      </MemoryRouter>
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/patients')
    expect(link).toHaveTextContent('Patients')
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormField } from './FormField'

describe('FormField', () => {
  it('renders a text input by default', () => {
    render(<FormField label="Name" />)
    const input = screen.getByLabelText('Name')
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('shows a required asterisk and marks the field required when `required` is set', () => {
    render(<FormField label="Email" required />)
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toBeRequired()
  })

  it('does not mark the field required by default', () => {
    render(<FormField label="Email" />)
    expect(screen.getByLabelText('Email')).not.toBeRequired()
  })

  it('renders a select with a placeholder option and the given options', () => {
    render(<FormField label="City" type="select" options={['Pune', 'Mumbai']} onChange={() => {}} />)
    const select = screen.getByLabelText('City')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'Select City' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Pune' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument()
  })

  it('renders a textarea', () => {
    render(<FormField label="Notes" type="textarea" placeholder="Add notes" />)
    const textarea = screen.getByPlaceholderText('Add notes')
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('passes through extra input props such as value and onChange', () => {
    render(<FormField label="Age" type="number" value={30} onChange={() => {}} />)
    const input = screen.getByLabelText('Age')
    expect(input).toHaveValue(30)
    expect(input).toHaveAttribute('type', 'number')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'

describe('FormField mobile sizing', () => {
  it('keeps text controls shrinkable inside narrow grid cards', () => {
    const { container } = render(<FormField label="Full name" name="name" />)

    expect(container.querySelector('label')).toHaveClass('min-w-0', 'max-w-full')
    expect(screen.getByLabelText('Full name')).toHaveClass('min-w-0', 'w-full', 'max-w-full')
  })

  it('applies the same width safety to textareas', () => {
    render(<FormField label="Professional biography" name="bio" type="textarea" />)

    expect(screen.getByLabelText('Professional biography')).toHaveClass('min-w-0', 'w-full', 'max-w-full')
  })
})

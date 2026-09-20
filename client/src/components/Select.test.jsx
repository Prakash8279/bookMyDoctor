import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Select } from './Select'

// CUSTOM DROPDOWN FIX (user report, twice: "dropdown karne par screen se bahar tak ja raha hai",
// then "ye mobile view se bahar ja raha hai har dropbox me har jagah ka fix karo") — see
// Select.jsx's header comment for the full rationale. These tests lock in the two contracts that
// matter most: (1) every existing call site's behavior (controlled/uncontrolled value, FormData
// submission, `fireEvent.change(getByLabelText(...))`) keeps working exactly as before, and (2)
// the dropdown this component draws itself can never be wider than its own field.
//
// The real (sr-only) <select> stays in the DOM alongside the visible custom button/list, so tests
// scope option/button queries with `within(...)` to the piece they mean, rather than a bare
// `screen.getByRole(...)` that could also match the hidden native control.
describe('Select', () => {
  const OPTIONS = ['Cash', 'Upi', 'Card']
  const trigger = () => screen.getAllByRole('button').find((button) => button.getAttribute('aria-haspopup') === 'listbox')

  it('shows a placeholder when nothing is selected, and opens/closes a custom dropdown (not a native popup)', () => {
    render(<Select options={OPTIONS} value="" onChange={() => {}} />)

    expect(within(trigger()).getByText('Select')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(trigger())
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByText('Cash')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('the drawn dropdown is always exactly as wide as its own field (left-0 right-0), never wider', () => {
    render(<Select options={OPTIONS} value="" onChange={() => {}} />)
    fireEvent.click(trigger())
    const listbox = screen.getByRole('listbox')
    expect(listbox.className).toMatch(/\babsolute\b/)
    expect(listbox.className).toMatch(/\bleft-0\b/)
    expect(listbox.className).toMatch(/\bright-0\b/)
  })

  // NOTE: a bare vi.fn() onChange, on a truly CONTROLLED field, gets its DOM value reset right
  // back to the (unchanged) `value` prop the instant React re-renders — same as a plain native
  // controlled <select> would. Real call sites always feed the picked value into state via
  // onChange, so these tests capture `event.target.value` SYNCHRONOUSLY inside the handler
  // (mirroring what every real onChange={(event) => setX(event.target.value)} call site does)
  // rather than reading it back from the mock's recorded call afterwards.
  it('controlled mode: clicking an option calls onChange with the real value, same as a native <select>', () => {
    let picked
    const onChange = vi.fn((event) => { picked = event.target.value })
    render(<Select options={OPTIONS} value="" onChange={onChange} />)

    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Upi'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(picked).toBe('Upi')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports {value, label} option objects (e.g. a database id vs. its display name)', () => {
    const CITIES = [{ value: 'city-1', label: 'Chhapra' }, { value: 'city-2', label: 'Mumbai' }]
    let picked
    const onChange = vi.fn((event) => { picked = event.target.value })
    render(<Select options={CITIES} value="city-2" onChange={onChange} />)

    // The trigger shows the LABEL, not the raw id.
    expect(screen.getByRole('button')).toHaveTextContent('Mumbai')

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Chhapra'))
    expect(picked).toBe('city-1')
  })

  // BACKWARD-COMPATIBILITY REGRESSION GUARD: every existing test across the app interacts with
  // FormField's select fields via `fireEvent.change(screen.getByLabelText(...), {target:...})`
  // and/or `getByRole('combobox')` — this must keep working unchanged, since the visible custom
  // button/list are an ADDITIONAL layer, not a replacement, for the real <select> underneath.
  it('keeps the real <select> in the DOM, reachable by label text and fireEvent.change, exactly like before', () => {
    let picked
    const onChange = vi.fn((event) => { picked = event.target.value })
    render(<label htmlFor="method-select">Payment method<Select id="method-select" options={OPTIONS} value="" onChange={onChange} /></label>)

    const select = screen.getByLabelText('Payment method')
    expect(select.tagName).toBe('SELECT')
    fireEvent.change(select, { target: { value: 'Card' } })
    expect(onChange).toHaveBeenCalled()
    expect(picked).toBe('Card')
  })

  it('uncontrolled mode: a defaultValue prefills the field, and its value round-trips through FormData on submit', () => {
    const onSubmit = vi.fn((event) => {
      event.preventDefault()
      const data = Object.fromEntries(new FormData(event.currentTarget).entries())
      onSubmit.captured = data
    })
    render(<form onSubmit={onSubmit}>
      <Select name="method" options={OPTIONS} defaultValue="Upi" />
      <button type="submit">Save</button>
    </form>)

    // Prefilled from defaultValue, same as a native <select defaultValue="Upi">.
    expect(within(trigger()).getByText('Upi')).toBeInTheDocument()

    // Picking a different option via the custom dropdown updates what FormData reads back.
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Card'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit.captured).toEqual({ method: 'Card' })
  })

  it('includeBlank={false} omits the "Select…" placeholder option (e.g. a filter whose own first option means "no filter")', () => {
    const onChange = vi.fn()
    render(<Select includeBlank={false} value="all" onChange={onChange} options={[{ value: 'all', label: 'All doctors' }, { value: 'd1', label: 'Dr. Rao' }]} />)

    expect(screen.getByRole('button')).toHaveTextContent('All doctors')
    fireEvent.click(screen.getByRole('button'))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByText(/^Select/)).not.toBeInTheDocument()
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
  })

  it('closes when clicking outside the field', () => {
    render(<div><Select options={OPTIONS} value="" onChange={() => {}} /><button type="button">Elsewhere</button></div>)
    fireEvent.click(trigger())
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a disabled field does not open the dropdown', () => {
    render(<Select options={OPTIONS} value="" onChange={() => {}} disabled />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

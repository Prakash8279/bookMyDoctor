import { useEffect, useId, useRef, useState } from 'react'

// CUSTOM DROPDOWN FIX (user report, twice: "dropdown karne par screen se bahar tak ja raha hai",
// then "ye mobile view se bahar ja raha hai har dropbox me har jagah ka fix karo") — a native
// <select>'s OPEN option list is drawn by the phone/browser/OS itself, not by this app's CSS, so
// it can (and, per the user's screenshots, does) render wider than — and outside — the app's own
// layout, especially in a narrow/mobile viewport. There is no CSS that can constrain a native
// popup's size or position, so the only real fix is to stop relying on it.
//
// This component keeps a REAL, fully-functional <select> in the DOM (so every existing behavior
// that depends on it — plain HTML form submission via `new FormData(form)`, and every existing
// test's `fireEvent.change(screen.getByLabelText(...), ...)` / `getByRole('combobox')` — keeps
// working exactly as before, with zero test changes needed) but makes it invisible (Tailwind's
// `sr-only`, not `display:none` — screen readers and keyboard users can still reach it) and draws
// its own dropdown instead: a plain absolutely-positioned list that is always exactly as wide as
// the field itself (`absolute left-0 right-0` inside a `relative` wrapper), so it can never be
// wider than — or escape — the very card/column that already fits the screen.
//
// `options` accepts either a flat array of strings (value === label — the shape FormField has
// always used, e.g. ['Cash', 'Upi', 'Card', 'Online']) or an array of {value, label} objects (the
// shape the app's hand-rolled <select>s used whenever the value needed to differ from the display
// text, e.g. a database id vs. a city's name).
//
// Supports the SAME two usage patterns the plain native <select> did across this app: a
// React-controlled field (`value` + `onChange`, e.g. Booking's Doctor picker) and an uncontrolled
// one (`defaultValue` only, read back later via `new FormData(form)`, e.g. every "Record
// payment"/profile-edit form) — `value === undefined` is how a caller signals "uncontrolled",
// exactly like a plain <select> would. `includeBlank` (default true) adds the "Select X" empty
// option every field used to start on; pass `includeBlank={false}` for a filter whose own first
// option already stands in for "no filter" (e.g. Revenue reports' "All doctors").
function normalizeOptions(options) {
  return options.map((option) => (typeof option === 'object' && option !== null ? option : { value: option, label: option }))
}

export function Select({ label, options = [], required = false, name, id, placeholder, disabled = false, className = '', value, defaultValue, onChange, includeBlank = true, ...rest }) {
  const normalized = normalizeOptions(options)
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState(defaultValue ?? '')
  const currentValue = isControlled ? value : internalValue
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const selectRef = useRef(null)
  const reactId = useId()
  const selectId = id || reactId
  const selected = normalized.find((option) => String(option.value) === String(currentValue))
  const placeholderText = placeholder || `Select ${label || ''}`.trim()

  useEffect(() => {
    if (!open) return undefined
    const onDocPointerDown = (event) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false) }
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Sets the real <select>'s value the same way a genuine user pick would, then dispatches a real
  // 'change' event on it — React's event delegation picks this up exactly like a native change, so
  // a caller's `onChange` fires with a normal `event.target.value`, no different from before.
  const commit = (nextValue) => {
    const node = selectRef.current
    if (node) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeSetter.call(node, nextValue)
      node.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!isControlled) setInternalValue(nextValue)
    setOpen(false)
  }

  return <div className={`relative ${className}`} ref={wrapperRef}>
    {isControlled
      ? <select ref={selectRef} id={selectId} name={name} required={required} disabled={disabled} value={value} onChange={onChange} className="sr-only" {...rest}>
          {includeBlank && <option value="">{placeholderText}</option>}
          {normalized.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      : <select ref={selectRef} id={selectId} name={name} required={required} disabled={disabled} defaultValue={defaultValue} onChange={onChange} className="sr-only" {...rest}>
          {includeBlank && <option value="">{placeholderText}</option>}
          {normalized.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-button border border-border bg-white px-3 text-left text-sm outline-none focus:border-primary-dark disabled:opacity-60" onClick={() => !disabled && setOpen((wasOpen) => !wasOpen)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={rest['aria-label']}>
      <span className={`truncate ${selected ? 'text-ink' : 'text-muted'}`}>{selected ? selected.label : placeholderText}</span>
      <span aria-hidden="true" className="shrink-0 text-muted">▾</span>
    </button>
    {open && <ul role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-button border border-border bg-white text-sm shadow-card">
      {includeBlank && <li role="option" aria-selected={!currentValue} className={`cursor-pointer px-3 py-2.5 hover:bg-primary-light/40 ${!currentValue ? 'bg-primary-light/60 font-semibold' : ''}`} onClick={() => commit('')}>{placeholderText}</li>}
      {normalized.map((option) => <li key={option.value} role="option" aria-selected={String(option.value) === String(currentValue)} className={`cursor-pointer px-3 py-2.5 hover:bg-primary-light/40 ${String(option.value) === String(currentValue) ? 'bg-primary-light/60 font-semibold' : ''}`} onClick={() => commit(option.value)}>{option.label}</li>)}
    </ul>}
  </div>
}

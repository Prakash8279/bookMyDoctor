import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PdfPreviewModal } from './PdfPreviewModal'

const SAMPLE_PREVIEW = { url: 'blob:mock-1', filename: 'booking-slip-#abcd.pdf' }

describe('PdfPreviewModal', () => {
  it('renders nothing when there is no preview', () => {
    const { container } = render(<PdfPreviewModal preview={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the PDF in an iframe pointed at the preview URL, and a Download link with the suggested filename', () => {
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={() => {}} title="Booking slip preview" />)

    expect(screen.getByRole('dialog', { name: 'Booking slip preview' })).toBeInTheDocument()
    const iframe = screen.getByTitle('Booking slip preview')
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe).toHaveAttribute('src', SAMPLE_PREVIEW.url)

    const downloadLink = screen.getByRole('link', { name: /Download/ })
    expect(downloadLink).toHaveAttribute('href', SAMPLE_PREVIEW.url)
    expect(downloadLink).toHaveAttribute('download', SAMPLE_PREVIEW.filename)
  })

  it('falls back to a generic title when none is given', () => {
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Document preview' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the Escape key is pressed', () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking the overlay backdrop but not the dialog itself', () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={onClose} />)

    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab within the dialog, wrapping from the last focusable element back to the first', () => {
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={() => {}} />)

    const downloadLink = screen.getByRole('link', { name: /Download/ })
    const closeButton = screen.getByRole('button', { name: 'Close preview' })

    closeButton.focus()
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(closeButton, { key: 'Tab' })
    expect(document.activeElement).toBe(downloadLink)
  })

  it('traps Shift+Tab within the dialog, wrapping from the first focusable element back to the last', () => {
    render(<PdfPreviewModal preview={SAMPLE_PREVIEW} onClose={() => {}} />)

    const downloadLink = screen.getByRole('link', { name: /Download/ })
    const closeButton = screen.getByRole('button', { name: 'Close preview' })

    downloadLink.focus()
    expect(document.activeElement).toBe(downloadLink)

    fireEvent.keyDown(downloadLink, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(closeButton)
  })

  it('returns focus to the element that triggered the modal once it closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open preview</button>
          <PdfPreviewModal preview={open ? SAMPLE_PREVIEW : null} onClose={() => setOpen(false)} />
        </div>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open preview' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })
})

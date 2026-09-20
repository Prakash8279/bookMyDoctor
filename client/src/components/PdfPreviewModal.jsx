import { useEffect, useRef } from 'react'

// Shared "view a generated PDF in-page, download from inside that preview" overlay — pairs with
// hooks/usePdfPreview.js. Used by every slip/receipt PDF in the app (booking slip, patient
// receipt, staff receipt — request: "booking slip ke jagah view ka option do view open hone ke
// bad download ka option ho", then "baki jagah v same kar do jaha slip download ho raha hai").
//
// Deliberately its own small overlay rather than reusing components/Modal.jsx: that component is
// fixed at max-w-lg (a form-sized dialog), too narrow to preview a full A4 document — everything
// else (backdrop, Escape-to-close, backdrop-click-to-close, focus on open) mirrors it.

/**
 * @param {{ preview: {url: string, filename: string} | null, onClose: () => void, title?: string }} props
 */
export function PdfPreviewModal({ preview, onClose, title = 'Document preview' }) {
  const downloadRef = useRef(null)
  const dialog = useRef(null)
  const triggerElement = useRef(null)

  useEffect(() => {
    if (!preview) return undefined
    triggerElement.current = document.activeElement
    downloadRef.current?.focus()
    const closeOnEscape = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      triggerElement.current?.focus?.()
    }
  }, [preview, onClose])

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = dialog.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!preview) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section ref={dialog} onKeyDown={trapFocus} role="dialog" aria-modal="true" aria-labelledby="pdf-preview-title" className="flex h-[90vh] w-full max-w-3xl flex-col rounded-card bg-white p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 id="pdf-preview-title" className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            <a ref={downloadRef} href={preview.url} download={preview.filename} className="btn-primary">↓ Download</a>
            <button type="button" className="touch-target text-2xl text-muted" onClick={onClose} aria-label="Close preview">×</button>
          </div>
        </div>
        <iframe src={preview.url} title={title} className="mt-3 flex-1 rounded-button border border-border" />
      </section>
    </div>
  )
}

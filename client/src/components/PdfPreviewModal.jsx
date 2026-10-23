import { useEffect, useRef } from 'react'
import logoUrl from '../assets/brand-logo.png'

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
export function PdfPreviewModal({ preview, error, onClose, title = 'Document preview' }) {
  const downloadRef = useRef(null)
  const dialog = useRef(null)
  const triggerElement = useRef(null)

  useEffect(() => {
    if (!preview) return undefined
    triggerElement.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    downloadRef.current?.focus()
    const closeOnEscape = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
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

  if (!preview) return error ? <p role="alert" className="rounded-button border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null
  const spec = preview.document

  return (
    <div
      className="pdf-preview-backdrop app-modal-backdrop fixed inset-0 z-[100] grid place-items-center bg-charcoal/40 p-4"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section ref={dialog} onKeyDown={trapFocus} role="dialog" aria-modal="true" aria-labelledby="pdf-preview-title" className="pdf-preview-panel flex h-[90dvh] w-full max-w-3xl flex-col rounded-card bg-white p-4 shadow-card">
        <div className="pdf-preview-header flex items-center justify-between gap-3">
          <h2 id="pdf-preview-title" className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{title}</h2>
          <div className="pdf-preview-actions flex shrink-0 items-center gap-2">
            <a ref={downloadRef} href={preview.url} download={preview.filename} className="btn-primary min-w-0">↓ Download PDF</a>
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="rounded-button border border-border px-3 py-2 text-sm font-semibold">Open PDF</a>
            <button type="button" className="touch-target text-2xl text-muted" onClick={onClose} aria-label="Close preview">×</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">If download does not start, use Open PDF and your browser's Save or Share option.</p>
        {spec ? <article aria-label="Document contents" className="receipt-preview mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-button border border-border bg-white p-4 text-charcoal sm:p-6">
          <header className="mb-4 border-b border-border pb-3">
            <div className="flex items-center gap-2"><img src={logoUrl} alt="" className="h-9 w-9 rounded-lg" /><strong className="text-xl text-primary-dark">{spec.title}</strong></div>
            <h3 className="mt-2 font-semibold">{spec.subtitle}</h3>
            {spec.meta?.map((line, index) => <p key={index} className="mt-1 break-words text-xs text-muted [overflow-wrap:anywhere]">{line}</p>)}
          </header>
          {spec.sections?.map((section, index) => <section key={index} className="mb-4 border-b border-border pb-3">
            <h4 className="mb-2 text-sm font-bold text-primary-dark">{section.heading}</h4>
            <dl className="space-y-2 text-sm">{section.rows.map(([label, value], row) => <div key={row} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-3"><dt className="text-muted [overflow-wrap:anywhere]">{label}</dt><dd className="min-w-0 whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">{value == null || value === '' ? '-' : String(value)}</dd></div>)}</dl>
          </section>)}
          <dl className="space-y-2 rounded-button bg-surface p-3 text-sm">{spec.totalRows?.map(([label, value, emphasize], index) => <div key={index} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 ${emphasize ? 'font-bold text-primary-dark' : ''}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <footer className="mt-4 space-y-1 text-xs text-muted">{spec.footer?.map((line, index) => <p key={index}>{line}</p>)}</footer>
        </article> : <iframe src={`${preview.url}#view=FitH`} title={title} className="mt-3 min-h-0 w-full flex-1 rounded-button border border-border" />}
      </section>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'

// Shared "generate a PDF, show it in-page, offer the actual save from inside that preview" flow.
//
// Extracted after applying the same fix twice by hand (PatientAppointments' "View slip" first,
// per request "booking slip ke jagah view ka option do view open hone ke bad download ka option
// ho", then asked to repeat everywhere per "baki jagah v same kar do jaha slip download ho raha
// hai") — rather than copy the object-URL lifecycle a third time into StaffPages.jsx's CashPayment
// receipt button, it's pulled out here so every "view/download a generated PDF" action in the app
// (booking slip, patient receipt, staff receipt, and any future one) shares one implementation.
//
// `build` is an async () => { blob, filename } — see lib/receiptPdf.js's build*PdfBlob functions.
// Pair with components/PdfPreviewModal.jsx, which renders `preview` and calls `close`.

/**
 * @returns {{
 *   preview: {url: string, filename: string} | null,
 *   loading: boolean,
 *   open: (build: () => Promise<{blob: Blob, filename: string}>) => Promise<void>,
 *   close: () => void,
 * }}
 */
export function usePdfPreview() {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(0)
  const url = useRef(null)

  const close = useCallback(() => {
    active.current += 1
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setPreview(null)
    setError('')
    setLoading(false)
  }, [])

  useEffect(() => () => {
    active.current += 1
    if (url.current) URL.revokeObjectURL(url.current)
  }, [])

  const open = async (build) => {
    const request = ++active.current
    setLoading(true)
    setError('')
    try {
      const { blob, filename, document: spec } = await build()
      if (request !== active.current) return
      if (!blob?.size || blob.type !== 'application/pdf') throw new Error('Invalid PDF')
      // Revoke any previous preview's URL before replacing it — otherwise repeated opens (e.g.
      // clicking "View" on two different rows in a row) leak one object URL per click.
      const nextUrl = URL.createObjectURL(blob)
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = nextUrl
      setPreview({ url: nextUrl, filename, document: spec })
    } catch {
      if (request === active.current) setError('Unable to prepare the PDF. Please try again.')
    } finally {
      if (request === active.current) setLoading(false)
    }
  }

  return { preview, loading, error, open, close }
}

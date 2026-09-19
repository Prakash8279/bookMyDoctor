import { useState } from 'react'

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

  const close = () => setPreview((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null })

  const open = async (build) => {
    setLoading(true)
    try {
      const { blob, filename } = await build()
      // Revoke any previous preview's URL before replacing it — otherwise repeated opens (e.g.
      // clicking "View" on two different rows in a row) leak one object URL per click.
      setPreview((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { url: URL.createObjectURL(blob), filename } })
    } catch {
      // PDF generation here is entirely local (no network — see lib/pdf.js/lib/brandLogo.js),
      // so a failure is rare and there's nothing sensible to show inline; leave the preview
      // closed rather than opening one for a broken/empty file.
    } finally {
      setLoading(false)
    }
  }

  return { preview, loading, open, close }
}

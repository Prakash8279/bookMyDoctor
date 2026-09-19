// A minimal, dependency-free PDF writer for simple text/line/image documents (receipts, slips).
//
// WHY NOT A LIBRARY (e.g. jsPDF): this codebase's build/test environment has no network route
// to the npm registry or a CDN to add one, so this module builds valid PDF 1.4 files by hand —
// just the Catalog/Pages/Page/Font/Image objects, text-showing operators, stroked/filled
// rectangles, and raw raster images, using only the PDF standard Helvetica/Helvetica-Bold fonts
// (built into every PDF reader, no font embedding needed). This is enough for a clean
// one-or-two-page receipt with a logo in the header.
//
// IMPORTANT — encoding: the standard Helvetica font's WinAnsiEncoding does NOT include the
// Rupee sign (₹) or other characters outside Latin-1. `sanitizeForPdf` below replaces anything
// outside the printable Latin-1 range with '?' so the document never renders a missing-glyph box
// or (worse) corrupts byte offsets — every character in the final document is guaranteed to be
// exactly one byte. Callers should format money with `formatMoneyPlain` (lib/format.js, "Rs. "
// prefix) rather than `formatMoney` ("₹") when the text is going into a PDF built by this module.

const PAGE_WIDTH = 595.28 // A4 at 72dpi
const PAGE_HEIGHT = 841.89

function sanitizeForPdf(value) {
  return String(value ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

function escapePdfString(value) {
  return sanitizeForPdf(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Converts a "#rrggbb" (or "rrggbb") hex color into the [r, g, b] 0..1 triples the `rg`/`RG`
 * PDF color operators expect.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb01(hex) {
  const clean = String(hex).replace('#', '')
  return [parseInt(clean.slice(0, 2), 16) / 255, parseInt(clean.slice(2, 4), 16) / 255, parseInt(clean.slice(4, 6), 16) / 255]
}

function fmtColor([r, g, b]) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`
}

// Converts raw image bytes to a "binary string" (one JS char per byte, code points 0-255) so it
// can be spliced into the same plain-string PDF buffer as every other object — see toBytes()'s
// final byte-conversion step, which relies on every character in that buffer being single-byte.
// A loop (not String.fromCharCode(...bytes)) avoids blowing the call stack on a large image.
function bytesToBinaryString(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * Creates a new in-memory PDF document builder. Coordinates passed to text()/line()/rect()/
 * image() are "screen-like" — (0, 0) top-left, y grows downward — converted internally to PDF's
 * own bottom-left-origin space, so callers can lay things out top-to-bottom without thinking
 * about it.
 * @param {{pageWidth?: number, pageHeight?: number}} [options]
 */
export function createPdfDoc({ pageWidth = PAGE_WIDTH, pageHeight = PAGE_HEIGHT } = {}) {
  const pages = []
  let currentOps = []
  const images = [] // { rgbBytes, pixelWidth, pixelHeight } — one entry per DISTINCT image
  const imageRefs = new Map() // rgbBytes (by identity) -> index into `images`, so drawing the
  // same logo on every page's header embeds it once, not once per page

  function toPdfY(y) {
    return (pageHeight - y).toFixed(2)
  }

  const doc = {
    pageWidth,
    pageHeight,

    addPage() {
      pages.push(currentOps)
      currentOps = []
    },

    /**
     * @param {number} x
     * @param {number} y - top of the text baseline area (screen-space, grows downward)
     * @param {string} value
     * @param {{size?: number, bold?: boolean, color?: [number, number, number]}} [opts] - color
     *   is an [r,g,b] 0..1 triple (see hexToRgb01); omit for black.
     */
    text(x, y, value, { size = 10, bold = false, color } = {}) {
      const font = bold ? '/FB' : '/FR'
      if (color) currentOps.push(`${fmtColor(color)} rg`)
      currentOps.push(`BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(y)} Tm (${escapePdfString(value)}) Tj ET`)
      if (color) currentOps.push('0 g') // reset fill color to black for anything drawn after
    },

    /** A single stroked line from (x1,y1) to (x2,y2), screen-space coordinates. `color` (an
     * [r,g,b] 0..1 triple) overrides `gray` when given. */
    line(x1, y1, x2, y2, { width = 0.75, gray = 0.7, color } = {}) {
      currentOps.push(`${color ? `${fmtColor(color)} RG` : `${gray} G`} ${width} w ${x1.toFixed(2)} ${toPdfY(y1)} m ${x2.toFixed(2)} ${toPdfY(y2)} l S`)
      currentOps.push('0 G') // reset stroke color to black for anything drawn after
    },

    /** A stroked (and optionally filled) rectangle, screen-space top-left + width/height.
     * `fillColor`/`strokeColor` ([r,g,b] 0..1 triples) override `fillGray`/plain-gray stroke when
     * given, for a brand-tinted box (e.g. the receipt totals panel). */
    rect(x, y, w, h, { stroke = true, fill = false, fillGray = 0.95, fillColor, strokeColor, strokeWidth = 0.75 } = {}) {
      const rectOp = `${x.toFixed(2)} ${(pageHeight - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`
      if (fill) {
        currentOps.push(`${fillColor ? `${fmtColor(fillColor)} rg` : `${fillGray} g`} ${rectOp} f`)
        currentOps.push('0 g')
      }
      if (stroke) {
        currentOps.push(`${strokeColor ? `${fmtColor(strokeColor)} RG` : '0.7 G'} ${strokeWidth} w ${rectOp} S`)
        currentOps.push('0 G')
      }
    },

    /**
     * Draws a raw RGB raster image (e.g. the app's brand-mark logo — see lib/brandLogo.js) into
     * the given screen-space box, stretching it to fit. `rgbBytes` must be exactly
     * pixelWidth*pixelHeight*3 bytes (8-bit DeviceRGB, no alpha, row-major, no padding) — see
     * lib/brandLogo.js#flattenRgbaOnWhite for how that's produced from a canvas ImageData.
     * Drawing the SAME rgbBytes array more than once (by reference) embeds it only once in the
     * file and reuses it, so calling this per-page for a repeated header logo stays cheap.
     * @param {number} x
     * @param {number} y - top-left, screen-space
     * @param {number} w
     * @param {number} h
     * @param {{rgbBytes: Uint8Array, pixelWidth: number, pixelHeight: number}} image
     */
    image(x, y, w, h, { rgbBytes, pixelWidth, pixelHeight } = {}) {
      if (!rgbBytes || !pixelWidth || !pixelHeight) return
      let ref = imageRefs.get(rgbBytes)
      if (ref === undefined) {
        ref = images.length
        images.push({ rgbBytes, pixelWidth, pixelHeight })
        imageRefs.set(rgbBytes, ref)
      }
      // The image XObject paints into the PDF unit square [0,1]x[0,1] — `cm` scales/translates
      // that square to the target box before `Do` paints it, same idea as an SVG viewBox.
      currentOps.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(pageHeight - y - h).toFixed(2)} cm /Im${ref} Do Q`)
    },

    /** Serializes everything drawn so far into PDF bytes (a Uint8Array). */
    toBytes() {
      const allPages = [...pages, currentOps]
      let nextId = 1
      const catalogId = nextId++
      const pagesId = nextId++
      const fontRId = nextId++
      const fontBId = nextId++
      const imageIds = images.map(() => nextId++)
      const pageIds = []
      const contentIds = []
      for (let i = 0; i < allPages.length; i++) {
        pageIds.push(nextId++)
        contentIds.push(nextId++)
      }
      const maxId = nextId - 1

      const objects = {}
      objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
      objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
      objects[fontRId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
      objects[fontBId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
      images.forEach((image, i) => {
        const id = imageIds[i]
        objects[id] =
          `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.rgbBytes.length} >>\n` +
          `stream\n${bytesToBinaryString(image.rgbBytes)}\nendstream`
      })
      const xobjectDict = imageIds.length ? ` /XObject << ${imageIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ')} >>` : ''
      allPages.forEach((ops, i) => {
        const pageId = pageIds[i]
        const contentId = contentIds[i]
        objects[pageId] =
          `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
          `/Resources << /Font << /FR ${fontRId} 0 R /FB ${fontBId} 0 R >>${xobjectDict} >> ` +
          `/Contents ${contentId} 0 R >>`
        const stream = ops.join('\n')
        objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      })

      let pdf = '%PDF-1.4\n'
      const offsets = new Array(maxId + 1).fill(0)
      for (let id = 1; id <= maxId; id++) {
        offsets[id] = pdf.length
        pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
      }
      const xrefStart = pdf.length
      pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`
      for (let id = 1; id <= maxId; id++) {
        pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
      }
      pdf += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

      // Every character in `pdf` is guaranteed single-byte: structural PDF syntax is plain ASCII,
      // all user-supplied text went through sanitizeForPdf/escapePdfString above, and image bytes
      // went through bytesToBinaryString above — so mapping each UTF-16 code unit straight to a
      // byte is correct here. A TextEncoder (UTF-8) would emit multi-byte sequences for the
      // 0xA0-0xFF range and silently corrupt every byte offset (and the image data) above.
      const bytes = new Uint8Array(pdf.length)
      for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
      return bytes
    },

    toBlob() {
      return new Blob([doc.toBytes()], { type: 'application/pdf' })
    },
  }
  return doc
}

/** Triggers a browser download of a Blob under the given filename (same pattern used elsewhere
 * in this codebase for CSV/text downloads — an in-memory object URL clicked via a throwaway
 * anchor, then revoked). */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

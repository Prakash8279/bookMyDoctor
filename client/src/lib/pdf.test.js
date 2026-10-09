import { describe, expect, it } from 'vitest'
import { createPdfDoc, hexToRgb01 } from './pdf'

function bytesToLatin1String(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

describe('createPdfDoc', () => {
  it('produces a well-formed PDF 1.4 file (header, objects, xref, trailer)', () => {
    const doc = createPdfDoc()
    doc.text(50, 50, 'Hello receipt')
    const pdf = bytesToLatin1String(doc.toBytes())

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(pdf).toContain('/Type /Catalog')
    expect(pdf).toContain('/Type /Pages')
    expect(pdf).toContain('/Type /Page')
    expect(pdf).toContain('/BaseFont /Helvetica')
    expect(pdf).toContain('/BaseFont /Helvetica-Bold')
    expect(pdf).toContain('(Hello receipt) Tj')
  })

  // The whole format hinges on every xref byte offset pointing EXACTLY at the start of its
  // "N 0 obj" line — a single off-by-one (e.g. from using UTF-16 string length instead of byte
  // length anywhere) makes the file unreadable in most real PDF viewers. Parse the xref table
  // back out and verify every offset resolves correctly, rather than trusting it structurally.
  // Includes an embedded image deliberately — raw binary image bytes are exactly the kind of
  // content that breaks a naive "treat everything as UTF-16 text" byte-offset calculation.
  it('every xref offset points exactly at its "N 0 obj" line, including with an embedded image', () => {
    const doc = createPdfDoc()
    doc.text(50, 50, 'Row one')
    doc.line(50, 60, 300, 60)
    doc.rect(50, 70, 200, 40, { fill: true })
    // A tiny 2x2 RGB image with bytes spanning the full 0-255 range, including values that would
    // be misinterpreted as PDF syntax characters (e.g. 0x29 ')' , 0x28 '(') if this were ever
    // accidentally routed through the string-escaping path instead of raw binary embedding.
    doc.image(10, 10, 20, 20, { rgbBytes: new Uint8Array([0, 40, 41, 92, 255, 128, 0, 0, 0, 255, 255, 255]), pixelWidth: 2, pixelHeight: 2 })
    const pdf = bytesToLatin1String(doc.toBytes())

    const xrefIndex = pdf.lastIndexOf('\nxref\n') + 1
    const trailerIndex = pdf.indexOf('trailer', xrefIndex)
    const xrefBlock = pdf.slice(xrefIndex, trailerIndex)
    const lines = xrefBlock.split('\n').filter(Boolean)
    // First line is "xref", second is "0 <count>", then one 20-byte entry per object (plus the
    // free-list head entry for object 0).
    const entryLines = lines.slice(2)
    entryLines.forEach((line, i) => {
      const id = i // object 0 is the free-list head, object N's entry is at index N
      const match = line.match(/^(\d{10}) \d{5} [nf] ?$/)
      expect(match).not.toBeNull()
      if (id === 0) return // free-list head has no real offset to check
      const offset = Number(match[1])
      expect(pdf.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    })
  })

  it('escapes parentheses and backslashes in text so the PDF string literal stays valid', () => {
    const doc = createPdfDoc()
    doc.text(10, 10, 'Fee (partial) \\ note')
    const pdf = bytesToLatin1String(doc.toBytes())
    expect(pdf).toContain('(Fee \\(partial\\) \\\\ note) Tj')
  })

  // The Rupee sign (and anything else outside Latin-1) isn't in the standard Helvetica font's
  // WinAnsiEncoding — left as-is it would render as a missing-glyph box, or worse, since this
  // writer treats every character as exactly one byte, a multi-byte UTF-16 surrogate would also
  // throw off every later byte offset. Sanitizing to '?' keeps both the rendering and the byte
  // math safe; callers should use formatMoneyPlain ("Rs. ") instead of formatMoney ("₹") for text
  // going into a PDF built by this module.
  it('replaces characters outside the printable Latin-1 range with "?"', () => {
    const doc = createPdfDoc()
    // '₹' (U+20B9) and the Devanagari word (each character above U+00FF) are out of range and
    // become '?'; the middle dot '·' (U+00B7) is IN Latin-1/WinAnsiEncoding and stays as-is —
    // this test deliberately includes both a real "outside the range" case and a look-alike
    // that must NOT be over-sanitized.
    doc.text(10, 10, '₹1,234.50 · टोकन')
    const pdf = bytesToLatin1String(doc.toBytes())
    expect(pdf).toContain('(?1,234.50 \xb7 ????) Tj')
  })

  it('supports multiple pages via addPage()', () => {
    const doc = createPdfDoc()
    doc.text(10, 10, 'Page one')
    doc.addPage()
    doc.text(10, 10, 'Page two')
    const pdf = bytesToLatin1String(doc.toBytes())
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain('(Page one) Tj')
    expect(pdf).toContain('(Page two) Tj')
  })

  it('toBlob() returns an application/pdf Blob', () => {
    const doc = createPdfDoc()
    doc.text(10, 10, 'hi')
    const blob = doc.toBlob()
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(0)
  })

  describe('hexToRgb01', () => {
    it('converts a "#rrggbb" brand color into 0..1 RGB triples', () => {
      // #ad5d3b is BookMyDoctors's own brand color (client/src/lib/theme.js) — used here as the
      // realistic case this helper exists for, not just an arbitrary hex value.
      const [r, g, b] = hexToRgb01('#ad5d3b')
      expect(r).toBeCloseTo(173 / 255, 5)
      expect(g).toBeCloseTo(93 / 255, 5)
      expect(b).toBeCloseTo(59 / 255, 5)
    })

    it('works without the leading "#" too', () => {
      expect(hexToRgb01('ffffff')).toEqual([1, 1, 1])
      expect(hexToRgb01('#000000')).toEqual([0, 0, 0])
    })
  })

  describe('colored drawing', () => {
    it('text() with a color option emits an rg/g color pair around the text-showing operator', () => {
      const doc = createPdfDoc()
      doc.text(10, 10, 'Due', { bold: true, color: hexToRgb01('#ad5d3b') })
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).toContain('0.678 0.365 0.231 rg')
      expect(pdf).toContain('(Due) Tj')
      expect(pdf).toContain('0 g') // resets to black afterwards
    })

    it('text() with no color option stays exactly as before (no color operators at all)', () => {
      const doc = createPdfDoc()
      doc.text(10, 10, 'plain')
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).not.toContain('rg')
    })

    it('line() with a color option emits an RG operator instead of the default gray', () => {
      const doc = createPdfDoc()
      doc.line(0, 0, 100, 0, { color: hexToRgb01('#ad5d3b') })
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).toContain('0.678 0.365 0.231 RG')
      expect(pdf).not.toContain('0.7 G')
    })

    it('rect() with fillColor/strokeColor emits RG/rg operators instead of the default grays', () => {
      const doc = createPdfDoc()
      doc.rect(0, 0, 50, 50, { fill: true, stroke: true, fillColor: hexToRgb01('#f5e9e3'), strokeColor: hexToRgb01('#ad5d3b') })
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).toContain('0.961 0.914 0.890 rg')
      expect(pdf).toContain('0.678 0.365 0.231 RG')
    })
  })

  describe('image()', () => {
    // 2x2 RGB: red, green, blue, white — chosen so a real PDF reader's extracted pixels can be
    // checked exactly, not just "some image is present".
    const TEST_IMAGE = { rgbBytes: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), pixelWidth: 2, pixelHeight: 2 }

    it('embeds an Image XObject with the correct dimensions and color space', () => {
      const doc = createPdfDoc()
      doc.image(10, 10, 40, 40, TEST_IMAGE)
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).toContain('/Subtype /Image')
      expect(pdf).toContain('/Width 2')
      expect(pdf).toContain('/Height 2')
      expect(pdf).toContain('/ColorSpace /DeviceRGB')
      expect(pdf).toContain('/BitsPerComponent 8')
      expect(pdf).toContain(`/Length ${TEST_IMAGE.rgbBytes.length}`)
      expect(pdf).toContain('/XObject << /Im0')
      expect(pdf).toContain('/Im0 Do')
    })

    it('reuses the same XObject when the identical rgbBytes array is drawn again (e.g. a repeated header logo)', () => {
      const doc = createPdfDoc()
      doc.image(10, 10, 40, 40, TEST_IMAGE)
      doc.addPage()
      doc.image(10, 10, 40, 40, TEST_IMAGE) // same object reference as the logo cache would return
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(1) // embedded once, not twice
      expect(pdf.match(/\/Im0 Do/g)).toHaveLength(2) // but painted on both pages
    })

    it('silently does nothing when the image data is missing (e.g. the logo failed to load)', () => {
      const doc = createPdfDoc()
      expect(() => doc.image(10, 10, 40, 40, {})).not.toThrow()
      const pdf = bytesToLatin1String(doc.toBytes())
      expect(pdf).not.toContain('/Subtype /Image')
    })

    it('produces a file a real PDF/image library can decode back to the exact original pixels', async () => {
      const doc = createPdfDoc()
      doc.image(0, 0, 40, 40, TEST_IMAGE)
      const bytes = doc.toBytes()

      const fs = await import('node:fs/promises')
      const os = await import('node:os')
      const path = await import('node:path')
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(execFile)

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-image-test-'))
      const pdfPath = path.join(dir, 'test.pdf')
      await fs.writeFile(pdfPath, bytes)

      const script = `
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
page = r.pages[0]
images = list(page.images)
assert len(images) == 1, f"expected 1 image, got {len(images)}"
img = images[0].image.convert("RGB")
assert img.size == (2, 2), img.size
pixels = list(img.getdata())
expected = [(255,0,0), (0,255,0), (0,0,255), (255,255,255)]
assert pixels == expected, f"expected {expected}, got {pixels}"
print("OK")
`
      const scriptPath = path.join(dir, 'check.py')
      await fs.writeFile(scriptPath, script)
      try {
        const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath])
        expect(stdout.trim()).toBe('OK')
      } catch (err) {
        if (err.code === 'ENOENT' || /Python was not found/i.test(err.message || '')) {
          return
        }
        throw err
      }
    })
  })
})

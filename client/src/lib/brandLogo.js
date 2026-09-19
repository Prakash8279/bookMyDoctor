// Rasterizes the app's REAL brand mark — a heart with an ECG/pulse line through it, on a
// terracotta rounded-square background (the same PNG used as the mobile app's icon:
// mobile/assets/branding/app_icon.png, cropped to drop its safe-zone margin and copied in here as
// assets/brand-logo.png) — into raw RGB pixel bytes, so lib/pdf.js's from-scratch, dependency-free
// PDF writer can embed it as an Image XObject in every receipt/slip header (see lib/receiptPdf.js).
//
// CORRECTION: an earlier version of this file built a generic "heart-pulse" stock icon (open loop
// + zigzag, not actually heart-shaped) from scratch as an inline SVG — that SVG had been copied
// from the web app's favicon/navbar/sidebar/footer, which (per user report "galat logo use kiye
// ho" — wrong logo) turned out to ALL be using that same generic icon instead of the app's real
// logo above. Both the web app's brand marks and this PDF logo have since been switched to the
// real one (assets/brand-logo.png) — see Sidebar.jsx, PublicPages.jsx, SiteFooter.jsx,
// public/favicon.svg for the other places that same fix applies.
//
// No image-processing library is used here — this sandbox has no network route to install one
// (see pdf.js's header comment for the same constraint on the PDF format itself). Instead the
// BROWSER's own <canvas> does the raster decode: draw the bundled PNG onto an offscreen canvas,
// then read the resulting pixels back out with getImageData(). This only works where a real
// <canvas> 2D context is available (i.e. a real browser) — see loadBrandLogoRgb's fallback below
// for where it isn't (this sandbox's jsdom-based test runner has no `canvas` package installed, so
// getContext('2d') returns null there, same as it would with canvas/image decoding blocked in any
// other constrained environment).
import logoUrl from '../assets/brand-logo.png'

// The bundled source is 512x512; draw it down to this size for the PDF embed — plenty crisp at
// the ~30pt size it's actually placed at on the page (a receipt is print-quality), while keeping
// the embedded image (and so the PDF file) reasonably small.
const RASTER_SIZE = 240

/**
 * Flattens RGBA pixel data onto a white background and drops the alpha channel — PDF's raw
 * DeviceRGB image XObjects have no alpha channel. The source PNG has no transparency of its own
 * (it's a flat RGB export), so this is a no-op for every real pixel in practice, but canvas
 * getImageData() always hands back RGBA regardless of the source, so the conversion still has to
 * happen. Pure function, independent of canvas — unit-testable without a browser image decoder.
 * @param {Uint8ClampedArray|Uint8Array} rgba - 4 bytes per pixel (R,G,B,A), width*height*4 long
 * @returns {Uint8Array} 3 bytes per pixel (R,G,B), width*height*3 long
 */
export function flattenRgbaOnWhite(rgba) {
  const pixelCount = Math.floor(rgba.length / 4)
  const rgb = new Uint8Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const alpha = rgba[i * 4 + 3] / 255
    rgb[i * 3] = Math.round(rgba[i * 4] * alpha + 255 * (1 - alpha))
    rgb[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * alpha + 255 * (1 - alpha))
    rgb[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * alpha + 255 * (1 - alpha))
  }
  return rgb
}

let cachedLogoPromise = null

/**
 * Loads (and caches, for the lifetime of the page) the brand mark as raw RGB bytes ready for
 * lib/pdf.js's doc.image(). Resolves to `null` if the browser can't rasterize it — no 2D canvas
 * context, the image failed to load/decode, or the canvas came back tainted — so callers must
 * render the receipt WITHOUT a logo in that case rather than fail the whole PDF download over a
 * decorative header image.
 * @returns {Promise<{rgbBytes: Uint8Array, pixelWidth: number, pixelHeight: number}|null>}
 */
export function loadBrandLogoRgb() {
  if (cachedLogoPromise) return cachedLogoPromise
  cachedLogoPromise = new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = RASTER_SIZE
      canvas.height = RASTER_SIZE
      const ctx = canvas.getContext && canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      const image = new Image()
      image.onload = () => {
        try {
          ctx.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE)
          const { data } = ctx.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE)
          resolve({ rgbBytes: flattenRgbaOnWhite(data), pixelWidth: RASTER_SIZE, pixelHeight: RASTER_SIZE })
        } catch {
          // e.g. a tainted/unsupported canvas in some embedded WebView — draw the receipt
          // without the logo rather than fail the download outright.
          resolve(null)
        }
      }
      image.onerror = () => resolve(null)
      image.src = logoUrl
    } catch {
      resolve(null)
    }
  })
  return cachedLogoPromise
}

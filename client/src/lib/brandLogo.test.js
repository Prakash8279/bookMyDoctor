import { describe, expect, it } from 'vitest'
import { flattenRgbaOnWhite, loadBrandLogoRgb } from './brandLogo'

describe('flattenRgbaOnWhite', () => {
  it('leaves a fully opaque pixel unchanged, minus the alpha channel', () => {
    // one red pixel (255,0,0), alpha 255 (fully opaque)
    const rgba = new Uint8ClampedArray([255, 0, 0, 255])
    expect(Array.from(flattenRgbaOnWhite(rgba))).toEqual([255, 0, 0])
  })

  it('flattens a fully transparent pixel to pure white', () => {
    // the logo's rounded corners: whatever color, alpha 0 — must render as white, not black
    const rgba = new Uint8ClampedArray([10, 20, 30, 0])
    expect(Array.from(flattenRgbaOnWhite(rgba))).toEqual([255, 255, 255])
  })

  it('blends a half-transparent pixel proportionally toward white', () => {
    // brand color-ish (200,100,50) at alpha 128/255 (~50%) should land roughly halfway to white
    // for each channel — exact values below are round(255 - (255-channel) * alpha), alpha=128/255.
    const rgba = new Uint8ClampedArray([200, 100, 50, 128])
    expect(Array.from(flattenRgbaOnWhite(rgba))).toEqual([227, 177, 152])
  })

  it('processes multiple pixels in row-major order', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, // opaque red
      0, 0, 0, 0, // transparent -> white
    ])
    expect(Array.from(flattenRgbaOnWhite(rgba))).toEqual([255, 0, 0, 255, 255, 255])
  })
})

describe('loadBrandLogoRgb', () => {
  // This sandbox's jsdom test runner has no `canvas` npm package installed (confirmed: canvas
  // element's getContext('2d') returns undefined here, same as pdf.js/pypdf's own "no network
  // route to install anything" constraint) — so this exercises the documented graceful-fallback
  // path for real, rather than mocking it. A real browser (where the app actually runs) has a
  // working 2D canvas context and resolves to real pixel bytes instead — that path is exercised
  // manually since this sandbox cannot run a real browser image decoder.
  it('resolves to null rather than throwing when no 2D canvas context is available', async () => {
    await expect(loadBrandLogoRgb()).resolves.toBeNull()
  })

  it('caches its result so repeated calls do not re-attempt the (expensive) rasterization', async () => {
    const first = loadBrandLogoRgb()
    const second = loadBrandLogoRgb()
    expect(first).toBe(second) // same in-flight/resolved promise instance
  })
})

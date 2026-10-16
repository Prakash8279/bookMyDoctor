import { expect, test } from '@playwright/test'

const publicRoutes = [
  '/',
  '/for-doctors',
  '/login',
  '/register',
  '/forgot-password',
  '/search',
  '/clinics',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/cancellation-refund-policy',
  '/delete-account',
]

const phoneViewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]

test.describe('responsive public pages', () => {
  test.beforeEach(async ({ page }) => {
    // Public pages load their directory from the API during app boot. A deterministic empty
    // response keeps this layout suite independent from the database/backend while still
    // exercising the real page shells, navigation, forms and empty states.
    await page.route('http://localhost:4000/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    })
  })

  for (const viewport of phoneViewports) {
    for (const route of publicRoutes) {
      test(`${route} fits ${viewport.width}px without page-level horizontal overflow`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(route)
        await page.waitForLoadState('networkidle')

        const dimensions = await page.evaluate(() => ({
          viewport: window.innerWidth,
          rootClient: document.documentElement.clientWidth,
          rootScroll: document.documentElement.scrollWidth,
        }))

        expect(dimensions.rootClient).toBe(dimensions.viewport)
        expect(dimensions.rootScroll).toBeLessThanOrEqual(dimensions.viewport + 1)
      })
    }
  }

  test('phone navigation opens inside the viewport and exposes its links', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const menu = page.getByRole('button', { name: /toggle navigation/i })
    await expect(menu).toBeVisible()
    await menu.click()

    await expect(page.getByRole('link', { name: /find doctors/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^log in$/i })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321)
  })
})

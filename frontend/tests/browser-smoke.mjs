/** Real Chromium smoke: login, main workspaces and responsive GIS controls.
 * Runs only in GitHub Actions with a disposable backend/data directory and
 * a test-only password; never opens external providers or real user data.
 */
import assert from 'node:assert/strict'
import { launch, offlineTiles } from './browser-helpers.mjs'

const site = 'http://127.0.0.1:5173'
const secret = 'AgroRadar-Test-Only-Password!2026'
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]

const browser = await launch()

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    await offlineTiles(page.context())
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.locator('#agro-admin-password').waitFor({ timeout: 15000 })
      await page.locator('#agro-admin-password').fill(secret)
      await page.locator('.agro-login-card button[type="submit"]').click()
      await page.locator('.agr-navigation').waitFor({ timeout: 15000 })

      const views = ['Обзор', 'Карта и поля', 'Центр решений', 'ИИ-агроном', 'Пользователи']
      for (const name of views) {
        await page.getByRole('button', { name, exact: true }).click()
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        assert.ok(overflow <= 5, `${name} overflows document horizontally at ${viewport.width}: +${overflow}px`)

        if (name === 'Карта и поля') {
          const toolbar = page.locator('.agr-main-map .agr-map-toolbar')
          await toolbar.waitFor({ timeout: 15000 })
          const clipped = await toolbar.evaluate(element => {
            const wrapper = element.getBoundingClientRect()
            return [...element.querySelectorAll('button')]
              .filter(button => {
                const r = button.getBoundingClientRect()
                return r.width && r.height && (
                  r.left < wrapper.left - 2 || r.right > wrapper.right + 2 ||
                  r.top < wrapper.top - 2 || r.bottom > wrapper.bottom + 2
                )
              })
              .map(button => button.textContent?.trim() || button.getAttribute('title') || '?')
          })
          assert.deepEqual(clipped, [], `Map toolbar clips actions at ${viewport.width}px`)
        }
      }
      assert.deepEqual(errors, [], `Browser exceptions at ${viewport.width}px`)
      console.log(`PASS ${viewport.width}x${viewport.height}: auth + five views + GIS controls`)
    } catch (error) {
      await page.screenshot({ path: `browser-failure-${viewport.width}.png`, fullPage: true })
      throw error
    } finally {
      await page.close()
    }
  }
  console.log('Chromium responsive + auth smoke passed for all viewports')
} finally {
  await browser.close()
}
